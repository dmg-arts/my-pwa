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

## Honest limits

**Synthetic writing is a model's impression of how students write, not how
students write.** It will be too clean, too on-topic, too evenly distributed, and
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
