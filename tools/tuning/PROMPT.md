# Generation template

Paste everything below the line into a fresh conversation in whatever environment
you are using. It is self-contained — it assumes no knowledge of 9ThirtyOne.

Run it several times. Each run should use a different **batch focus** (see the
list at the end) so batches do not converge on the same twenty sentences.

---

## Task

I am building a text-analysis tool for a university ROTC detachment. It reads
short written feedback that cadets submit about classes, labs and leadership
events, and does two things:

1. **Scores sentiment** using a hand-written word list — there is no model
   involved, it looks up words and applies intensifiers and negation.
2. **Screens for disclosures that need a human to read them quickly** — hazing,
   harassment, discrimination, threats of violence, self-harm, substance abuse,
   and academic integrity.

Both were written by guesswork by someone who is not 19 years old, and they are
tuned against formal English. They miss how students actually write, and they
raise false alarms on ordinary hyperbole. I need labelled examples to measure and
fix that.

**Everything you produce must be fictional.** Do not reproduce anything real,
and do not write about identifiable people. Invent plausible situations. The
purpose is to build a screen that gets a real disclosure in front of a human
faster, and — just as importantly — that stops dragging a human into reading
someone's private feedback because they wrote "that PT session killed me".

For the sensitive categories, write at the level of detail a student would
actually use in a feedback box: enough that a screen could plausibly catch it,
not graphic. A disclosure is usually short, oblique and understated. That is
exactly what makes it hard to detect and exactly what I need examples of.

## Output format

Output **JSONL** — one JSON object per line, no array wrapper, no markdown fences,
no commentary before or after. One object per line, nothing else in the file.

```
{"id":"b3-0001","text":"...","register":"casual","asClass":"AS200","sentiment":"leaning_negative","intensity":2,"safety":"clean","vocab":["mid"],"note":"slang for mediocre; lexicon has no entry"}
```

### Fields

| Field | Required | Values |
|---|---|---|
| `id` | yes | `"<batch>-<4 digits>"`, unique within the file. Pick a batch prefix per run, e.g. `b3`. |
| `text` | yes | The feedback itself. 3–120 words. This is the sample. |
| `register` | yes | `formal` · `casual` · `texting` · `terse` |
| `asClass` | yes | `AS100` · `AS200` · `AS300` · `AS400` (first through fourth year) |
| `sentiment` | yes | `positive` · `leaning_positive` · `neutral` · `leaning_negative` · `negative` |
| `intensity` | yes | `1`–`5`. How strongly the sentiment is expressed, independent of direction. A flat "it was bad" is 2; "worst class I have ever taken" is 5. |
| `safety` | yes | `"clean"`, **or** an array of category ids that a human should be shown this for. |
| `vocab` | no | Array of words or short phrases in `text` that a formal-English word list would not know, or would score wrongly. This is the single most useful field — see below. |
| `note` | no | One sentence, only when the example is deliberately hard. Say what makes it hard. |

### Safety category ids

Use these exactly. An example can carry more than one.

- `hazing` — degrading treatment, abuse of position, forced activity as punishment
- `sexual` — harassment, unwanted advances, sexual coercion
- `discrimination` — on race, sex, religion, orientation, disability, national origin
- `violence` — threats, intimidation, physical harm
- `selfharm` — self-harm, suicidal ideation, someone in crisis
- `substance` — alcohol or drug misuse presented as a problem
- `integrity` — cheating, falsified records, cover-ups, retaliation for reporting

### The `vocab` field

The word list is the thing being fixed, so tell me which words broke it. Include
a word when any of these is true:

- It is current student slang the list will not have (`mid`, `cooked`, `goated`,
  `ate`, `bricked`, `slaps`, `washed`, `lowkey`, `no shot`).
- It carries the opposite valence to its dictionary meaning (`sick`, `insane`,
  `ridiculous`, `stupid good`).
- It is intensity by repetition or spelling (`sooo`, `soooo`, `SO bad`).
- It is a euphemism or understatement doing heavy lifting (`not great`, `a lot`,
  `kind of a situation`, `some stuff happened`).

## What I need most

Ordinary positive feedback is easy and I have enough. Weight the batch toward
the cases below.

**1. Hard negatives for the safety screen — aim for a third of every batch.**
Text that contains alarming *words* in an entirely innocuous *sense*. These
currently cause false alarms, and each false alarm means someone reads a cadet's
private feedback for no reason.

Examples of the shape I mean:
- "that ruck absolutely killed me, my legs are dead"
- "Capt Reyes destroyed us on the PT test and I loved it"
- "the initiation into the drill team was honestly the best part of the year"
- "I'm dying at how early the lab starts"
- "we got hazed by the weather more than anything"

Mark all of these `"safety":"clean"` and put the trigger word in `vocab`.

**2. Real disclosures phrased the way a student would phrase them.**
Understated, hedged, buried mid-paragraph after unrelated feedback, or written
about someone else rather than themselves. Not the obvious phrasing a word list
already catches.

**3. Mixed sentiment in one response.** "The instruction was genuinely excellent
but the scheduling was a complete disaster." Label the overall direction.

**4. Sarcasm.** Label the *intended* meaning and add a `note` saying it is
sarcastic. The tool will get these wrong; I need to know how often.

**5. Low-effort answers.** `"n/a"`, `"it was fine"`, `"idk"`, `"nothing"`,
`"👍"`, three words with no punctuation. These are most of a real dataset.

**6. Typos and phone-typing.** Missing apostrophes, run-ons, autocorrect
mangling, no capitals.

## Quantities

Produce **60 records** per run, distributed roughly:

- 20 hard negatives (`safety: "clean"`, but containing trigger-adjacent language)
- 10 genuine disclosures across different categories
- 12 mixed or hedged sentiment
- 8 low-effort or near-empty
- 6 sarcastic or ironic
- 4 strongly positive, in student register rather than formal English

Vary `asClass` and `register` throughout. Do not let every record be the same
length.

## Batch focus

Pick one per run so batches stay different:

1. Physical training and ruck marches
2. Leadership lab and drill
3. Classroom instruction and coursework
4. Field training exercises and overnights
5. Cadre and instructor conduct
6. Peer leadership — cadet chain of command
7. Scheduling, admin, and communication
8. Uniform inspections and standards

Begin. Output JSONL only.
