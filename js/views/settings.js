/**
 * Settings — database location, appearance, accessibility, and app info.
 * Reachable without signing in, since display preferences belong to
 * whoever is holding the device.
 */

import {
  el, icon, field, select, notice, toast, confirmDialog, spinner, badge,
  fmtDateTime, download, modal,
  mount, remount } from '../util.js';
import { APP, BACKENDS, SEMESTERS, schoolYears, isDevMode, setDevMode } from '../config.js';
import { settings, connection, applySettings, markSetupComplete, endCadreSession } from '../state.js';
import { hasAdmin, signOut } from '../auth.js';
import { db, adapters, parseFolderId } from '../storage/index.js';
import { navigate } from '../router.js';
import { resetSetupDraft } from './setup.js';

export async function renderSettings(root) {
  const conn = connection.get();

  mount(root, 
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Settings'),
      el('p', { class: 'page-sub' }, 'Applies to this device. Feedback data is unaffected.')),
    await storageSection(conn),
    appearanceSection(),
    defaultsSection(),
    await accessSection(),
    aboutSection(),
  );
}

/* ------------------------------------------------------------------ *
 * Access — the development-mode escape hatch
 * ------------------------------------------------------------------ */

async function accessSection() {
  const adminExists = await hasAdmin().catch(() => false);
  const on = isDevMode();

  const toggle = el('input', {
    type: 'checkbox', checked: on,
    onchange: async (e) => {
      if (!e.target.checked) {
        setDevMode(false);
        toast('Development mode off — the portals now require sign-in.', 'ok');
        return navigate('/settings');
      }
      const confirmed = await confirmDialog('Turn on development mode?',
        'The Instructor Portal and Database Administration will open on this device without a '
        + 'sign-in. Use it only while building — never on a device students can reach.',
        { confirmLabel: 'Turn on', danger: true });
      if (!confirmed) { e.target.checked = false; return undefined; }
      setDevMode(true);
      toast('Development mode on.', 'warn');
      return navigate('/settings');
    },
  });

  return el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('h2', { class: 'section-title' }, 'Access'),

    on
      ? notice('warn', 'Development mode is on',
        el('p', {}, 'Anyone using this device can open the Instructor Portal and Database '
          + 'Administration without signing in. Turn this off before fielding the app.'))
      : notice('ok', 'Sign-in is enforced',
        el('p', {}, adminExists
          ? 'The Instructor Portal and Database Administration require an account.'
          : 'No administrator account exists yet — the first person to open Database '
            + 'Administration will be asked to create one.')),

    el('label', { class: 'check' }, toggle,
      el('span', {},
        el('span', { class: 'check__text' }, 'Development mode (skip sign-in on this device)'),
        el('span', { class: 'check__desc', style: { display: 'block' } },
          'Device-local. It does not change anyone else\'s access, and it never changes your data.'))),

    el('p', { class: 'field__hint' },
      'The roster is managed in Database Administration. Everyone signs in with their Google '
      + 'account, so this app stores no passwords — access is decided by which emails are on the '
      + 'roster, and by who your detachment has shared the Drive folder with.'));
}

/* ------------------------------------------------------------------ *
 * Storage / database location
 * ------------------------------------------------------------------ */

async function storageSection(conn) {
  const statusRow = el('div', { class: 'row row--wrap' }, spinner('Checking…'));

  db.status().then((status) => {
    remount(statusRow, 
      el('span', { class: 'conn', dataset: { status: status.status } },
        el('span', { class: 'conn__dot' }),
        el('span', {}, status.status)),
      el('span', { class: 'muted' }, status.detail || ''));
  });

  const card = el('section', { class: 'card stack' },
    el('h2', { class: 'section-title' }, 'Database location'),
    el('div', { class: 'row row--between row--wrap' },
      el('div', {},
        el('div', { class: 'eyebrow' }, 'Backend'),
        el('div', { style: { fontWeight: '570' } }, backendLabel(conn.backend)),
        conn.folderName && el('div', { class: 'muted' }, conn.folderName),
        conn.connectedAt && el('div', { class: 'faint' }, `Connected ${fmtDateTime(conn.connectedAt)}`)),
      statusRow),
  );

  if (conn.backend === BACKENDS.drive) {
    mount(card, 
      conn.folderUrl && el('a', { class: 'btn btn--sm', href: conn.folderUrl, target: '_blank', rel: 'noopener' },
        icon('external'), 'Open folder in Drive'),
      el('div', { class: 'row row--wrap' },
        el('button', {
          type: 'button', class: 'btn btn--sm',
          onclick: async () => {
            try {
              const result = await adapters.drive.connect({ interactive: true });
              toast(result.ok ? 'Reconnected to Drive.' : `Could not connect: ${result.detail || result.reason}`,
                result.ok ? 'ok' : 'danger');
            } catch (err) { toast(err.message, 'danger', 7000); }
          },
        }, icon('refresh'), 'Reconnect'),
        el('button', {
          type: 'button', class: 'btn btn--sm',
          onclick: () => { adapters.drive.signOut(); toast('Signed out of Google on this device.', 'ok'); },
        }, icon('lock'), 'Sign out of Google'),
        el('button', { type: 'button', class: 'btn btn--sm', onclick: () => editDriveTarget(conn) },
          icon('edit'), 'Change folder')));
  }

  if (conn.backend === BACKENDS.folder) {
    mount(card, el('div', { class: 'row row--wrap' },
      el('button', {
        type: 'button', class: 'btn btn--sm',
        onclick: async () => {
          const result = await adapters.folder.connect({ interactive: true });
          toast(result.ok ? 'Folder access restored.' : 'Folder access was declined.', result.ok ? 'ok' : 'warn');
        },
      }, icon('refresh'), 'Reconnect'),
      el('button', {
        type: 'button', class: 'btn btn--sm',
        onclick: async () => {
          try {
            const { name } = await adapters.folder.chooseFolder();
            connection.set({ folderName: name, connectedAt: new Date().toISOString() });
            await db.initialize({ seed: false });
            toast(`Now using "${name}".`, 'ok');
            navigate('/settings');
          } catch (err) {
            if (err.name !== 'AbortError') toast(err.message, 'danger', 7000);
          }
        },
      }, icon('folder'), 'Choose a different folder')));
  }

  if (conn.backend === BACKENDS.local) {
    mount(card, notice('warn', 'Data lives only in this browser',
      el('p', {}, 'Clearing site data will erase it. Export a backup from Cadre → Database, '
        + 'then re-run setup pointing at Google Drive when the detachment account is ready.')));
  }

  mount(card, 
    el('hr', { class: 'rule' }),
    el('div', { class: 'row row--wrap' },
      el('button', {
        type: 'button', class: 'btn',
        onclick: async () => {
          const confirmed = await confirmDialog('Re-run setup?',
            'You will choose the storage backend and location again. Export a backup first if you are switching backends — '
            + 'records do not move automatically.',
            { confirmLabel: 'Re-run setup' });
          if (!confirmed) return;
          resetSetupDraft();
          navigate('/setup?rerun=1');
        },
      }, icon('refresh'), 'Re-run setup'),
      el('button', {
        type: 'button', class: 'btn btn--danger',
        onclick: async () => {
          const confirmed = await confirmDialog('Disconnect this device?',
            'This device forgets where the database is and returns to setup. '
            + 'No records are deleted — other devices keep working.',
            { confirmLabel: 'Disconnect', danger: true });
          if (!confirmed) return;
          if (connection.get().backend === BACKENDS.drive) adapters.drive.signOut();
          if (connection.get().backend === BACKENDS.folder) await adapters.folder.forget();
          connection.reset();
          endCadreSession();
          signOut();
          markSetupComplete(false);
          resetSetupDraft();
          navigate('/setup');
        },
      }, icon('x'), 'Disconnect this device')));

  return card;
}

async function editDriveTarget(conn) {
  const clientInput = el('input', { class: 'input mono', type: 'text', value: conn.clientId || '', spellcheck: 'false' });
  const folderInput = el('input', { class: 'input', type: 'text', value: conn.folderUrl || conn.folderId || '', spellcheck: 'false' });

  const result = await modal({
    title: 'Change Drive target',
    body: el('div', {},
      field('OAuth Client ID', clientInput),
      field('Folder link or ID', folderInput),
      notice('warn', 'Records do not move',
        el('p', {}, 'Pointing at a different folder shows whatever is already in that folder. '
          + 'Export a backup first if you mean to migrate.'))),
    actions: [{ label: 'Cancel', value: null }, { label: 'Save and connect', value: 'save', variant: 'primary' }],
  });
  if (result !== 'save') return;

  const folderId = parseFolderId(folderInput.value);
  if (!folderId) return toast('That folder link could not be read.', 'danger');

  connection.set({ clientId: clientInput.value.trim(), folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}` });
  db.use(BACKENDS.drive, { clientId: clientInput.value.trim(), folderId });
  try {
    const connected = await adapters.drive.connect({ interactive: true });
    if (!connected.ok) throw new Error(connected.detail || 'Could not verify the folder.');
    connection.set({ folderName: connected.folderName, connectedAt: new Date().toISOString() });
    await db.initialize({ seed: false });
    toast(`Now using "${connected.folderName}".`, 'ok');
  } catch (err) {
    toast(err.message, 'danger', 8000);
  }
  return navigate('/settings');
}

/* ------------------------------------------------------------------ *
 * Appearance & accessibility
 * ------------------------------------------------------------------ */

function appearanceSection() {
  const current = settings.get();

  const segmented = (name, options, value, onChange) => {
    const wrap = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
    for (const option of options) {
      mount(wrap, el('label', { class: 'segmented__opt' },
        el('input', {
          type: 'radio', name, value: option.value, checked: option.value === value,
          onchange: () => onChange(option.value),
        }),
        el('span', {}, option.label)));
    }
    return wrap;
  };

  return el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('h2', { class: 'section-title' }, 'Appearance'),

    field('Theme', segmented('theme', [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ], current.theme, (value) => settings.set({ theme: value })), {
      hint: 'System follows the device\'s light/dark setting.',
    }),

    field('Color vision', segmented('palette', [
      { value: 'default', label: 'Default' },
      { value: 'deuteranopia', label: 'Deuteranopia' },
      { value: 'protanopia', label: 'Protanopia' },
      { value: 'tritanopia', label: 'Tritanopia' },
      { value: 'mono', label: 'Monochrome' },
    ], current.palette, (value) => settings.set({ palette: value })), {
      hint: 'Remaps status colors. Every status also carries an icon and a text label, '
        + 'so nothing depends on color alone.',
    }),

    field('Contrast', segmented('contrast', [
      { value: 'normal', label: 'Normal' },
      { value: 'high', label: 'High' },
    ], current.contrast, (value) => settings.set({ contrast: value }))),

    field('Text size', segmented('textSize', [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Default' },
      { value: 'lg', label: 'Large' },
    ], current.textSize, (value) => settings.set({ textSize: value }))),

    el('label', { class: 'check' },
      el('input', {
        type: 'checkbox', checked: current.reduceMotion,
        onchange: (e) => settings.set({ reduceMotion: e.target.checked }),
      }),
      el('span', {},
        el('span', { class: 'check__text' }, 'Reduce motion'),
        el('span', { class: 'check__desc', style: { display: 'block' } },
          'Turns off transitions and animations.'))),

    el('div', { class: 'row row--wrap' },
      el('button', {
        type: 'button', class: 'btn btn--sm',
        onclick: () => {
          settings.replace({});
          applySettings();
          toast('Appearance reset.', 'ok');
          navigate('/settings');
        },
      }, icon('refresh'), 'Reset appearance')),

    previewSwatches());
}

/** Shows every status color at once so a palette choice can be judged quickly. */
function previewSwatches() {
  return el('div', {},
    el('div', { class: 'eyebrow', style: { marginBottom: 'var(--sp-2)' } }, 'Preview'),
    el('div', { class: 'row row--wrap' },
      badge('Open', 'ok', 'checkCircle'),
      badge('Overdue', 'warn', 'clock'),
      badge('Closed', 'neutral', 'lock'),
      badge('Error', 'danger', 'alert'),
      badge('Info', 'info', 'info')));
}

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

function defaultsSection() {
  const current = settings.get();
  const years = schoolYears();

  return el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('h2', { class: 'section-title' }, 'Defaults'),
    el('p', { class: 'muted' }, 'Pre-selects the filters on the student screen for this device — '
      + 'useful on a kiosk laptop in a classroom.'),
    el('div', { class: 'filters' },
      field('School year', select(
        [{ value: '', label: 'Follow the calendar' }, ...years.map((y) => ({ value: y, label: y }))],
        { value: current.defaultSchoolYear, onchange: (e) => settings.set({ defaultSchoolYear: e.target.value }) })),
      field('Semester', select(
        [{ value: '', label: 'Follow the calendar' }, ...SEMESTERS.map((s) => ({ value: s, label: s }))],
        { value: current.defaultSemester, onchange: (e) => settings.set({ defaultSemester: e.target.value }) }))),
    el('label', { class: 'check' },
      el('input', {
        type: 'checkbox', checked: current.studentShowClosed,
        onchange: (e) => settings.set({ studentShowClosed: e.target.checked }),
      }),
      el('span', { class: 'check__text' }, 'Show closed requests to students by default')));
}

/* ------------------------------------------------------------------ *
 * About
 * ------------------------------------------------------------------ */

function aboutSection() {
  const install = el('div', { class: 'row row--wrap' });

  // The beforeinstallprompt event is captured in app.js and stashed here.
  const deferred = window.__topfbInstallPrompt;
  if (deferred) {
    mount(install, el('button', {
      type: 'button', class: 'btn',
      onclick: async () => {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') toast('Installing…', 'ok');
        window.__topfbInstallPrompt = null;
      },
    }, icon('download'), 'Install this app'));
  }

  return el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('h2', { class: 'section-title' }, 'About'),
    el('dl', { class: 'stack-sm' },
      row('Version', `${APP.version} (schema v${APP.schemaVersion})`),
      row('Organization', connection.get().orgName || '—'),
      row('Offline', navigator.onLine ? 'Online' : 'Offline'),
      row('Installed', window.matchMedia('(display-mode: standalone)').matches ? 'Yes' : 'No')),
    install,
    el('div', { class: 'row row--wrap' },
      el('button', {
        type: 'button', class: 'btn btn--sm',
        onclick: async () => {
          const registration = await navigator.serviceWorker?.getRegistration();
          if (!registration) return toast('No service worker registered.', 'warn');
          await registration.update();
          return toast('Checked for updates.', 'ok');
        },
      }, icon('refresh'), 'Check for updates'),
      el('button', {
        type: 'button', class: 'btn btn--sm',
        onclick: () => download('top-feedback-diagnostics.json', JSON.stringify({
          app: APP,
          connection: { ...connection.get(), clientId: connection.get().clientId ? '(set)' : '' },
          settings: settings.get(),
          userAgent: navigator.userAgent,
          online: navigator.onLine,
          generatedAt: new Date().toISOString(),
        }, null, 2)),
      }, icon('download'), 'Download diagnostics')));
}

function row(label, value) {
  return el('div', { class: 'row row--between' },
    el('dt', { class: 'muted' }, label),
    el('dd', { style: { fontWeight: '570' } }, value));
}

function backendLabel(backend) {
  return {
    [BACKENDS.drive]: 'Google Drive (organization account)',
    [BACKENDS.folder]: 'Synced folder on this computer',
    [BACKENDS.local]: 'This device only',
  }[backend] || 'Not configured';
}
