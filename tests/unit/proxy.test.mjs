/**
 * Contract checks for the submission proxy.
 *
 *     npm run test:unit
 *
 * The proxy is the access boundary once cadre lose Drive access, so the thing
 * worth pinning is its shape: every action it will perform is enumerated with a
 * role requirement, and the caller never names a file. A read added without an
 * entry in that table would fall straight through the gate, and a read that
 * accepted a path would put the access decision back in the browser — which is
 * the arrangement being replaced.
 *
 * The script is checked as source rather than executed: it runs on Apps Script,
 * against DriveApp and UrlFetchApp, neither of which exists here.
 */

import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../../tools/proxy/Code.gs', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('../../js/storage/proxy.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};

const declared = new Set(
  [...SOURCE.matchAll(/^\s{2}([a-zA-Z]+):\s*\[([^\]]*)\]/gm)].map((m) => m[1]));
const handled = new Set(
  [...SOURCE.matchAll(/body\.action === '([a-zA-Z]+)'/g)].map((m) => m[1]));
const requested = new Set(
  [...CLIENT.matchAll(/action:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));

/* ---------- the action table is the access model ---------- */

check('every action the client asks for is declared in the script', () => {
  const missing = [...requested].filter((a) => !declared.has(a));
  if (missing.length) throw new Error(`client asks for undeclared: ${missing.join(', ')}`);
});

check('every declared action is actually handled', () => {
  // `submit` is handled by the block after the reads, guarded by an explicit
  // check rather than falling through.
  const missing = [...declared].filter((a) => !handled.has(a) && a !== 'submit');
  if (missing.length) throw new Error(`declared but unhandled: ${missing.join(', ')}`);
  if (!/body\.action !== 'submit'/.test(SOURCE)) {
    throw new Error('the submit path is an implicit fall-through');
  }
});

check('no action is declared with an empty role list', () => {
  for (const [, name, roles] of SOURCE.matchAll(/^\s{2}([a-zA-Z]+):\s*\[([^\]]*)\]/gm)) {
    if (!roles.trim()) throw new Error(`${name} is open to everyone`);
  }
});

check('student-facing actions are limited to students', () => {
  for (const action of ['bundle', 'submit']) {
    const m = SOURCE.match(new RegExp(`^\\s{2}${action}:\\s*\\[([^\\]]*)\\]`, 'm'));
    if (!m) throw new Error(`${action} is not declared`);
    if (m[1].replace(/['\s]/g, '') !== 'student') {
      throw new Error(`${action} is open to ${m[1]}`);
    }
  }
});

check('the audit log is not readable by instructors', () => {
  const m = SOURCE.match(/^\s{2}audit:\s*\[([^\]]*)\]/m);
  if (!m) throw new Error('audit is not declared');
  if (/instructor/.test(m[1])) throw new Error(`audit is open to ${m[1]}`);
});

/* ---------- the caller must never name a file ---------- */

check('the client never sends a path, folder or filename', () => {
  const bad = [...CLIENT.matchAll(/^\s*(path|file|folder|segments):/gm)].map((m) => m[1]);
  if (bad.length) throw new Error(`client sends ${bad.join(', ')}`);
});

check('ids taken from the request are pattern-checked before use', () => {
  if (!/ID_PATTERN\.test\(requestId\)/.test(SOURCE)) {
    throw new Error('requestId reaches a Drive path unchecked');
  }
  if (!/var ID_PATTERN = \/\^\[A-Za-z0-9_-\]/.test(SOURCE)) {
    throw new Error('ID_PATTERN allows more than an id');
  }
});

/* ---------- identity is verified with Google, not decoded ---------- */

check('the ID token is verified against Google, not merely parsed', () => {
  if (!/oauth2\.googleapis\.com\/tokeninfo/.test(SOURCE)) {
    throw new Error('no call to Google to verify the token');
  }
});

check('the token audience is checked against this deployment', () => {
  if (!/claims\.aud !== expectedClientId/.test(SOURCE)) {
    throw new Error('a token minted for another app would be accepted');
  }
});

check('tokeninfo string values are compared as strings', () => {
  // tokeninfo returns every field as a string; comparing email_verified as a
  // boolean silently passes for an unverified address.
  if (!/String\(claims\.email_verified\) !== 'true'/.test(SOURCE)) {
    throw new Error('email_verified is not compared as a string');
  }
});

/* ---------- one submission per cadet is enforced, not assumed ---------- */

check('the receipt check and the write share a lock', () => {
  const locked = SOURCE.indexOf('LockService.getScriptLock');
  const receipt = SOURCE.indexOf('hasReceipt(root, requestId');
  const write = SOURCE.indexOf('writeJson(root, [\'responses\'');
  if (locked < 0) throw new Error('no script lock');
  if (!(locked < receipt && receipt < write)) {
    throw new Error('the duplicate check is not inside the lock');
  }
});

check('roll-up index files are never served to a caller', () => {
  // They are caches the app rebuilds; handing them over invites the client to
  // trust them as though the server had vouched for them.
  if (!/name\.indexOf\('_'\) === 0/.test(SOURCE)) {
    throw new Error('index files are not filtered out of folder reads');
  }
});

/* ---------- what proxy mode means for the OAuth scope ---------- */

const JOIN = readFileSync(new URL('../../js/views/join.js', import.meta.url), 'utf8');
const DATA = readFileSync(new URL('../../js/data-source.js', import.meta.url), 'utf8');

check('joining a proxy detachment never asks for Drive', () => {
  // This is the whole prize: an app that requests only non-sensitive scopes
  // needs no verification, no CASA, and shows no unverified-app warning.
  const guard = JOIN.indexOf('if (viaProxy)');
  const connect = JOIN.indexOf('adapters.drive.connect');
  if (guard < 0) throw new Error('the join screen has no proxy branch');
  if (connect > 0 && connect < guard) throw new Error('Drive is reached before the proxy check');
  if (!/return navigate\('\/student'\)/.test(JOIN.slice(guard, connect > 0 ? connect : undefined))) {
    throw new Error('the proxy branch falls through to the Drive path');
  }
});

check('maintenance is refused in proxy mode rather than attempted', () => {
  // Backup, restore and wipe act on the whole folder. The proxy exposes no
  // action for any of them on purpose: an endpoint that could empty a
  // detachment on request is not one worth having.
  if (!/export function canDoMaintenance/.test(DATA)) {
    throw new Error('no maintenance guard exists');
  }
  for (const action of ['wipe', 'import', 'export', 'reindex', 'migrate']) {
    if (new RegExp(`^\\s{2}${action}`, 'mi').test(SOURCE)) {
      throw new Error(`the proxy exposes a ${action} action`);
    }
  }
});

check('every write action requires more than a student role', () => {
  const writes = ['saveForm', 'saveRequest', 'deleteForm', 'deleteRequest',
    'deleteResponse', 'accountCreate', 'accountUpdate', 'accountDelete', 'rollover'];
  for (const action of writes) {
    const m = SOURCE.match(new RegExp(`^\\s{2}${action}:\\s*\\[([^\\]]*)\\]`, 'm'));
    if (!m) throw new Error(`${action} is not declared`);
    if (/student/.test(m[1])) throw new Error(`${action} is open to students`);
  }
});

check('roster changes run inside the script lock', () => {
  const withRoster = SOURCE.indexOf('function withRoster');
  const lock = SOURCE.indexOf('LockService.getScriptLock', withRoster);
  const write = SOURCE.indexOf("writeJson(root, ['users']", withRoster);
  if (!(withRoster >= 0 && lock > withRoster && write > lock)) {
    throw new Error('the roster write is not inside a lock');
  }
});

check('the audit actor comes from the token, never the request body', () => {
  // A client that could name its own actor could write someone else's name
  // against its own deletion, which is worse than having no log.
  const fn = SOURCE.slice(SOURCE.indexOf('function appendAudit'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  if (/actor:\s*entry\./.test(body)) throw new Error('the actor is taken from the request');
  if (!/actor: \{ username: account\.username/.test(body)) {
    throw new Error('the actor is not taken from the verified account');
  }
});

check('at most two commanders, enforced on the server', () => {
  if (!/MAX_COMMANDERS = 2/.test(SOURCE)) throw new Error('no commander cap');
  if (!/function enforceCommanderCap/.test(SOURCE)) throw new Error('the cap is not enforced');
  for (const fn of ['addAccount', 'patchAccount']) {
    const body = SOURCE.slice(SOURCE.indexOf(`function ${fn}`));
    if (!/enforceCommanderCap/.test(body.slice(0, body.indexOf('\n}\n')))) {
      throw new Error(`${fn} can grant commander without the cap`);
    }
  }
});

console.log(failures ? `\n${failures} proxy check(s) failed.` : '\nAll proxy checks passed.');
process.exit(failures ? 1 : 0);
