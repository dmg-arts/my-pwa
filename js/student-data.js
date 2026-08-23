/**
 * Where the student screens get their data.
 *
 * There are two answers, and which one applies is a property of the
 * detachment, not of the cadet:
 *
 *   - **Proxy mode.** The detachment has deployed the Apps Script. The cadet has
 *     no Drive access at all; one call returns their assignments, the forms to
 *     render them, and what they have already submitted. The server decides what
 *     they may see.
 *   - **Direct mode.** No proxy. The cadet reads Drive themselves, which means
 *     they have Editor on the folder and can read every response in it. It works,
 *     and the setup guide is honest about what it costs.
 *
 * This module exists so that choice is made once, here, instead of at each of
 * the seven places the student screens touch storage. The views ask for what
 * they need and do not care which mode is in force.
 */

import { connection } from './state.js';
import { db } from './storage/index.js';
import { fetchBundle } from './storage/proxy.js';
import { currentIdToken, findByUsername } from './auth.js';

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
