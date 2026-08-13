/**
 * TOP-Feedback — application constants and the shape of the data model.
 *
 * Everything the rest of the app assumes about *where things live* and *what a
 * record looks like* is declared here, so re-pointing at a different Drive or
 * bumping the schema is a one-file change.
 */

export const APP = {
  name: 'TOP-Feedback',
  shortName: 'TOP-FB',
  version: '0.2.0',
  /**
   * Bump when the on-disk record shape changes, and add a matching entry to
   * MIGRATIONS in js/migrations.js. The runner upgrades a detachment's existing
   * records to this version on startup.
   */
  schemaVersion: 2,
};

/**
 * Built-in administrator, always available.
 *
 * This exists so a detachment can never lock itself out of its own database.
 * It is a *standard* credential, which means it is only as private as the Drive
 * folder itself — anyone who can reach the folder and knows this pair can open
 * the admin console. The app therefore shows a standing warning until a
 * detachment-specific admin exists, and Settings recommends disabling it then.
 */
export const BUILTIN_ADMIN = {
  username: 'admin',
  password: '#admin-Password',
  name: 'Built-in Administrator',
};

/** localStorage keys. Device-local only — never org data. */
export const LS = {
  settings: 'topfb.settings.v1',
  connection: 'topfb.connection.v1',
  cadreSession: 'topfb.cadre.session.v1',
  studentPrefs: 'topfb.student.prefs.v1',
  setupComplete: 'topfb.setup.complete.v1',
  session: 'topfb.session.v1',
  devMode: 'topfb.devmode.v1',
  queue: 'topfb.queue.v1',
};

/**
 * Account roles. An account may hold several (an instructor who also
 * administers the database holds both `instructor` and `admin`).
 */
export const ROLES = {
  student: 'student',
  instructor: 'instructor',
  admin: 'admin',
};

export const ROLE_LABELS = {
  student: 'Student',
  instructor: 'Instructor',
  admin: 'Database admin',
};

/**
 * Development mode leaves the Instructor Portal and Database Administration
 * unlocked so the app can be built out before real accounts exist. It is
 * device-local, loudly indicated in the UI, and must be off before fielding.
 */
export function isDevMode() {
  return localStorage.getItem(LS.devMode) === '1';
}

export function setDevMode(on) {
  if (on) localStorage.setItem(LS.devMode, '1');
  else localStorage.removeItem(LS.devMode);
}

/**
 * Storage backends. The org picks one during setup; every view talks to the
 * facade in js/storage/index.js and never to a backend directly.
 */
export const BACKENDS = {
  drive: 'drive',   // Google Drive REST API + OAuth (phone + desktop)
  folder: 'folder', // File System Access API against a synced Drive folder (desktop)
  local: 'local',   // IndexedDB on this device only (evaluation / offline)
};

/**
 * The folder tree created inside the org's chosen Drive folder. This *is* the
 * database: one JSON document per record, grouped by collection.
 */
export const DB_LAYOUT = {
  root: 'TOP-Feedback',
  folders: {
    config: 'config',
    users: 'users',
    forms: 'forms',
    requests: 'requests',
    responses: 'responses',
    receipts: 'receipts',
    roster: 'roster',
    reports: 'reports',
    archive: 'archive',
  },
};

/** Single-document files that live in config/ or a collection root. */
export const DOCS = {
  org: 'config/org.json',
  shared: 'config/settings.json',
  users: 'users/users.json',
};

/**
 * Roll-up files. Reading one of these replaces reading every record in the
 * folder, which is the difference between 1 API call and several thousand.
 * The leading underscore marks them as indexes; readCollection() skips them.
 */
export const INDEXES = {
  /** responses/_counts.json — {byRequest: {id: n}, total: n} */
  responseCounts: 'responses/_counts.json',
  /** responses/<requestId>/_index.json — every response for one request */
  responsesFor: (requestId) => `responses/${requestId}/_index.json`,
  /** receipts/<requestId>/_index.json — usernames that have submitted */
  receiptsFor: (requestId) => `receipts/${requestId}/_index.json`,
};

export const FOLDER_TREE_PREVIEW = `TOP-Feedback/
├── config/      org profile, shared settings
├── users/       accounts — students, instructors, admins
├── roster/      legacy student roster (migrated into users/)
├── forms/       feedback form definitions
├── requests/    feedback requests issued to students
├── responses/   submitted feedback, one folder per request
├── receipts/    who submitted (kept apart from what they said)
├── reports/     exported reports (CSV / JSON)
└── archive/     closed terms retained for the record`;

/** Standardized form limits, per the form creator specification. */
export const FORM_RULES = {
  minQuestions: 3,
  textWordLimit: 250,
  scaleMin: 1,
  scaleMax: 10,
};

/**
 * Named points on the rating scale. Anchoring odd numbers gives every rating a
 * word without crowding the row on a phone.
 *
 * NOTE: these anchors describe a 1–9 scale — with scaleMax at 10, the top point
 * sits above "Outstanding" with no label of its own. Either set scaleMax to 9
 * so the scale ends on an anchor, or add a 10th label. Change SCALE_ANCHORS and
 * FORM_RULES.scaleMax together; existing responses keep the scale they were
 * created with, so old feedback is unaffected either way.
 */
export const SCALE_ANCHORS = {
  1: 'Detrimental',
  3: 'Unsatisfactory',
  5: 'Neutral',
  7: 'Satisfactory',
  9: 'Outstanding',
};

/* ------------------------------------------------------------------ *
 * Academic term vocabulary — drives the filter controls everywhere.
 * ------------------------------------------------------------------ */

export const SEMESTERS = ['Fall', 'Spring', 'Summer'];

/** AFROTC class years. `label` is what cadre/students actually say. */
export const AS_CLASSES = [
  { code: 'AS100', label: 'AS100 — GMC First Year' },
  { code: 'AS200', label: 'AS200 — GMC Second Year' },
  { code: 'AS300', label: 'AS300 — POC First Year' },
  { code: 'AS400', label: 'AS400 — POC Second Year' },
  { code: 'FT', label: 'Field Training' },
  { code: 'CADRE', label: 'Cadre' },
];

export const REQUEST_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Open', tone: 'ok' },
  closed: { label: 'Closed', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
};

/**
 * Human-readable feedback id stamped on every request by the form creator, so
 * cadre can quote "FB-2026-0007" in conversation and filter on it later.
 */
export function makeFeedbackId(existingIds = [], now = new Date()) {
  const year = now.getFullYear();
  const prefix = `FB-${year}-`;
  const highest = existingIds
    .filter((id) => typeof id === 'string' && id.startsWith(prefix))
    .map((id) => Number.parseInt(id.slice(prefix.length), 10))
    .filter(Number.isFinite)
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

/** Counts words the way the 250-word limit is described to students. */
export function countWords(text) {
  const trimmed = (text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Generates the school-year strings used in filters, e.g. "2025-2026".
 * The academic year is treated as rolling over in July.
 */
export function schoolYears(span = 5, now = new Date()) {
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const out = [];
  for (let i = 1; i >= -(span - 2); i--) {
    out.push(`${startYear + i}-${startYear + i + 1}`);
  }
  return out;
}

export function currentSchoolYear(now = new Date()) {
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

export function currentSemester(now = new Date()) {
  const m = now.getMonth();
  if (m >= 7 && m <= 11) return 'Fall';
  if (m >= 0 && m <= 4) return 'Spring';
  return 'Summer';
}

/** Default settings. Anything absent from stored settings falls back to this. */
export const DEFAULT_SETTINGS = {
  theme: 'system',       // system | light | dark
  palette: 'default',    // default | deuteranopia | protanopia | tritanopia | mono
  contrast: 'normal',    // normal | high
  textSize: 'md',        // sm | md | lg
  reduceMotion: false,
  defaultSchoolYear: '',   // '' = follow the calendar
  defaultSemester: '',
  studentShowClosed: false,
};
