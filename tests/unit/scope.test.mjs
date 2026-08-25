/**
 * The Drive permission the app asks Google for, and everything that depends on it.
 *
 *     node tests/unit/scope.test.mjs
 *
 * This is pinned because widening it is invisible in review and expensive in
 * consequence. `auth/drive` — full access to somebody's entire Google Drive —
 * is one word shorter than `auth/drive.file` and would look like a tidy-up.
 * Google classes it as *restricted*: verification plus a paid third-party
 * security assessment, every year, for a free tool nobody is selling. And it
 * would mean asking a detachment for access to everything in their account when
 * the app touches one folder.
 *
 * The narrow scope has one consequence the app is built around: it can only
 * reach files it created itself, so **setup creates the folder** rather than
 * accepting a link to one. A change that reintroduces a folder-link field would
 * appear to work in local mode and fail against real Drive with "not found",
 * which is why that is pinned here too.
 *
 * The last check is the one a reviewer would make: the privacy policy has to
 * name the same scope the code requests. A policy contradicted by the app is
 * grounds for rejection, and the two live in different files that nothing else
 * keeps in step.
 */

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const EXPECTED = 'https://www.googleapis.com/auth/drive.file';
const drive = read('js/storage/drive.js');

check('the app requests drive.file and nothing wider', () => {
  const found = /const SCOPE = '([^']+)'/.exec(drive);
  if (!found) throw new Error('no SCOPE constant — did the adapter change shape?');
  if (found[1] !== EXPECTED) {
    throw new Error(`asks for "${found[1]}"; restricted scopes cost verification and an annual assessment`);
  }
});

check('only one scope is ever requested', () => {
  // A second scope added anywhere would be granted alongside this one.
  const scopes = [...drive.matchAll(/googleapis\.com\/auth\/[a-z.]+/g)].map((m) => m[0]);
  const distinct = [...new Set(scopes)];
  if (distinct.length !== 1) throw new Error(`found ${distinct.length}: ${distinct.join(', ')}`);
});

check('the adapter can create its own root folder', () => {
  // Without this the narrow scope has nothing to reach: a folder made by hand
  // in Drive is invisible to the app.
  if (!/async createRoot\(/.test(drive)) {
    throw new Error('createRoot is gone — setup would have nothing to point at');
  }
});

check('setup no longer asks for a folder link', () => {
  const setup = read('js/views/setup.js');
  // Linking *to* the folder the app just made is fine and wanted; what must not
  // come back is a field asking the administrator to supply one.
  if (/parseFolderId/.test(setup)) {
    throw new Error('the wizard parses a pasted folder id again; a hand-made folder cannot be reached');
  }
  if (/placeholder:\s*'https:\/\/drive\.google\.com/.test(setup)) {
    throw new Error('the wizard has a folder-link input again');
  }
  if (!/createRoot/.test(setup)) throw new Error('the wizard no longer creates the folder');
});

check('a join link without a submission server is refused, not attempted', () => {
  // Trying would ask Google for a folder this device did not create, which
  // fails as "not found" and reads like a broken link rather than a missing
  // server. Before the proxy existed this path asked for full Drive instead.
  const join = read('js/views/join.js');
  if (/adapters\.drive/.test(join)) {
    throw new Error('the join screen reaches for Drive again');
  }
  if (!/no submission server yet/i.test(join)) {
    throw new Error('nothing explains to a cadet why the link cannot work');
  }
});

check('the privacy policy names the scope the code requests', () => {
  const policy = read('privacy.html');
  const stated = /<!--SCOPE-->.*?<code>([^<]+)<\/code>.*?<!--\/SCOPE-->/s.exec(policy);
  if (!stated) throw new Error('the policy has no marked scope row');
  if (stated[1].trim() !== EXPECTED) {
    throw new Error(`policy says "${stated[1].trim()}", code requests "${EXPECTED}"`);
  }
});

check('the setup guide does not tell people to make the folder by hand', () => {
  const guide = read('tools/docs/setup-guide.html');
  if (/Create a folder named/.test(guide)) {
    throw new Error('the guide still asks for a hand-made folder, which the app cannot use');
  }
  if (!/You do not create a folder yourself/.test(guide)) {
    throw new Error('the guide does not explain that the app makes its own folder');
  }
});

check('the repository carries its licence', () => {
  const licence = read('LICENSE');
  if (!/Apache License/.test(licence) || !/Version 2\.0/.test(licence)) {
    throw new Error('LICENSE is not the Apache 2.0 text');
  }
  const pkg = JSON.parse(read('package.json'));
  if (pkg.license !== 'Apache-2.0') throw new Error(`package.json says "${pkg.license}"`);
});

console.log(failures ? `\n${failures} scope check(s) failed.` : '\nScope and its consequences hold.');
process.exit(failures ? 1 : 0);
