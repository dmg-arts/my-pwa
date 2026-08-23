/**
 * Unit checks for join links.
 *
 *     npm run test:unit
 *
 * A malformed join link fails in a cadet's hands, on their phone, where nobody
 * can see the error and the only feedback anyone gets is "it didn't work". So
 * the round trip is checked directly: whatever `buildJoinLink` produces must
 * come back out of `parseJoinParams` unchanged, and anything malformed must be
 * refused loudly at the point of creation rather than quietly at the point of use.
 */

import {
  shortenClientId, expandClientId, buildJoinLink, parseJoinParams, joinMailto, appBaseUrl,
} from '../../js/join.js';

const CLIENT = '724504040762-rrq3q51dip6rib0g8lof5pq5r6da2g03.apps.googleusercontent.com';
const FOLDER = '1Te9Pc7JgOSUluq3tc0FCK4IqbKm1MTIM';
const BASE = 'https://dmg-arts.github.io/my-pwa/';

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};

/** Parses a built link the way the router would, via URLSearchParams. */
const paramsOf = (link) => new URLSearchParams(link.slice(link.indexOf('?') + 1));

const refuses = (label, config, pattern) => check(label, () => {
  let message = 'NO ERROR';
  try { buildJoinLink(config); } catch (e) { message = e.message; }
  if (!pattern.test(message)) throw new Error(`message was: ${message}`);
});

/* ---------- the client id suffix ---------- */

check('the fixed client-id suffix is dropped', () => {
  const short = shortenClientId(CLIENT);
  if (short !== '724504040762-rrq3q51dip6rib0g8lof5pq5r6da2g03') {
    throw new Error(`got ${short}`);
  }
});

check('shortening is idempotent', () => {
  if (shortenClientId(shortenClientId(CLIENT)) !== shortenClientId(CLIENT)) {
    throw new Error('a second pass changed it');
  }
});

check('expanding restores the full client id', () => {
  if (expandClientId(shortenClientId(CLIENT)) !== CLIENT) throw new Error('round trip lost data');
});

check('expanding tolerates an already-full client id', () => {
  // A link built by an older release, or hand-edited, may carry the long form.
  if (expandClientId(CLIENT) !== CLIENT) throw new Error('suffix was doubled');
});

check('an empty client id expands to empty, not to a bare suffix', () => {
  if (expandClientId('') !== '') throw new Error('invented a client id from nothing');
});

/* ---------- the round trip ---------- */

check('a built link parses back to what went in', () => {
  const link = buildJoinLink({ clientId: CLIENT, folderId: FOLDER, orgName: 'Det 025', base: BASE });
  const out = parseJoinParams(paramsOf(link));
  if (out.clientId !== CLIENT) throw new Error(`client id came back as ${out.clientId}`);
  if (out.folderId !== FOLDER) throw new Error(`folder id came back as ${out.folderId}`);
  if (out.orgName !== 'Det 025') throw new Error(`org name came back as ${out.orgName}`);
});

check('the link points at the join route', () => {
  const link = buildJoinLink({ clientId: CLIENT, folderId: FOLDER, base: BASE });
  if (!link.startsWith(`${BASE}#/join?`)) throw new Error(link);
});

check('an org name with spaces and punctuation survives', () => {
  const name = 'Det 025 — Wilkes & Misericordia';
  const link = buildJoinLink({ clientId: CLIENT, folderId: FOLDER, orgName: name, base: BASE });
  // A raw space is the one that actually bites: chat clients and mail wrap or
  // truncate the link at it. The & separators between parameters are fine.
  if (/ /.test(link)) throw new Error('a raw space survived into the link');
  if (parseJoinParams(paramsOf(link)).orgName !== name) throw new Error('name did not survive');
});

check('the org name is optional', () => {
  const link = buildJoinLink({ clientId: CLIENT, folderId: FOLDER, base: BASE });
  if (link.includes('n=')) throw new Error('an empty name was still written into the link');
  if (parseJoinParams(paramsOf(link)).orgName !== '') throw new Error('org name not empty');
});

check('the link stays short enough to be worth a QR code later', () => {
  const link = buildJoinLink({ clientId: CLIENT, folderId: FOLDER, orgName: 'Det 025', base: BASE });
  // Byte-mode QR at error correction M holds 152 bytes at version 8. Staying
  // under that keeps the code coarse enough to scan off a projector.
  if (link.length > 152) throw new Error(`link is ${link.length} chars`);
});

/* ---------- refusals, at build time ---------- */

refuses('a missing client id is refused', { folderId: FOLDER, base: BASE }, /no Google Client ID/i);
refuses('a missing folder id is refused', { clientId: CLIENT, base: BASE }, /no Drive folder/i);
refuses('a malformed client id is refused',
  { clientId: 'not a client id!', folderId: FOLDER, base: BASE }, /does not look valid/i);
refuses('a folder link pasted where an id belongs is refused',
  { clientId: CLIENT, folderId: 'https://drive.google.com/drive/folders/abc', base: BASE },
  /does not look valid/i);

/* ---------- refusals, at parse time ---------- */

check('a link with no folder is rejected', () => {
  if (parseJoinParams(new URLSearchParams('c=abc123')) !== null) throw new Error('accepted');
});

check('a link with no client is rejected', () => {
  if (parseJoinParams(new URLSearchParams(`f=${FOLDER}`)) !== null) throw new Error('accepted');
});

check('an empty query is rejected rather than treated as a default', () => {
  if (parseJoinParams(new URLSearchParams('')) !== null) throw new Error('accepted');
});

check('a truncated link is rejected', () => {
  // Mail clients and chat apps cut long links; this is the realistic failure.
  const link = buildJoinLink({ clientId: CLIENT, folderId: FOLDER, base: BASE });
  const cut = link.slice(0, link.indexOf('&f='));
  if (parseJoinParams(paramsOf(cut)) !== null) throw new Error('a truncated link was accepted');
});

check('junk in the parameters is rejected, not passed to Google', () => {
  const bad = new URLSearchParams({ c: 'a b c', f: FOLDER });
  if (parseJoinParams(bad) !== null) throw new Error('accepted a malformed client id');
});

/* ---------- the mail draft ---------- */

check('the mail draft carries the link and encodes its body', () => {
  const link = buildJoinLink({ clientId: CLIENT, folderId: FOLDER, base: BASE });
  const href = joinMailto({ link, orgName: 'Det 025' });
  if (!href.startsWith('mailto:?subject=')) throw new Error(href.slice(0, 40));
  if (!decodeURIComponent(href).includes(link)) throw new Error('link missing from the body');
  if (/\n/.test(href)) throw new Error('raw newlines would break the mailto');
});

check('the mail draft warns about the unverified-app screen', () => {
  // Cadets meet that screen before they ever see the app; an invitation that
  // does not mention it generates support questions by design.
  const body = decodeURIComponent(joinMailto({ link: 'https://x/#/join?c=a&f=b' }));
  if (!/not been verified/i.test(body)) throw new Error('no warning in the invitation');
});

/* ---------- base url ---------- */

check('the base url drops any route but keeps the subpath', () => {
  // GitHub Pages serves from /repo/, so dropping the path would break the link.
  const fake = { origin: 'https://dmg-arts.github.io', pathname: '/my-pwa/' };
  if (appBaseUrl(fake) !== BASE) throw new Error(appBaseUrl(fake));
});

console.log(failures ? `\n${failures} join check(s) failed.` : '\nAll join checks passed.');
process.exit(failures ? 1 : 0);
