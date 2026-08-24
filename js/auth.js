/**
 * Accounts and sessions.
 *
 * Identity is the person's Google account. This app issues no passwords and
 * stores no credentials — `users/users.json` is a **roster**: verified email,
 * roles, AS level, section. Nothing in it is secret.
 *
 * That is a deliberate reversal of the earlier design, and a better one for a
 * regional detachment. Cadets travel in from several schools, so there is no
 * single institutional domain to key on, but every one of them already has a
 * Google account — it is how the det mails them. The roster of allowed emails
 * therefore does the job a domain restriction would do at a single-school unit.
 *
 * It also deletes the two worst jobs in the old scheme: distributing a
 * generated password to every cadet, and resetting the ones they forget.
 *
 * See js/google-identity.js for what the client-side token check is and is not
 * worth. Short version: Drive sharing is the boundary that holds.
 */

import { ROLES, LS, isDevMode } from './config.js';
import { makeId, nowIso } from './util.js';
import { forgetGoogleSession } from './google-identity.js';
import { db } from './storage/index.js';
import { record, AUDIT } from './audit.js';

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

/** Emails are matched case-insensitively and stored lowercased. */
export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Checks the shape of an email. Deliberately permissive — a regional
 * detachment's cadets arrive with school addresses, Gmail addresses and
 * everything in between, and rejecting an unusual but real address is worse
 * than accepting a typo an admin can see and fix.
 */
export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return 'Enter the Google account email.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That does not look like an email address.';
  if (email.length > 254) return 'That email address is too long.';
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
 * @property {string} email        the Google account they sign in with; the key
 * @property {string} username     stable internal handle; receipts are filed under it
 * @property {string} name         display name
 * @property {string[]} roles      any of student | instructor | admin
 * @property {string} asClass      AS100…AS400, FT, CADRE
 * @property {string} section
 * @property {boolean} active
 * @property {boolean} [needsEmail] set by the v4 migration on records with no email
 */

/**
 * The roster, read straight from Drive.
 *
 * Deliberately *not* routed through the proxy: data-source.js already imports
 * this module, so importing it back would be a cycle. Screens that need the
 * roster under either mode call `loadRoster()` from data-source instead; this
 * remains the direct-mode primitive the write paths use.
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

/** The identity lookup: a verified Google address against the roster. */
export async function findByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  return (await listAccounts()).find((a) => normalizeEmail(a.email) === target) || null;
}

export async function listStudents() {
  return (await listAccounts())
    .filter((a) => a.roles?.includes(ROLES.student) && a.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Adds someone to the roster.
 *
 * The email is the identity — it is what a Google sign-in is matched against.
 * The username is kept as a stable internal handle: receipts are stored as
 * `receipts/<requestId>/<username>.json`, and keying those on an address that
 * can change would orphan a cadet's submission history the first time they move
 * schools.
 */
export async function createAccount({ email, name, username = '', roles = [ROLES.student], asClass = '', section = '' }) {
  const emailProblem = validateEmail(email);
  if (emailProblem) throw new Error(emailProblem);
  if (!String(name || '').trim()) throw new Error('Enter a name.');

  const address = normalizeEmail(email);
  if (await findByEmail(address)) {
    throw new Error(`${address} is already on the roster.`);
  }

  const existing = await listAccounts();
  const handle = normalizeUsername(username) || suggestUsername(name, existing.map((a) => a.username));
  const handleProblem = validateUsername(handle);
  if (handleProblem) throw new Error(handleProblem);
  if (existing.some((a) => normalizeUsername(a.username) === handle)) {
    throw new Error(`The handle "${handle}" is already in use.`);
  }

  const account = {
    id: makeId('usr'),
    email: address,
    username: handle,
    name: String(name).trim(),
    roles: [...new Set(roles)],
    asClass,
    section,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  // Expressed as a change, not a precomputed list: if another admin saves while
  // this runs, the append is replayed against their result rather than wiping it.
  await db.updateUsers((users) => {
    if (users.some((u) => normalizeEmail(u.email) === account.email)) {
      throw new Error(`${account.email} is already on the roster.`);
    }
    return [...users, account];
  });
  await record(AUDIT.accountCreated, {
    summary: `Added ${account.email} (${account.roles.join(', ')})`,
    target: account.email,
  });
  return account;
}

export async function updateAccount(id, patch) {
  if (patch.email) {
    const problem = validateEmail(patch.email);
    if (problem) throw new Error(problem);
  }
  if (patch.username) {
    const problem = validateUsername(patch.username);
    if (problem) throw new Error(problem);
  }
  let result = null;
  let emailChanged = false;

  await db.updateUsers((users) => {
    const existing = users.find((a) => a.id === id);
    if (!existing) throw new Error('That account no longer exists.');

    const wantedEmail = patch.email ? normalizeEmail(patch.email) : normalizeEmail(existing.email);
    if (wantedEmail !== normalizeEmail(existing.email)
        && users.some((a) => a.id !== id && normalizeEmail(a.email) === wantedEmail)) {
      throw new Error('That email is already on the roster.');
    }
    const wantedHandle = patch.username ? normalizeUsername(patch.username) : existing.username;
    if (wantedHandle !== existing.username
        && users.some((a) => a.id !== id && normalizeUsername(a.username) === wantedHandle)) {
      throw new Error('That handle is already in use.');
    }

    emailChanged = wantedEmail !== normalizeEmail(existing.email);
    const next = {
      ...existing, ...patch,
      email: wantedEmail, username: wantedHandle,
      updatedAt: nowIso(),
    };
    // Nothing here stores credentials any more; drop any left by an old record.
    delete next.password;
    delete next.needsPassword;
    result = next;
    return users.map((a) => (a.id === id ? next : a));
  });

  await record(AUDIT.accountUpdated, {
    summary: emailChanged
      ? `Changed the sign-in email for ${result.name} to ${result.email}`
      : `Updated ${result.email}`,
    target: result.email,
    detail: { fields: Object.keys(patch) },
  });
  return result;
}

export async function deleteAccount(id) {
  let removed = null;
  await db.updateUsers((users) => {
    removed = users.find((a) => a.id === id) || null;
    return users.filter((a) => a.id !== id);
  });
  if (removed) {
    await record(AUDIT.accountDeleted, {
      summary: `Removed ${removed.email || removed.username} (${removed.name})`,
      target: removed.email || removed.username,
      detail: { roles: removed.roles, asClass: removed.asClass },
    });
  }
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
 * Completes a Google sign-in.
 *
 * The token has already been decoded and checked by google-identity.js; this
 * decides whether that verified person is *allowed in*, which is a roster
 * question, not a cryptographic one.
 *
 * @param {{email, name, picture}} profile  from decodeIdToken()
 * @param {string|null} requiredRole
 * @returns {Promise<Account>}
 */
export async function signInWithGoogle(profile, requiredRole = null, rawToken = null) {
  const email = normalizeEmail(profile?.email);
  if (!email) throw new Error('That Google account did not provide an email address.');

  const account = await findByEmail(email);

  if (!account) {
    // Bootstrap: a folder with nobody on the roster yet would otherwise be
    // unreachable. Anyone who can sign in *and* reach the folder can claim it —
    // and reaching the folder is a Drive permission the det controls.
    if (!(await hasAnyAccount())) {
      const founder = await createAccount({
        email,
        name: profile.name || email,
        roles: [ROLES.admin, ROLES.instructor],
      });
      startSession(founder, { idToken: rawToken, idTokenExp: profile.exp });
      return founder;
    }
    throw new Error(
      `${email} is not on this detachment's roster. Ask an administrator to add it.`);
  }

  if (account.active === false) {
    throw new Error('That account has been deactivated. Ask an administrator.');
  }
  if (requiredRole && !account.roles?.includes(requiredRole)) {
    throw new Error(`${email} does not have ${ROLE_ACCESS[requiredRole] || requiredRole} access.`);
  }

  // Keep the roster's display name in step with Google's, so a married name or
  // a corrected spelling does not need an admin edit.
  if (profile.name && profile.name !== account.name) {
    updateAccount(account.id, { name: profile.name }).catch(() => {});
  }

  startSession(account, { idToken: rawToken, idTokenExp: profile.exp });
  return account;
}

/**
 * Sign-in without Google, for development and offline demos only.
 *
 * Google will not issue a token to a page served from a random port, and the
 * local and folder backends have no Drive account behind them at all — so
 * without this, the app could not be run or tested off a Drive. It takes an
 * email and trusts it, which is exactly as weak as it sounds.
 *
 * Two things keep that from becoming a hole in a real installation: it throws
 * unless developer mode is switched on in Settings (a device-local flag, not a
 * stored setting), and the sign-in screen only offers it when no Google Client
 * ID is configured. A Drive-backed detachment has a Client ID by definition —
 * they cannot reach their own folder without one.
 */
export async function signInAsDeveloper(email, requiredRole = null) {
  if (!isDevMode()) throw new Error('Developer sign-in is off. Turn on developer mode in Settings.');
  const problem = validateEmail(email);
  if (problem) throw new Error(problem);
  return signInWithGoogle({ email: normalizeEmail(email), name: null, developer: true }, requiredRole);
}

const ROLE_ACCESS = {
  [ROLES.admin]: 'database administrator',
  [ROLES.instructor]: 'instructor',
  [ROLES.student]: 'student',
};

/** True once anyone at all is on the roster. Gates the bootstrap above. */
export async function hasAnyAccount() {
  return (await listAccounts()).length > 0;
}

/**
 * @param {object} account
 * @param {{idToken?: string, idTokenExp?: number}} [credential]
 *   The raw Google ID token, kept only when there is a submission proxy to send
 *   it to. The proxy re-verifies it server-side — that is the whole point of it
 *   — so the browser has to hold the original string, not the decoded claims.
 *   It lives in sessionStorage beside the session it belongs to, and dies with
 *   the tab.
 */
export function startSession(account, credential = {}) {
  sessionStorage.setItem(LS.session, JSON.stringify({
    id: account.id,
    email: account.email,
    username: account.username,
    name: account.name,
    roles: account.roles,
    // Carried so the student view can match forms to their AS level without
    // another read of the account database on every render.
    asClass: account.asClass || '',
    idToken: credential.idToken || null,
    idTokenExp: credential.idTokenExp || null,
    until: Date.now() + SESSION_MS,
  }));
}

/**
 * The raw ID token, if one is held and still valid.
 *
 * Returns null once it expires rather than handing over something the proxy
 * will refuse — the caller can then send the cadet back through sign-in with an
 * honest reason instead of a server error.
 */
export function currentIdToken() {
  const session = currentUser();
  if (!session?.idToken) return null;
  if (session.idTokenExp && session.idTokenExp * 1000 < Date.now()) return null;
  return session.idToken;
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
  forgetGoogleSession();
}

/**
 * Role check used by the route guards.
 *
 * In development mode this returns true so the portals can be built out before
 * a Google Client ID exists. `isDevMode()` is device-local and surfaced as a
 * banner, and Settings refuses to leave it on quietly.
 */
export function hasRole(role) {
  if (isDevMode()) return true;
  return Boolean(currentUser()?.roles?.includes(role));
}

