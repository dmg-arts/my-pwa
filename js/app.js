/**
 * Bootstrap: apply display settings, register routes, wire the app bar, and
 * start the service worker.
 */

import { APP } from './config.js';
import { $, el, icon, toast, mount, remount } from './util.js';
import { applySettings, connection, isConfigured } from './state.js';
import { db } from './storage/index.js';
import { route, startRouter, navigate, currentPath } from './router.js';
import { renderHome } from './views/home.js';
import { renderSetup } from './views/setup.js';
import { renderJoin } from './views/join.js';
import { renderInvite } from './views/invite.js';
import { renderStudentList, renderStudentFill } from './views/student.js';
import { renderInstructor } from './views/instructor.js';
import { renderFormCreator } from './views/formCreator.js';
import { renderAdmin } from './views/admin.js';
import { renderSettings } from './views/settings.js';
import { primeOverlay, flushQueue, onQueueChange, queueState } from './storage/index.js';

applySettings();

/* ------------------------------------------------------------------ *
 * routes
 * ------------------------------------------------------------------ */

/** Sends anyone who has not finished setup to the wizard. */
const requireSetup = () => (isConfigured() ? null : '/setup');

route('/', () => navigate('/home', { replace: true }));
route('/setup', ({ outlet, query }) => renderSetup(outlet, { rerun: query.get('rerun') === '1' }),
  { title: 'Setup' });
route('/join', ({ outlet, query }) => renderJoin(outlet, { query }), { title: 'Join' });
route('/home', ({ outlet }) => renderHome(outlet), { guard: requireSetup, title: 'Home' });

route('/student', ({ outlet }) => renderStudentList(outlet), { guard: requireSetup, title: 'Student' });
route('/student/fill/:id', ({ outlet, params }) => renderStudentFill(outlet, { params }),
  { guard: requireSetup, title: 'Feedback' });

route('/instructor', ({ outlet, query }) => renderInstructor(outlet, { query }),
  { guard: requireSetup, title: 'Instructor Portal' });
route('/instructor/create/:id', ({ outlet, params }) => renderFormCreator(outlet, { params }),
  { guard: requireSetup, title: 'Create Feedback' });

route('/admin/invite', ({ outlet }) => renderInvite(outlet),
  { guard: requireSetup, title: 'Invite' });
route('/admin', ({ outlet, query }) => renderAdmin(outlet, { query }),
  { guard: requireSetup, title: 'Database Administration' });

route('/settings', ({ outlet }) => renderSettings(outlet), { title: 'Settings' });

// The portal moved; keep old bookmarks and shortcuts working.
route('/cadre', () => navigate('/instructor', { replace: true }));

/* ------------------------------------------------------------------ *
 * app bar
 * ------------------------------------------------------------------ */

function buildAppBar() {
  const bar = $('#appbar');
  const conn = connection.get();

  const back = el('button', {
    type: 'button', class: 'btn btn--icon btn--ghost', 'aria-label': 'Back to home',
    onclick: () => navigate('/home'),
  }, icon('arrowLeft'));

  const brand = el('button', {
    type: 'button', class: 'appbar__brand',
    style: { background: 'none', border: '0', padding: '0', cursor: 'pointer', textAlign: 'left' },
    onclick: () => navigate('/home'),
  },
    el('span', { class: 'appbar__mark', 'aria-hidden': 'true' }, 'TF'),
    el('span', { style: { minWidth: '0' } },
      el('span', { class: 'appbar__title', style: { display: 'block' } }, APP.name),
      el('span', { class: 'appbar__sub', style: { display: 'block' } }, conn.orgName || 'Not configured')));

  const status = el('span', { class: 'conn', dataset: { status: 'unknown' }, id: 'conn-indicator' },
    el('span', { class: 'conn__dot' }),
    el('span', { class: 'conn__label' }, 'checking'),
    el('span', { class: 'visually-hidden' }, 'Database connection status'));

  remount(bar, 
    back, brand,
    el('span', { class: 'appbar__spacer' }),
    buildQueuePill(),
    status,
    el('button', {
      type: 'button', class: 'btn btn--icon btn--ghost', 'aria-label': 'Settings',
      onclick: () => navigate('/settings'),
    }, icon('settings')));
}

buildAppBar();
// The org name and connection live in the bar, so rebuild it when they change.
connection.subscribe(() => { buildAppBar(); syncAppBar(); refreshStatus(); });

/** Hides the back button on the home screen, where it has nowhere to go. */
function syncAppBar() {
  const path = currentPath();
  const atHome = path === '/home' || path === '/' || path === '/setup' || path === '/join';
  const back = $('#appbar .btn--icon');
  if (back) back.hidden = atHome;
}

/** Connection pill: refreshed on navigation and when the network flips. */
async function refreshStatus() {
  const node = $('#conn-indicator');
  if (!node) return;
  if (!isConfigured()) {
    node.dataset.status = 'unknown';
    node.querySelector('.conn__label').textContent = 'setup';
    return;
  }
  try {
    const status = await db.status();
    node.dataset.status = status.status;
    node.querySelector('.conn__label').textContent = status.status;
    node.title = status.detail || '';
  } catch (err) {
    node.dataset.status = 'error';
    node.querySelector('.conn__label').textContent = 'error';
    node.title = err.message;
  }
}

/**
 * Pending-write badge. Anything queued while offline is surfaced here rather
 * than silently held, and clicking it retries immediately.
 */
function buildQueuePill() {
  const pill = el('button', {
    type: 'button', class: 'conn queue-pill', id: 'queue-pill', hidden: true,
    title: 'Retry sending now',
    onclick: () => sendQueue({ manual: true }),
  }, icon('upload'), el('span', { id: 'queue-count' }, '0'));
  return pill;
}

async function refreshQueuePill(state = null) {
  const pill = $('#queue-pill');
  if (!pill) return;
  const { pending, draining } = state || await queueState();
  pill.hidden = pending === 0;
  pill.dataset.status = draining ? 'offline' : pending ? 'error' : 'ready';
  const count = $('#queue-count');
  if (count) count.textContent = draining ? 'sending…' : String(pending);
}

let flushing = false;
async function sendQueue({ manual = false } = {}) {
  if (flushing) return;
  flushing = true;
  try {
    const before = (await queueState()).pending;
    if (!before) {
      if (manual) toast('Nothing is waiting to send.', 'info', 2500);
      return;
    }
    const result = await flushQueue();
    if (result.sent) toast(`Sent ${result.sent} saved ${result.sent === 1 ? 'change' : 'changes'}.`, 'ok');
    else if (manual) toast('Still no connection — your work is safe on this device.', 'warn', 5000);
  } catch (err) {
    if (manual) toast(err.message, 'danger', 6000);
  } finally {
    flushing = false;
    refreshQueuePill();
  }
}

onQueueChange((state) => refreshQueuePill(state));

window.addEventListener('online', () => {
  refreshStatus();
  toast('Back online.', 'ok', 2500);
  sendQueue();
});
window.addEventListener('offline', () => {
  refreshStatus();
  toast('Offline — your work is saved on this device and sent when you reconnect.', 'warn', 5000);
});

/* ------------------------------------------------------------------ *
 * start
 * ------------------------------------------------------------------ */

// Re-point the storage facade at whatever this device was set up with.
if (connection.get().backend) db.use(connection.get().backend);

startRouter($('#view'), {
  afterRender: (current) => {
    document.title = current.title ? `${current.title} · ${APP.name}` : APP.name;
    syncAppBar();
    refreshStatus();
    refreshQueuePill();
  },
});

// Restore anything queued from a previous session, then try to send it.
primeOverlay()
  .then(() => refreshQueuePill())
  .then(() => { if (navigator.onLine) sendQueue(); })
  .catch((err) => console.warn('[queue] could not restore', err));

/**
 * Bring the connected folder up to this build's schema before any view reads
 * it. A device opening a detachment's folder for the first time after an update
 * is the normal case, so this runs quietly and only speaks up if it did work.
 */
async function migrateIfNeeded() {
  if (!isConfigured()) return;
  try {
    const status = await db.migrationStatus();
    if (!status.pending.length) return;
    const busy = toast(`Updating your database to v${status.to}…`, 'info', 60000);
    const result = await db.migrate();
    busy.remove();
    if (result.ran.length) {
      toast(`Database updated from v${result.from} to v${result.to}.`, 'ok', 6000);
      console.info('[migrations]', result.ran, result.notes);
    }
  } catch (err) {
    console.error('[migrations]', err);
    toast(`Database update failed: ${err.message}`, 'danger', 12000);
  }
}

migrateIfNeeded();

/* ------------------------------------------------------------------ *
 * PWA plumbing
 * ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            // An installed app has no address bar to reload from, so the
            // notice has to carry the action itself.
            const notice = toast('An update is ready.', 'info', 15000);
            mount(notice, el('button', {
              type: 'button', class: 'btn btn--sm',
              style: { marginLeft: 'var(--sp-3)' },
              onclick: () => window.location.reload(),
            }, 'Reload'));
          }
        });
      });
    }).catch((err) => console.warn('[sw] registration failed', err));
  });
}

// Stashed so Settings can offer an explicit "Install this app" button.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.__topfbInstallPrompt = event;
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled]', event.reason);
  toast(event.reason?.message || 'Something went wrong.', 'danger', 6000);
});
