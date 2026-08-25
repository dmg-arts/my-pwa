/**
 * Instructor Portal. Everything behind an instructor sign-in: creating
 * feedback, reading responses, analysis, accounts, and database maintenance.
 *
 * Sign-in identifies who is at the keyboard on a shared device. It is not a
 * security boundary — anyone with access to the org's Drive folder can read the
 * JSON directly. Real access control is Google's folder sharing, which is
 * exactly the point of letting each detachment own its own Drive.
 */

import {
  el, icon, badge, field, select, notice, toast, spinner, emptyState, modal,
  confirmDialog, fmtDate, fmtRelative, pluralize, download, pickFile, readFileAsText,
  mount, remount } from '../util.js';
import {
  SEMESTERS, AS_CLASSES, REQUEST_STATUS, ROLES, schoolYears, isDevMode,
} from '../config.js';
import { connection } from '../state.js';
import { hasRole, currentUser, signOut, listStudents } from '../auth.js';
import { db } from '../storage/index.js';
import { navigate } from '../router.js';
import { renderAnalysis } from './analysis.js';
import { renderLogin } from './sign-in.js';
import { isRestricted, spaceShort } from '../spaces.js';
import {
  loadCatalog, saveForm, saveRequest, deleteForm, deleteRequest, writeAudit,
  canDoMaintenance, connectionStatus, loadOverview,
} from '../data-source.js';
import { buildAnonymisedExport, summariseAnonymisedExport } from '../export-anon.js';
import { record, AUDIT } from '../audit.js';

const TABS = [
  { id: 'requests', label: 'Feedback forms', iconName: 'send' },
  { id: 'analysis', label: 'Responses & analysis', iconName: 'chart' },
  { id: 'students', label: 'Students', iconName: 'users' },
  { id: 'database', label: 'Database', iconName: 'database' },
];

/** Wraps an instructor view in the sign-in gate. */
export async function requireInstructor(root, render) {
  if (hasRole(ROLES.instructor)) return render();
  return renderLogin(root, ROLES.instructor, 'Instructor Portal', render);
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

export async function renderInstructor(root, { query }) {
  return requireInstructor(root, async () => {
    remount(root, );
    const activeTab = query.get('tab') || 'requests';
    const host = el('div', {}, spinner());
    const session = currentUser();

    const tabBar = el('div', { class: 'tabs', role: 'tablist' });
    for (const tab of TABS) {
      mount(tabBar, el('button', {
        type: 'button', class: 'tab', role: 'tab',
        'aria-selected': String(tab.id === activeTab),
        onclick: () => navigate(`/instructor?tab=${tab.id}`),
      }, tab.label));
    }

    mount(root, 
      el('div', { class: 'page-head row row--between row--wrap' },
        el('div', {},
          el('h1', { class: 'page-title' }, 'Instructor Portal'),
          el('p', { class: 'page-sub' },
            session ? `${session.name} · ${connection.get().orgName || 'Detachment'}`
              : connection.get().orgName || 'Detachment')),
        el('div', { class: 'row row--wrap' },
          session && el('button', {
            type: 'button', class: 'btn btn--sm',
            onclick: () => { signOut(); toast('Signed out.', 'ok'); navigate('/home'); },
          }, icon('lock'), 'Sign out'))),

      isDevMode() && notice('warn', 'Development mode is on',
        el('p', {}, 'This portal is unlocked without a sign-in on this device. '
          + 'Turn it off in Settings before fielding the app.')),

      // The two primary actions, called out above the tabs.
      el('div', { class: 'role-grid', style: { marginBottom: 'var(--sp-5)' } },
        el('button', {
          type: 'button', class: 'role-card',
          onclick: () => navigate('/instructor/create/new'),
        },
          el('span', { class: 'role-card__icon' }, icon('plus')),
          el('span', { class: 'role-card__title' }, 'Create Feedback'),
          el('span', { class: 'role-card__desc' },
            'Build a standardized form, choose the class or event, and issue it to students.')),
        el('button', {
          type: 'button', class: 'role-card',
          onclick: () => navigate('/instructor?tab=analysis'),
        },
          el('span', { class: 'role-card__icon' }, icon('chart')),
          el('span', { class: 'role-card__title' }, 'Feedback Response and Analysis'),
          el('span', { class: 'role-card__desc' },
            'Filter by date, class, AS level or feedback ID. See scores, comments and who still owes feedback.'))),

      tabBar,
      host);

    const renderers = {
      requests: tabRequests,
      analysis: (node) => renderAnalysis(node),
      students: tabStudents,
      database: tabDatabase,
    };
    try {
      await (renderers[activeTab] || tabRequests)(host);
    } catch (err) {
      remount(host, notice('danger', 'Could not load this tab', el('p', {}, err.message)));
    }
  });
}

/* ------------------------------------------------------------------ *
 * Tab: requests
 * ------------------------------------------------------------------ */

async function tabRequests(host) {
  const [catalog, counts] = await Promise.all([loadCatalog(), db.responseCounts()]);
  const { requests, forms } = catalog;
  const templates = forms.filter((f) => f.isTemplate);
  const state = { status: '', schoolYear: '', semester: '', asClass: '', search: '' };
  const list = el('div', {});

  const draw = () => {
    const visible = requests
      .filter((r) => !state.status || r.status === state.status)
      .filter((r) => !state.schoolYear || r.schoolYear === state.schoolYear)
      .filter((r) => !state.semester || r.semester === state.semester)
      .filter((r) => !state.asClass || r.asClass === state.asClass)
      .filter((r) => !state.search
        || `${r.feedbackId || ''} ${r.title}`.toLowerCase().includes(state.search.toLowerCase()));

    remount(list, );
    if (!visible.length) {
      mount(list, emptyState({
        iconName: 'send',
        title: requests.length ? 'Nothing matches these filters' : 'No feedback forms yet',
        message: requests.length ? null : 'Create one to put a form in front of your students.',
        action: el('button', {
          type: 'button', class: 'btn btn--primary',
          onclick: () => navigate('/instructor/create/new'),
        }, icon('plus'), 'Create feedback'),
      }));
      return;
    }

    const rows = el('div', { class: 'list' });
    for (const request of visible) {
      const count = counts.byRequest?.[request.id] || 0;
      const status = REQUEST_STATUS[request.status] || REQUEST_STATUS.draft;
      const audience = request.assignedUsernames?.length
        ? `${pluralize(request.assignedUsernames.length, 'student')} selected`
        : 'Everyone at this AS level';

      mount(rows, el('button', {
        type: 'button', class: 'list__item',
        onclick: () => navigate(`/instructor/create/${request.id}`),
      },
        el('span', { class: 'list__main' },
          el('span', { class: 'list__title', style: { display: 'block' } },
            request.feedbackId
              ? [el('span', { class: 'mono faint' }, `${request.feedbackId} `), request.title]
              : request.title,
            // Restricted feedback is labelled wherever it appears, so nobody
            // has to remember which area they filed something into.
            isRestricted(request.space)
              ? [' ', badge(spaceShort(request.space), 'warn', 'lock')] : null),
          el('span', { class: 'list__meta', style: { display: 'block' } },
            [request.asClass, request.semester, request.schoolYear].filter(Boolean).join(' \u00b7 '),
            ` \u00b7 ${audience}`),
          el('span', { class: 'list__meta', style: { display: 'block' } },
            request.dueAt ? `Due ${fmtDate(request.dueAt)}` : 'No due date',
            ` \u00b7 created ${fmtRelative(request.createdAt)}`)),
        el('span', { class: 'list__aside' },
          badge(pluralize(count, 'response'), count ? 'info' : 'neutral', 'inbox'),
          badge(status.label, status.tone),
          icon('chevronRight', { cls: 'list__chev' }))));
    }
    mount(list, rows);
  };

  const years = schoolYears();
  remount(host, 
    el('div', { class: 'row row--between row--wrap', style: { marginBottom: 'var(--sp-4)' } },
      el('h2', { class: 'section-title', style: { margin: '0' } }, 'Feedback forms'),
      el('button', {
        type: 'button', class: 'btn btn--primary',
        onclick: () => navigate('/instructor/create/new'),
      }, icon('plus'), 'Create feedback')),
    el('div', { class: 'card', style: { padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)' } },
      el('div', { class: 'filters' },
        field('Status', select(
          [{ value: '', label: 'All statuses' },
            ...Object.entries(REQUEST_STATUS).map(([value, meta]) => ({ value, label: meta.label }))],
          { value: state.status, onchange: (e) => { state.status = e.target.value; draw(); } })),
        field('School year', select([{ value: '', label: 'All years' }, ...years.map((y) => ({ value: y, label: y }))],
          { onchange: (e) => { state.schoolYear = e.target.value; draw(); } })),
        field('Semester', select([{ value: '', label: 'All' }, ...SEMESTERS.map((s) => ({ value: s, label: s }))],
          { onchange: (e) => { state.semester = e.target.value; draw(); } })),
        field('AS level', select([{ value: '', label: 'All' }, ...AS_CLASSES.map((c) => ({ value: c.code, label: c.code }))],
          { onchange: (e) => { state.asClass = e.target.value; draw(); } })),
        field('Search', el('input', {
          class: 'input', type: 'search', placeholder: 'Feedback ID or name\u2026',
          oninput: (e) => { state.search = e.target.value; draw(); },
        })))),
    list,
    templateLibrary(templates));
  draw();
}

/**
 * Saved question sets, offered under "Start from" whenever anyone creates
 * feedback. Keeping the wording identical between terms is the whole reason
 * the results are comparable at all.
 */
function templateLibrary(templates) {
  const section = el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('h3', { class: 'section-title' }, `Question templates (${templates.length})`),
    el('p', { class: 'muted' },
      'Reusable sets of questions. Save one from the form creator, then start from it next term '
      + 'so the wording does not drift.'));

  if (!templates.length) {
    mount(section, el('p', { class: 'field__hint' },
      'None yet. Build a form, then use "Save as template" in the creator.'));
    return section;
  }

  const list = el('div', { class: 'list' });
  for (const template of templates) {
    const count = (template.sections || []).reduce((n, sec) => n + (sec.items || []).length, 0);
    mount(list, el('div', { class: 'list__item' },
      el('span', { class: 'list__main' },
        el('span', { class: 'list__title', style: { display: 'block' } }, template.name),
        el('span', { class: 'list__meta', style: { display: 'block' } },
          `${pluralize(count, 'question')} \u00b7 saved ${fmtDate(template.updatedAt || template.createdAt)}`)),
      el('span', { class: 'list__aside' },
        el('button', {
          type: 'button', class: 'btn btn--sm',
          onclick: () => navigate('/instructor/create/new'),
        }, icon('plus'), 'Use'),
        el('button', {
          type: 'button', class: 'btn btn--sm btn--ghost', title: 'Delete template',
          onclick: async () => {
            if (!(await confirmDialog('Delete this template?',
              `"${template.name}" will no longer be offered. Feedback already issued from it is `
              + 'unaffected.', { confirmLabel: 'Delete', danger: true }))) return;
            await deleteForm(template.id);
            toast('Template deleted.', 'ok');
            navigate('/instructor?tab=requests');
          },
        }, icon('trash')))));
  }
  mount(section, list);
  return section;
}

/* ------------------------------------------------------------------ *
 * Tab: students (read-only \u2014 accounts are managed by an admin)
 * ------------------------------------------------------------------ */

async function tabStudents(host) {
  const students = await listStudents();
  const state = { search: '', asClass: '' };
  const table = el('div', {});

  function paint() {
    const rows = students
      .filter((s) => !state.asClass || s.asClass === state.asClass)
      .filter((s) => !state.search
        || `${s.name} ${s.username}`.toLowerCase().includes(state.search.toLowerCase()));

    if (!rows.length) {
      remount(table, emptyState({
        iconName: 'users',
        title: students.length ? 'No students match' : 'No student accounts yet',
        message: students.length ? 'Try a different filter.'
          : 'A database administrator creates student accounts and usernames.',
        action: el('button', {
          type: 'button', class: 'btn btn--primary', onclick: () => navigate('/admin'),
        }, icon('database'), 'Open Database Administration'),
      }));
      return;
    }

    const body = el('tbody');
    for (const student of rows) {
      mount(body, el('tr', {},
        el('td', {}, student.name),
        el('td', { class: 'mono' }, student.username),
        el('td', {}, student.asClass || '\u2014'),
        el('td', {}, student.section || '\u2014')));
    }
    remount(table, el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Name'), el('th', {}, 'Username'),
          el('th', {}, 'AS level'), el('th', {}, 'Section'))),
        body)));
  }

  remount(host, 
    el('div', { class: 'row row--between row--wrap', style: { marginBottom: 'var(--sp-4)' } },
      el('h2', { class: 'section-title', style: { margin: '0' } }, `Students (${students.length})`),
      el('button', { type: 'button', class: 'btn btn--sm', onclick: () => navigate('/admin') },
        icon('database'), 'Manage accounts')),
    notice('info', 'Usernames are how students identify themselves',
      el('p', {}, 'A student types their username on the feedback form. It is checked against this '
        + 'list at submission, and each username can submit a given form only once.')),
    el('div', { class: 'card', style: { padding: 'var(--sp-4)', margin: 'var(--sp-4) 0' } },
      el('div', { class: 'filters' },
        field('AS level', select(
          [{ value: '', label: 'All levels' }, ...AS_CLASSES.map((c) => ({ value: c.code, label: c.label }))],
          { onchange: (e) => { state.asClass = e.target.value; paint(); } })),
        field('Search', el('input', {
          class: 'input', type: 'search', placeholder: 'Name or username\u2026',
          oninput: (e) => { state.search = e.target.value; paint(); },
        })))),
    table);
  paint();
}

/* ------------------------------------------------------------------ *
 * Tab: database
 * ------------------------------------------------------------------ */

async function tabDatabase(host) {
  const conn = connection.get();
  // In proxy mode there is no storage adapter on this device at all, so the
  // counts come from the server and maintenance is somebody else's job.
  const [stats, status] = await Promise.all([
    canDoMaintenance() ? db.stats() : loadOverview().then((o) => o.stats),
    connectionStatus(),
  ]);

  const statCard = (label, value, note = null) =>
    el('div', { class: 'stat' },
      el('div', { class: 'stat__label' }, label),
      el('div', { class: 'stat__value' }, String(value)),
      note && el('div', { class: 'stat__note' }, note));

  /**
   * The anonymised export.
   *
   * Confirmed rather than immediate, because this is the one file that can
   * legitimately leave the detachment and an administrator should see what is
   * in it before it does.
   */
  async function exportAnonymised() {
    const busy = toast('Checking what would be exported…', 'info', 20000);
    let summary;
    try {
      summary = await summariseAnonymisedExport();
    } catch (err) {
      busy.remove();
      return toast(`Could not read the records: ${err.message}`, 'danger', 8000);
    }
    busy.remove();

    const includeFlagged = el('input', { type: 'checkbox' });
    const choice = await modal({
      title: 'Export anonymised records',
      body: el('div', { class: 'stack' },
        el('p', {}, 'A copy of the written feedback with the roster, every respondent, '
          + 'receipt names and the detachment\'s own name removed. Timestamps are reduced '
          + 'to the month, because a receipt written seconds before a response identifies '
          + 'its author by elimination.'),

        el('div', { class: 'grid grid--3' },
          statCard('Responses', summary.responses),
          statCard('Written answers', summary.textAnswers),
          statCard('Flagged', summary.flagged, 'excluded by default')),

        notice('warn', 'Free text can still identify people',
          el('p', {}, 'Removing fields cannot change what someone wrote. A cadet who says '
            + 'they are the only AS400 in their flight has identified themselves. Treat this '
            + 'as feedback, not as anonymous statistics.')),

        summary.flagged
          ? el('label', { class: 'check' }, includeFlagged,
            el('span', {},
              el('span', { class: 'check__text' },
                `Include the ${pluralize(summary.flagged, 'flagged response')}`),
              el('span', { class: 'check__desc', style: { display: 'block' } },
                'These are the ones most likely to describe a real incident and to identify '
                + 'people by circumstance. Leave this unticked unless you have a specific '
                + 'reason and the authority to decide it.')))
          : null),
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Export', value: 'go', variant: 'primary' },
      ],
    });
    if (choice !== 'go') return undefined;

    try {
      const bundle = await buildAnonymisedExport({ includeFlagged: includeFlagged.checked });
      download(`top-feedback-anonymised-${new Date().toISOString().slice(0, 7)}.json`,
        JSON.stringify(bundle, null, 2));
      await writeAudit({
        action: AUDIT.dataExported,
        summary: `Exported ${pluralize(bundle.responses.length, 'response')} anonymised`
          + (includeFlagged.checked ? ', including flagged ones' : ''),
        detail: {
          responses: bundle.responses.length,
          flaggedIncluded: includeFlagged.checked,
          flaggedExcluded: bundle.excludedFlaggedCount,
        },
      });
      return toast('Anonymised export downloaded.', 'ok', 6000);
    } catch (err) {
      return toast(`Export failed: ${err.message}`, 'danger', 8000);
    }
  }

  async function exportBundle() {
    try {
      const bundle = await db.exportBundle();
      download(`top-feedback-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(bundle, null, 2));
      toast('Backup downloaded.', 'ok');
    } catch (err) {
      toast(`Export failed: ${err.message}`, 'danger', 7000);
    }
  }

  async function importBundle() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    const mode = await modal({
      title: 'Import backup',
      body: el('div', {},
        el('p', {}, 'Merge keeps what is already here and adds the backup on top. '
          + 'Replace deletes every current record first.'),
        notice('warn', 'Replace cannot be undone', el('p', {}, 'Export a backup first if you are unsure.'))),
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Replace', value: 'replace', variant: 'danger' },
        { label: 'Merge', value: 'merge', variant: 'primary', autofocus: true },
      ],
    });
    if (!mode) return;
    try {
      const counts = await db.importBundle(JSON.parse(await readFileAsText(file)), { mode });
      await writeAudit({
        action: AUDIT.dataImported,
        summary: `Imported a backup (${mode}): ${counts.requests} forms, ${counts.responses} responses`,
        detail: counts,
      });
      toast(`Imported ${counts.requests} requests, ${counts.responses} responses, ${counts.forms} forms.`, 'ok', 6000);
      navigate('/instructor?tab=database');
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'danger', 8000);
    }
  }

  async function wipe() {
    if (!(await confirmDialog('Delete every record?',
      'Requests, responses, form templates and the roster will all be deleted. '
      + 'The folder structure stays. This cannot be undone.',
      { confirmLabel: 'Delete everything', danger: true }))) return;
    const typed = await promptText('Type DELETE to confirm');
    if (typed !== 'DELETE') return toast('Cancelled — nothing was deleted.', 'warn');
    await db.wipeData();
    await writeAudit({
      action: AUDIT.dataWiped,
      summary: `Deleted every record (${stats.requests} forms, ${stats.responses} responses)`,
      reason: 'Confirmed by typing DELETE',
    });
    toast('All records deleted.', 'ok');
    return navigate('/instructor?tab=database');
  }

  remount(host, 
    el('h2', { class: 'section-title' }, 'Database'),

    el('div', { class: 'grid grid--3', style: { marginBottom: 'var(--sp-5)' } },
      statCard('Requests', stats.requests, `${stats.openRequests} open`),
      statCard('Responses', stats.responses),
      statCard('Students', stats.students),
      statCard('Templates', stats.forms)),

    el('div', { class: 'card stack' },
      el('h3', { class: 'section-title' }, 'Connection'),
      el('div', { class: 'row row--between row--wrap' },
        el('div', {},
          el('div', { style: { fontWeight: '570' } }, backendLabel(conn.backend)),
          el('div', { class: 'muted' }, status.detail || '')),
        el('span', { class: 'conn', dataset: { status: status.status } },
          el('span', { class: 'conn__dot' }), el('span', {}, status.status))),
      conn.folderUrl && el('a', { class: 'btn btn--sm', href: conn.folderUrl, target: '_blank', rel: 'noopener' },
        icon('external'), 'Open folder in Google Drive'),
      el('div', { class: 'row row--wrap' },
        el('button', { type: 'button', class: 'btn btn--sm', onclick: () => navigate('/settings') },
          icon('settings'), 'Change location'),
        el('button', {
          type: 'button', class: 'btn btn--sm',
          onclick: async () => {
            try {
              await db.initialize({ seed: false });
              toast('Folder structure verified.', 'ok');
            } catch (err) { toast(err.message, 'danger', 7000); }
          },
        }, icon('refresh'), 'Verify folders'))),

    el('div', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
      el('h3', { class: 'section-title' }, 'Backup and restore'),
      el('p', { class: 'muted' },
        'A backup is a single JSON file containing every record. It imports into any '
        + 'TOP-Feedback install, which is also how you migrate from this device to Google Drive.'),
      el('div', { class: 'row row--wrap' },
        canDoMaintenance()
          ? el('button', { type: 'button', class: 'btn', onclick: exportBundle }, icon('download'), 'Export backup')
          : null,
        canDoMaintenance()
          ? el('button', { type: 'button', class: 'btn', onclick: importBundle }, icon('upload'), 'Import backup')
          : null,
        canDoMaintenance()
          ? el('button', { type: 'button', class: 'btn', onclick: exportAnonymised },
            icon('eye'), 'Export anonymised')
          : null),

      canDoMaintenance()
        ? el('p', { class: 'field__hint' },
          'An anonymised export carries the feedback without the roster, the respondents, '
          + 'receipt names or the detachment\'s name, and rounds timestamps to the month. '
          + 'It is the version to keep off-site, and the only one appropriate to share.')
        : null),

    canDoMaintenance() ? null : notice('info', 'Maintenance runs from the folder owner\'s device',
      el('p', {}, 'Backup, restore and wipe act on the whole folder, and this detachment routes '
        + 'through its own server — which deliberately offers no way to do any of that remotely. '
        + 'An endpoint that could empty a detachment\'s records on request is not one worth '
        + 'having. Sign in on the account that owns the Drive folder to run them.')),

    el('div', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
      el('h3', { class: 'section-title' }, 'Danger zone'),
      notice('danger', 'Deleting records is permanent',
        el('p', {}, db.backendId === 'drive'
          ? 'Files are moved to the Drive trash, where Google keeps them for 30 days.'
          : 'Deleted records cannot be recovered from here.')),
      el('div', { class: 'row row--wrap' },
        el('button', { type: 'button', class: 'btn btn--danger', onclick: wipe }, icon('trash'), 'Delete all records'))),
  );
}

function backendLabel(backend) {
  return {
    drive: 'Google Drive (organization account)',
    folder: 'Synced folder on this computer',
    local: 'This device only',
  }[backend] || 'Not configured';
}

/** Small text prompt built on the modal helper. */
async function promptText(title) {
  const input = el('input', { class: 'input', type: 'text', autocomplete: 'off' });
  const ok = await modal({
    title,
    body: input,
    actions: [{ label: 'Cancel', value: false }, { label: 'Confirm', value: true, variant: 'danger' }],
  });
  return ok ? input.value.trim() : null;
}
