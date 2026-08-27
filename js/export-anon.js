/**
 * Anonymised export — a backup that is safe to keep somewhere else.
 *
 * An ordinary backup carries the roster, every respondent, and every receipt
 * with a username on it, all in one file that ends up on a laptop, a USB stick
 * or a personal cloud drive. This one carries the feedback and nothing that says
 * who wrote it, so the copy kept off-site is not the copy that leaks.
 *
 * IT HAS ONE PURPOSE, AND THIS IS NOT NEGOTIABLE
 *
 * This file exists so a detachment can protect its own backups. It is **not** a
 * channel for sending feedback to whoever maintains this software, and no such
 * channel exists anywhere in this app.
 *
 * An earlier draft of this module described a second use: shipping the written
 * answers to the maintainer as raw material for tuning the sentiment lexicon and
 * the safety phrase lists, which were written by guesswork and would genuinely
 * improve with real language. That was removed deliberately. Asking a detachment
 * for its cadets' words would mean cadet feedback leaving the detachment for the
 * benefit of the software rather than the unit — and once that request exists at
 * all, a detachment that says yes to be helpful has given away something its
 * cadets were told stays with them. The lexicon gets improved from published
 * research and synthetic examples instead.
 *
 * So: the maintainer never asks for this file, never receives it, and has no way
 * to. If a future change adds a "send us your data" affordance, it contradicts
 * the privacy policy shipped in `privacy.html`, which says plainly that none is
 * ever collected.
 *
 * WHAT IS STRIPPED
 *
 *   - The roster, entirely. It is the personal data.
 *   - Every `respondent`, so no answer is attributable.
 *   - Receipt usernames, replaced by a count. Who took part is not needed to
 *     restore an archive, and is exactly what correlates with timestamps.
 *   - The detachment's name, and anything else in its profile.
 *   - **Timestamps are reduced to a month.** This is the one people forget:
 *     a receipt written seconds before a response identifies its author by
 *     elimination, and that survives having the names removed.
 *
 * WHAT CANNOT BE STRIPPED
 *
 * Free text says what it says. A cadet who writes "I'm the only AS400 in Bravo
 * flight and the flight commander singled me out" has identified themselves,
 * and no amount of field removal changes that. Anyone handling this file is
 * handling feedback, not anonymous statistics, and the export says so in its own
 * header rather than relying on somebody remembering.
 */

import { db } from './storage/index.js';
import { screenText } from './analysis/text.js';
import { APP } from './config.js';

/** Dates become months: enough to see a term, not enough to line two records up. */
function toMonth(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : null;
}

/**
 * Reduces one response to its content.
 *
 * The answers, the ratings, and enough context for the numbers to mean
 * something — nothing that says who.
 */
function stripResponse(response) {
  return {
    requestId: response.requestId,
    formId: response.formId || null,
    asClass: response.asClass || '',
    schoolYear: response.schoolYear || '',
    semester: response.semester || '',
    // Deliberately not the id: response ids encode creation time, which is half
    // of the timing correlation this export exists to prevent.
    submittedMonth: toMonth(response.submittedAt),
    answers: response.answers || {},
  };
}

/** True when any text answer trips the safety screen. */
function isFlagged(response) {
  for (const value of Object.values(response.answers || {})) {
    if (typeof value !== 'string') continue;
    if (screenText(value).length) return true;
  }
  return false;
}

/**
 * Builds the export.
 *
 * @param {{includeFlagged?: boolean}} options
 *   Responses the safety screen flags are **excluded by default**. They are the
 *   most likely to describe a real incident, the most likely to identify people
 *   by circumstance, and the least appropriate to leave a detachment. Including
 *   them is a deliberate act and is recorded in the file.
 * @returns {Promise<object>}
 */
export async function buildAnonymisedExport({ includeFlagged = false } = {}) {
  const [forms, requests, responses] = await Promise.all([
    db.listForms(), db.listRequests(), db.listAllResponses(),
  ]);

  let excluded = 0;
  const kept = [];
  for (const response of responses) {
    if (!includeFlagged && isFlagged(response)) { excluded++; continue; }
    kept.push(stripResponse(response));
  }

  // How many people answered, without saying which people.
  const counts = {};
  for (const request of requests) {
    const receipts = await db.listReceipts(request.id);
    if (receipts.length) counts[request.id] = receipts.length;
  }

  return {
    format: 'nine31-anonymised',
    schemaVersion: APP.schemaVersion,
    appVersion: APP.version,
    exportedMonth: toMonth(new Date().toISOString()),
    anonymised: {
      roster: 'removed',
      respondents: 'removed',
      receipts: 'reduced to counts',
      timestamps: 'reduced to the month',
      organisation: 'removed',
      flaggedResponses: includeFlagged ? 'included by explicit choice' : 'excluded',
    },
    notice: 'This file contains written feedback with identifying fields removed. '
      + 'Free text can still identify people by circumstance. Handle it as feedback, '
      + 'not as anonymous statistics.',
    // Questions are kept because a rating means nothing without the question,
    // and the wording is what the analysis is being tuned against.
    forms: forms.map((form) => ({
      id: form.id,
      sections: (form.sections || []).map((section) => ({
        title: section.title || '',
        items: (section.items || []).map((item) => ({
          id: item.id, type: item.type, label: item.label,
          min: item.min, max: item.max,
        })),
      })),
    })),
    requests: requests.map((request) => ({
      id: request.id,
      formId: request.formId || null,
      asClass: request.asClass || '',
      schoolYear: request.schoolYear || '',
      semester: request.semester || '',
      anonymous: request.anonymous !== false,
      space: request.space || 'shared',
      respondents: counts[request.id] || 0,
      createdMonth: toMonth(request.createdAt),
    })),
    responses: kept,
    excludedFlaggedCount: excluded,
  };
}

/**
 * A one-line summary for the confirmation dialog.
 *
 * Counting before exporting means an administrator is told what is about to
 * leave, rather than finding out from the file.
 */
export async function summariseAnonymisedExport({ includeFlagged = false } = {}) {
  const responses = await db.listAllResponses();
  let flagged = 0;
  let textAnswers = 0;
  for (const response of responses) {
    if (isFlagged(response)) flagged++;
    for (const value of Object.values(response.answers || {})) {
      if (typeof value === 'string' && value.trim()) textAnswers++;
    }
  }
  return {
    responses: responses.length,
    flagged,
    textAnswers,
    leaving: includeFlagged ? responses.length : responses.length - flagged,
  };
}
