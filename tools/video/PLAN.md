# The walkthrough video

A ~5 minute screen recording of the real app, for a **detachment being
onboarded** — so it is procedural. The viewer is going to do these things
afterwards, not decide whether to buy them.

Everything is captured from the running app with seeded data, the same way the
screenshots and both PDFs are. Nothing is mocked up, and nothing is faked in
post.

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
| Voice | *pending — samples generated in `/tmp/voice-samples/`* |
| On-screen detachment | Fictional "AFROTC Detachment 025", invented cadet names |
| Assembly | ffmpeg, installed |
| Resolution | 1920×1080, except the student phone shots |

### The voice, and why it is worth a moment

macOS only has its **legacy** voices installed here — Samantha, Daniel, Karen,
Albert, plus novelty ones. Samantha is the best of them and still sounds like a
2010 satnav. The modern *Enhanced* and *Premium* voices are free but have to be
downloaded by hand:

> System Settings → Accessibility → Spoken Content → System Voice → Manage
> Voices → English → pick a **(Premium)** or **(Enhanced)** voice → download

Ava (Premium), Zoe (Premium), Tom (Enhanced) and Evan (Enhanced) are all a large
step up and would not embarrass the video. Once one is installed it appears in
`say -v '?'` and `VOICE` in `build.mjs` can point at it.

## Progress

- [x] Plan, narration script, shot list
- [x] Recorder harness — visible cursor, deliberate pacing, seeded detachment
- [x] Section 1 (overview) recorded and reviewed
- [ ] Sections 2–7
- [ ] `build.mjs` — title cards, voiceover, assembly
- [ ] Final review end to end

**Blocked on nothing.** The voice is the only open decision and it affects the
last step only; everything else can be built first.

## Structure

Seven sections, ~300 seconds. Each is recorded separately so one can be re-shot
without redoing the rest.

| # | Section | Target | Recorded as |
|---|---|---|---|
| 1 | Overview | 45s | Home, storage picture, the folder in Drive |
| 2 | Student | 45s | Join link → sign in → assigned list → filling a form (phone) |
| 3 | Instructor | 60s | Create feedback → issue → responses & analysis → safety screen |
| 4 | Cadre | 40s | Cadre Panel, the restricted badges, what an instructor sees instead |
| 5 | Commander | 45s | Own area, By instructor, a withheld person |
| 6 | Database admin | 40s | Roster and roles, join link and QR, activity log |
| 7 | Close | 25s | Where the data lives, licence |

## Narration

Timings are targets, not constraints — the recorder holds each shot for as long
as its line takes, so the video follows the script rather than the other way
round.

### 1 — Overview (45s)

> This is 9ThirtyOne. It runs the feedback cycle for an AFROTC detachment:
> cadets answer a short form, and the people who teach them get the results
> analysed rather than stacked.
>
> Everything it stores lives in one Google Drive folder your detachment owns.
> There is no vendor database, no server in the middle, and no account with
> anyone. If you stopped using this tomorrow, every response would still be
> sitting in your Drive where you could read it.
>
> Here is what each person sees.

### 2 — Student (45s)

> A cadet never sets anything up. They get a link, or scan a code on a
> projector, and that is the whole installation.
>
> They sign in with the Google account your detachment already mails them at,
> and they see only what has been assigned to them — filtered by class, term and
> due date.
>
> Ratings are words rather than numbers, so nobody is averaging in their head
> while they answer. And each form can be submitted once. The app records that
> they took part separately from what they said, so completion can be chased
> without anybody's answers being attached to their name.

### 3 — Instructor (60s)

> An instructor builds a form, chooses who receives it, and issues it. Question
> sets can be saved and reused, which is what keeps one term comparable with the
> next.
>
> The results come back analysed. Not just an average — the app looks at the
> shape of the responses, so when a class is genuinely split it says so instead
> of reporting a middling score that describes nobody.
>
> Written answers are read too. Every one is screened for language that needs a
> person to see it quickly — hazing, harassment, a cadet in trouble — and
> flagged for review. It finds words, not meaning, so it is a prompt to go and
> read something, never a verdict.

### 4 — Cadre (40s)

> Cadre get the same screen again, pointed at a separate area.
>
> Feedback filed here is visible to cadre and the commander, and to nobody else.
> That is not a hidden tab or a setting on a record — it is a different folder,
> and your detachment's own server is what decides who may open it. An
> instructor does not see a filtered list. The folder is never opened for them,
> and they cannot reach it through Drive either.
>
> Anything restricted is badged wherever it appears, so nobody has to remember
> which area they filed something into.

### 5 — Commander (45s)

> The commander sees both areas, plus one only they can read.
>
> They also get a view of feedback grouped by the person it reflects on —
> instructors, cadre, anybody feedback can be about.
>
> And this is where the app refuses to answer. Below three responses, nothing is
> shown: no average, no distribution, no written answers. With two responses
> about somebody, showing anything would identify who wrote them. The count is
> still there, so you know feedback exists. The content is not.

### 6 — Database admin (40s)

> The roster is a list of Google accounts and what each one is allowed to do.
> There are no passwords in this app at all — access is decided by which
> addresses are on the roster.
>
> Adding somebody takes an email address. Getting them set up takes a link, or a
> code you can put on a screen in front of a room.
>
> And anything destructive is written down: who did it, when, and why. That log
> cannot be edited from inside the app.

### 7 — Close (25s)

> That is the whole application. It installs into a Google account your
> detachment already has, it costs nothing, and the data never leaves your
> Drive.
>
> The setup guide walks through the installation end to end. It takes about
> forty-five minutes, once.

## Shot list

What each section records, in order. `record.mjs` implements this.

**1 Overview** — Home signed out · the storage step of the wizard showing the
three options · the created folder tree · back to Home.

**2 Student** — the join screen from a link · sign in · the assigned list ·
switch to a phone viewport · open a form · the nine-point word scale · submit ·
the list showing it as done.

**3 Instructor** — Instructor Panel · Create Feedback · fill a form name, pick
the class, add questions · issue it · Responses & analysis · the distribution
chart · a split question called out · the written answers tab · the safety
screen with a flagged answer.

**4 Cadre** — Cadre Panel with the restricted notice · the badged list ·
the switch button to the Instructor Panel · the same route as an instructor,
landing on the sign-in gate.

**5 Commander** — Cadre Panel showing the commander's own area badged · By
instructor · a person with enough responses · a person under the threshold
showing the withholding notice.

**6 Database admin** — the roster · adding an account and choosing roles · the
invite screen · the QR code · the activity log.

**7 Close** — the Drive folder tree · Home.

## Known constraints

- **The Drive sections are recorded against the local backend**, because Google
  will not issue a token to an automated browser. What is shown is the real app
  with real behaviour; the storage underneath is the local one. Nothing on
  screen claims otherwise.
- **Sign-in is done the way the callback does it**, not through Google's popup,
  for the same reason. The sign-in *screen* is real and is shown.
- The student section switches to a phone viewport mid-section. That is
  deliberate — it is the device a cadet actually uses.
