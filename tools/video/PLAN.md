# The walkthrough video

A ~6:30 video in two halves. It **argues** before it demonstrates: four still
cards make the case for why the app exists, then the recorded app shows what it
does. The viewer is somebody deciding whether to care, and then somebody who
will go and do these things.

The app footage is captured from the running app with seeded data, the same way
the screenshots and both PDFs are. Nothing is mocked up and nothing is faked in
post. The opening cards are rendered HTML, because there is no screen in the app
that shows "AFROTC uses a centralized detachment model".

**The argument the cards make is `docs/WHY.md`.** If one changes, the other is
wrong.

## Resuming this work in a later session

Read this file first; it is the spec. Then:

```bash
brew install ffmpeg                       # already done once, checks fast
python3 serve.py --port 8123 --no-open &  # the recorder needs a server
node tools/video/record.mjs               # writes tools/video/out/raw/*.webm
node tools/video/build.mjs                # titles, voiceover, final mp4
```

Output lands in `tools/video/out/`, which is **gitignored** — it is a few
hundred megabytes of intermediate files. The script, the shot list and the
build scripts are committed; the video is not. Regenerate rather than hunting
for a copy.

**State that lives outside this repo:** none. The voice choice below is the
only open decision, and it is recorded here once made.

## Decisions taken

| | |
|---|---|
| Audience | A detachment being onboarded — procedural, not a pitch |
| Narration | Synthesised, and **final** rather than a placeholder to be re-recorded |
| Voice | **Allison (Enhanced)** (en_US) |
| On-screen detachment | Fictional "AFROTC Detachment 025", invented cadet names |
| Assembly | ffmpeg, installed |
| Resolution | 1920×1080, except the cadet phone shots |
| Opening chapter | Rendered HTML cards, not app footage — `cards.mjs` |

### The voice

Was Daniel (en_GB), the best of the *legacy* voices and still audibly a 2010
satnav. **Allison (Enhanced)** is installed now and is used instead — en_US,
which suits an AFROTC audience anyway.

`say -v '?'` lists what is available; Allison and Evan are the Enhanced voices
here. The **Premium** voices are a further step up and download by hand:

> System Settings → Accessibility → Spoken Content → System Voice → Manage
> Voices → English → pick a **(Premium)** voice → download

`VOICE` in `build.mjs` is then a one-line change and a rebuild.

**Allison speaks faster than Daniel did**, which matters more than it sounds: it
opened about 78 seconds of footage playing under silence the first time the
chapter was assembled. The fix was to put narration back rather than cut
footage — see the note on section length below, where adding words was free.

## Progress

- [x] Plan, shot list, narration
- [x] Recorder — visible cursor, deliberate pacing, seeded detachment
- [x] All eight clips recorded and reviewed
- [x] `build.mjs` — title cards, voiceover, length-matched assembly
- [x] First cut: 5:09, procedural only
- [x] Re-recorded against the post-lexicon wording (cadet, spaces, Feedback requests)
- [x] Why/how chapter, Allison (Enhanced)
- [x] **Current cut: 6:42**

The narration lives in `script.mjs`, which is the source of truth. This file
describes the video; it does not repeat the words.

### Worth doing before this is final

- A **Premium** voice would be a further step up on Allison. One line, one
  rebuild — see above.
- The four opening cards are dense. If a viewer says the chapter drags, cut a
  consequence from *What that costs* rather than speeding the voice up.

## Structure

Twelve sections, ~400 seconds: four **cards** that argue, then eight **clips**
that demonstrate. Each clip is recorded separately so one can be re-shot without
redoing the rest.

### How long a section is, which is the thing to understand before editing

A **card** section lasts exactly as long as its narration.

A **clip** section lasts `max(footage, narration)` — `build.mjs` holds the last
frame when the words outrun the picture, and lets the picture play on under
silence when they do not. Two consequences, both learned here:

- Trimming a line only shortens the video where **narration** is the larger
  number. Where footage dominates, the holds in `record.mjs` are the lever.
- Where footage dominates, **adding narration is free** up to the length of the
  footage. That is how the switch to a faster voice was absorbed: it left ~78
  seconds of silent footage, and the fix was more words, not less film.

`build.mjs` prints both numbers for every section. Read that output before
changing anything.

| # | Section | Kind | Shows |
|---|---|---|---|
| 0 | The detachment problem | card | Crosstown diagram, the causal chain to a Det Google Account |
| 0b | What that costs | card | The four consequences, LLAB last |
| 0c | Cadets instruct, uncertified | card | The second gap |
| 0d | How it works | card | Ownership diagram, `drive.file`, the submission server |
| 1 | Setting it up | 28s | The wizard, storage choice, the folder it creates |
| 2 | Cadet | 45s | Join link → sign in → assigned list → filling a form (phone) |
| 3 | Instructor | 45s | Create feedback → issue → responses & analysis → safety screen |
| 4 | Cadre | 27s | Cadre Panel, the restricted badges, what an instructor sees instead |
| 5 | Commander | 32s | Own space, By instructor, a withheld person |
| 6 | Database admin | 37s | Roster and roles, join link and QR, activity log |
| 7 | Close | 18s | Where the data lives, licence |

## Narration

**In `script.mjs`, not here.** This file used to carry a copy, and by the time
the video was re-cut the copy said something the video did not — seven sections,
an older voice, and lines that had already been rewritten. Two places for one
set of words is a guarantee they drift, so there is now one.

`build.mjs` speaks what is in `script.mjs` and times each section against it.
Read it there.

## Shot list

The four opening cards record nothing — they are drawn by `cards.mjs`. What
follows is the app footage, in order. `record.mjs` implements this.

**1 Setting it up** — the wizard · the storage step showing the three options ·
the created folder tree · the panels it lands on. It no longer tours the role
cards at the end: the card chapter now closes on "here is what each person
sees", and touring them said the same thing twice.

**2 Cadet** — the join screen from a link · sign in · the assigned list ·
switch to a phone viewport · open a form · the nine-point word scale · submit ·
the list showing it as done.

**3 Instructor** — Instructor Panel · Create Feedback · fill a form name, pick
the class, add questions · issue it · Responses & analysis · the distribution
chart · a split question called out · the written answers tab · the safety
screen with a flagged answer. The completion table at the end was dropped when
the narration stopped covering it.

**4 Cadre** — Cadre Panel with the restricted notice · the badged list ·
the switch button to the Instructor Panel · the same route as an instructor,
landing on the sign-in gate.

**5 Commander** — Cadre Panel showing the commander's own space badged · By
instructor · a person with enough responses · a person under the threshold
showing the withholding notice.

**6 Database admin** — the roster · adding an account and choosing roles · the
invite screen · the QR code · the activity log. The anonymised backup export
came out with its line — a backup feature is not what a first-contact viewer
needs, and unnarrated footage is worse than no footage.

**7 Close** — the Drive folder tree · Home.

## Known constraints

- **The Drive sections are recorded against the local backend**, because Google
  will not issue a token to an automated browser. What is shown is the real app
  with real behaviour; the storage underneath is the local one. Nothing on
  screen claims otherwise.
- **Sign-in is done the way the callback does it**, not through Google's popup,
  for the same reason. The sign-in *screen* is real and is shown.
- The cadet section switches to a phone viewport mid-section. That is
  deliberate — it is the device a cadet actually uses. It is also why 2a and 2b
  are two clips rather than one: a Playwright recording context has a single
  viewport size, so desktop and phone cannot share a recording.
- **The cards are rendered at build time, not recorded.** They cost nothing to
  change and need no server — editing `cards.mjs` and re-running `build.mjs` is
  enough. Only the app footage needs `record.mjs` and a running server.
