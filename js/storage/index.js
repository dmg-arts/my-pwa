/**
 * Storage facade.
 *
 * Views call `db.*` and never touch an adapter directly. Swapping a detachment
 * from local storage to Google Drive is therefore a setup-screen change, not a
 * code change.
 *
 * Record layout inside the org's folder:
 *   config/org.json                        org profile
 *   config/settings.json                   shared settings + cadre passcode hash
 *   roster/students.json                   the roster, one document
 *   forms/<formId>.json                    form templates
 *   requests/<requestId>.json              issued feedback requests
 *   responses/<requestId>/<responseId>.json  submitted feedback
 */

import { APP, BACKENDS, DB_LAYOUT, DOCS, INDEXES } from '../config.js';
import { makeId, nowIso } from '../util.js';
import { connection } from '../state.js';
import { localAdapter } from './local.js';
import { folderAdapter } from './folder.js';
import { driveAdapter, parseFolderId } from './drive.js';
import { runWrite, pending, isTransient, drain, primeOverlay, queueState, onQueueChange } from './queue.js';

export { parseFolderId };
export { queueState, onQueueChange, primeOverlay };

/** Replays anything queued while offline. */
export async function flushQueue() {
  return drain(db.adapter);
}

/** Local, because auth.js imports it and importing auth here would cycle. */
function suggestUsername(name, taken = []) {
  const parts = String(name || '').replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts[0] : (parts[0] || 'cadet');
  const first = parts.length > 1 ? parts[1] : '';
  let base = `${last}${first ? `.${first}` : ''}`.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (base.length < 3) base = `${base}user`;
  const existing = new Set(taken);
  if (!existing.has(base)) return base;
  for (let n = 2; n < 999; n++) if (!existing.has(`${base}${n}`)) return `${base}${n}`;
  return `${base}${Date.now().toString(36)}`;
}

const ADAPTERS = {
  [BACKENDS.local]: localAdapter,
  [BACKENDS.folder]: folderAdapter,
  [BACKENDS.drive]: driveAdapter,
};

export const adapters = ADAPTERS;

let active = null;

/** Small read-through cache so redrawing a list doesn't re-hit Drive. */
const cache = new Map();
const CACHE_MS = 20_000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Drops cache entries whose key starts with any given prefix. */
function invalidate(...prefixes) {
  for (const key of [...cache.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
  }
}

export const db = {
  /** Points the facade at the backend recorded in the connection state. */
  use(backendId, options = {}) {
    active = ADAPTERS[backendId] || null;
    if (active === driveAdapter) {
      const conn = connection.get();
      driveAdapter.configure({
        clientId: options.clientId ?? conn.clientId,
        folderId: options.folderId ?? conn.folderId,
      });
    }
    cache.clear();
    return active;
  },

  get adapter() {
    if (!active) {
      const backend = connection.get().backend;
      if (backend) this.use(backend);
    }
    return active;
  },

  get backendId() {
    return this.adapter?.id ?? null;
  },

  isReady() {
    return Boolean(this.adapter);
  },

  /** Creates the folder tree and the seed documents. Safe to run repeatedly. */
  async initialize({ orgName = '', seed = true } = {}) {
    const adapter = requireAdapter();
    await adapter.ensureLayout(Object.values(DB_LAYOUT.folders));

    let org = await adapter.readDoc(DOCS.org);
    if (!org) {
      // A brand-new folder starts at the current schema — nothing to migrate.
      org = {
        schemaVersion: APP.schemaVersion,
        appVersion: APP.version,
        orgName: orgName || 'Detachment',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await adapter.writeDoc(DOCS.org, org);
    } else if (orgName && org.orgName !== orgName) {
      org = { ...org, orgName, updatedAt: nowIso() };
      await adapter.writeDoc(DOCS.org, org);
    }

    let shared = await adapter.readDoc(DOCS.shared);
    if (!shared) {
      shared = {
        schemaVersion: APP.schemaVersion,
        cadrePasscode: null,      // set on first cadre unlock
        allowAnonymous: true,
        requireStudentName: true,
        updatedAt: nowIso(),
      };
      await adapter.writeDoc(DOCS.shared, shared);
    }

    if (!(await adapter.readDoc(`${DB_LAYOUT.folders.roster}/students.json`))) {
      await adapter.writeDoc(`${DB_LAYOUT.folders.roster}/students.json`,
        { schemaVersion: APP.schemaVersion, students: [], updatedAt: nowIso() });
    }

    if (seed && (await this.listForms()).length === 0) {
      for (const form of starterForms()) await this.saveForm(form);
    }

    invalidate('');
    return org;
  },

  /**
   * Upgrades this folder's records to the schema this build expects.
   * Imported lazily so the migration code is not on the first-paint path.
   */
  async migrate(options = {}) {
    // Drop the read cache first. A migration run from the admin console happens
    // after plenty of browsing, and upgrading records against a stale snapshot
    // would silently skip anything written since the cache warmed.
    invalidate('');
    const { runMigrations } = await import('../migrations.js');
    const result = await runMigrations(this, options);
    invalidate('');
    return result;
  },

  async migrationStatus() {
    invalidate(DOCS.org);
    const { pendingMigrations } = await import('../migrations.js');
    return pendingMigrations(this);
  },


  async status() {
    if (!this.adapter) return { status: 'error', detail: 'Not set up yet' };
    try {
      return await this.adapter.status();
    } catch (err) {
      return { status: 'error', detail: err.message };
    }
  },

  /* ---------------- org profile + shared settings ---------------- */

  async getOrg() {
    const cached = cacheGet(DOCS.org);
    if (cached !== undefined) return cached;
    return cacheSet(DOCS.org, await requireAdapter().readDoc(DOCS.org));
  },

  async saveOrg(patch) {
    const current = (await this.getOrg()) || {};
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await requireAdapter().writeDoc(DOCS.org, next);
    invalidate(DOCS.org);
    return next;
  },

  async getShared() {
    const cached = cacheGet(DOCS.shared);
    if (cached !== undefined) return cached;
    return cacheSet(DOCS.shared, await requireAdapter().readDoc(DOCS.shared));
  },

  async saveShared(patch) {
    const current = (await this.getShared()) || {};
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await requireAdapter().writeDoc(DOCS.shared, next);
    invalidate(DOCS.shared);
    return next;
  },

  /* ---------------- roster ---------------- */

  async getRoster() {
    const path = `${DB_LAYOUT.folders.roster}/students.json`;
    const cached = cacheGet(path);
    if (cached !== undefined) return cached;
    const doc = (await requireAdapter().readDoc(path)) || { students: [] };
    return cacheSet(path, doc);
  },

  async saveRoster(students) {
    const path = `${DB_LAYOUT.folders.roster}/students.json`;
    const doc = { schemaVersion: APP.schemaVersion, students, updatedAt: nowIso() };
    await requireAdapter().writeDoc(path, doc);
    invalidate(path);
    return doc;
  },

  /* ---------------- forms ---------------- */

  async listForms() {
    return readCollection(DB_LAYOUT.folders.forms);
  },

  async getForm(id) {
    return requireAdapter().readDoc(`${DB_LAYOUT.folders.forms}/${id}.json`);
  },

  async saveForm(form) {
    const record = {
      schemaVersion: APP.schemaVersion,
      ...form,
      id: form.id || makeId('form'),
      createdAt: form.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    await requireAdapter().writeDoc(`${DB_LAYOUT.folders.forms}/${record.id}.json`, record);
    invalidate(DB_LAYOUT.folders.forms);
    return record;
  },

  async deleteForm(id) {
    await requireAdapter().deleteDoc(`${DB_LAYOUT.folders.forms}/${id}.json`);
    invalidate(DB_LAYOUT.folders.forms);
  },

  /* ---------------- requests ---------------- */

  async listRequests() {
    const items = await readCollection(DB_LAYOUT.folders.requests);
    return items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async getRequest(id) {
    return requireAdapter().readDoc(`${DB_LAYOUT.folders.requests}/${id}.json`);
  },

  async saveRequest(request) {
    const record = {
      schemaVersion: APP.schemaVersion,
      ...request,
      id: request.id || makeId('req'),
      createdAt: request.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    await requireAdapter().writeDoc(`${DB_LAYOUT.folders.requests}/${record.id}.json`, record);
    invalidate(DB_LAYOUT.folders.requests);
    return record;
  },

  async deleteRequest(id) {
    const adapter = requireAdapter();
    for (const response of await this.listResponses(id)) {
      await adapter.deleteDoc(`${DB_LAYOUT.folders.responses}/${id}/${response.id}.json`);
    }
    await adapter.deleteDoc(`${DB_LAYOUT.folders.requests}/${id}.json`);
    invalidate(DB_LAYOUT.folders.requests, DB_LAYOUT.folders.responses);
  },

  /* ---------------- responses ----------------
   * Reads go through per-request roll-up indexes. Writing a response costs
   * three writes (record, request index, global counts); reading a term's
   * worth of feedback costs one read per request instead of one per response,
   * which is the difference between ~12 API calls and several thousand.
   * -------------------------------------------------------------------- */

  /** Responses for one request, from its index, falling back to a full walk. */
  async listResponses(requestId, { rebuild = false } = {}) {
    const indexPath = INDEXES.responsesFor(requestId);
    if (!rebuild) {
      const cached = cacheGet(indexPath);
      if (cached !== undefined) return cached;
      const index = await readDoc(indexPath);
      if (index?.responses) return cacheSet(indexPath, index.responses);
    }
    // No index yet (or a rebuild was asked for): read every file and write one.
    const responses = await readCollection(`${DB_LAYOUT.folders.responses}/${requestId}`);
    await writeResponseIndex(requestId, responses);
    return cacheSet(indexPath, responses);
  },

  /** Every response across every request, one index read per request. */
  async listAllResponses() {
    const key = `${DB_LAYOUT.folders.responses}:all`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    const requestIds = await knownRequestIds();
    const out = [];
    for (const requestId of requestIds) {
      out.push(...await this.listResponses(requestId));
    }
    return cacheSet(key, out);
  },

  /**
   * Response counts without reading any response. One document read, so the
   * home screen stays cheap no matter how much feedback has accumulated.
   */
  async responseCounts() {
    const cached = cacheGet(INDEXES.responseCounts);
    if (cached !== undefined) return cached;
    const doc = await readDoc(INDEXES.responseCounts);
    if (doc) return cacheSet(INDEXES.responseCounts, doc);
    return cacheSet(INDEXES.responseCounts, await rebuildCounts(this));
  },

  async saveResponse(response) {
    const record = {
      schemaVersion: APP.schemaVersion,
      ...response,
      id: response.id || makeId('res'),
      submittedAt: response.submittedAt || nowIso(),
    };
    const path = `${DB_LAYOUT.folders.responses}/${record.requestId}/${record.id}.json`;
    const { queued } = await writeDoc(path, record);

    // Keep the roll-ups in step. Read the current index before invalidating so
    // a queued (offline) write still lands in the local view of the data.
    const existing = await this.listResponses(record.requestId).catch(() => []);
    const merged = [...existing.filter((r) => r.id !== record.id), record];
    await writeResponseIndex(record.requestId, merged);
    await bumpCounts(record.requestId, merged.length);

    invalidate(DB_LAYOUT.folders.responses);
    return { ...record, queued };
  },

  async deleteResponse(requestId, responseId) {
    await deleteDoc(`${DB_LAYOUT.folders.responses}/${requestId}/${responseId}.json`);
    const remaining = (await this.listResponses(requestId)).filter((r) => r.id !== responseId);
    await writeResponseIndex(requestId, remaining);
    await bumpCounts(requestId, remaining.length);
    invalidate(DB_LAYOUT.folders.responses);
  },

  /** Repairs every index by re-reading the underlying records. */
  async rebuildIndexes() {
    invalidate('');
    const requestIds = await knownRequestIds();
    let responses = 0;
    for (const requestId of requestIds) {
      const rows = await this.listResponses(requestId, { rebuild: true });
      responses += rows.length;
    }
    const counts = await rebuildCounts(this);
    return { requests: requestIds.length, responses, counts };
  },

  /* ---------------- receipts ----------------
   * A receipt records THAT a username submitted, in a folder separate from
   * WHAT they wrote. That separation is what lets the app block a second
   * submission and show who still owes feedback, without ever putting a name
   * beside an anonymous answer.
   * -------------------------------------------------------------------- */

  /** Usernames that have already submitted for a request. */
  async listReceipts(requestId) {
    const path = INDEXES.receiptsFor(requestId);
    const cached = cacheGet(path);
    if (cached !== undefined) return cached;
    const doc = await readDoc(path);
    return cacheSet(path, doc?.receipts || []);
  },

  async hasSubmitted(requestId, username) {
    const target = String(username || '').trim().toLowerCase();
    if (!target) return false;
    return (await this.listReceipts(requestId)).some((r) => r.username === target);
  },

  async addReceipt(requestId, username) {
    const target = String(username).trim().toLowerCase();
    const receipts = await this.listReceipts(requestId);
    if (receipts.some((r) => r.username === target)) return receipts;
    const next = [...receipts, { username: target, submittedAt: nowIso() }];
    await writeDoc(INDEXES.receiptsFor(requestId), {
      schemaVersion: APP.schemaVersion, requestId, receipts: next, updatedAt: nowIso(),
    });
    invalidate(INDEXES.receiptsFor(requestId));
    return next;
  },

  async clearReceipt(requestId, username) {
    const target = String(username).trim().toLowerCase();
    const next = (await this.listReceipts(requestId)).filter((r) => r.username !== target);
    await writeDoc(INDEXES.receiptsFor(requestId), {
      schemaVersion: APP.schemaVersion, requestId, receipts: next, updatedAt: nowIso(),
    });
    invalidate(INDEXES.receiptsFor(requestId));
    return next;
  },

  /* ---------------- accounts ---------------- */

  async getUsers() {
    const cached = cacheGet(DOCS.users);
    if (cached !== undefined) return cached;
    let doc = await readDoc(DOCS.users);
    if (!doc) doc = await migrateRosterToUsers(this);
    return cacheSet(DOCS.users, doc);
  },

  async saveUsers(users) {
    const doc = { schemaVersion: APP.schemaVersion, users, updatedAt: nowIso() };
    await writeDoc(DOCS.users, doc);
    invalidate(DOCS.users);
    return doc;
  },

  /* ---------------- whole-database operations ---------------- */

  /** Everything, as one JSON object — the backup / migration format. */
  async exportBundle() {
    const [org, shared, roster, users, forms, requests, responses] = await Promise.all([
      this.getOrg(), this.getShared(), this.getRoster(), this.getUsers(),
      this.listForms(), this.listRequests(), this.listAllResponses(),
    ]);
    const receipts = {};
    for (const request of requests) {
      const rows = await this.listReceipts(request.id);
      if (rows.length) receipts[request.id] = rows;
    }
    return {
      format: 'top-feedback-bundle',
      schemaVersion: APP.schemaVersion,
      appVersion: APP.version,
      exportedAt: nowIso(),
      org, shared, roster, users, forms, requests, responses, receipts,
    };
  },

  /** Restores a bundle. `mode: 'merge'` keeps existing records with new ids. */
  async importBundle(bundle, { mode = 'merge' } = {}) {
    if (bundle?.format !== 'top-feedback-bundle') {
      throw new Error('That file is not a TOP-Feedback backup.');
    }
    if (mode === 'replace') await this.wipeData();

    const counts = { forms: 0, requests: 0, responses: 0, students: 0, users: 0 };

    if (bundle.org) await this.saveOrg(bundle.org);
    if (bundle.shared) await this.saveShared(bundle.shared);
    if (bundle.roster?.students?.length) {
      const existing = mode === 'replace' ? [] : (await this.getRoster()).students || [];
      const byId = new Map(existing.map((s) => [s.id, s]));
      for (const student of bundle.roster.students) byId.set(student.id, student);
      await this.saveRoster([...byId.values()]);
      counts.students = bundle.roster.students.length;
    }
    if (bundle.users?.users?.length) {
      const existing = mode === 'replace' ? [] : (await this.getUsers()).users || [];
      const byUsername = new Map(existing.map((u) => [u.username, u]));
      for (const user of bundle.users.users) byUsername.set(user.username, user);
      await this.saveUsers([...byUsername.values()]);
      counts.users = bundle.users.users.length;
    }
    for (const form of bundle.forms || []) { await this.saveForm(form); counts.forms++; }
    for (const request of bundle.requests || []) { await this.saveRequest(request); counts.requests++; }
    for (const response of bundle.responses || []) { await this.saveResponse(response); counts.responses++; }
    for (const [requestId, rows] of Object.entries(bundle.receipts || {})) {
      await writeDoc(INDEXES.receiptsFor(requestId), {
        schemaVersion: APP.schemaVersion, requestId, receipts: rows, updatedAt: nowIso(),
      });
    }

    invalidate('');
    await this.rebuildIndexes();
    return counts;
  },

  /** Deletes all records but leaves the folder tree in place. */
  async wipeData() {
    const adapter = requireAdapter();
    for (const request of await this.listRequests()) {
      await this.deleteRequest(request.id);
    }
    for (const form of await this.listForms()) {
      await adapter.deleteDoc(`${DB_LAYOUT.folders.forms}/${form.id}.json`);
    }
    await this.saveRoster([]);
    invalidate('');
  },

  /**
   * Row counts for the home and Database screens. Deliberately reads the
   * counts index rather than the responses themselves — this runs on the
   * landing page, so it must stay O(1) in the amount of feedback collected.
   */
  async stats() {
    const [forms, requests, counts, users] = await Promise.all([
      this.listForms(), this.listRequests(), this.responseCounts(), this.getUsers(),
    ]);
    const accounts = users.users || [];
    return {
      forms: forms.length,
      requests: requests.length,
      openRequests: requests.filter((r) => r.status === 'open').length,
      responses: counts.total || 0,
      students: accounts.filter((a) => a.roles?.includes('student') && a.active !== false).length,
      instructors: accounts.filter((a) => a.roles?.includes('instructor') && a.active !== false).length,
      admins: accounts.filter((a) => a.roles?.includes('admin') && a.active !== false).length,
    };
  },
};

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function requireAdapter() {
  const adapter = db.adapter;
  if (!adapter) throw new Error('No storage backend is connected. Open Settings to reconnect.');
  return adapter;
}

/* ---- queue-aware primitives ----
 * Every read consults the pending overlay first, so a record written while
 * offline is visible immediately instead of vanishing until reconnect. Every
 * write goes through the queue, which parks it on a connectivity failure. */

async function readDoc(path) {
  if (pending.isDeleted(path)) return null;
  const queued = pending.get(path);
  if (queued !== undefined) return queued;
  return requireAdapter().readDoc(path);
}

async function writeDoc(path, data) {
  return runWrite('write', path, data, () => requireAdapter().writeDoc(path, data));
}

async function deleteDoc(path) {
  return runWrite('delete', path, null, () => requireAdapter().deleteDoc(path));
}

/** Reads every .json document in a folder, merging anything queued offline. */
async function readCollection(folderPath) {
  const cached = cacheGet(folderPath);
  if (cached !== undefined) return cached;

  const adapter = requireAdapter();
  const docs = [];
  const seen = new Set();

  let entries = [];
  try {
    entries = await adapter.list(folderPath);
  } catch (err) {
    // Offline with nothing cached: fall through to whatever is queued locally.
    if (!isTransient(err)) throw err;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue; // roll-up index, not a record
    if (pending.isDeleted(entry.path)) continue;
    seen.add(entry.path);
    const doc = pending.get(entry.path) ?? await adapter.readDoc(entry.path);
    if (doc) docs.push(doc);
  }

  // Records created offline have no directory entry yet.
  for (const path of pending.under(folderPath)) {
    if (seen.has(path) || path.split('/').pop().startsWith('_')) continue;
    const doc = pending.get(path);
    if (doc) docs.push(doc);
  }

  return cacheSet(folderPath, docs);
}

/* ---- roll-up maintenance ---- */

/** Request ids that could own responses, from the requests collection. */
async function knownRequestIds() {
  const requests = await db.listRequests();
  return requests.map((r) => r.id);
}

async function writeResponseIndex(requestId, responses) {
  const path = INDEXES.responsesFor(requestId);
  await writeDoc(path, {
    schemaVersion: APP.schemaVersion,
    requestId,
    count: responses.length,
    responses,
    updatedAt: nowIso(),
  });
  cacheSet(path, responses);
}

async function bumpCounts(requestId, count) {
  const current = (await readDoc(INDEXES.responseCounts)) || { byRequest: {}, total: 0 };
  const byRequest = { ...current.byRequest, [requestId]: count };
  const doc = {
    schemaVersion: APP.schemaVersion,
    byRequest,
    total: Object.values(byRequest).reduce((sum, n) => sum + n, 0),
    updatedAt: nowIso(),
  };
  await writeDoc(INDEXES.responseCounts, doc);
  cacheSet(INDEXES.responseCounts, doc);
  return doc;
}

async function rebuildCounts(facade) {
  const byRequest = {};
  for (const requestId of await knownRequestIds()) {
    byRequest[requestId] = (await facade.listResponses(requestId)).length;
  }
  const doc = {
    schemaVersion: APP.schemaVersion,
    byRequest,
    total: Object.values(byRequest).reduce((sum, n) => sum + n, 0),
    updatedAt: nowIso(),
  };
  await writeDoc(INDEXES.responseCounts, doc);
  return doc;
}

/**
 * Upgrades a pre-accounts database: every roster student becomes a student
 * account with a generated username. Runs once, when users.json is absent.
 */
async function migrateRosterToUsers(facade) {
  const roster = await facade.getRoster();
  const students = roster.students || [];
  const taken = [];
  const users = students.map((student) => {
    const username = suggestUsername(student.name, taken);
    taken.push(username);
    return {
      id: student.id || makeId('usr'),
      username,
      name: student.name,
      roles: ['student'],
      asClass: student.asClass || '',
      section: student.section || '',
      email: student.email || '',
      active: student.active !== false,
      password: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      migratedFromRoster: true,
    };
  });
  const doc = { schemaVersion: APP.schemaVersion, users, updatedAt: nowIso() };
  await writeDoc(DOCS.users, doc);
  return doc;
}

/**
 * Two starter templates so a detachment can issue feedback on day one. They are
 * ordinary records — cadre can edit or delete them.
 */
function starterForms() {
  const scale = (id, label, help = '') => ({
    id, type: 'scale', label, help, required: true, min: 1, max: 5,
    minLabel: 'Needs work', maxLabel: 'Outstanding',
  });

  return [
    {
      id: 'form_instructor_default',
      name: 'Instructor Feedback (standard)',
      description: 'End-of-block feedback from cadets on an instructor or AS class.',
      subject: 'instructor',
      sections: [
        {
          title: 'Instruction',
          description: 'Rate the instruction you received this block.',
          items: [
            scale('q_clarity', 'Material was presented clearly'),
            scale('q_prepared', 'The instructor was prepared for each session'),
            scale('q_engaged', 'Sessions kept me engaged and involved'),
            scale('q_relevance', 'Content connected to my development as an officer candidate'),
          ],
        },
        {
          title: 'Mentorship',
          items: [
            scale('q_approach', 'The instructor was approachable with questions'),
            scale('q_feedback', 'I received useful feedback on my performance'),
          ],
        },
        {
          title: 'Comments',
          items: [
            { id: 'q_best', type: 'text', label: 'What worked well?', required: false, rows: 3 },
            { id: 'q_improve', type: 'text', label: 'What should change next term?', required: false, rows: 3 },
            {
              id: 'q_recommend', type: 'choice', label: 'Would you recommend this block as taught?',
              required: true, options: ['Yes', 'Yes, with changes', 'No'],
            },
          ],
        },
      ],
    },
    {
      id: 'form_leadership_default',
      name: 'Cadet Leadership Feedback',
      description: 'Peer and subordinate feedback on a cadet in a leadership billet.',
      subject: 'cadet',
      sections: [
        {
          title: 'Performance',
          items: [
            scale('q_standards', 'Enforces standards fairly and consistently'),
            scale('q_comms', 'Communicates intent clearly'),
            scale('q_example', 'Sets the example in bearing and effort'),
            scale('q_decisions', 'Makes timely decisions under pressure'),
            scale('q_care', 'Looks out for the people in the flight'),
          ],
        },
        {
          title: 'Development',
          items: [
            { id: 'q_strength', type: 'text', label: 'Greatest strength as a leader', required: false, rows: 2 },
            { id: 'q_growth', type: 'text', label: 'Where should they focus next?', required: false, rows: 2 },
            {
              id: 'q_billet', type: 'choice', label: 'Ready for greater responsibility?',
              required: true, options: ['Ready now', 'Ready with development', 'Not yet'],
            },
          ],
        },
      ],
    },
  ];
}
