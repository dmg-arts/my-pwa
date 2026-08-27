/**
 * The signed-in session: who is here, and the credential that proves it.
 *
 * Extracted from auth.js for a structural reason rather than a tidiness one.
 * `data-source.js` needs the ID token to talk to the proxy, and `auth.js` needs
 * `data-source.js` to route roster writes — importing each other would be a
 * cycle. Both import this instead, and it imports neither.
 *
 * Everything here lives in `sessionStorage`, so it is scoped to one tab and
 * dies with it. That is deliberate: a shared laptop in a detachment office
 * should not keep somebody signed in for the next person who opens the lid.
 */

import { LS } from './config.js';
import { forgetGoogleSession } from './google-identity.js';

/** Long enough for a drill weekend, short enough not to outlive the day. */
const SESSION_MS = 8 * 60 * 60 * 1000;

/**
 * @param {object} account
 * @param {{idToken?: string, idTokenExp?: number}} [credential]
 *   The raw Google ID token, kept only because the proxy re-verifies it
 *   server-side — that is the whole point of the proxy — so the browser has to
 *   hold the original string rather than the decoded claims.
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
  announceIdentityChange();
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

/**
 * The raw ID token, if one is held and still valid.
 *
 * Returns null once it expires rather than handing over something the proxy
 * will refuse — the caller can then send the person back through sign-in with an
 * honest reason instead of a server error.
 */
export function currentIdToken() {
  const session = currentUser();
  if (!session?.idToken) return null;
  if (session.idTokenExp && session.idTokenExp * 1000 < Date.now()) return null;
  return session.idToken;
}

/**
 * Broadcast whenever the signed-in person changes, so caches can be dropped.
 *
 * An event rather than a direct call because the modules holding those caches
 * import this one, and importing them back would be a cycle. Anything holding
 * data belonging to a person must listen.
 */
export const IDENTITY_CHANGED = 'nine31:identity-changed';

function announceIdentityChange() {
  try {
    window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED));
  } catch { /* no window: nothing is cached either */ }
}

export function signOut() {
  sessionStorage.removeItem(LS.session);
  forgetGoogleSession();
  // Caches outlive sessionStorage, so without this the next person to sign in
  // on a shared device is served the previous person's data.
  announceIdentityChange();
}
