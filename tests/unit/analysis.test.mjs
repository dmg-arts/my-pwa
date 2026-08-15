/**
 * Unit checks for the analysis maths and the language lexicons.
 *
 * These import the real modules — no copies, no mocks — and need no browser,
 * so they run in about a second and are the first thing to run after touching
 * anything in js/analysis/.
 *
 *     node tests/unit/analysis.test.mjs
 */

import { describe, consensus, describeConsensus, findClusters, findOutliers,
         findRespondentOutliers, compareSegments, histogram, mode } from '../../js/analysis/stats.js';
import { scoreSentiment, summariseSentiment, wordFrequencies, screenText, tokenize, normalizeWord } from '../../js/analysis/text.js';

let fails = 0;
const t = (name, fn) => { try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + ': ' + e.message); fails++; } };
const eq = (a, b, m='') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

console.log('\n--- descriptive ---');
t('describe computes quartiles and spread', () => {
  const d = describe([1,2,3,4,5,6,7,8,9]);
  eq(d.n, 9); eq(d.median, 5); eq(d.min, 1); eq(d.max, 9); eq(d.q1, 3); eq(d.q3, 7); eq(d.iqr, 4);
});
t('mode reports ties rather than picking one', () => {
  const m = mode([1,1,5,5,9]);
  eq(m.values, [1,5]); ok(m.tied, 'should be flagged as tied');
});
t('histogram includes unchosen points', () => {
  const h = histogram([5,5,9], [1,5,9]);
  eq(h.map(b=>b.count), [0,2,1]);
});
t('dispersion is marked unreliable below n=5', () => {
  ok(describe([5,5,6]).reliable === false, 'n=3 should be unreliable');
  ok(describe([5,5,6,7,8]).reliable === true, 'n=5 should be reliable');
});

console.log('\n--- agreement ---');
t('unanimous ratings score 1.0', () => {
  eq(consensus([7,7,7,7,7], 1, 9), 1);
});
t('a polarised split scores near 0', () => {
  const c = consensus([1,1,1,9,9,9], 1, 9);
  ok(c < 0.2, `expected < 0.2, got ${c}`);
});
t('moderate spread lands in between', () => {
  const c = consensus([5,6,7,6,5], 1, 9);
  ok(c > 0.6 && c < 1, `expected 0.6-1.0, got ${c}`);
});
t('consensus is labelled in plain language', () => {
  eq(describeConsensus(consensus([1,1,9,9], 1, 9)).label, 'Sharply divided');
  eq(describeConsensus(1).label, 'Strong agreement');
});

console.log('\n--- clusters ---');
t('a genuine split is detected', () => {
  const c = findClusters([1,2,2,8,9,9], { min:1, max:9 });
  ok(c.split, 'should detect a split');
  eq(c.groups.map(g=>g.size), [3,3]);
});
t('a consensus group is not reported as split', () => {
  const c = findClusters([6,7,7,7,8,7], { min:1, max:9 });
  ok(!c.split, 'should not be split');
});
t('one outlier does not count as a cluster', () => {
  const c = findClusters([7,7,7,7,7,1], { min:1, max:9 });
  ok(!c.split, 'a lone dissenter is not a group');
});
t('clustering declines below n=5', () => { eq(findClusters([1,9,1], {min:1,max:9}), null); });

console.log('\n--- outliers ---');
t('needs six responses', () => {
  ok(findOutliers([1,7,7,7,7]).supported === false, 'n=5 should be unsupported');
});
t('a lone dissenter is flagged when everyone else agrees', () => {
  const r = findOutliers([7,7,7,7,7,1]);
  ok(r.supported); eq(r.outliers.map(o=>o.value), [1]);
});
t('normal variation is not flagged', () => {
  const r = findOutliers([5,6,7,6,5,7,6]);
  eq(r.outliers.length, 0);
});
t('a consistently harsh rater is identified', () => {
  const items = [{id:'a'},{id:'b'},{id:'c'}];
  const rows = [
    {id:'1', answers:{a:7,b:7,c:8}}, {id:'2', answers:{a:7,b:8,c:7}},
    {id:'3', answers:{a:8,b:7,c:7}}, {id:'4', answers:{a:7,b:7,c:7}},
    {id:'5', answers:{a:8,b:8,c:8}}, {id:'6', answers:{a:2,b:2,c:1}},
  ];
  const r = findRespondentOutliers(rows, items);
  ok(r.supported); eq(r.respondents.length, 1);
  ok(r.respondents[0].drift < 0, 'should read as more critical');
});

console.log('\n--- segments ---');
t('small cohorts are suppressed, not shown', () => {
  const rows = [
    {asClass:'AS100', v:[7,7,7]}, {asClass:'AS100', v:[8]}, {asClass:'AS200', v:[3]},
  ];
  const r = compareSegments(rows, x=>x.asClass, x=>x.v, { minSize: 3 });
  eq(r.segments.map(s=>s.label), ['AS100']);
  eq(r.suppressed, 1);
});

console.log('\n--- sentiment ---');
t('positive language scores positive', () => { ok(scoreSentiment('The instruction was excellent and clear').score > 0); });
t('negative language scores negative', () => { ok(scoreSentiment('Disorganised and a waste of time').score < 0); });
t('negation flips the sign', () => {
  ok(scoreSentiment('not helpful').score < 0, 'not helpful should be negative');
  ok(scoreSentiment('helpful').score > 0, 'helpful should be positive');
});
t('intensifiers increase magnitude', () => {
  const plain = scoreSentiment('good').score;
  const strong = scoreSentiment('extremely good').score;
  ok(strong > plain, `extremely good (${strong}) should exceed good (${plain})`);
});
t('a clause break stops a negation reaching across it', () => {
  // "not X but Y" — Y must stay positive
  const s = scoreSentiment('not clear but excellent');
  ok(s.hits.find(h=>h.word==='excellent' && !h.negated), 'excellent should not be negated');
});
t('text with no lexicon words reports no sentiment', () => {
  eq(scoreSentiment('the session ran from noon').hits.length, 0);
});
t('summary buckets responses', () => {
  const s = summariseSentiment(['excellent and helpful','terrible and useless','the room was cold']);
  eq(s.buckets.positive, 1); eq(s.buckets.negative, 1); eq(s.unreadable, 1);
});

console.log('\n--- word frequency ---');
t('stopwords and filler are dropped', () => {
  const w = wordFrequencies(['the class was about the course instructor']);
  eq(w.length, 0, 'everything here is a stopword');
});
t('counts responses not repetitions', () => {
  const w = wordFrequencies(['drill drill drill drill','drill'], { minLength: 3 });
  eq(w[0].responses, 2); eq(w[0].count, 5);
});
t('inflections collapse to one entry', () => {
  const w = wordFrequencies(['organised sessions','organising the event','organise it'], { minLength: 3 });
  const stems = new Set(w.map(x=>x.stem));
  ok(stems.size < 3 || w.some(x=>x.responses>1), 'organis* should merge');
});

console.log('\n--- safety screen ---');
t('hazing language is flagged as critical', () => {
  const r = screenText('I was hazed during initiation');
  ok(r.length > 0); eq(r[0].categoryId, 'hazing'); eq(r[0].severity, 'critical');
});
t('self-harm language is flagged', () => {
  const r = screenText('I feel hopeless and want to die');
  ok(r.some(c=>c.categoryId==='selfharm'), 'should flag self-harm');
});
t('discrimination phrasing is flagged', () => {
  const r = screenText('He treated me differently because of my accent');
  ok(r.some(c=>c.categoryId==='discrimination'), 'should flag discrimination');
});
t('benign text is not flagged', () => {
  eq(screenText('The drill practice was well organised and I learned a lot').length, 0);
});
t('a match carries readable context', () => {
  const r = screenText('Everything was fine until the senior cadet hazed the new flight members badly');
  ok(r[0].matches[0].excerpt.includes('hazed'), 'excerpt should contain the match');
});
t('repeats collapse to one entry per category', () => {
  const r = screenText('hazing hazing hazing');
  eq(r.length, 1); eq(r[0].matches.length, 1);
});

console.log(fails ? `\n${fails} failure(s)` : '\nAll unit checks passed.');
process.exit(fails ? 1 : 0);
