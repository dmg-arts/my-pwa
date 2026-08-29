/**
 * The narration, and the section order.
 *
 * **This is the source of truth.** `PLAN.md` describes the video for a human to
 * read; this is what actually gets spoken and what `build.mjs` times the footage
 * against. Keeping the words in two places guarantees they drift, so the plan
 * points here rather than repeating them.
 *
 * Each section names the clip it narrates. `build.mjs` stretches or trims the
 * footage to fit the spoken line rather than the reverse, so editing a line here
 * changes the length of that section and nothing else.
 */

export const SECTIONS = [
  {
    id: '1-overview',
    title: '9ThirtyOne',
    subtitle: 'Feedback that stays in your detachment',
    clip: '1-overview',
    narration: `
      This is 9ThirtyOne. It runs the feedback cycle for an AFROTC detachment.
      Cadets answer a short form, and the people who teach them get the results
      analysed rather than stacked on a desk.
      Everything it stores lives in one Google Drive folder your detachment owns.
      There is no vendor database, no server in the middle, and no account with
      anyone. If you stopped using this tomorrow, every response would still be
      sitting in your Drive, where you could read it.
      Here is what each person sees.`,
  },
  {
    id: '2a-student-desktop',
    title: 'The cadet',
    subtitle: 'A link, a sign-in, and the forms assigned to them',
    clip: '2a-student-desktop',
    narration: `
      A cadet never sets anything up. They open a link, or scan a code on a
      projector, and that is the whole installation.
      They sign in with the Google account your detachment already mails them at.
      Then they see only what has been assigned to them, filtered by class, term
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
      Each form can be submitted once. The app records that a cadet took part
      separately from what they said, so completion can be chased without
      anybody's answers being attached to their name.
      And it works with no signal. Answers written in the field are held on the
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
      Question sets can be saved and reused, which is what keeps one term
      comparable with the next.
      The results come back analysed. Not just an average. The app looks at the
      shape of the responses, so when a class is genuinely split it says so,
      instead of reporting a middling score that describes nobody.
      Written answers are read too. Every one is screened for language that needs
      a person to see it quickly, and flagged for review. It finds words, not
      meaning, so it is a prompt to go and read something. Never a verdict.
      Alongside the results is the question every instructor asks first: who has
      not answered yet. The app tracks that without ever attaching a name to an
      answer.`,
  },
  {
    id: '4-cadre',
    title: 'Cadre',
    subtitle: 'The same screen, pointed at a locked folder',
    clip: '4-cadre',
    narration: `
      Cadre get the same screen again, pointed at a separate space.
      Feedback filed here is visible to cadre and the commander, and to nobody
      else. That is not a hidden tab, or a setting on a record. It is a different
      folder, and your detachment's own server decides who may open it.
      An instructor does not see a filtered list. The folder is never opened for
      them, and they cannot reach it through Drive either. This is what they get
      at the same address.`,
  },
  {
    id: '5-commander',
    title: 'The commander',
    subtitle: 'Every space, and the point where the app refuses to answer',
    clip: '5-commander',
    narration: `
      The commander sees both spaces, plus one that only they can read.
      They also get a view of feedback grouped by the person it reflects on.
      Instructors, cadre, anybody feedback can be about.
      And this is where the app refuses to answer. Below three responses, nothing
      is shown. No average, no distribution, no written answers. With two
      responses about somebody, showing anything at all would identify who wrote
      them. The count stays visible, so you know feedback exists. The content
      does not.`,
  },
  {
    id: '6-admin',
    title: 'The database administrator',
    subtitle: 'The roster, the invitations, and the log',
    clip: '6-admin',
    narration: `
      The roster is a list of Google accounts and what each one is allowed to do.
      There are no passwords in this app at all. Access is decided by which
      addresses are on the roster.
      Adding somebody takes an email address. Getting them set up takes a link,
      or a code you can put on a screen in front of a room.
      And anything destructive is written down. Who did it, when, and why. That
      log cannot be edited from inside the app.
      There is also an export built for backups, with the roster and every name
      stripped out of it, so the copy your unit keeps off-site is not the copy
      that leaks.`,
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
      The setup guide walks through the installation end to end, with screenshots
      of every step. It takes about forty-five minutes, once, and after that the
      only thing a detachment does is use it.`,
  },
];

/** Collapses the indented template strings into one spoken line. */
export const spoken = (section) => section.narration.trim().replace(/\s+/g, ' ');
