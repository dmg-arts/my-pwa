# Tuning the analysis

The sentiment word list and the safety phrase lists in
[`js/analysis/lexicon.js`](../../js/analysis/lexicon.js) were written by
guesswork, and they are tuned against formal English. Real feedback from
nineteen-year-olds is not formal English. This directory is how they get better
without a single cadet's words ever leaving a detachment.

## Why not real feedback

Because we are never going to ask for it. The app has an anonymised export, but
it exists so a detachment's off-site backup does not carry names — not as a
collection channel, and there is no collection channel anywhere in the app. The
privacy policy says so, and this is the mechanism that lets it stay true:
**tuning runs on synthetic writing, generated elsewhere, labelled, and measured
against the real code.**

## The loop

```
   PROMPT.md  ──►  a different environment  ──►  batch.jsonl
                                                     │
                                                     ▼
                                        node tools/tuning/ingest.mjs batch.jsonl
                                                     │
                                                     ▼
                            precision, recall, and words the lexicon is missing
                                                     │
                                                     ▼
                                    edit lexicon.js by hand, run again, compare
```

1. **Generate.** Paste [`PROMPT.md`](PROMPT.md) into whatever environment you are
   using. It is self-contained and assumes no knowledge of this project. Change
   the *batch focus* each run so batches do not converge.
2. **Save** the output as `batch-N.jsonl` — one JSON object per line.
3. **Measure.**
   ```bash
   node tools/tuning/ingest.mjs batch-3.jsonl
   node tools/tuning/ingest.mjs batches/*.jsonl     # or the whole corpus
   ```
4. **Read the candidates, decide, and edit `lexicon.js` yourself.** Nothing is
   applied automatically. Then run step 3 again and compare — that comparison is
   the entire point of the exercise.

Keep the batches. They are the regression suite for every future lexicon change.

## What the report tells you

**Safety screen — precision and recall.** Recall is how many real disclosures got
surfaced. Precision is how many of the flags were worth raising.

Watch **precision** hardest. Every false alarm is a person opening a cadet's
private feedback because somebody wrote that a ruck march killed them. A screen
that cries wolf gets ignored, and then it costs the exact thing it was built to
protect. This is why `PROMPT.md` asks for a third of every batch to be *hard
negatives* — innocuous text stuffed with alarming words.

**Sentiment — exact, within-one-step, and direction wrong.** The last one is what
matters: praise scored as a complaint, or a complaint scored as praise. A word
list will never handle sarcasm, so some of these are permanent. Knowing the rate
is still worth having.

**Vocabulary gaps** come from two places on purpose. The generator's own `vocab`
field is a guess about a list it never saw. The second pass is independent: words
appearing three or more times, leaning consistently positive or negative across
the corpus, with no entry in `SENTIMENT`. Suggested valences are a starting point
for your judgement, not an answer.

## Results so far

600 samples, ten batches, generated August 2026. Split **b1–b7 to tune on,
b8–b10 held back** — the holdout is the only number that means anything, because
patterns written while looking at the misses will always fit those misses.

| | Safety recall | Safety precision | Sentiment exact | Direction wrong |
|---|---|---|---|---|
| Before | 9.0% | 31.0% | 27.2% | 12.5% |
| After (tune set) | 75.7% | 100% | — | — |
| **After (holdout)** | **80.0%** | **100%** | — | — |
| After (all 600) | 77.0% | 100% | 28.8% | 12.5% |

The holdout scoring slightly *higher* than the tune set is the result worth
having: the patterns generalise rather than memorise.

### What actually moved the numbers

**Every false alarm came from four words**, all military or athletic idiom:
`smoked` (a hard PT session), `suicide` (sprints and pace), `initiation` (a
drill team night out), and one figurative `hazed`. Across 600 samples they
produced twenty false alarms and **not one true one**. `smoked` and `initiation`
were removed as standalone terms and re-added inside patterns that require
punishment framing; the others became exclusions.

**Recall was low because real disclosures do not use the vocabulary.** They are
hedged, understated, and buried after something unrelated — "the ruck marches
themselves are fine. One thing I probably should mention is…". The patterns that
found them key on *shape* rather than words: seniors making juniors do things,
"keeps finding reasons to", "the only \<x\> cadet in", a quoted threat, somebody
worried about a friend and repeating what they said.

### The trap in the vocabulary report

The report ranks words by the mean sentiment of the samples containing them.
**That is not the word's valence**, and treating it as one is how a lexicon gets
worse. `torture` scored +1.0 because it appears in "basically torture but worth
it"; `wrecked` scored +1.3 from "wrecked us and I loved every second". The
positive reading comes from *worth it* and *loved*, which are already scored.
Adding the hyperbole would double-count them and read "that session was torture"
as praise.

Only `goated` and `elite` were added — words whose own meaning is unambiguous.
Eight others the report ranked highly were rejected for the reason above, and
the rejection is written into `lexicon.js` so it does not get undone.

### What the numbers do not say

Sentiment barely moved, and will not: 12.5% of samples are read in the wrong
direction and most of those are **sarcasm**, which a word list cannot do.
"Nothing says leadership development like standing in a parking lot for an hour"
scores positive and always will. That is a known ceiling, not a tuning target.

## Honest limits

**Synthetic writing is a model's impression of how cadets write, not how
cadets write.** It will be too clean, too on-topic, too evenly distributed, and
its slang will lag or overshoot. Tuning against it makes the lexicon better at
handling a model's idea of cadet writing, which is correlated with the real thing
but is not the real thing.

That trade is deliberate and it is the right one. The alternative is asking a
detachment for its cadets' words, and we are not doing that.

Two things follow. Read the samples yourself rather than trusting the aggregate —
if a batch reads wrong to you, it is wrong, and a number will not tell you.
And treat every measurement here as directional: a jump from 40% to 70% recall on
synthetic text means the word list got broader, not that seven in ten real
disclosures will now be caught.

**The screen is a screen.** It finds words, never meaning. It cannot read
context, sarcasm, quotation, or a cadet describing something that happened to
someone else, and an empty result is not evidence that nothing was disclosed.
No amount of tuning changes that, and the app's own wording should never start
implying otherwise.

## Format

One JSON object per line. Full field reference is in [`PROMPT.md`](PROMPT.md).

```json
{"id":"b3-0004","text":"im dying at how early the lab starts lol","register":"texting",
 "asClass":"AS100","sentiment":"leaning_negative","intensity":2,"safety":"clean",
 "vocab":["dying"],"note":"idiom, not selfharm"}
```

`safety` is either the string `"clean"` or an array drawn from: `hazing`,
`sexual`, `discrimination`, `violence`, `selfharm`, `substance`, `integrity`.

The loader tolerates blank lines and stray markdown fences, reports bad records
by line number, and carries on with the rest — one malformed line should not
waste a generation run.
