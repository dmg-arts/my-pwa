/**
 * Every screen, from every role's point of view.
 *
 *     python3 serve.py --port 8123 --no-open &
 *     node tools/docs/capture-perspectives.mjs docs/screens
 *
 * Different from `capture-screenshots.mjs`, which takes the handful of images
 * the guide and the deck embed. This takes the **whole app, six times over** —
 * signed out, then once as each of the five roles — so the access model can be
 * looked at rather than reasoned about.
 *
 * WHY THE REFUSALS ARE CAPTURED TOO
 *
 * A screenshot of the Cadre Panel proves cadre can open it. It says nothing
 * about whether an instructor can, and that is the half worth checking. So each
 * role also visits the screens it should *not* reach, and those shots are kept
 * alongside the rest under `refused/`. If one of them ever shows a panel instead
 * of a sign-in gate, that is a security regression somebody can see at a glance.
 *
 * `admin` is deliberately included in that: it implies no other role, so a
 * database administrator meets the same gate as anyone else at the Instructor
 * Panel. That looks like a bug until you know it is the design.
 *
 * The output folder is gitignored. These are for looking at, not for shipping —
 * a full set is a few dozen images and they go stale the moment a view changes.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/index.html';
const OUT = process.argv[2] || 'docs/screens';
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));

/** A Client ID makes the sign-in screens render Google's real button. */
const DEMO_CLIENT = '000000000000-topfeedbackdemo.apps.googleusercontent.com';

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const problems = [];
let count = 0;

/* ------------------------------------------------------------------ *
 * the detachment everyone is looking at
 * ------------------------------------------------------------------ */

const PEOPLE = {
  student:    { email: 'mia.alvarez@gmail.com',   name: 'Alvarez, Mia',    roles: ['student'],    asClass: 'AS200' },
  instructor: { email: 'ana.lindqvist@det025.edu', name: 'Lindqvist, Ana',  roles: ['instructor'], asClass: '' },
  cadre:      { email: 'sam.okafor@det025.edu',   name: 'Okafor, Sam',     roles: ['cadre'],      asClass: '' },
  commander:  { email: 'maria.reyes@det025.edu',  name: 'Reyes, Maria',    roles: ['commander'],  asClass: '' },
  admin:      { email: 'dee.novak@det025.edu',    name: 'Novak, Dee',      roles: ['admin'],      asClass: '' },
};

async function seed(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wizard');
  await page.fill('.wizard input[type=text]', 'AFROTC Detachment 025');
  await page.click('.wizard .btn--primary');
  await page.waitForSelector('.choice-list');
  await page.click('input[value="local"]', { force: true });
  await page.click('.wizard .btn--primary');
  await page.waitForSelector('.notice--warn');
  await page.click('.wizard .btn--primary');
  await page.waitForSelector('.tree');
  await page.click('.wizard .btn--lg');
  await page.waitForSelector('.role-grid', { timeout: 12000 });

  await page.evaluate(async (people) => {
    const a = await import('/js/auth.js');
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');

    // The first account to sign in claims an empty roster and is handed
    // [admin, instructor] by the bootstrap, whatever roles were asked for. That
    // silently made the "commander" an administrator, so her perspective was
    // really an admin's and her By-instructor screenshot was the fallback tab.
    // Everyone is created while she still holds admin, and her roles are
    // corrected last.
    const founder = await a.signInWithGoogle(
      { email: people.commander.email, name: people.commander.name, emailVerified: true }, null, 'tok');

    for (const key of ['instructor', 'cadre', 'admin']) {
      await a.createAccount(people[key]);
    }
    const cadets = [
      ['mia.alvarez@gmail.com', 'Alvarez, Mia'], ['dan.brooks@gmail.com', 'Brooks, Dan'],
      ['li.chen@gmail.com', 'Chen, Li'], ['sam.diaz@gmail.com', 'Diaz, Sam'],
      ['jo.ellis@gmail.com', 'Ellis, Jo'], ['kim.ford@gmail.com', 'Ford, Kim'],
      ['ade.grant@gmail.com', 'Grant, Ade'], ['rae.hall@gmail.com', 'Hall, Rae'],
    ];
    for (const [email, name] of cadets) {
      await a.createAccount({ email, name, roles: ['student'], asClass: 'AS200' });
    }

    const anchors = { ...c.SCALE_ANCHORS };
    const items = [
      { id: 'q1', type: 'scale', label: 'Instruction was clear and well paced', required: true, min: 1, max: 9, anchors },
      { id: 'q2', type: 'scale', label: 'The event was well organised', required: true, min: 1, max: 9, anchors },
      { id: 'q3', type: 'scale', label: 'I can apply what I learned', required: true, min: 1, max: 9, anchors },
      { id: 'q4', type: 'text', label: 'What should change next time?', required: false, rows: 4, wordLimit: 250 },
    ];

    // One request per space, so the panels differ visibly by role.
    for (const [id, title, space, fid, subject] of [
      ['req_demo', 'AS200 Leadership Lab — Drill Block 3', 'shared', 'FB-2026-0001', 'lindqvist.ana'],
      ['req_cadre', 'Cadre climate check — Fall term', 'cadre', 'FB-2026-0014', 'okafor.sam'],
      ['req_cmdr', 'Commander’s assessment — AS400 leadership', 'commander', 'FB-2026-0015', 'reyes.maria'],
    ]) {
      const form = await m.db.saveForm({
        id: `form_${id}`, name: title, space,
        sections: [{ title, items }],
      });
      await m.db.saveRequest({
        id, feedbackId: fid, title, eventName: title, formId: form.id, space, subject,
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        anonymous: true, status: 'open', assignedUsernames: [],
        instructions: 'Answer honestly — your name is never stored with your answers.',
      });
    }

    const rows = [
      [9, 8, 9, 'Absolutely excellent instruction. Very clear and the drill practice was engaging.'],
      [8, 7, 8, 'Great pace overall. The labs were thorough and well organised.'],
      [9, 9, 8, 'Outstanding block. Learned a lot about leadership under pressure.'],
      [3, 2, 3, 'Disorganised and confusing. Honestly a waste of time.'],
      [2, 3, 2, 'The briefings were unclear and frustrating. Nobody knew the plan.'],
      [8, 8, 7, 'Really enjoyed the drill sequence. More reps would help.'],
      [7, 7, 8, 'Solid instruction, though the room was cold and we started late.'],
    ];
    for (const [v1, v2, v3, text] of rows) {
      await m.db.saveResponse({
        requestId: 'req_demo', formId: 'form_req_demo', anonymous: true,
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        answers: { q1: v1, q2: v2, q3: v3, q4: text },
      });
    }
    // Enough in the cadre space that its analysis is not empty either.
    for (const [v1, v2, v3, text] of rows.slice(0, 4)) {
      await m.db.saveResponse({
        requestId: 'req_cadre', formId: 'form_req_cadre', anonymous: true, space: 'cadre',
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        answers: { q1: v1, q2: v2, q3: v3, q4: text },
      });
    }
    for (const [email] of cadets.slice(0, 5)) {
      await m.db.addReceipt('req_demo', (await a.findByEmail(email)).username);
    }

    // Done creating, so the founder can stop being an administrator.
    await a.updateAccount(founder.id, { roles: people.commander.roles });
    a.signOut();
  }, PEOPLE);
}

/* ------------------------------------------------------------------ *
 * what each perspective sees
 * ------------------------------------------------------------------ */

/** Screens everyone can reach, captured from all six points of view. */
const COMMON = [
  ['home', '/home'],
  ['settings', '/settings'],
];

/** Screens a role should reach, and screens it should be refused. */
const PERSPECTIVES = [
  {
    id: '0-signed-out', as: null,
    allowed: [
      ['join-link', '/join?c=000000000000-topfeedbackdemo&f=1A2b3C4d5E6f7G8h&n=AFROTC%20Detachment%20025&p=AKfycbxDEMO'],
      ['setup-wizard', '/setup?rerun=1'],
    ],
    refused: [['student', '/student'], ['instructor-panel', '/instructor'], ['cadre-panel', '/cadre'], ['admin', '/admin']],
  },
  {
    id: '1-student', as: 'student',
    allowed: [['my-feedback', '/student'], ['filling-a-form', '/student/fill/req_demo']],
    refused: [['instructor-panel', '/instructor'], ['cadre-panel', '/cadre'], ['admin', '/admin']],
  },
  {
    id: '2-instructor', as: 'instructor',
    allowed: [
      ['panel-feedback-forms', '/instructor?tab=requests'],
      ['panel-responses-analysis', '/instructor?tab=analysis'],
      ['panel-students', '/instructor?tab=students'],
      ['panel-database', '/instructor?tab=database'],
      ['create-feedback', '/instructor/create/new'],
    ],
    refused: [['cadre-panel', '/cadre'], ['by-instructor-tab', '/instructor?tab=people'], ['admin', '/admin']],
  },
  {
    id: '3-cadre', as: 'cadre',
    allowed: [
      ['instructor-panel', '/instructor?tab=requests'],
      ['cadre-panel', '/cadre?tab=requests'],
      ['cadre-responses-analysis', '/cadre?tab=analysis'],
      ['create-feedback-in-cadre-area', '/instructor/create/new?panel=cadre'],
    ],
    refused: [['by-instructor-tab', '/instructor?tab=people'], ['admin', '/admin']],
  },
  {
    id: '4-commander', as: 'commander',
    allowed: [
      ['instructor-panel', '/instructor?tab=requests'],
      ['cadre-panel-with-own-area', '/cadre?tab=requests'],
      ['by-instructor', '/instructor?tab=people'],
      ['cadre-responses-analysis', '/cadre?tab=analysis'],
    ],
    refused: [['admin', '/admin']],
  },
  {
    id: '5-admin', as: 'admin',
    allowed: [['roster', '/admin'], ['invite-and-qr', '/admin/invite']],
    // admin implies nothing on purpose: managing the roster and reading
    // feedback are different jobs that happen to be held together.
    refused: [['instructor-panel', '/instructor'], ['cadre-panel', '/cadre']],
  },
];

/* ------------------------------------------------------------------ *
 * capture
 * ------------------------------------------------------------------ */

const signInAs = (page, person) => page.evaluate(async (p) => {
  const a = await import('/js/auth.js');
  a.signOut();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  await a.signInWithGoogle({ ...p, emailVerified: true, exp }, null, 'tok');
}, person);

/**
 * Content that only ever appears once a panel has actually opened.
 *
 * Checked on every `refused/` capture, so the folder is a verification artifact
 * rather than a pile of pictures: if a role that should meet a sign-in gate is
 * shown one of these instead, the run fails rather than quietly saving a
 * screenshot of a security regression that nobody opens.
 */
const PANEL_CONTENT = /Feedback forms|Restricted area|Invite people|Question templates/;

/**
 * A refused *tab* is not a refused *panel*.
 *
 * Asking for `?tab=people` without the commander role lands on the panel's
 * default tab, which is correct and shows ordinary panel content. What must be
 * absent is the restricted view itself, so those entries name their own tell.
 */
const REFUSAL_TELL = {
  'by-instructor-tab': /grouped by the person it reflects on/,
};

async function shoot(page, dir, name, route, { mobile = false, mustRefuse = false } = {}) {
  await page.goto(`${BASE}#${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(route.includes('analysis') || route.includes('people') ? 2200 : 1100);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  const body = await page.textContent('#view').catch(() => '');
  if (/Something went wrong/i.test(body)) problems.push(`${dir}/${name}: crash screen`);
  if (mustRefuse && (REFUSAL_TELL[name] || PANEL_CONTENT).test(body)) {
    problems.push(`${dir}/${name}: OPENED something it should have refused`);
  }

  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  await page.screenshot({
    path: path.join(OUT, dir, `${name}${mobile ? '-phone' : ''}.png`),
    fullPage: true,
  });
  count++;
}

fs.rmSync(OUT, { recursive: true, force: true });

for (const view of PERSPECTIVES) {
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${view.id}: PAGEERROR ${e.message}`));

  await seed(page);
  // A Client ID so the sign-in gates render Google's real button rather than
  // "not configured", which is what a fielded detachment actually sees.
  await page.evaluate((id) => {
    const conn = JSON.parse(localStorage.getItem('nine31.connection.v1') || '{}');
    localStorage.setItem('nine31.connection.v1', JSON.stringify({ ...conn, clientId: id }));
  }, DEMO_CLIENT);
  await page.reload({ waitUntil: 'networkidle' });

  if (view.as) await signInAs(page, PEOPLE[view.as]);

  for (const [name, route] of COMMON) await shoot(page, view.id, name, route);
  for (const [name, route] of view.allowed) await shoot(page, view.id, name, route);
  for (const [name, route] of (view.refused || [])) {
    await shoot(page, `${view.id}/refused`, name, route, { mustRefuse: true });
  }

  // The cadet's real device is a phone, so hers is captured that way too.
  if (view.as === 'student') {
    await page.setViewportSize({ width: 390, height: 844 });
    await shoot(page, view.id, 'my-feedback', '/student', { mobile: true });
    await shoot(page, view.id, 'filling-a-form', '/student/fill/req_demo', { mobile: true });
  }

  console.log(`  ${view.id}`);
  await ctx.close();
}

await browser.close();

fs.writeFileSync(path.join(OUT, 'README.md'), `# Screens by perspective

${count} screenshots, generated by \`tools/docs/capture-perspectives.mjs\`.
Not committed — regenerate rather than trusting a copy.

Each folder is one point of view. \`refused/\` holds the screens that role should
**not** be able to open: those should show a sign-in gate, never a panel. If one
of them shows a panel, that is a security regression.

Note \`5-admin/refused/\` — a database administrator is refused the Instructor and
Cadre panels. That is deliberate. Managing the roster and reading feedback are
different jobs, so \`admin\` implies no other role.

| Folder | Signed in as |
|---|---|
| \`0-signed-out\` | nobody |
| \`1-student\` | Alvarez, Mia — student (also captured on a phone) |
| \`2-instructor\` | Lindqvist, Ana — instructor |
| \`3-cadre\` | Okafor, Sam — cadre |
| \`4-commander\` | Reyes, Maria — commander |
| \`5-admin\` | Novak, Dee — database admin |
`);

console.log(`\n${count} screenshots in ${OUT}/`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)].slice(0, 15)) console.log('  - ' + p);
}
process.exit(problems.length ? 1 : 0);
