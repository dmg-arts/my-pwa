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
} from './storage/proxy.js';
import { currentIdToken, findByUsername } from './auth.js';
import { recent as recentAudit } from './audit.js';

/** True when this detachment routes cadets through the submission proxy. */
export function usingProxy() {
  return Boolean(connection.get().proxyUrl);
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
  return findByUsername(session.username);
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
