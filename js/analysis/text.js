/**
 * Text analysis for written feedback.
 *
 * Runs entirely in the browser against a curated lexicon — see lexicon.js for
 * why there is no model behind this. Three capabilities, in increasing order of
 * how carefully the output must be treated:
 *
 *   1. Word frequency, for a word cloud. Mechanical and reliable.
 *   2. Sentiment, which reads words rather than meaning and is a rough sort.
 *   3. Safety screening, which is a prompt to read a response, never a finding.
 */

import {
  SENTIMENT, INTENSIFIERS, NEGATORS, CLAUSE_BREAKS, STOPWORDS,
  SAFETY_CATEGORIES, SEVERITY_ORDER,
} from './lexicon.js';

/* ------------------------------------------------------------------ *
 * Tokenizing
 * ------------------------------------------------------------------ */

/** Words, lowercased, apostrophes folded so "don't" matches "dont". */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

/**
 * Collapses obvious inflections so "organised", "organising" and "organise"
 * land on one entry in the cloud. Deliberately crude — a real stemmer would
 * merge words a reader then cannot recognise in the output.
 */
export function normalizeWord(word) {
  if (word.length <= 4) return word;
  for (const [suffix, min] of [['ingly', 7], ['edly', 7], ['ing', 6], ['ers', 6], ['ed', 5], ['es', 5], ['s', 4]]) {
    if (word.length >= min && word.endsWith(suffix)) {
      let stem = word.slice(0, -suffix.length);
      // "running" -> "runn" -> "run"
      if (/([bdfglmnprt])\1$/.test(stem)) stem = stem.slice(0, -1);
      if (stem.length >= 3) return stem;
    }
  }
  return word;
}

/* ------------------------------------------------------------------ *
 * Sentiment
 * ------------------------------------------------------------------ */

/**
 * Scores one piece of text.
 *
 * Handles the three things a bare word-count gets wrong often enough to matter:
 * negation ("not helpful"), intensity ("extremely helpful"), and the pivot in
 * "the labs were good but the lectures were useless", where a clause break ends
 * the reach of an earlier negation.
 *
 * @returns {{score: number, label: string, tone: string, hits: Array, words: number}}
 */
export function scoreSentiment(text) {
  const words = tokenize(text);
  const hits = [];
  let total = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const base = SENTIMENT[word] ?? SENTIMENT[normalizeWord(word)];
    if (base === undefined) continue;

    let value = base;
    let multiplier = 1;
    let negated = false;

    // Look back up to three words for a modifier, stopping at a clause break.
    for (let back = 1; back <= 3 && i - back >= 0; back++) {
      const prior = words[i - back];
      if (CLAUSE_BREAKS.has(prior)) break;
      if (NEGATORS.has(prior)) { negated = true; break; }
      if (INTENSIFIERS[prior] !== undefined) multiplier *= INTENSIFIERS[prior];
    }

    value *= multiplier;
    // Negation is dampened rather than mirrored: "not great" is a complaint,
    // but a milder one than "terrible", and flipping the sign outright
    // overstates it.
    if (negated) value = -value * 0.75;

    total += value;
    hits.push({ word, value: Math.round(value * 100) / 100, negated });
  }

  // Normalise by length so a long, thoughtful response is not scored as more
  // positive than a short one simply for containing more words.
  const density = hits.length ? total / Math.sqrt(hits.length) : 0;
  const score = Math.max(-5, Math.min(5, Math.round(density * 100) / 100));

  return { score, ...labelSentiment(score, hits.length), hits, words: words.length };
}

function labelSentiment(score, hitCount) {
  if (!hitCount) return { label: 'No sentiment words', tone: 'neutral' };
  if (score >= 2) return { label: 'Positive', tone: 'ok' };
  if (score >= 0.5) return { label: 'Leaning positive', tone: 'ok' };
  if (score > -0.5) return { label: 'Neutral or mixed', tone: 'neutral' };
  if (score > -2) return { label: 'Leaning negative', tone: 'warn' };
  return { label: 'Negative', tone: 'danger' };
}

/** Sentiment across a set of answers, with the distribution that produced it. */
export function summariseSentiment(texts) {
  const scored = texts.map((text) => ({ text, ...scoreSentiment(text) }));
  const withSignal = scored.filter((s) => s.hits.length);
  if (!withSignal.length) {
    return { n: scored.length, scored, average: null, buckets: null, unreadable: scored.length };
  }

  const average = withSignal.reduce((sum, s) => sum + s.score, 0) / withSignal.length;
  const buckets = { positive: 0, neutral: 0, negative: 0 };
  for (const s of withSignal) {
    if (s.score >= 0.5) buckets.positive++;
    else if (s.score > -0.5) buckets.neutral++;
    else buckets.negative++;
  }

  return {
    n: scored.length,
    scored,
    average: Math.round(average * 100) / 100,
    ...labelSentiment(average, withSignal.length),
    buckets,
    // Responses with no lexicon match at all: the score says nothing about them.
    unreadable: scored.length - withSignal.length,
  };
}

/* ------------------------------------------------------------------ *
 * Word frequency
 * ------------------------------------------------------------------ */

/**
 * Term counts for the cloud.
 *
 * Counts the number of *responses* a term appears in, not raw occurrences, so
 * one person repeating a word cannot dominate a cloud built from six people.
 */
export function wordFrequencies(texts, { limit = 60, minLength = 3, minResponses = 1 } = {}) {
  const totals = new Map();
  const documents = new Map();
  const display = new Map();

  for (const text of texts) {
    const seen = new Set();
    for (const raw of tokenize(text)) {
      if (raw.length < minLength) continue;
      if (STOPWORDS.has(raw)) continue;
      if (/^\d+$/.test(raw)) continue;
      const key = normalizeWord(raw);
      if (STOPWORDS.has(key)) continue;

      totals.set(key, (totals.get(key) || 0) + 1);
      // Show the most common surface form rather than the stem, so the cloud
      // reads as English.
      const forms = display.get(key) || new Map();
      forms.set(raw, (forms.get(raw) || 0) + 1);
      display.set(key, forms);
      seen.add(key);
    }
    for (const key of seen) documents.set(key, (documents.get(key) || 0) + 1);
  }

  return [...totals.entries()]
    .filter(([key]) => (documents.get(key) || 0) >= minResponses)
    .map(([key, count]) => {
      const forms = [...display.get(key).entries()].sort((a, b) => b[1] - a[1]);
      return { term: forms[0][0], stem: key, count, responses: documents.get(key) || 0 };
    })
    .sort((a, b) => b.responses - a.responses || b.count - a.count)
    .slice(0, limit);
}

/**
 * Two-word phrases, which often carry what single words lose — "not enough
 * time" and "enough time" mean opposite things.
 */
export function phraseFrequencies(texts, { limit = 20 } = {}) {
  const counts = new Map();
  for (const text of texts) {
    const words = tokenize(text).filter((w) => !/^\d+$/.test(w));
    for (let i = 0; i < words.length - 1; i++) {
      const [a, b] = [words[i], words[i + 1]];
      // Keep a pair only if at least one half carries meaning.
      if (STOPWORDS.has(a) && STOPWORDS.has(b)) continue;
      if (a.length < 3 && b.length < 3) continue;
      const phrase = `${a} ${b}`;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Safety screening
 * ------------------------------------------------------------------ */

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compiled once — rebuilding these per response is the slow path. */
const COMPILED = SAFETY_CATEGORIES.map((category) => ({
  ...category,
  matchers: [
    ...category.terms.map((term) => ({
      term,
      re: new RegExp(`\\b${escapeRe(term).replace(/\s+/g, '\\s+')}\\b`, 'gi'),
    })),
    ...category.patterns.map((re, i) => ({
      term: `pattern ${i + 1}`,
      re: new RegExp(re.source, 'gi'),
      isPattern: true,
    })),
  ],
}));

/**
 * Screens one piece of text for language that needs a human to read it.
 *
 * Returns every match with the words around it, because the surrounding
 * sentence is what decides whether a match means anything — "we talked about
 * hazing prevention" and "I was hazed" both contain the word.
 */
export function screenText(text, { context = 8 } = {}) {
  const source = String(text || '');
  if (!source.trim()) return [];
  const words = source.split(/\s+/);
  const found = [];

  for (const category of COMPILED) {
    const matches = [];
    for (const matcher of category.matchers) {
      matcher.re.lastIndex = 0;
      let match = matcher.re.exec(source);
      while (match) {
        // Locate the match in word-space to pull a readable window around it.
        const before = source.slice(0, match.index).split(/\s+/).length - 1;
        const start = Math.max(0, before - context);
        const end = Math.min(words.length, before + context + match[0].split(/\s+/).length);
        matches.push({
          matched: match[0],
          term: matcher.term,
          isPattern: Boolean(matcher.isPattern),
          excerpt: (start > 0 ? '… ' : '') + words.slice(start, end).join(' ') + (end < words.length ? ' …' : ''),
          index: match.index,
        });
        match = matcher.re.exec(source);
        if (matches.length > 20) break;
      }
    }
    if (matches.length) {
      // One category, one entry — a response saying "hazing" three times is one
      // concern to review, not three.
      const unique = [...new Map(matches.map((m) => [m.matched.toLowerCase(), m])).values()];
      found.push({
        categoryId: category.id,
        label: category.label,
        severity: category.severity,
        note: category.note,
        matches: unique,
      });
    }
  }

  return found.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * Screens a set of answers and rolls the result up by category.
 *
 * @param {Array<{id, text, question, request}>} entries
 */
export function screenAll(entries) {
  const byCategory = new Map();
  let flaggedEntries = 0;

  for (const entry of entries) {
    const hits = screenText(entry.text);
    if (!hits.length) continue;
    flaggedEntries++;
    for (const hit of hits) {
      if (!byCategory.has(hit.categoryId)) {
        byCategory.set(hit.categoryId, {
          categoryId: hit.categoryId,
          label: hit.label,
          severity: hit.severity,
          note: hit.note,
          entries: [],
        });
      }
      byCategory.get(hit.categoryId).entries.push({ ...entry, matches: hit.matches });
    }
  }

  const categories = [...byCategory.values()]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.entries.length - a.entries.length);

  return {
    scanned: entries.length,
    flaggedEntries,
    categories,
    critical: categories.filter((c) => c.severity === 'critical').reduce((n, c) => n + c.entries.length, 0),
  };
}

/** Wraps every match in `<mark>` for display. Escapes first. */
export function highlight(text, matches) {
  const escaped = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!matches?.length) return escaped;

  const terms = [...new Set(matches.map((m) => m.matched))]
    .sort((a, b) => b.length - a.length)   // longest first, so nested terms nest correctly
    .map(escapeRe);
  if (!terms.length) return escaped;

  return escaped.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>');
}
