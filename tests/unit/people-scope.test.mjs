/**
 * Whose results each role sees in the By-instructor view.
 *
 *     npm run test:unit
 *
 * `tests/proxy/behaviour.test.mjs` runs the same rule through the real proxy
 * against an in-memory Drive, which is what proves the narrowing actually
 * happens server-side. This pins the rule itself, in the form the app and the
 * non-proxy backends use, so a change to one is visible without reading Apps
 * Script.
 *
 * THE CASE WORTH GUARDING
 *
 * `ROLE_IMPLIES` makes cadre imply instructor. A tier computed on *effective*
 * roles would therefore put every cadre member in the instructor tier and hand
 * them each other's results — silently, and looking correct on screen, because
 * a cadre member reading another cadre member's feedback is exactly what the
 * screen is for at the next tier up. Nothing would look wrong until a commander
 * filed something about one cadre member and another read it.
 */

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};
const eq = (actual, expected, what) => {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
};

const { peopleScope, peopleTierFor, isPlainInstructor, subjectOf, PEOPLE_SCOPE } =
  await import('../../js/people-scope.js');
const { effectiveRoles } = await import('../../js/config.js');

const roster = new Map([
  ['teachone', { username: 'teachone', roles: ['instructor'] }],
  ['teachtwo', { username: 'teachtwo', roles: ['instructor'] }],
  ['boss', { username: 'boss', roles: ['cadre'] }],
  ['boss2', { username: 'boss2', roles: ['cadre'] }],
  ['top', { username: 'top', roles: ['commander'] }],
  ['clerk', { username: 'clerk', roles: ['admin', 'instructor'] }],
]);

const req = (subject, createdBy = subject) => ({ subject, createdBy });

/* ---------- the tiers ---------- */

check('held roles decide the tier', () => {
  eq(peopleTierFor(['instructor']), PEOPLE_SCOPE.own, 'instructor');
  eq(peopleTierFor(['cadre']), PEOPLE_SCOPE.instructors, 'cadre');
  eq(peopleTierFor(['commander']), PEOPLE_SCOPE.all, 'commander');
  eq(peopleTierFor(['admin', 'instructor']), PEOPLE_SCOPE.own, 'admin who instructs');
});

check('the highest held role wins when several are held', () => {
  eq(peopleTierFor(['instructor', 'commander']), PEOPLE_SCOPE.all, 'instructor+commander');
  eq(peopleTierFor(['cadre', 'commander']), PEOPLE_SCOPE.all, 'cadre+commander');
});

/* ---------- the trap ---------- */

check('effective roles would break the cadre tier, held roles do not', () => {
  // The bug this guards: effectiveRoles(['cadre']) contains 'instructor'.
  const effective = effectiveRoles(['cadre']);
  if (!effective.includes('instructor')) {
    throw new Error('effectiveRoles no longer implies instructor — revisit this test');
  }
  // Computed on the held set, a cadre account is still in the cadre tier.
  eq(peopleTierFor(['cadre']), PEOPLE_SCOPE.instructors, 'cadre held');
  // And is not itself a plain-instructor subject.
  eq(isPlainInstructor(roster.get('boss')), false, 'cadre as a subject');
});

check('one cadre member cannot see another', () => {
  const scope = peopleScope(['cadre'], 'boss', roster);
  eq(scope.allows(req('boss2')), false, 'the other cadre member');
  eq(scope.allowsSubject('boss2'), false, 'the other cadre member, listed');
});

/* ---------- what each tier admits ---------- */

check('an instructor sees their own, and what they issued', () => {
  const scope = peopleScope(['instructor'], 'teachone', roster);
  eq(scope.allows(req('teachone')), true, 'about them');
  eq(scope.allows(req('teachtwo', 'teachone')), true, 'issued by them');
  eq(scope.allows(req('teachtwo')), false, 'somebody else entirely');
  eq(scope.allowsSubject('teachtwo'), false, 'somebody else, listed');
});

check('cadre see every plain instructor, and themselves', () => {
  const scope = peopleScope(['cadre'], 'boss', roster);
  eq(scope.allows(req('teachone')), true, 'an instructor');
  eq(scope.allows(req('teachtwo')), true, 'another instructor');
  eq(scope.allows(req('boss')), true, 'themselves');
  eq(scope.allows(req('top')), false, 'the commander');
});

check('a commander sees everyone', () => {
  const scope = peopleScope(['commander'], 'top', roster);
  for (const who of ['teachone', 'boss', 'boss2', 'top', 'clerk']) {
    eq(scope.allows(req(who)), true, who);
  }
});

check('an admin who also instructs is still a subject cadre may see', () => {
  // Administering the roster is a different job from being overseen, and says
  // nothing about whose results these are.
  eq(isPlainInstructor(roster.get('clerk')), true, 'admin+instructor');
  eq(peopleScope(['cadre'], 'boss', roster).allows(req('clerk')), true, 'cadre sees them');
});

/* ---------- edges ---------- */

check('a request with no subject falls back to its creator', () => {
  eq(subjectOf({ createdBy: 'teachone' }), 'teachone', 'no subject');
  eq(subjectOf({ subject: 'teachtwo', createdBy: 'teachone' }), 'teachtwo', 'both');
  eq(subjectOf({}), null, 'neither');
});

check('an unattributed request reaches only the commander', () => {
  // It predates the subject field. A commander should see that the data is
  // incomplete; nobody below them can be shown records nothing accounts for.
  const orphan = {};
  eq(peopleScope(['commander'], 'top', roster).allows(orphan), true, 'commander');
  eq(peopleScope(['cadre'], 'boss', roster).allows(orphan), false, 'cadre');
  eq(peopleScope(['instructor'], 'teachone', roster).allows(orphan), false, 'instructor');
});

check('a subject missing from the roster is not admitted by default', () => {
  const scope = peopleScope(['cadre'], 'boss', roster);
  eq(scope.allows(req('departed')), false, 'an account no longer on the roster');
});

console.log(failures ? `\n${failures} people-scope check(s) failed.` : '\nAll people-scope checks passed.');
process.exit(failures ? 1 : 0);
