/**
 * Validates a generated batch and measures the current analysis against it.
 *
 *     node tools/tuning/ingest.mjs batch-3.jsonl
 *     node tools/tuning/ingest.mjs batches/*.jsonl
 *
 * WHAT THIS IS FOR
 *
 * The sentiment list and the safety phrase lists in js/analysis/lexicon.js were
 * written by guesswork. Guesswork can be improved, but only if there is a way to
 * tell whether a change made things better or worse — otherwise editing the
 * lexicon is just moving words around and hoping.
 *
 * So a batch of labelled samples is ground truth, and this runs the real
 * `scoreSentiment` and `screenText` against it and reports where they disagree.
 * Run it before a lexicon change and after; the numbers say whether to keep it.
 *
 * WHICH NUMBER MATTERS
 *
 * Not accuracy. **False positives on the safety screen.** Every one of those is
 * a human being pulled into reading a cadet's private feedback because somebody
 * wrote that a ruck march killed them. The screen exists to get real disclosures
 * read quickly, and a screen that cries wolf gets ignored, which costs exactly
 * the thing it was built to protect.
 *
 * False negatives matter too and are reported, but the honest position is in the
 * lexicon's own header: a word list cannot find meaning, and an empty result is
 * not evidence that nothing was disclosed. This measures a screen, not a
 * safeguard.
 */

import { readFileSync } from 'node:fs';
import { scoreSentiment, screenText } from '../../js/analysis/text.js';
import { SENTIMENT, STOPWORDS } from '../../js/analysis/lexicon.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/tuning/ingest.mjs <file.jsonl> [more.jsonl ...]');
  process.exit(2);
}

const CATEGORIES = new Set([
  'hazing', 'sexual', 'discrimination', 'violence', 'selfharm', 'substance', 'integrity',
]);
const SENTIMENTS = ['positive', 'leaning_positive', 'neutral', 'leaning_negative', 'negative'];
const REGISTERS = new Set(['formal', 'casual', 'texting', 'terse']);
const CLASSES = new Set(['AS100', 'AS200', 'AS300', 'AS400']);

/* ------------------------------------------------------------------ *
 * load and validate
 * ------------------------------------------------------------------ */

const samples = [];
const problems = [];
const seenIds = new Set();

for (const file of files) {
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split('\n');
  } catch (err) {
    console.error(`cannot read ${file}: ${err.message}`);
    process.exit(2);
  }

  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const trimmed = line.trim();
    // Tolerate blank lines and stray markdown fences: a model asked for JSONL
    // will sometimes wrap it anyway, and rejecting the whole batch for that
    // wastes a generation run.
    if (!trimmed || trimmed.startsWith('```')) return;

    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      problems.push(`${where}: not valid JSON`);
      return;
    }

    const bad = [];
    if (!row.id) bad.push('missing id');
    else if (seenIds.has(row.id)) bad.push(`duplicate id ${row.id}`);
    else seenIds.add(row.id);

    if (typeof row.text !== 'string' || !row.text.trim()) bad.push('missing text');
    if (!SENTIMENTS.includes(row.sentiment)) bad.push(`sentiment "${row.sentiment}"`);
    if (!(Number(row.intensity) >= 1 && Number(row.intensity) <= 5)) bad.push('intensity 1-5');
    if (row.register && !REGISTERS.has(row.register)) bad.push(`register "${row.register}"`);
    if (row.asClass && !CLASSES.has(row.asClass)) bad.push(`asClass "${row.asClass}"`);

    if (row.safety !== 'clean') {
      if (!Array.isArray(row.safety) || !row.safety.length) {
        bad.push('safety must be "clean" or a non-empty array');
      } else {
        for (const c of row.safety) if (!CATEGORIES.has(c)) bad.push(`category "${c}"`);
      }
    }

    if (bad.length) problems.push(`${where}: ${bad.join(', ')}`);
    else samples.push(row);
  });
}

console.log(`\nLoaded ${samples.length} sample(s) from ${files.length} file(s).`);
if (problems.length) {
  console.log(`\n${problems.length} record(s) rejected:`);
  for (const p of problems.slice(0, 20)) console.log('  ' + p);
  if (problems.length > 20) console.log(`  … and ${problems.length - 20} more`);
}
if (!samples.length) process.exit(1);

/* ------------------------------------------------------------------ *
 * safety screen
 * ------------------------------------------------------------------ */

/** The label the app would apply, mapped onto the batch's vocabulary. */
const toSlug = (label) => ({
  Positive: 'positive',
  'Leaning positive': 'leaning_positive',
  'Neutral or mixed': 'neutral',
  'Leaning negative': 'leaning_negative',
  Negative: 'negative',
  'No sentiment words': 'neutral',
}[label] ?? 'neutral');

let truePos = 0;
let falsePos = 0;
let falseNeg = 0;
let trueNeg = 0;
const falsePositives = [];
const falseNegatives = [];

for (const row of samples) {
  const expected = row.safety === 'clean' ? [] : row.safety;
  // `screenText` returns `categoryId`, not `id`.
  const found = screenText(row.text).map((c) => c.categoryId);

  if (!expected.length && !found.length) trueNeg++;
  else if (!expected.length && found.length) {
    falsePos++;
    falsePositives.push({ row, found });
  } else if (expected.length && !found.length) {
    falseNeg++;
    falseNegatives.push({ row });
  } else {
    truePos++;
    // Caught something, but check it was the right something.
    const missed = expected.filter((c) => !found.includes(c));
    if (missed.length) falseNegatives.push({ row, partial: missed });
  }
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const flagged = truePos + falsePos;
const shouldFlag = truePos + falseNeg;

console.log('\n── Safety screen ─────────────────────────────────────');
console.log(`  caught            ${truePos} of ${shouldFlag} disclosures  (recall ${pct(truePos, shouldFlag)})`);
console.log(`  false alarms      ${falsePos} of ${flagged} flags        (precision ${pct(truePos, flagged)})`);
console.log(`  correctly quiet   ${trueNeg} of ${trueNeg + falsePos} clean samples`);

if (falsePositives.length) {
  console.log('\n  FALSE ALARMS — a person reads private feedback for nothing:');
  for (const { row, found } of falsePositives.slice(0, 10)) {
    console.log(`    [${found.join(',')}] ${JSON.stringify(row.text.slice(0, 88))}`);
  }
  if (falsePositives.length > 10) console.log(`    … and ${falsePositives.length - 10} more`);
}

if (falseNegatives.length) {
  console.log('\n  MISSED — worth reading, not surfaced:');
  for (const { row, partial } of falseNegatives.slice(0, 10)) {
    const want = partial ? `partial, missed ${partial.join(',')}` : row.safety.join(',');
    console.log(`    [${want}] ${JSON.stringify(row.text.slice(0, 88))}`);
  }
  if (falseNegatives.length > 10) console.log(`    … and ${falseNegatives.length - 10} more`);
}

/* ------------------------------------------------------------------ *
 * sentiment
 * ------------------------------------------------------------------ */

const order = new Map(SENTIMENTS.map((s, i) => [s, i]));
let exact = 0;
let within1 = 0;
let inverted = 0;
const worst = [];

for (const row of samples) {
  const got = toSlug(scoreSentiment(row.text).label);
  const distance = Math.abs(order.get(got) - order.get(row.sentiment));
  if (distance === 0) exact++;
  if (distance <= 1) within1++;
  // Crossing the midpoint is the failure that matters: praise read as complaint.
  const crossed = (order.get(got) - 2) * (order.get(row.sentiment) - 2) < 0;
  if (crossed) {
    inverted++;
    worst.push({ row, got });
  }
}

console.log('\n── Sentiment ─────────────────────────────────────────');
console.log(`  exact             ${exact} of ${samples.length}  (${pct(exact, samples.length)})`);
console.log(`  within one step   ${within1} of ${samples.length}  (${pct(within1, samples.length)})`);
console.log(`  direction wrong   ${inverted}  (${pct(inverted, samples.length)})`);

if (worst.length) {
  console.log('\n  READ AS THE OPPOSITE:');
  for (const { row, got } of worst.slice(0, 10)) {
    console.log(`    labelled ${row.sentiment}, scored ${got}${row.note ? ` — ${row.note}` : ''}`);
    console.log(`      ${JSON.stringify(row.text.slice(0, 88))}`);
  }
  if (worst.length > 10) console.log(`    … and ${worst.length - 10} more`);
}

/* ------------------------------------------------------------------ *
 * vocabulary the lexicon does not have
 * ------------------------------------------------------------------ */

/**
 * The actual output of a tuning run.
 *
 * Two sources, deliberately. The `vocab` field is what the generator thought was
 * unusual — useful, but it is a guess about a list it never saw. The second pass
 * finds words that carry the label statistically: they appear in samples marked
 * strongly positive or strongly negative, and the lexicon has no entry for them.
 * That one does not depend on the generator being right.
 */
const declared = new Map();
for (const row of samples) {
  for (const word of row.vocab || []) {
    const key = String(word).toLowerCase().trim();
    if (!key) continue;
    if (!declared.has(key)) declared.set(key, { count: 0, known: SENTIMENT[key] !== undefined });
    declared.get(key).count++;
  }
}

const unknownDeclared = [...declared.entries()]
  .filter(([, v]) => !v.known)
  .sort((a, b) => b[1].count - a[1].count);

console.log('\n── Vocabulary gaps ───────────────────────────────────');
console.log(`  flagged by the generator, absent from SENTIMENT: ${unknownDeclared.length}`);
for (const [word, v] of unknownDeclared.slice(0, 25)) {
  console.log(`    ${String(v.count).padStart(3)}x  ${word}`);
}
if (unknownDeclared.length > 25) console.log(`    … and ${unknownDeclared.length - 25} more`);

// Words that lean, found without trusting the generator's judgement.
const lean = new Map();
for (const row of samples) {
  const weight = { positive: 2, leaning_positive: 1, neutral: 0, leaning_negative: -1, negative: -2 }[row.sentiment];
  if (!weight) continue;
  for (const raw of row.text.toLowerCase().match(/[a-z']+/g) || []) {
    const word = raw.replace(/'/g, '');
    if (word.length < 3 || STOPWORDS.has(word) || SENTIMENT[word] !== undefined) continue;
    if (!lean.has(word)) lean.set(word, { n: 0, sum: 0 });
    const e = lean.get(word);
    e.n++;
    e.sum += weight;
  }
}

const candidates = [...lean.entries()]
  .filter(([, v]) => v.n >= 3 && Math.abs(v.sum / v.n) >= 1.2)
  .map(([word, v]) => ({ word, n: v.n, mean: v.sum / v.n }))
  .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean) || b.n - a.n);

console.log(`\n  carry a direction across ${samples.length} samples, absent from SENTIMENT: ${candidates.length}`);
console.log('    (3+ appearances, consistent lean — suggested valence in brackets)');
for (const c of candidates.slice(0, 25)) {
  const suggested = Math.max(-4, Math.min(4, Math.round(c.mean * 1.5)));
  console.log(`    ${String(c.n).padStart(3)}x  ${c.word.padEnd(18)} [${suggested > 0 ? '+' : ''}${suggested}]`);
}
if (candidates.length > 25) console.log(`    … and ${candidates.length - 25} more`);

console.log('\nNothing here is applied automatically. Read the candidates, decide,');
console.log('edit js/analysis/lexicon.js by hand, and run this again to compare.\n');
