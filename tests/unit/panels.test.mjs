/**
 * Which panel shows which area.
 *
 * The split between the Instructor Panel and the Cadre Panel is what stops
 * restricted feedback appearing in a list an instructor is reading. The proxy
 * is what makes it *true* — these checks pin the presentation rule that decides
 * what a person who is already allowed to read something is looking at now.
 *
 * The case worth guarding: a cadre member must not see the commander's area,
 * even though both live in the same panel. Getting that backwards is invisible
 * until a commander files something sensitive and a cadre member reads it.
 */

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};
const eq = (actual, expected, what) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
};

const { PANELS, panelSpacesFor, canOpenPanel, inSpaces, panelFor } =
  await import('../../js/panels.js');

/* ---------- what each role sees in each panel ---------- */

check('the Instructor Panel is the detachment area, whoever opens it', () => {
  for (const roles of [['instructor'], ['cadre'], ['commander'], ['admin', 'instructor']]) {
    eq(panelSpacesFor(PANELS.instructor, roles), ['shared'], `roles ${roles.join('+')}`);
  }
});

check('a cadre member sees the cadre area and not the commander’s', () => {
  eq(panelSpacesFor(PANELS.cadre, ['cadre']), ['cadre'], 'cadre in the Cadre Panel');
});

check('a commander sees both restricted areas', () => {
  eq(panelSpacesFor(PANELS.cadre, ['commander']), ['cadre', 'commander'], 'commander');
});

check('an instructor cannot open the Cadre Panel at all', () => {
  eq(panelSpacesFor(PANELS.cadre, ['instructor']), [], 'instructor in the Cadre Panel');
  if (canOpenPanel(PANELS.cadre, ['instructor'])) throw new Error('instructor was let in');
  if (!canOpenPanel(PANELS.instructor, ['instructor'])) throw new Error('instructor shut out of their own panel');
});

check('a database admin is not thereby cadre', () => {
  // `admin` deliberately implies nothing: managing the roster and reading
  // restricted feedback are different jobs that happen to be held together.
  if (canOpenPanel(PANELS.cadre, ['admin'])) throw new Error('admin reached the cadre area');
});

/* ---------- the filter itself ---------- */

check('records are matched to the areas on show', () => {
  const keep = inSpaces(['cadre', 'commander']);
  if (!keep({ space: 'cadre' })) throw new Error('dropped a cadre record');
  if (!keep({ space: 'commander' })) throw new Error('dropped a commander record');
  if (keep({ space: 'shared' })) throw new Error('kept a detachment record');
});

check('a record with no area is detachment material', () => {
  // Everything written before the split has no `space`. Treating it as
  // restricted would hide old feedback from the people who wrote it.
  if (!inSpaces(['shared'])({})) throw new Error('an old record was not treated as detachment');
  if (inSpaces(['cadre'])({})) throw new Error('an old record was treated as restricted');
});

/* ---------- the two panels really are one implementation ---------- */

check('both panels are rendered by the same function', () => {
  const source = readFileSync(new URL('../../js/views/instructor.js', import.meta.url), 'utf8');
  for (const name of ['renderInstructor', 'renderCadre']) {
    if (!new RegExp(`${name} = \\(root, options\\) =>\\s*\\n?\\s*renderPanel\\(`).test(source)) {
      throw new Error(`${name} no longer delegates to renderPanel — the panels can now drift`);
    }
  }
});

check('an unknown panel falls back to the instructor one', () => {
  // The creator reads this out of a query string, which anyone can edit.
  eq(panelFor('nonsense').id, 'instructor', 'unknown id');
  eq(panelFor(null).id, 'instructor', 'missing id');
  eq(panelFor('cadre').id, 'cadre', 'the real one');
});

console.log(failures ? `\n${failures} check(s) failed.` : '\nPanel scoping holds.');
process.exit(failures ? 1 : 0);
