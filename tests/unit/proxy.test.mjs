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

console.log(failures ? `\n${failures} proxy check(s) failed.` : '\nAll proxy checks passed.');
process.exit(failures ? 1 : 0);
