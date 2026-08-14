/**
 * Accounts and sessions.
 *
 * Every account for an organization lives in `users/users.json` inside that
 * organization's own Drive folder — so each detachment owns its user base
 * exactly as it owns its feedback data.
 *
 * WHAT THIS IS NOT: with no server, the password hashes sit in a file that
 * anyone with folder access can read. PBKDF2 makes a stolen hash expensive to
 * crack, but the real access boundary is still Google Drive's own sharing.
 * Treat these credentials as "who is at the keyboard", not as secrets that
 * protect the data from someone who already has the folder.
 */

import { ROLES, LS, BUILTIN_ADMIN, isDevMode } from './config.js';
import { hashPasscode, verifyPasscode, makeId, nowIso } from './util.js';
import { db } from './storage/index.js';

/* ------------------------------------------------------------------ *
 * usernames
 * ------------------------------------------------------------------ */

/** Usernames are matched case-insensitively and stored lowercased. */
export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Validates the shape of a username. Kept deliberately narrow: cadets type
 * these by hand on a phone, so no spaces and no case sensitivity.
 */
export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!username) return 'Enter a username.';
  if (username.length < 3) return 'Usernames are at least 3 characters.';
  if (username.length > 32) return 'Usernames are at most 32 characters.';
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return 'Use letters, numbers, dots, dashes or underscores only.';
  }
  // Receipts are stored as <username>.json alongside index files, which are the
  // ones starting with an underscore. Reserving the prefix keeps them apart.
  if (username.startsWith('_')) return 'Usernames cannot start with an underscore.';
  return null;
}

/**
 * Password rules. Students get a lower floor deliberately: a cadet types this
 * on a phone before every submission, and an 8-character requirement pushes
 * them straight to writing it on the inside of a notebook.
 */
export function validatePassword(password, roles = [ROLES.student]) {
  const value = String(password || '');
  const privileged = roles.includes(ROLES.instructor) || roles.includes(ROLES.admin);
  const min = privileged ? 8 : 6;
  if (value.length < min) {
    return `Use at least ${min} characters${privileged ? ' for an instructor or admin account' : ''}.`;
  }
  return null;
}

/** Suggests `last.first` from a display name, deduped against existing users. */
export function suggestUsername(name, taken = []) {
  const parts = String(name || '').replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts[0] : (parts[0] || 'cadet');
  const first = parts.length > 1 ? parts[1] : '';
  let base = normalizeUsername(`${last}${first ? `.${first}` : ''}`.replace(/[^a-z0-9._-]/gi, ''));
  if (base.length < 3) base = `${base}user`;
  const existing = new Set(taken.map(normalizeUsername));
  if (!existing.has(base)) return base;
  for (let n = 2; n < 999; n++) {
    if (!existing.has(`${base}${n}`)) return `${base}${n}`;
  }
  return `${base}${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ *
 * the account directory
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} Account
 * @property {string} id
 * @property {string} username     unique, lowercased
 * @property {string} name         display name
 * @property {string[]} roles      any of student | instructor | admin
 * @property {string} asClass      AS100…AS400, FT, CADRE
 * @property {string} section
 * @property {string} email
 * @property {boolean} active
 * @property {object|null} password  PBKDF2 record; null for students
 */

export async function listAccounts() {
  const doc = await db.getUsers();
  return doc.users || [];
}

export async function findByUsername(username) {
  const target = normalizeUsername(username);
  if (!target) return null;
  return (await listAccounts()).find((a) => normalizeUsername(a.username) === target) || null;
}

export async function listStudents() {
  return (await listAccounts())
    .filter((a) => a.roles?.includes(ROLES.student) && a.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Creates an account. Rejects duplicate usernames case-insensitively. */
export async function createAccount({ username, name, roles = [ROLES.student], asClass = '', section = '', email = '', password = null }) {
  const problem = validateUsername(username);
  if (problem) throw new Error(problem);
  if (await findByUsername(username)) {
    throw new Error(`The username "${normalizeUsername(username)}" is already taken.`);
  }
  if (!String(name || '').trim()) throw new Error('Enter a name.');

  // Every account signs in now, students included — that is what makes a
  // submission receipt trustworthy rather than merely a typed claim.
  if (!password) throw new Error('Every account needs a password.');
  const problemPw = validatePassword(password, roles);
  if (problemPw) throw new Error(problemPw);

  const account = {
    id: makeId('usr'),
    username: normalizeUsername(username),
    name: String(name).trim(),
    roles: [...new Set(roles)],
    asClass,
    section,
    email,
    active: true,
    password: password ? await hashPasscode(password) : null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  // Expressed as a change, not a precomputed list: if another admin saves while
  // this runs, the append is replayed against their result rather than wiping it.
  await db.updateUsers((users) => {
    if (users.some((u) => normalizeUsername(u.username) === account.username)) {
      throw new Error(`The username "${account.username}" is already taken.`);
    }
    return [...users, account];
  });
  return account;
}

export async function updateAccount(id, patch) {
  if (patch.username) {
    const problem = validateUsername(patch.username);
    if (problem) throw new Error(problem);
  }
  // Hashing is slow, so do it once outside the retry loop.
  const hashed = patch.newPassword ? await hashPasscode(patch.newPassword) : null;
  let result = null;

  await db.updateUsers((users) => {
    const existing = users.find((a) => a.id === id);
    if (!existing) throw new Error('That account no longer exists.');

    const wanted = patch.username ? normalizeUsername(patch.username) : existing.username;
    if (wanted !== existing.username
        && users.some((a) => a.id !== id && normalizeUsername(a.username) === wanted)) {
      throw new Error('That username is already taken.');
    }

    const next = { ...existing, ...patch, username: wanted, updatedAt: nowIso() };
    if (hashed) next.password = hashed;
    delete next.newPassword;
    result = next;
    return users.map((a) => (a.id === id ? next : a));
  });

  return result;
}

export async function deleteAccount(id) {
  await db.updateUsers((users) => users.filter((a) => a.id !== id));
}

/** True once at least one admin exists — used to gate first-run bootstrap. */
export async function hasAdmin() {
  return (await listAccounts()).some((a) => a.roles?.includes(ROLES.admin) && a.active !== false);
}

/* ------------------------------------------------------------------ *
 * sign in
 * ------------------------------------------------------------------ */

const SESSION_MS = 8 * 60 * 60 * 1000;

/**
 * Verifies credentials and starts a session.
 * @returns {Promise<Account>}
 */
export async function signIn(username, password, requiredRole = null) {
  // Same message either way, so the form cannot be used to enumerate usernames.
  const rejection = new Error('That username and password do not match.');

  // The built-in administrator is checked first and needs no stored record, so
  // it still works against an empty or damaged account database.
  if (normalizeUsername(username) === BUILTIN_ADMIN.username
      && password === BUILTIN_ADMIN.password) {
    const builtIn = {
      id: 'usr_builtin_admin',
      username: BUILTIN_ADMIN.username,
      name: BUILTIN_ADMIN.name,
      roles: [ROLES.admin, ROLES.instructor],
      builtIn: true,
    };
    if (requiredRole && !builtIn.roles.includes(requiredRole)) throw rejection;
    startSession(builtIn);
    return builtIn;
  }

  const account = await findByUsername(username);
  if (!account || account.active === false || !account.password) throw rejection;
  if (!(await verifyPasscode(password, account.password))) throw rejection;
  if (requiredRole && !account.roles?.includes(requiredRole)) {
    throw new Error(`That account does not have ${requiredRole} access.`);
  }

  startSession(account);
  return account;
}

/**
 * True while the standard credential is the only way into the admin console.
 * Drives the standing warning: a shared, published password is fine as a
 * recovery path, and poor as the permanent front door.
 */
export async function usingBuiltInAdminOnly() {
  try {
    return !(await hasAdmin());
  } catch {
    return true;
  }
}

/** Sets a new password for an account. Used by the admin reset action. */
export async function resetPassword(id, newPassword) {
  const account = (await listAccounts()).find((a) => a.id === id);
  if (!account) throw new Error('That account no longer exists.');
  const problem = validatePassword(newPassword, account.roles || []);
  if (problem) throw new Error(problem);
  return updateAccount(id, { newPassword });
}

export function startSession(account) {
  sessionStorage.setItem(LS.session, JSON.stringify({
    id: account.id,
    username: account.username,
    name: account.name,
    roles: account.roles,
    // Carried so the student view can match forms to their AS level without
    // another read of the account database on every render.
    asClass: account.asClass || '',
    builtIn: Boolean(account.builtIn),
    until: Date.now() + SESSION_MS,
  }));
}

export function currentUser() {
  try {
    const raw = sessionStorage.getItem(LS.session);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() > session.until) {
      signOut();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function signOut() {
  sessionStorage.removeItem(LS.session);
}

/**
 * Role check used by the route guards.
 *
 * In development mode this returns true so the portals can be built out before
 * any accounts exist. `isDevMode()` is device-local and surfaced as a banner,
 * and Settings refuses to leave it on once an admin account has been created.
 */
export function hasRole(role) {
  if (isDevMode()) return true;
  return Boolean(currentUser()?.roles?.includes(role));
}

/** Roles the signed-in account holds, for the UI to label the session. */
export function currentRoles() {
  return currentUser()?.roles || [];
}
