/**
 * Where the app gets its data.
 *
 * There are two answers, and which one applies is a property of the
 * detachment, not of the person:
 *
 *   - **Proxy mode.** The detachment has deployed the Apps Script. The cadet has
 *     no Drive access at all; one call returns their assignments, the forms to
 *     render them, and what they have already submitted. The server decides what
 *     they may see.
 *   - **Direct mode.** No proxy. The cadet reads Drive themselves, which means
 *     they have Editor on the folder and can read every response in it. It works,
 *     and the setup guide is honest about what it costs.
 *
 * This module exists so that choice is made once, here, instead of at every
 * place a view touches storage. The views ask for what they need and do not
 * care which mode is in force — which matters most as cadre reads move across,
 * because there are far more of those and each would otherwise be a chance to
 * forget the branch.
 */

import { connection } from './state.js';
import { db } from './storage/index.js';
import {
  fetchBundle, fetchCatalog, fetchResponses, fetchAllResponses, fetchRoster, fetchAudit,
  saveFormViaProxy, saveRequestViaProxy, deleteFormViaProxy, deleteRequestViaProxy,
  deleteResponseViaProxy, createAccountViaProxy, updateAccountViaProxy,
  deleteAccountViaProxy, rolloverViaProxy, recordAuditViaProxy,
} from './storage/proxy.js';
import { currentIdToken, IDENTITY_CHANGED } from './session.js';
import { recent as recentAudit, record as recordAuditDirect } from './audit.js';

/** True when this detachment routes people through the submission proxy. */
export function usingProxy() {
  return Boolean(connection.get().proxyUrl);
}

/**
 * Whether this device can perform folder maintenance.
 *
 * Backup, restore, wipe, reindex and migrate all operate on the folder as a
 * whole, and the proxy deliberately exposes no action for any of them: an
 * endpoint that could empty a detachment's records on request is not one worth
 * having. They stay with whoever owns the folder — which is the account the
 * Apps Script itself runs as, so someone always can.
 */
export function canDoMaintenance() {
  return !usingProxy();
}

/** Connection state for the header, without needing a storage adapter. */
export async function connectionStatus() {
  if (usingProxy()) {
    const url = proxyUrl();
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      const body = await response.json();
      return body?.service === 'top-feedback-proxy'
        ? { status: 'ready', detail: 'Through your detachment\'s server' }
        : { status: 'error', detail: 'The submission service did not answer properly.' };
    } catch {
      return { status: 'offline', detail: 'Cannot reach the submission service.' };
    }
  }
  return db.status();
}

/**
 * Cached per page load.
 *
 * A cadet moves between the list and a form and back, and re-fetching the
 * bundle each time would be three round trips to Apps Script on a connection
 * that may be a phone on a bad campus signal. Cleared after a submission, which
 * is the only thing that changes what the bundle would say.
 */
let cached = null;

export function invalidateStudentData() {
  cached = null;
}

// The bundle belongs to one person. A shared office laptop signs one cadre
// member out and the next one in without ever reloading the page, so holding it
// past a sign-in would show them somebody else's feedback.
if (typeof window !== 'undefined') {
  window.addEventListener(IDENTITY_CHANGED, () => { cached = null; });
}

async function loadBundle() {
  if (cached) return cached;
  const token = currentIdToken();
  if (!token) throw new Error('Your sign-in has expired. Sign in again.');
  cached = await fetchBundle(connection.get().proxyUrl, token);
  return cached;
}

/**
 * Everything the feedback list needs.
 *
 * @returns {Promise<{requests: object[], submitted: Set<string>, account: object|null}>}
 */
export async function loadAssignments(session) {
  if (usingProxy()) {
    const bundle = await loadBundle();
    return {
      requests: bundle.requests || [],
      submitted: new Set(bundle.submitted || []),
      account: bundle.account || null,
    };
  }

  const requests = await db.listRequests();
  const submitted = new Set();
  // Only ask about requests this cadet could actually answer; a receipt lookup
  // per request across a term's worth of closed forms is wasted reads.
  for (const request of requests) {
    if (await db.hasSubmitted(request.id, session.username)) submitted.add(request.id);
  }
  return { requests, submitted, account: null };
}

/**
 * One request, its form, and whether this cadet has already answered it.
 *
 * @returns {Promise<{request: object|null, form: object|null, submitted: boolean}>}
 */
export async function loadForFilling(session, requestId) {
  if (usingProxy()) {
    const bundle = await loadBundle();
    const request = (bundle.requests || []).find((r) => r.id === requestId) || null;
    const form = request ? (bundle.forms || {})[request.formId] || null : null;
    return {
      request,
      form,
      submitted: (bundle.submitted || []).includes(requestId),
    };
  }

  const request = await db.getRequest(requestId);
  const form = request ? await db.getForm(request.formId) : null;
  const submitted = request ? await db.hasSubmitted(requestId, session.username) : false;
  return { request, form, submitted };
}

/**
 * Re-checks the cadet's own account at submission time.
 *
 * A session can outlive an administrator deactivating the account. In proxy
 * mode the server re-checks this anyway and is the authority; the local check
 * only saves a round trip and gives a clearer message.
 */
export async function loadOwnAccount(session) {
  if (usingProxy()) {
    const bundle = await loadBundle();
    return bundle.account || null;
  }
  // Direct mode: the roster is readable, so find them in it. Deliberately not
  // auth.findByUsername — importing auth here would put back the cycle that
  // session.js exists to prevent.
  const roster = await loadRoster();
  const target = String(session.username || '').trim().toLowerCase();
  return roster.find((a) => String(a.username || '').toLowerCase() === target) || null;
}

/* ------------------------------------------------------------------ *
 * cadre reads
 *
 * The same fork, for the screens instructors and cadre use. These exist so the
 * views stay unaware of which mode is in force — every one of them was reading
 * Drive directly, and adding a branch to each would have meant seven chances to
 * forget one.
 * ------------------------------------------------------------------ */

const token = () => {
  const value = currentIdToken();
  if (!value) throw new Error('Your sign-in has expired. Sign in again.');
  return value;
};

const proxyUrl = () => connection.get().proxyUrl;

/** Forms and requests together, so the portal opens in one round trip. */
export async function loadCatalog() {
  if (usingProxy()) return fetchCatalog(proxyUrl(), token());
  const [forms, requests] = await Promise.all([db.listForms(), db.listRequests()]);
  return { forms, requests };
}

/** Just the forms. */
export async function loadForms() {
  return (await loadCatalog()).forms;
}

/** Just the requests. */
export async function loadRequests() {
  return (await loadCatalog()).requests;
}

/**
 * One request, by id.
 *
 * Fetched through the catalog rather than by name: the proxy exposes no
 * single-record read, deliberately, because a call that takes an id and returns
 * whatever is at that id is a short step from a call that takes a path.
 */
export async function getRequest(requestId) {
  return (await loadRequests()).find((r) => r.id === requestId) || null;
}

export async function getForm(formId) {
  return (await loadForms()).find((f) => f.id === formId) || null;
}

/** Responses and receipts for one request. */
export async function loadResponsesFor(requestId) {
  if (usingProxy()) return fetchResponses(proxyUrl(), token(), requestId);
  const [responses, receipts] = await Promise.all([
    db.listResponses(requestId),
    db.listReceipts(requestId),
  ]);
  return { responses, receipts };
}

/** Every response, for analysis that spans forms. */
export async function loadAllResponses() {
  if (usingProxy()) return fetchAllResponses(proxyUrl(), token());
  return db.listAllResponses();
}

/** Org record and headline counts, without shipping the records. */
export async function loadOverview() {
  if (usingProxy()) {
    const { fetchOverview } = await import('./storage/proxy.js');
    return fetchOverview(proxyUrl(), token());
  }
  return { org: await db.getOrg(), stats: await db.stats() };
}

export async function loadRoster() {
  if (usingProxy()) return fetchRoster(proxyUrl(), token());
  return (await db.getUsers()).users || [];
}

/** Active students only, for targeting a form and for completion tracking. */
export async function loadStudents() {
  const roster = await loadRoster();
  return roster
    .filter((a) => a.roles?.includes('student') && a.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Audit entries, newest first.
 *
 * Sorted here rather than trusted from either source: direct mode sorts on the
 * way out of audit.js, the proxy returns them a month at a time, and a screen
 * that got them in a different order depending on deployment would be a bug
 * nobody could reproduce.
 */
export async function loadAudit(months = 6) {
  const entries = usingProxy()
    ? await fetchAudit(proxyUrl(), token(), months)
    : await recentAudit({ months });
  return entries.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/* ------------------------------------------------------------------ *
 * writes
 *
 * The same fork again. Through the proxy these are stronger than the direct
 * path they replace: the roster ones run their whole read-modify-write inside a
 * server-side lock, where the direct path could only compare revisions and
 * retry.
 * ------------------------------------------------------------------ */

export async function saveForm(form) {
  if (usingProxy()) return saveFormViaProxy(proxyUrl(), token(), form);
  return db.saveForm(form);
}

export async function saveRequest(request) {
  if (usingProxy()) return saveRequestViaProxy(proxyUrl(), token(), request);
  return db.saveRequest(request);
}

export async function deleteForm(formId) {
  if (usingProxy()) return deleteFormViaProxy(proxyUrl(), token(), formId);
  return db.deleteForm(formId);
}

export async function deleteRequest(requestId) {
  if (usingProxy()) return deleteRequestViaProxy(proxyUrl(), token(), requestId);
  return db.deleteRequest(requestId);
}

/**
 * Deletes one response.
 *
 * The reason is mandatory in proxy mode and enforced by the server. Direct mode
 * cannot enforce it, which is one more reason the proxy is the better position.
 */
export async function deleteResponse(requestId, responseId, reason) {
  if (usingProxy()) {
    return deleteResponseViaProxy(proxyUrl(), token(), requestId, responseId, reason);
  }
  return db.deleteResponse(requestId, responseId);
}

export async function createAccountRecord(account) {
  if (usingProxy()) return createAccountViaProxy(proxyUrl(), token(), account);
  let created = null;
  await db.updateUsers((users) => {
    if (users.some((u) => String(u.email || '').toLowerCase() === account.email)) {
      throw new Error(`${account.email} is already on the roster.`);
    }
    created = account;
    return [...users, account];
  });
  return created;
}

export async function updateAccountRecord(id, patch, mutate) {
  if (usingProxy()) return updateAccountViaProxy(proxyUrl(), token(), id, patch);
  let result = null;
  await db.updateUsers((users) => {
    const next = mutate(users);
    result = next.find((a) => a.id === id) || null;
    return next;
  });
  return result;
}

/**
 * Removes someone and permanently anonymises what they left behind.
 *
 * Dropping the roster entry alone would leave their name on every attributed
 * response and their username on every receipt, so "delete this person" would
 * mean "stop them signing in" and nothing else — and a backup export would
 * carry all of it out of the folder anyway.
 *
 * Responses keep their content and lose their respondent. Receipts keep their
 * existence, because completion counts must still add up, and lose the name.
 * Irreversible on purpose; that is what makes it worth anything.
 */
export async function deleteAccountRecord(id) {
  if (usingProxy()) return deleteAccountViaProxy(proxyUrl(), token(), id);

  const roster = await db.getUsers();
  const target = (roster.users || []).find((a) => a.id === id);
  if (!target) throw new Error('That account no longer exists.');

  const counts = await anonymiseInDrive(target.username);
  await db.updateUsers((users) => users.filter((a) => a.id !== id));
  return counts;
}

/**
 * The direct-mode equivalent of the proxy's sweep.
 *
 * Slower, because it reads every response folder rather than doing it
 * server-side, but deletion is rare and correctness matters more than speed.
 */
async function anonymiseInDrive(username) {
  const at = new Date().toISOString();
  const counts = { responses: 0, receipts: 0 };
  const target = String(username || '').toLowerCase();

  for (const request of await db.listRequests()) {
    for (const response of await db.listResponses(request.id)) {
      if (String(response.respondent?.username || '').toLowerCase() !== target) continue;
      await db.saveResponse({
        ...response,
        respondent: null,
        anonymous: true,      // it genuinely is now, and analysis must treat it so
        anonymisedAt: at,
      });
      counts.responses++;
    }
    if (await db.hasSubmitted(request.id, target)) {
      await db.anonymiseReceipt(request.id, target);
      counts.receipts++;
    }
  }
  return counts;
}

export async function applyRollover(moves, deactivate) {
  if (usingProxy()) return rolloverViaProxy(proxyUrl(), token(), moves, deactivate);
  return db.updateUsers((users) => users.map((user) => {
    if (!user.roles?.includes('student')) return user;
    const to = moves[user.asClass];
    if (to === undefined) return user;
    if (to === null) return deactivate === false ? user : { ...user, active: false };
    return { ...user, asClass: to };
  }));
}

/** Writes one audit entry. The actor comes from the token, never the client. */
export async function writeAudit(entry) {
  if (usingProxy()) return recordAuditViaProxy(proxyUrl(), token(), entry);
  return recordAuditDirect(entry.action, entry);
}
