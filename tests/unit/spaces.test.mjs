/**
 * Unit checks for the space vocabulary and the client's view of who sees what.
 *
 * The server is the authority — these check that the app describes the same
 * rule, so nobody is offered a choice that will be refused, and nothing is
 * labelled as more private than it is.
 */

import { spacesFor, effectiveRoles, SPACES, ROLES, MAX_COMMANDERS } from '../../js/config.js';
import { spaceChoicesFor, spaceLabel, spaceShort, isRestricted } from '../../js/spaces.js';

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (err) { console.log(`  FAIL ${label}: ${err.message}`); failures++; }
};

check('an instructor sees only the shared space', () => {
  const seen = spacesFor([ROLES.instructor]);
  if (seen.length !== 1 || seen[0] !== SPACES.shared) throw new Error(seen.join(', '));
});

check('a database admin is not thereby cadre', () => {
  // Deliberate: the two are separate and may be held together, but holding one
  // must not silently confer the other's reach.
  const seen = spacesFor([ROLES.admin]);
  if (seen.includes(SPACES.cadre)) throw new Error('admin reaches the cadre space');
});

check('cadre see the shared and cadre spaces, not the commander one', () => {
  const seen = spacesFor([ROLES.cadre]);
  if (!seen.includes(SPACES.shared) || !seen.includes(SPACES.cadre)) throw new Error(seen.join(', '));
  if (seen.includes(SPACES.commander)) throw new Error('cadre reach the commander space');
});

check('a commander sees everything', () => {
  const seen = spacesFor([ROLES.commander]);
  for (const space of Object.values(SPACES)) {
    if (!seen.includes(space)) throw new Error(`commander cannot reach ${space}`);
  }
});

check('holding several roles combines their reach without inventing any', () => {
  const seen = spacesFor([ROLES.instructor, ROLES.admin]);
  if (seen.length !== 1) throw new Error(`instructor+admin reaches ${seen.join(', ')}`);
});

check('an unknown role grants nothing', () => {
  if (spacesFor(['janitor']).length) throw new Error('an unknown role granted access');
  if (spacesFor([]).length) throw new Error('no roles granted access');
});

check('students are not in the space table at all', () => {
  // Cadets reach requests by being addressed, not by holding a space. Granting
  // them one would hand them other people's responses.
  if (spacesFor([ROLES.student]).length) throw new Error('the student role grants a space');
});

/* ---------- what the picker offers ---------- */

check('an instructor is not asked where to file feedback', () => {
  if (spaceChoicesFor([ROLES.instructor]).length !== 1) throw new Error('instructor got a choice');
});

check('cadre may file into the cadre space but not the commander one', () => {
  const values = spaceChoicesFor([ROLES.cadre]).map((c) => c.value);
  if (!values.includes(SPACES.cadre)) throw new Error('cadre cannot file into their own area');
  if (values.includes(SPACES.commander)) throw new Error('cadre offered the commander area');
});

check('a commander may file anywhere', () => {
  const values = spaceChoicesFor([ROLES.commander]).map((c) => c.value);
  for (const space of Object.values(SPACES)) {
    if (!values.includes(space)) throw new Error(`commander not offered ${space}`);
  }
});

check('the picker never offers more than the server allows', () => {
  for (const roles of [[ROLES.instructor], [ROLES.cadre], [ROLES.commander], [ROLES.admin]]) {
    const offered = spaceChoicesFor(roles).map((c) => c.value);
    const allowed = spacesFor(roles);
    for (const value of offered) {
      // shared is always offered; everything else must be genuinely reachable.
      if (value !== SPACES.shared && !allowed.includes(value)) {
        throw new Error(`${roles.join('+')} offered ${value} but cannot reach it`);
      }
    }
  }
});

/* ---------- labelling ---------- */

check('only the shared space is unrestricted', () => {
  if (isRestricted(SPACES.shared)) throw new Error('shared is treated as restricted');
  if (!isRestricted(SPACES.cadre) || !isRestricted(SPACES.commander)) {
    throw new Error('a locked space is not labelled restricted');
  }
});

check('every space has a label and a short form', () => {
  for (const space of Object.values(SPACES)) {
    if (!spaceLabel(space) || !spaceShort(space)) throw new Error(`${space} has no label`);
  }
});

check('an unknown space falls back to the shared wording, not to blank', () => {
  if (spaceLabel('nonsense') !== spaceLabel(SPACES.shared)) throw new Error('no fallback label');
});

check('the commander cap is two', () => {
  // Two so a change of command overlaps; one would cut over, three is not a
  // handover.
  if (MAX_COMMANDERS !== 2) throw new Error(`cap is ${MAX_COMMANDERS}`);
});

/* ---------- role implication ---------- */

check('cadre carries instructor access', () => {
  // Without this a cadre-only account is locked out of the portal it is
  // supposed to have more access to, not less.
  if (!effectiveRoles([ROLES.cadre]).includes(ROLES.instructor)) {
    throw new Error('cadre does not imply instructor');
  }
});

check('commander carries cadre and instructor access', () => {
  const held = effectiveRoles([ROLES.commander]);
  for (const role of [ROLES.cadre, ROLES.instructor]) {
    if (!held.includes(role)) throw new Error(`commander does not imply ${role}`);
  }
});

check('database admin does not imply instructor', () => {
  // Managing the roster and running the portal are separate jobs that are often
  // held together; one must not silently grant the other.
  if (effectiveRoles([ROLES.admin]).includes(ROLES.instructor)) {
    throw new Error('admin implies instructor');
  }
});

check('implication does not leak into space access', () => {
  // cadre implies instructor, but instructor must not thereby reach the cadre
  // space through the back door.
  if (spacesFor([ROLES.instructor]).includes(SPACES.cadre)) {
    throw new Error('instructor reaches the cadre space');
  }
});

console.log(failures ? `\n${failures} space check(s) failed.` : '\nAll space checks passed.');
process.exit(failures ? 1 : 0);
