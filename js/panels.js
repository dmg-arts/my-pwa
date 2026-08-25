/**
 * The two working panels, and which spaces each one shows.
 *
 * The Instructor Panel and the Cadre Panel are the same screen. Same tabs, same
 * filters, same form creator — the only difference is which folder the records
 * come out of. That is deliberate: a cadre member should not have to learn a
 * second interface to do the same job with restricted material, and a bug fixed
 * in one is fixed in both because there is only one implementation.
 *
 * WHY SEPARATE PANELS RATHER THAN A FILTER
 *
 * Restricted feedback used to sit in the instructor list with a lock badge next
 * to it. That works right up until someone is reading a list on a shared screen
 * with a cadet standing behind them. Splitting the panels means the restricted
 * material is somewhere you have to deliberately navigate to, and the
 * detachment list never contains anything a cadet could not see.
 *
 * The separation here is presentation. The boundary that actually holds is the
 * proxy: `SPACE_ACCESS` in `tools/proxy/Code.gs` decides what an account can
 * read at all, and it is enforced on a server the browser does not control.
 * This file decides which of the records a person may already read they are
 * looking at right now.
 */

import { ROLES, SPACES } from './config.js';
import { spaceChoicesFor } from './spaces.js';

export const PANELS = {
  instructor: {
    id: 'instructor',
    path: '/instructor',
    title: 'Instructor Panel',
    // What the panel is for, on the home screen.
    blurb: 'Create feedback forms, read responses, run analysis, and manage the database.',
    role: ROLES.instructor,
    /** The detachment's ordinary work. Everything an instructor can see. */
    spaces: [SPACES.shared],
    defaultSpace: SPACES.shared,
  },
  cadre: {
    id: 'cadre',
    path: '/cadre',
    title: 'Cadre Panel',
    blurb: 'The same tools, for feedback instructors cannot see. Commanders also '
      + 'reach their own area here.',
    role: ROLES.cadre,
    /**
     * Cadre material, plus the commander's own area for whoever holds that role.
     * `panelSpacesFor` trims this to what the account actually has, so a cadre
     * member never sees the commander space listed here.
     */
    spaces: [SPACES.cadre, SPACES.commander],
    defaultSpace: SPACES.cadre,
  },
};

/** The panel a path or id refers to, defaulting to the instructor one. */
export function panelFor(id) {
  return PANELS[id] || PANELS.instructor;
}

/**
 * The spaces this account may see *in this panel*.
 *
 * Intersects the panel's declared spaces with what the roles allow, using the
 * same `spaceChoicesFor` the form creator uses to decide what may be written.
 * Reading and writing therefore agree by construction rather than by two lists
 * being kept in step.
 */
export function panelSpacesFor(panel, roles = []) {
  const allowed = new Set(spaceChoicesFor(roles).map((choice) => choice.value));
  return panel.spaces.filter((space) => allowed.has(space));
}

/** True when these roles can open this panel at all. */
export function canOpenPanel(panel, roles = []) {
  return panelSpacesFor(panel, roles).length > 0;
}

/**
 * Keeps only the records belonging to one of `spaces`.
 *
 * A record with no space at all predates the split and is detachment material,
 * which is why the default matters: treating it as restricted would hide old
 * feedback from the people who wrote it.
 */
export function inSpaces(spaces) {
  const allowed = new Set(spaces);
  return (record) => allowed.has(record?.space || SPACES.shared);
}
