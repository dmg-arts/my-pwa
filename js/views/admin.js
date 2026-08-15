/**
 * Database Administration — account maintenance for one organization.
 *
 * Every account lives in the organization's own Drive folder, so a detachment
 * owns its user base the same way it owns its feedback. Students, instructors
 * and administrators all sign in with a username and password; an admin can
 * create accounts and reset any password.
 *
 * There is no first-run bootstrap: the built-in administrator always works, so
 * a detachment can reach a brand-new folder and can never lock itself out.
 */

import {
  el, icon, field, select, notice, toast, spinner, badge, modal, confirmDialog,
  emptyState, download, toCsv, pickFile, readFileAsText, pluralize, fmtDate, fmtDateTime,
  mount, remount } from '../util.js';
import {
  AS_CLASSES, ROLES, ROLE_LABELS, BUILTIN_ADMIN, AS_PROGRESSION,
  currentSchoolYear, isDevMode,
} from '../config.js';
import { record, recent, AUDIT, AUDIT_LABELS } from '../audit.js';
import {
  listAccounts, createAccount, updateAccount, deleteAccount, hasAdmin,
  signIn, signOut, currentUser, hasRole, validateUsername, validatePassword,
  suggestUsername, normalizeUsername, resetPassword,
} from '../auth.js';
import { db } from '../storage/index.js';
import { navigate } from '../router.js';

export async function renderAdmin(root, { query }) {
  // The built-in administrator always works, so there is no bootstrap gate:
  // a brand-new folder is reached with the standard credential, and the console
  // then prompts for a named admin account.
  if (!hasRole(ROLES.admin)) {
    return renderLogin(root, ROLES.admin, 'Database Administration',
      () => renderAdmin(root, { query }));
  }
  return renderConsole(root);
}

/* ------------------------------------------------------------------ *
 * sign in — shared by admin and instructor portals
 * ------------------------------------------------------------------ */

export async function renderLogin(root, role, title, onSuccess) {
  // On a folder with no named administrator yet, point at the built-in account
  // rather than leaving someone stuck on a login screen they cannot pass.
  const hint = el('div', {});
  if (role === ROLES.admin) {
    hasAdmin().then((exists) => {
      if (exists) return;
      remount(hint, notice('info', 'No administrator account exists yet',
        el('p', {}, 'Sign in with the built-in administrator username ',
          el('code', { class: 'mono' }, BUILTIN_ADMIN.username),
          ' and the standard password from your setup documentation, then create a named account.')));
    }).catch(() => {});
  }

  const username = el('input', {
    class: 'input', type: 'text', autocomplete: 'username',
    onkeydown: (e) => { if (e.key === 'Enter') password.focus(); },
  });
  const password = el('input', {
    class: 'input', type: 'password', autocomplete: 'current-password',
    onkeydown: (e) => { if (e.key === 'Enter') attempt(); },
  });
  const error = el('div', { class: 'field__error', hidden: true });
  const submit = el('button', { type: 'button', class: 'btn btn--primary btn--block btn--lg', onclick: attempt },
    icon('unlock'), 'Sign in');

  async function attempt() {
    error.hidden = true;
    submit.disabled = true;
    try {
      await signIn(username.value, password.value, role);
      toast(`Signed in as ${normalizeUsername(username.value)}.`, 'ok');
      onSuccess();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
      password.select();
    }
  }

  remount(root, el('div', { class: 'wizard stack' },
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, title),
      el('p', { class: 'page-sub' }, `Sign in with your ${ROLE_LABELS[role].toLowerCase()} account.`)),

    el('div', { class: 'card stack' },
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('span', { class: 'role-card__icon' }, icon('lock'))),
      field('Username', username, { required: true }),
      field('Password', password, { required: true }),
      error,
      submit,
      el('p', { class: 'field__hint' },
        'Forgot it? A database administrator can reset any password from '
        + 'Database Administration → Accounts.'),
      hint),

    el('div', { class: 'row', style: { justifyContent: 'center' } },
      el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => navigate('/home') },
        icon('arrowLeft'), 'Back to home'))));

  setTimeout(() => username.focus(), 50);
}

/* ------------------------------------------------------------------ *
 * console
 * ------------------------------------------------------------------ */

async function renderConsole(root) {
  remount(root, spinner('Loading accounts…'));
  let accounts = await listAccounts();

  const table = el('div', {});
  const state = { role: '', search: '' };

  const reload = async () => { accounts = await listAccounts(); paint(); };

  async function editAccount(existing = null, defaults = {}) {
    const isNew = !existing;
    const name = el('input', { class: 'input', type: 'text', value: existing?.name || '' });
    const username = el('input', {
      class: 'input mono', type: 'text', value: existing?.username || '',
      placeholder: 'auto-generated from the name',
    });
    // Suggest a username while the name is typed, and stop the moment the
    // admin edits the username themselves. Deliberately not on `blur`: that
    // fires as focus moves *into* the username field, so the suggestion would
    // land in the middle of whatever they were about to type.
    let usernameEdited = !isNew;
    username.addEventListener('input', () => { usernameEdited = true; });
    if (isNew) {
      name.addEventListener('input', () => {
        if (usernameEdited) return;
        username.value = name.value.trim()
          ? suggestUsername(name.value, accounts.map((a) => a.username))
          : '';
      });
    }
    const asClass = select([{ value: '', label: '—' }, ...AS_CLASSES.map((c) => ({ value: c.code, label: c.label }))],
      { value: existing?.asClass || '' });
    const section = el('input', { class: 'input', type: 'text', value: existing?.section || '' });
    const email = el('input', { class: 'input', type: 'email', value: existing?.email || '' });

    const roleBoxes = Object.values(ROLES).map((role) => {
      const input = el('input', {
        type: 'checkbox', value: role,
        checked: existing
          ? existing.roles?.includes(role)
          : (defaults.roles ? defaults.roles.includes(role) : role === ROLES.student),
        onchange: () => syncPassword(),
      });
      return { role, input, node: el('label', { class: 'check' }, input,
        el('span', {},
          el('span', { class: 'check__text' }, ROLE_LABELS[role]),
          el('span', { class: 'check__desc', style: { display: 'block' } }, ROLE_HINTS[role]))) };
    });

    const password = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const passwordHint = el('span', {});
    const passwordField = field(isNew ? 'Password' : 'New password (leave blank to keep)', password, {
      hint: passwordHint,
    });
    const activeBox = el('input', { type: 'checkbox', checked: existing ? existing.active !== false : true });

    // Every account signs in now, students included, so the password field is
    // always shown; only the minimum length changes with the role.
    function syncPassword() {
      const privileged = roleBoxes.some((r) => r.input.checked && r.role !== ROLES.student);
      passwordHint.textContent = privileged
        ? 'Minimum 8 characters for instructor and admin accounts.'
        : 'Minimum 6 characters. Cadets type this on a phone before every submission.';
    }
    syncPassword();

    const result = await modal({
      title: isNew ? 'Create account' : `Edit ${existing.username}`,
      body: el('div', { class: 'stack' },
        field('Name', name, { required: true }),
        field('Username', username, { required: true, hint: 'Unique, not case sensitive. Students type this on the feedback form.' }),
        el('div', {}, el('div', { class: 'field__label' }, 'Roles'),
          el('div', { class: 'stack-sm' }, ...roleBoxes.map((r) => r.node))),
        passwordField,
        el('div', { class: 'filters' }, field('AS level', asClass), field('Section / flight', section)),
        field('Email', email),
        el('label', { class: 'check' }, activeBox,
          el('span', { class: 'check__text' }, 'Active'))),
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', variant: 'primary' }],
    });
    if (result !== 'save') return;

    const roles = roleBoxes.filter((r) => r.input.checked).map((r) => r.role);
    if (!roles.length) return toast('Pick at least one role.', 'warn');

    try {
      if (isNew) {
        await createAccount({
          username: username.value || suggestUsername(name.value, accounts.map((a) => a.username)),
          name: name.value,
          roles,
          asClass: asClass.value,
          section: section.value.trim(),
          email: email.value.trim(),
          password: password.value || null,
        });
        toast('Account created.', 'ok');
      } else {
        const wouldOrphan = existing.roles?.includes(ROLES.admin) && !roles.includes(ROLES.admin)
          && accounts.filter((a) => a.roles?.includes(ROLES.admin) && a.active !== false).length <= 1;
        if (wouldOrphan) return toast('That is the only admin account — give another account admin first.', 'warn', 6000);

        await updateAccount(existing.id, {
          name: name.value,
          username: username.value,
          roles,
          asClass: asClass.value,
          section: section.value.trim(),
          email: email.value.trim(),
          active: activeBox.checked,
          ...(password.value ? { newPassword: password.value } : {}),
        });
        toast('Account updated.', 'ok');
      }
      return reload();
    } catch (err) {
      return toast(err.message, 'danger', 7000);
    }
  }

  /**
   * Password reset. Admins do this constantly — a cadet forgets a password
   * before a deadline — so it is one click from the account row rather than
   * buried in the edit dialog.
   */
  async function resetPasswordFor(account) {
    const next = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const confirmField = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const error = el('div', { class: 'field__error', hidden: true });
    const privileged = (account.roles || []).some((r) => r !== ROLES.student);

    const suggestion = suggestPassword();
    const useSuggested = el('button', {
      type: 'button', class: 'btn btn--sm',
      onclick: () => { next.value = suggestion; confirmField.value = suggestion; },
    }, icon('refresh'), 'Use suggested');

    const result = await modal({
      title: `Reset password — ${account.username}`,
      body: el('div', { class: 'stack' },
        field('New password', next, {
          required: true,
          hint: `Minimum ${privileged ? 8 : 6} characters.`,
        }),
        field('Confirm', confirmField, { required: true }),
        el('div', { class: 'row row--wrap' },
          useSuggested,
          el('span', { class: 'mono muted' }, suggestion)),
        error,
        notice('info', 'Hand it over in person',
          el('p', {}, 'This app cannot send email. Write the new password down, give it to them '
            + 'directly, and pick something they can actually remember.'))),
      actions: [{ label: 'Cancel', value: null }, { label: 'Reset password', value: 'save', variant: 'primary' }],
    });
    if (result !== 'save') return undefined;

    if (next.value !== confirmField.value) return toast('The two passwords do not match.', 'warn');
    try {
      await resetPassword(account.id, next.value);
      toast(`Password reset for ${account.username}.`, 'ok', 5000);
      return reload();
    } catch (err) {
      return toast(err.message, 'danger', 7000);
    }
  }

  async function importCsv() {
    const file = await pickFile('.csv,text/csv');
    if (!file) return;
    try {
      const rows = parseCsv(await readFileAsText(file));
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const col = (...names) => header.findIndex((h) => names.includes(h));
      const nameCol = col('name', 'student', 'full name');
      if (nameCol < 0) throw new Error('No "name" column found.');
      const userCol = col('username', 'user');
      const classCol = col('class', 'as class', 'asclass', 'as level');

      const pwCol = col('password', 'pass');
      const taken = accounts.map((a) => a.username);
      const created = [];
      let skipped = 0;

      for (const row of rows.slice(1)) {
        const studentName = (row[nameCol] || '').trim();
        if (!studentName) continue;
        const wanted = userCol >= 0 && row[userCol]?.trim()
          ? normalizeUsername(row[userCol])
          : suggestUsername(studentName, taken);
        if (taken.includes(wanted)) { skipped++; continue; }
        // Students sign in now, so every imported account needs a password.
        // One is generated unless the CSV supplies it.
        const pw = pwCol >= 0 && row[pwCol]?.trim() ? row[pwCol].trim() : suggestPassword();
        try {
          await createAccount({
            username: wanted,
            name: studentName,
            roles: [ROLES.student],
            asClass: classCol >= 0 ? (row[classCol] || '').trim() : '',
            password: pw,
          });
          taken.push(wanted);
          created.push({ name: studentName, username: wanted, password: pw });
        } catch { skipped++; }
      }

      if (!created.length) {
        return toast(`Nothing imported${skipped ? ` — ${skipped} skipped` : ''}.`, 'warn', 6000);
      }

      // The generated passwords exist nowhere else once this dialog closes:
      // they are stored only as hashes. Hand them over now or reset later.
      await modal({
        title: `Imported ${pluralize(created.length, 'account')}`,
        body: el('div', { class: 'stack' },
          notice('warn', 'Save this list now',
            el('p', {}, 'Passwords are stored only as hashes, so this is the one time they can be '
              + 'read. Download the list and distribute it, or you will have to reset them individually.')),
          el('div', { class: 'table-wrap', style: { maxHeight: '18rem', overflowY: 'auto' } },
            el('table', { class: 'table' },
              el('thead', {}, el('tr', {},
                el('th', {}, 'Name'), el('th', {}, 'Username'), el('th', {}, 'Password'))),
              el('tbody', {}, ...created.map((c) => el('tr', {},
                el('td', {}, c.name),
                el('td', { class: 'mono' }, c.username),
                el('td', { class: 'mono' }, c.password)))))),
          skipped ? el('p', { class: 'muted' }, `${skipped} row(s) skipped — duplicate or invalid.`) : null),
        actions: [
          {
            label: 'Download credentials CSV',
            value: 'download',
            variant: 'primary',
            autofocus: true,
          },
          { label: 'Close', value: null },
        ],
      }).then((choice) => {
        if (choice === 'download') {
          download(`student-credentials-${new Date().toISOString().slice(0, 10)}.csv`,
            toCsv(created, [
              { key: 'name', label: 'name' },
              { key: 'username', label: 'username' },
              { key: 'password', label: 'password' },
            ]), 'text/csv');
        }
      });

      return reload();
    } catch (err) {
      return toast(`Import failed: ${err.message}`, 'danger', 8000);
    }
  }

  function paint() {
    const visible = accounts
      .filter((a) => !state.role || a.roles?.includes(state.role))
      .filter((a) => !state.search
        || `${a.name} ${a.username}`.toLowerCase().includes(state.search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!visible.length) {
      remount(table, emptyState({
        iconName: 'users',
        title: accounts.length ? 'No accounts match' : 'No accounts yet',
        message: accounts.length ? 'Try a different filter.' : 'Create one, or import a student CSV.',
        action: el('button', { type: 'button', class: 'btn btn--primary', onclick: () => editAccount() },
          icon('plus'), 'Create account'),
      }));
      return;
    }

    const body = el('tbody');
    for (const account of visible) {
      mount(body, el('tr', {},
        el('td', {}, el('div', { style: { fontWeight: '550' } }, account.name),
          el('div', { class: 'mono faint' }, account.username)),
        el('td', {}, el('div', { class: 'row row--wrap' },
          ...(account.roles || []).map((r) => badge(ROLE_LABELS[r] || r,
            r === ROLES.admin ? 'danger' : r === ROLES.instructor ? 'info' : 'neutral')))),
        el('td', {}, account.asClass || '—'),
        el('td', {}, account.active === false ? badge('Inactive', 'neutral') : badge('Active', 'ok', 'check')),
        el('td', { class: 'faint nowrap' }, fmtDate(account.createdAt)),
        el('td', { class: 'num' }, el('div', { class: 'row row--end' },
          el('button', {
            type: 'button', class: 'btn btn--sm btn--ghost', title: 'Reset password',
            onclick: () => resetPasswordFor(account),
          }, icon('lock')),
          el('button', { type: 'button', class: 'btn btn--sm btn--ghost', title: 'Edit', onclick: () => editAccount(account) },
            icon('edit')),
          el('button', {
            type: 'button', class: 'btn btn--sm btn--ghost', title: 'Delete',
            onclick: async () => {
              const admins = accounts.filter((a) => a.roles?.includes(ROLES.admin) && a.active !== false);
              if (account.roles?.includes(ROLES.admin) && admins.length <= 1) {
                return toast('You cannot delete the only admin account.', 'warn', 6000);
              }
              if (!(await confirmDialog('Delete this account?',
                `${account.name} (${account.username}) will be removed. Their submitted feedback is kept.`,
                { confirmLabel: 'Delete', danger: true }))) return undefined;
              await deleteAccount(account.id);
              toast('Account deleted.', 'ok');
              return reload();
            },
          }, icon('trash'))))));
    }

    remount(table, el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Account'), el('th', {}, 'Roles'), el('th', {}, 'AS level'),
          el('th', {}, 'Status'), el('th', {}, 'Created'), el('th', { class: 'num' }, ''))),
        body)));
  }

  const session = currentUser();

  remount(root, 
    el('div', { class: 'page-head row row--between row--wrap' },
      el('div', {},
        el('h1', { class: 'page-title' }, 'Database Administration'),
        el('p', { class: 'page-sub' }, session
          ? `Signed in as ${session.name} (${session.username})`
          : 'Development mode — no sign-in required')),
      el('div', { class: 'row row--wrap' },
        session && el('button', {
          type: 'button', class: 'btn btn--sm',
          onclick: () => { signOut(); toast('Signed out.', 'ok'); navigate('/home'); },
        }, icon('lock'), 'Sign out'))),

    isDevMode() && notice('warn', 'Development mode is on',
      el('p', {}, 'The Instructor Portal and these admin screens are unlocked on this device. '
        + 'Turn it off in Settings before fielding the app.')),

    !accounts.some((a) => a.roles?.includes(ROLES.admin) && a.active !== false)
      && notice('warn', 'No named administrator account exists',
        el('p', {}, 'Only the shared built-in credential can reach these screens. '
          + 'Create an admin account for your detachment so access can be traced to a person.'),
        el('div', { class: 'row', style: { marginTop: 'var(--sp-3)' } },
          el('button', {
            type: 'button', class: 'btn btn--sm btn--primary',
            onclick: () => editAccount(null, { roles: [ROLES.admin, ROLES.instructor] }),
          }, icon('plus'), 'Create administrator'))),

    session?.builtIn && notice('warn', 'You are signed in as the built-in administrator',
      el('p', {}, 'The ', el('code', { class: 'mono' }, BUILTIN_ADMIN.username), ' credential is the '
        + 'same for every installation, so it is only as private as your Drive folder. It exists so a '
        + 'detachment can never lock itself out. Create a named admin account for day-to-day use.')),

    el('section', { class: 'card stack' },
      el('div', { class: 'row row--between row--wrap' },
        el('h2', { class: 'section-title', style: { margin: '0' } }, 'Account maintenance'),
        el('div', { class: 'row row--wrap' },
          el('button', { type: 'button', class: 'btn btn--sm', onclick: importCsv }, icon('upload'), 'Import students CSV'),
          el('button', {
            type: 'button', class: 'btn btn--sm',
            onclick: () => download('accounts.csv', toCsv(accounts, [
              { key: 'username', label: 'username' }, { key: 'name', label: 'name' },
              { key: 'roles', label: 'roles', get: (a) => (a.roles || []).join(' ') },
              { key: 'asClass', label: 'class' }, { key: 'section', label: 'section' },
              { key: 'email', label: 'email' },
            ]), 'text/csv'),
          }, icon('download'), 'Export CSV'),
          el('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: () => editAccount() },
            icon('plus'), 'Create account'))),

      el('div', { class: 'filters' },
        field('Role', select([
          { value: '', label: 'All roles' },
          ...Object.values(ROLES).map((r) => ({ value: r, label: ROLE_LABELS[r] })),
        ], { onchange: (e) => { state.role = e.target.value; paint(); } })),
        field('Search', el('input', {
          class: 'input', type: 'search', placeholder: 'Name or username…',
          oninput: (e) => { state.search = e.target.value; paint(); },
        }))),

      table),

    rolloverCard(reload),
    await auditCard(),
    await schemaCard(),

    el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
      el('h2', { class: 'section-title' }, 'Database maintenance'),
      el('p', { class: 'muted' },
        'Roll-up indexes make the app fast by avoiding a read per response. '
        + 'Rebuild them if counts ever look wrong after a restore.'),
      el('div', { class: 'row row--wrap' },
        el('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            const busy = toast('Rebuilding indexes…', 'info', 30000);
            try {
              const result = await db.rebuildIndexes();
              await record(AUDIT.indexesRebuilt, {
                summary: `Rebuilt indexes for ${pluralize(result.requests, 'form')}`,
                detail: { responses: result.responses },
              });
              busy.remove();
              toast(`Rebuilt ${pluralize(result.requests, 'request')} · ${pluralize(result.responses, 'response')}.`, 'ok', 6000);
            } catch (err) {
              busy.remove();
              toast(err.message, 'danger', 8000);
            }
          },
        }, icon('refresh'), 'Rebuild indexes'),
        el('button', { type: 'button', class: 'btn', onclick: () => navigate('/instructor?tab=database') },
          icon('database'), 'Backup and restore'))),
  );

  paint();
}

/**
 * Annual rollover.
 *
 * Every August a detachment's AS100s become AS200s and the AS400s commission
 * out. Done by hand across 150 accounts it is a morning's work that somebody
 * eventually skips, and once the levels are stale every class filter and every
 * cohort comparison is quietly wrong for a year.
 *
 * Graduating cadets are *deactivated, never deleted* — their submitted feedback
 * stays part of the record, and the account can be reactivated if someone
 * returns.
 */
function rolloverCard(reload) {
  const host = el('div', {});

  const preview = async () => {
    const accounts = await listAccounts();
    const students = accounts.filter((a) => a.roles?.includes(ROLES.student) && a.active !== false);
    const moves = new Map();
    for (const student of students) {
      const from = student.asClass || '—';
      if (!(from in AS_PROGRESSION)) continue;   // Field Training, cadre: untouched
      const to = AS_PROGRESSION[from];
      const key = `${from}->${to ?? 'graduating'}`;
      if (!moves.has(key)) moves.set(key, { from, to, people: [] });
      moves.get(key).people.push(student);
    }
    const untouched = students.filter((s) => !((s.asClass || '') in AS_PROGRESSION));
    return { moves: [...moves.values()].sort((a, b) => a.from.localeCompare(b.from)), untouched, students };
  };

  const draw = async () => {
    const { moves, untouched, students } = await preview();
    remount(host);

    if (!students.length) {
      mount(host, el('p', { class: 'muted' }, 'No active student accounts to advance.'));
      return;
    }
    if (!moves.length) {
      mount(host, el('p', { class: 'muted' },
        'No accounts sit on the AS100–AS400 ladder, so there is nothing to advance.'));
      return;
    }

    const deactivateBox = el('input', { type: 'checkbox', checked: true });
    const body = el('tbody');
    for (const move of moves) {
      mount(body, el('tr', {},
        el('td', {}, move.from),
        el('td', {}, move.to || el('span', {}, 'Graduating')),
        el('td', { class: 'num' }, String(move.people.length))));
    }

    mount(host,
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Currently'), el('th', {}, 'Becomes'), el('th', { class: 'num' }, 'Cadets'))),
          body)),
      untouched.length
        ? el('p', { class: 'field__hint' },
          `${pluralize(untouched.length, 'account')} left unchanged — not on the AS100–AS400 ladder.`)
        : null,
      el('label', { class: 'check' }, deactivateBox,
        el('span', {},
          el('span', { class: 'check__text' }, 'Deactivate graduating cadets'),
          el('span', { class: 'check__desc', style: { display: 'block' } },
            'Their feedback is kept and the account can be reactivated. Never deleted.'))),
      el('div', { class: 'row row--wrap' },
        el('button', {
          type: 'button', class: 'btn btn--primary',
          onclick: () => apply(moves, deactivateBox.checked),
        }, icon('refresh'), 'Advance the academic year')));
  };

  const apply = async (moves, deactivate) => {
    const total = moves.reduce((n, m) => n + m.people.length, 0);
    const graduating = moves.filter((m) => m.to === null).reduce((n, m) => n + m.people.length, 0);

    const confirmed = await confirmDialog('Advance the academic year?',
      `${pluralize(total, 'cadet')} will move up a level`
      + (graduating ? `, and ${pluralize(graduating, 'graduating cadet')} will be `
        + `${deactivate ? 'deactivated' : 'left active at AS400'}.` : '.')
      + ' This is recorded in the audit trail. There is no undo, though levels can be edited back by hand.',
      { confirmLabel: 'Advance', danger: true });
    if (!confirmed) return;

    const busy = toast('Advancing…', 'info', 60000);
    let moved = 0;
    let retired = 0;
    try {
      for (const move of moves) {
        for (const student of move.people) {
          if (move.to === null) {
            if (deactivate) { await updateAccount(student.id, { active: false }); retired++; }
          } else {
            await updateAccount(student.id, { asClass: move.to });
            moved++;
          }
        }
      }
      await record(AUDIT.rolloverApplied, {
        summary: `Advanced ${pluralize(moved, 'cadet')}`
          + (retired ? `, deactivated ${pluralize(retired, 'graduating cadet')}` : ''),
        detail: { schoolYear: currentSchoolYear(), moved, retired },
      });
      busy.remove();
      toast(`Advanced ${pluralize(moved, 'cadet')}${retired ? `, ${retired} deactivated` : ''}.`,
        'ok', 6000);
      reload();
      draw();
    } catch (err) {
      busy.remove();
      toast(`Rollover stopped: ${err.message}`, 'danger', 9000);
      draw();
    }
  };

  const card = el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('h2', { class: 'section-title' }, 'Academic year rollover'),
    el('p', { class: 'muted' },
      `Moves every cadet up one AS level for ${currentSchoolYear()}. Run it once, at the start of `
      + 'the year. Individual accounts can still be corrected by hand afterwards.'),
    host);
  draw();
  return card;
}

/**
 * Recent activity. Read-only by construction — there is no delete in the audit
 * module, so nothing in this app removes an entry.
 */
async function auditCard() {
  const host = el('div', {}, spinner('Loading activity…'));
  const card = el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('div', { class: 'row row--between row--wrap' },
      el('h2', { class: 'section-title', style: { margin: '0' } }, 'Activity log'),
      el('button', {
        type: 'button', class: 'btn btn--sm',
        onclick: async () => {
          const rows = await recent({ months: 24, limit: 5000 });
          download(`activity-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, [
            { key: 'at', label: 'When' },
            { key: 'who', label: 'Who', get: (r) => r.actor?.username || '' },
            { key: 'action', label: 'Action', get: (r) => AUDIT_LABELS[r.action] || r.action },
            { key: 'summary', label: 'Detail' },
            { key: 'target', label: 'Target' },
            { key: 'reason', label: 'Reason' },
          ]), 'text/csv');
        },
      }, icon('download'), 'Export')),
    el('p', { class: 'muted' },
      'Every deletion, account change and password reset, with who did it. Nothing in this app '
      + 'removes an entry.'),
    host);

  recent({ months: 6, limit: 60 }).then((rows) => {
    if (!rows.length) {
      remount(host, el('p', { class: 'muted' }, 'No recorded activity yet.'));
      return;
    }
    const body = el('tbody');
    for (const row of rows) {
      mount(body, el('tr', {},
        el('td', { class: 'faint nowrap' }, fmtDateTime(row.at)),
        el('td', { class: 'mono' }, row.actor?.username || '—'),
        el('td', {}, row.severe
          ? badge(AUDIT_LABELS[row.action] || row.action, 'danger', 'alert')
          : (AUDIT_LABELS[row.action] || row.action)),
        el('td', {}, row.summary,
          row.reason ? el('div', { class: 'field__hint' }, `Reason: ${row.reason}`) : null)));
    }
    remount(host, el('div', { class: 'table-wrap', style: { maxHeight: '26rem', overflowY: 'auto' } },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'When'), el('th', {}, 'Who'), el('th', {}, 'Action'), el('th', {}, 'Detail'))),
        body)));
  }).catch((err) => {
    remount(host, notice('danger', 'Could not read the activity log', el('p', {}, err.message)));
  });

  return card;
}

/**
 * Schema panel. Migrations normally run automatically on startup; this shows
 * what version the folder is at and lets an admin re-run them after restoring
 * a backup written by an older release.
 */
async function schemaCard() {
  let status;
  try {
    status = await db.migrationStatus();
  } catch (err) {
    return notice('danger', 'Could not read the schema version', el('p', {}, err.message));
  }

  const log = el('div', {});
  const runBtn = el('button', {
    type: 'button', class: status.pending.length ? 'btn btn--primary' : 'btn',
    onclick: async () => {
      runBtn.disabled = true;
      const lines = el('ul', { style: { margin: '0', paddingLeft: '1.1rem' } });
      remount(log, el('div', { class: 'notice notice--info' }, el('div', {},
        el('strong', { class: 'notice__title' }, 'Updating…'), lines)));
      try {
        const result = await db.migrate({
          onProgress: (message) => mount(lines, el('li', {}, message)),
        });
        remount(log, notice('ok',
          result.ran.length ? `Updated from v${result.from} to v${result.to}` : 'Already up to date',
          result.notes.length
            ? el('ul', { style: { margin: '0', paddingLeft: '1.1rem' } },
              ...result.notes.map((n) => el('li', {}, n)))
            : el('p', {}, 'No records needed changing.')));
        toast('Database schema is up to date.', 'ok');
      } catch (err) {
        remount(log, notice('danger', 'Update failed', el('p', {}, err.message)));
      }
      runBtn.disabled = false;
    },
  }, icon('refresh'), status.pending.length ? 'Run migrations now' : 'Re-run migrations');

  return el('section', { class: 'card stack', style: { marginTop: 'var(--sp-5)' } },
    el('h2', { class: 'section-title' }, 'Schema version'),
    el('div', { class: 'row row--between row--wrap' },
      el('div', {},
        el('div', { class: 'eyebrow' }, 'This folder'),
        el('div', { style: { fontWeight: '570' } }, `v${status.from}`)),
      el('div', {},
        el('div', { class: 'eyebrow' }, 'This app expects'),
        el('div', { style: { fontWeight: '570' } }, `v${status.to}`)),
      status.pending.length
        ? badge(`${pluralize(status.pending.length, 'update')} pending`, 'warn', 'alert')
        : badge('Up to date', 'ok', 'checkCircle')),

    status.pending.length
      ? notice('warn', 'Pending updates',
        el('ul', { style: { margin: '0', paddingLeft: '1.1rem' } },
          ...status.pending.map((p) => el('li', {}, p))))
      : el('p', { class: 'muted' },
        'Records match this build. Migrations run automatically when a device opens a folder '
        + 'written by an older release — export a backup before a major update all the same.'),

    el('div', { class: 'row row--wrap' }, runBtn),
    log);
}

/**
 * Generates a password a cadet can read off a printed list and type on a phone:
 * two short words and two digits. No look-alike characters, no symbols.
 */
function suggestPassword() {
  const words = [
    'alpha', 'bravo', 'delta', 'eagle', 'falcon', 'golf', 'hotel', 'india',
    'juliet', 'kilo', 'lima', 'mike', 'nova', 'oscar', 'papa', 'quebec',
    'romeo', 'sierra', 'tango', 'victor', 'whiskey', 'xray', 'yankee', 'zulu',
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const digits = String(Math.floor(Math.random() * 90) + 10);
  return `${pick()}-${pick()}${digits}`;
}

const ROLE_HINTS = {
  student: 'Can be targeted by feedback forms. Types this username when submitting. No password.',
  instructor: 'Signs in to the Instructor Portal to create feedback and read responses.',
  admin: 'Signs in here to create and manage accounts.',
};

/** Shared with the roster importer — quoted fields, embedded commas/newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; } else quoted = false;
      } else value += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value); value = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else value += char;
  }
  row.push(value);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}
