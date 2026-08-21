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
  version: '0.4.0',
  /**
   * Bump when the on-disk record shape changes, and add a matching entry to
   * MIGRATIONS in js/migrations.js. The runner upgrades a detachment's existing
   * records to this version on startup.
   */
  schemaVersion: 4,
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
    audit: 'audit',
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
  /**
   * receipts/<requestId>/<username>.json — one file per student per form.
   *
   * Deliberately NOT one array in one document. Every cadet in a flight submits
   * within minutes of each other, and a shared array means read-modify-write
   * races that silently drop a receipt — which would let that student submit
   * twice and leave them showing as outstanding forever. A lost receipt is also
   * the one loss that cannot be rebuilt, because an anonymous response carries
   * no name to reconstruct it from. Separate paths make the race impossible
   * rather than merely detectable.
   */
  receiptFor: (requestId, username) => `receipts/${requestId}/${username}.json`,
  receiptsFolder: (requestId) => `receipts/${requestId}`,
  /** Pre-v3 layout, still read so an un-migrated folder keeps working. */
  legacyReceiptsFor: (requestId) => `receipts/${requestId}/_index.json`,
};

export const FOLDER_TREE_PREVIEW = `TOP-Feedback/
├── config/      org profile, shared settings
├── users/       accounts — students, instructors, admins
├── roster/      legacy student roster (migrated into users/)
├── forms/       feedback form definitions
├── requests/    feedback requests issued to students
├── responses/   submitted feedback, one folder per request
├── receipts/    who submitted (kept apart from what they said)
├── audit/       who deleted or changed what, and when
├── reports/     exported reports (CSV / JSON)
└── archive/     closed terms retained for the record`;

/**
 * Disclosure control for anonymous feedback.
 *
 * Anonymity has a hard floor: with n responses from a known set of n
 * submitters, the best anyone can do is a 1-in-n guess — and at n=1 that is a
 * certainty. Receipts make the submitters known by design, so a single response
 * shown next to a completion list identifies its author by elimination.
 *
 * Below this many responses, an anonymous form's results are withheld from the
 * analysis entirely: no statistics, no comments, no individual responses. Only
 * the counts remain, so cadre can still chase the people who owe feedback.
 *
 * This applies to anonymous forms only. On an attributed form the names are
 * already attached, so withholding would cost visibility and buy nothing.
 */
export const PRIVACY = {
  minResponsesToShow: 3,
};

/** Standardized form limits, per the form creator specification. */
export const FORM_RULES = {
  minQuestions: 3,
  textWordLimit: 250,
  scaleMin: 1,
  scaleMax: 9,
};

/**
 * The rating scale.
 *
 * Students choose a *word*; the number behind it is what gets averaged and is
 * never shown to them. All nine points are named, so the full 1–9 resolution is
 * actually reachable rather than only the odd values.
 *
 * The vocabulary alternates by design. Odd points carry the direction —
 * Detrimental, Unfavorable, Neutral, Favorable, Outstanding — and even points
 * carry the magnitude of the step either side of centre, paired symmetrically:
 * Significant (2) mirrors Major (8), Minor (4) mirrors Slight (6). Position in
 * the row supplies the direction for the magnitude words, which is why the
 * options are always rendered in numeric order and never re-sorted.
 *
 * This object drives the UI directly: one option is rendered per entry, so
 * changing the vocabulary or the number of points needs no code change.
 *
 * Changing these words does not touch stored feedback — every form records the
 * scale it was built with, so old responses keep their original wording and
 * numbers and remain comparable among themselves.
 */
export const SCALE_ANCHORS = {
  1: 'Detrimental',
  2: 'Significant',
  3: 'Unfavorable',
  4: 'Minor',
  5: 'Neutral',
  6: 'Slight',
  7: 'Favorable',
  8: 'Major',
  9: 'Outstanding',
};

/** The selectable values of an anchor set, in order. */
export function scaleValues(anchors = SCALE_ANCHORS) {
  return Object.keys(anchors).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * The word closest to a computed score, for reporting a mean in the same
 * vocabulary students answered in. Ties round toward the lower anchor so a
 * score is never described more favourably than it earned.
 */
export function nearestAnchor(value, anchors = SCALE_ANCHORS) {
  if (!Number.isFinite(value)) return null;
  const values = scaleValues(anchors);
  if (!values.length) return null;
  let best = values[0];
  for (const candidate of values) {
    if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  }
  return anchors[best] ?? anchors[String(best)] ?? null;
}

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

/**
 * How a cadet's AS level advances at the end of an academic year.
 * A level with no entry here is left alone — Field Training and cadre are not
 * on the four-year ladder.
 */
export const AS_PROGRESSION = {
  AS100: 'AS200',
  AS200: 'AS300',
  AS300: 'AS400',
  AS400: null,      // null means "graduating" — deactivated, never deleted
};

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
