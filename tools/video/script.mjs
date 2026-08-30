/**
 * The narration, and the section order.
 *
 * **This is the source of truth.** `PLAN.md` describes the video for a human to
 * read; this is what actually gets spoken and what `build.mjs` times against.
 * Keeping the words in two places guarantees they drift, so the plan points
 * here rather than repeating them.
 *
 * A section is either **a card** or **a clip**:
 *
 *   - `card: '<key>'`  — a still from `cards.mjs`, held for the spoken length.
 *     Used for the opening chapter, which argues rather than demonstrates.
 *   - `clip: '<name>'` — footage recorded by `record.mjs` into `out/raw/`.
 *
 * For a clip, **the section lasts `max(footage, narration)`** — `build.mjs`
 * holds the last frame when the words outrun the picture and lets the picture
 * play out under silence when they do not. So shortening a line only shortens
 * the video where narration is the longer of the two; where footage dominates,
 * the holds in `record.mjs` are the lever. `build.mjs` prints both numbers.
 *
 * The argument the first four sections make lives in `docs/WHY.md`. If one
 * changes, the other is wrong.
 */

export const SECTIONS = [
  /* ---------------------------------------------------------------- *
   * why — the case, before any of the app is shown
   * ---------------------------------------------------------------- */
  {
    id: '0-problem',
    title: '9ThirtyOne',
    subtitle: 'Feedback that stays in your detachment',
    card: 'problem',
    narration: `
      Before the app, the problem it exists for. AFROTC runs a centralized
      detachment model: one host facility serving cadets from several Crosstown
      universities. That is why none of the ordinary tooling fits.
      A detachment cannot run on any one university's system, because it has
      cadets at schools that system has never heard of. So it stands up a
      detachment Google account. That solves the mail and costs everything else
      — a university system comes with a course platform, a survey tool,
      somewhere evaluations live. A Google account comes with none of it.`,
  },
  {
    id: '0b-costs',
    title: null,
    subtitle: null,
    card: 'costs',
    narration: `
      Four things follow, and they compound. Nothing is standardized across
      detachments, because nothing has a common shape. Aerospace Studies runs
      through the host university's system, with varying degrees of return.
      Leadership Laboratory has no capture at all — the part of the program
      where cadets lead cadets.
      And upperclassmen improvise. A cadet builds something in a consumer form
      tool to get feedback on a lab. It works, and it has no oversight, no
      archive, and nothing left after that cadet graduates.`,
  },
  {
    id: '0c-instructors',
    title: null,
    subtitle: null,
    card: 'instructors',
    narration: `
      There is a second problem. AFROTC requires upperclassmen to instruct
      lowerclassmen, and provides no certification process for doing it.
      A cadet gets an instructor's responsibility and none of the apparatus: no
      baseline, no structured feedback, nothing showing they improved. Cadre are
      accountable, and working without instruments.
      This is where feedback stops being administrative. A cadet instructor who
      can see how a block landed, and see it again next term measured the same
      way, is being developed. One who cannot is being assigned.`,
  },
  {
    id: '0d-how',
    title: null,
    subtitle: null,
    card: 'how',
    narration: `
      So, how it works. 9ThirtyOne is a web page. Nothing to install, no server
      to maintain, no account with anyone. Everything it stores is ordinary
      files in one Google Drive folder your detachment already owns.
      It asks Google for one narrow permission — the files it created itself —
      so the rest of that account was never granted, and could not be reached
      even if the app were compromised.
      And cadets get no Drive access at all. A script inside your own Google
      account files their answers, which is what stops one cadet reading
      another's by opening Drive.
      Here is what each person sees.`,
  },

  /* ---------------------------------------------------------------- *
   * how it looks — the app itself
   * ---------------------------------------------------------------- */
  {
    id: '1-overview',
    title: 'Setting it up',
    subtitle: 'Once, in about forty-five minutes',
    clip: '1-overview',
    narration: `
      Installation is a wizard. It asks where the records should live — a Drive
      folder for a real detachment, or this device alone if you just want to try
      it. It creates the folder itself, so there is no link to find and paste.
      Then it shows you the structure it made. Forms, requests, responses,
      receipts, the roster, the log. Plain files you can open in Drive, so
      nothing about where your data sits is a mystery afterwards.`,
  },
  {
    id: '2a-student-desktop',
    title: 'The cadet',
    subtitle: 'A link, a sign-in, and the forms assigned to them',
    clip: '2a-student-desktop',
    narration: `
      A cadet never sets anything up. They open a link, or scan a code on a
      projector, and that is the whole installation. No client ID, no folder, no
      wizard — the link carries all of it.
      They sign in with the Google account your detachment already mails them
      at. Then they see only what is assigned to them, filtered by class, term
      and due date.`,
  },
  {
    id: '2b-student-phone',
    title: null,
    subtitle: null,
    clip: '2b-student-phone',
    phone: true,
    narration: `
      On the device they will actually use, ratings are words rather than
      numbers, so nobody is averaging in their head while they answer.
      Each form is submitted once. The app records that a cadet took part
      separately from what they said, so completion can be chased without
      anybody's answers being attached to their name.
      It also works with no signal. Answers written in the field are held on the
      device and sent when the connection comes back, so a form does not have to
      wait for a bar of reception.`,
  },
  {
    id: '3-instructor',
    title: 'The instructor',
    subtitle: 'Build it, issue it, and read what comes back',
    clip: '3-instructor',
    narration: `
      An instructor builds a form, chooses who receives it, and issues it.
      Question sets are saved and reused, which is what keeps one term
      comparable with the next.
      The results come back analysed. Not just an average. The app looks at the
      shape of the responses, so when a class is genuinely split it says so
      instead of reporting a middling score that describes nobody.
      Written answers are screened for language that needs a person to see it
      quickly — hazing, harassment, a cadet in trouble — and flagged for review.
      It finds words, not meaning. It cannot read context or sarcasm, so it is a
      prompt to go and read something, never a verdict, and a clear screen is
      not proof that nothing was reported.`,
  },
  {
    id: '4-cadre',
    title: 'Cadre',
    subtitle: 'The same screen, pointed at a locked folder',
    clip: '4-cadre',
    narration: `
      Cadre get the same screen again, pointed at a separate space.
      Feedback filed here is visible to cadre and the commander and nobody else.
      That is not a hidden tab, or a setting on a record. It is a different
      folder, and your detachment's own submission server decides who may open
      it. An instructor does not get a filtered list — the folder is never
      opened for them, and they cannot reach it through Drive either. This is
      what they get at the same address.`,
  },
  {
    id: '5-commander',
    title: 'The commander',
    subtitle: 'Every space, and the point where the app refuses to answer',
    clip: '5-commander',
    narration: `
      The commander sees both spaces, plus one only they can read. In the view
      that groups feedback by the person it reflects on, an instructor sees their
      own results, cadre see the instructors they oversee, and the commander sees
      everyone.
      There are at most two commanders at a time, so a change of command
      overlaps rather than cutting over.
      And this is where the app refuses to answer. Below three responses,
      nothing is shown. No average, no distribution, no written answers. With
      two responses about somebody, showing anything at all would identify who
      wrote them. The count stays visible, so you know feedback exists. The
      content does not.`,
  },
  {
    id: '6-admin',
    title: 'The database administrator',
    subtitle: 'The roster, the invitations, and the log',
    clip: '6-admin',
    narration: `
      The roster is a list of Google accounts and what each is allowed to do.
      There are no passwords in this app at all — access is decided by which
      addresses are on the roster, and managing that roster is a separate job
      from reading feedback, so an administrator is not automatically given a
      panel.
      Adding somebody takes an email address. Getting them set up takes a link,
      or a code you can put on a screen in front of a room.
      And anything destructive is written down. Who did it, when, and why. That
      log cannot be edited from inside the app, including by the person it
      names.`,
  },
  {
    id: '7-close',
    title: null,
    subtitle: null,
    clip: '7-close',
    narration: `
      That is the whole application. It installs into a Google account your
      detachment already has, it costs nothing to run, and the feedback never
      leaves your Drive.
      The setup guide walks through the installation end to end, with a
      screenshot of every step. About forty-five minutes, once.`,
  },
];

/** Collapses the indented template strings into one spoken line. */
export const spoken = (section) => section.narration.trim().replace(/\s+/g, ' ');
