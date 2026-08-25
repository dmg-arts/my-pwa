/**
 * Which area a piece of feedback belongs to, in the app's own words.
 *
 * The server decides what an account may actually reach — this is only how the
 * choice is described to the person making it. Keeping the wording here rather
 * than in the form creator means the panels, the picker and the badges all
 * describe the same thing the same way.
 */

import { SPACES, ROLES } from './config.js';

const DESCRIPTIONS = {
  [SPACES.shared]: {
    label: 'Detachment',
    short: 'Detachment',
    hint: 'Visible to every instructor. The usual choice.',
  },
  [SPACES.cadre]: {
    label: 'Cadre only',
    short: 'Cadre',
    hint: 'Visible to cadre and the commander. Instructors cannot see it, and cannot '
      + 'reach it by opening Drive either — it is a separate folder they have no access to.',
  },
  [SPACES.commander]: {
    label: 'Commander only',
    short: 'Commander',
    hint: 'Visible to the commander alone. Not to cadre, not to instructors.',
  },
};

export function spaceLabel(space) {
  return DESCRIPTIONS[space]?.label || DESCRIPTIONS[SPACES.shared].label;
}

export function spaceShort(space) {
  return DESCRIPTIONS[space]?.short || DESCRIPTIONS[SPACES.shared].short;
}

export function spaceHint(space) {
  return DESCRIPTIONS[space]?.hint || '';
}

/**
 * The areas this person may file feedback into, most open first.
 *
 * Mirrors the server's rule rather than replacing it. Someone who edits the
 * page to add an option they do not hold gets a refusal from the proxy, not a
 * quietly misfiled request.
 */
export function spaceChoicesFor(roles = []) {
  const out = [SPACES.shared];
  if (roles.includes(ROLES.cadre) || roles.includes(ROLES.commander)) out.push(SPACES.cadre);
  if (roles.includes(ROLES.commander)) out.push(SPACES.commander);
  return out.map((space) => ({
    value: space,
    label: spaceLabel(space),
    hint: spaceHint(space),
  }));
}

/** True when a space is anything other than the shared one. */
export function isRestricted(space) {
  return Boolean(space) && space !== SPACES.shared;
}
