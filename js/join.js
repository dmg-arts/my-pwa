/**
 * Join links — how a device gets pointed at a detachment's folder.
 *
 * Without this, every device runs the full setup wizard: choose a backend, paste
 * an OAuth Client ID, paste a Drive folder link. That is a reasonable thing to
 * ask of the one administrator who sets the detachment up. It is not a
 * reasonable thing to ask of a hundred cadets on their phones, and the first
 * live install made that obvious — the same values were pasted three times in
 * one evening on three devices.
 *
 * A join link carries the configuration instead:
 *
 *     https://det.example.org/app/#/join?c=<client>&f=<folder>&n=<name>
 *
 * The cadet taps it, approves Drive access once, and lands signed in. Nothing
 * is typed.
 *
 * WHAT A JOIN LINK IS NOT. It is not a credential, and it must not be treated
 * as one. Everything in it is already public or already an address:
 *
 *   - The **Client ID** is designed to be public. It ships in the page source of
 *     every app that uses one.
 *   - The **folder ID** is an address, not a key. Reaching the folder still
 *     requires Google to have granted that account access.
 *   - Being able to *connect* grants nothing on its own. The roster decides who
 *     may sign in and as what, and an unknown email is turned away.
 *
 * So the link is safe to post in whatever the detachment already uses for
 * comms. It is a shortcut past typing, not past permission.
 *
 * This module is deliberately DOM-free so the link format is unit-testable, and
 * so a future QR renderer can consume `buildJoinLink()` without dragging a view
 * along with it.
 */

/** Every Google browser client ID ends this way, so it is not worth carrying. */
const CLIENT_SUFFIX = '.apps.googleusercontent.com';

/** Drive file and folder ids, and Google's client id body. */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Drops the fixed suffix from a client ID.
 *
 * Saves 27 characters in every link. That is invisible in a pasted URL and
 * matters quite a lot to a QR code, where length drives the module count and
 * therefore how close someone has to hold a phone to a projector screen.
 */
export function shortenClientId(clientId) {
  const value = String(clientId || '').trim();
  return value.endsWith(CLIENT_SUFFIX) ? value.slice(0, -CLIENT_SUFFIX.length) : value;
}

/** Puts the suffix back, tolerating a link that carried the full form anyway. */
export function expandClientId(short) {
  const value = String(short || '').trim();
  if (!value) return '';
  return value.endsWith(CLIENT_SUFFIX) ? value : value + CLIENT_SUFFIX;
}

/**
 * The address the app is served from, without any route on the end.
 *
 * Built from wherever the app currently runs rather than stored, so a
 * detachment that moves hosts gets correct links immediately and nobody has to
 * remember to update a setting.
 */
export function appBaseUrl(loc = window.location) {
  return `${loc.origin}${loc.pathname}`;
}

/**
 * Builds a join link.
 *
 * @param {{clientId: string, folderId: string, orgName?: string, base?: string}} config
 * @returns {string}
 * @throws if the client ID or folder ID is missing or malformed — a broken join
 *         link fails in a cadet's hands, where nobody can debug it.
 */
export function buildJoinLink({ clientId, folderId, orgName = '', base = null }) {
  const client = shortenClientId(clientId);
  const folder = String(folderId || '').trim();

  if (!client) throw new Error('This installation has no Google Client ID, so it cannot make a join link.');
  if (!folder) throw new Error('This installation has no Drive folder, so it cannot make a join link.');
  if (!ID_PATTERN.test(client)) throw new Error('That Google Client ID does not look valid.');
  if (!ID_PATTERN.test(folder)) throw new Error('That Drive folder ID does not look valid.');

  const params = new URLSearchParams({ c: client, f: folder });
  if (String(orgName || '').trim()) params.set('n', String(orgName).trim());

  return `${base || appBaseUrl()}#/join?${params.toString()}`;
}

/**
 * Reads the configuration back out of a join link's query parameters.
 *
 * Takes the router's own `URLSearchParams`, so it never has to re-parse a hash
 * and cannot disagree with the router about what the route was.
 *
 * @returns {{clientId: string, folderId: string, orgName: string}|null}
 *          null when the link is missing either required value.
 */
export function parseJoinParams(query) {
  const client = expandClientId(query.get('c') || '');
  const folder = String(query.get('f') || '').trim();
  const orgName = String(query.get('n') || '').trim();

  if (!client || !folder) return null;
  if (!ID_PATTERN.test(shortenClientId(client)) || !ID_PATTERN.test(folder)) return null;

  return { clientId: client, folderId: folder, orgName };
}

/**
 * A pre-addressed mail draft, for detachments that hand out access by email.
 *
 * The body is plain text on purpose: it has to survive every mail client a
 * regional detachment might be using, and a cadet reading it on a phone should
 * understand what they are being asked to do before they tap anything.
 */
export function joinMailto({ link, orgName = '', appName = 'TOP-Feedback' }) {
  const who = orgName || 'your detachment';
  const subject = `${appName} — join ${who}`;
  const body = [
    `You have been added to the ${who} feedback roster.`,
    '',
    'Open this link on the phone or laptop you will use:',
    '',
    link,
    '',
    'It will ask you to sign in with Google. Use the account this message',
    'was sent to — that is the one on the roster.',
    '',
    'Google will warn that the app has not been verified. That is expected.',
    'Choose Advanced, then continue.',
    '',
    'Nothing to install and nothing to type.',
  ].join('\n');

  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
