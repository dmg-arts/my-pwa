/**
 * Records the walkthrough, one clip per section.
 *
 *     python3 serve.py --port 8123 --no-open &
 *     node tools/video/record.mjs            # everything
 *     node tools/video/record.mjs 3-instructor   # just one, to re-shoot it
 *
 * See PLAN.md for the script and the shot list. Clips land in
 * `tools/video/out/raw/` and are stitched by `build.mjs`.
 *
 * WHY EACH SECTION IS ITS OWN CLIP
 *
 * Playwright writes a video when a browser context closes, and fixes its size
 * for the life of that context. One context per section therefore buys two
 * things: a re-shoot of the instructor section does not mean re-recording the
 * whole video, and the student section can be captured at phone size while
 * everything else is 1080p. `build.mjs` pads the phone clips onto the same
 * canvas afterwards.
 *
 * THE CURSOR IS FAKE, AND HAS TO BE
 *
 * Playwright's video does not draw a pointer, so a recording made with ordinary
 * `click()` calls shows things happening with nothing causing them — which is
 * useless in a walkthrough. `cursor()` injects a real element and `moveTo()`
 * animates it to a target before the actual click lands, so a viewer can follow
 * what is being pressed.
 *
 * PACING IS THE WHOLE JOB
 *
 * A screen recording made at machine speed is unwatchable. Every step here is
 * deliberately slower than it needs to be, and each shot is held for roughly as
 * long as its narration line takes to read. `hold()` is not padding; it is the
 * thing that makes the result follow the script.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/index.html';
const OUT = path.resolve('tools/video/out/raw');
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));

const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 460, height: 940 };

/* ------------------------------------------------------------------ *
 * pacing and the visible cursor
 * ------------------------------------------------------------------ */

const hold = (page, seconds) => page.waitForTimeout(seconds * 1000);

/**
 * How much bigger to draw the app than a browser would.
 *
 * The layout is capped at `--content-max`, 68rem, so on a 1920-wide frame the
 * app is a 1088px column with four hundred pixels of empty carpet either side —
 * accurate, and sparse enough to look like a mistake in a video. Everything is
 * sized in rem, so raising the root font size scales the whole interface
 * proportionally and fills the frame *at native resolution*, which is sharper
 * than recording small and upscaling afterwards.
 */
const ROOT_PX = 22;

/** Injects a pointer the recording can actually see. */
async function cursor(page) {
  await page.addStyleTag({ content: `html { font-size: ${ROOT_PX}px; }` });
  await page.addStyleTag({
    content: `
      #vidcursor {
        position: fixed; z-index: 2147483647; left: 0; top: 0;
        width: 22px; height: 22px; margin: -11px 0 0 -11px;
        border-radius: 50%; pointer-events: none;
        background: rgba(28,79,139,.32);
        border: 2px solid rgba(28,79,139,.9);
        box-shadow: 0 0 0 2px rgba(255,255,255,.75);
        transition: transform .18s ease-out;
      }
      #vidcursor.tap { animation: vidtap .4s ease-out; }
      @keyframes vidtap {
        0%   { box-shadow: 0 0 0 2px rgba(255,255,255,.75), 0 0 0 0 rgba(28,79,139,.45); }
        100% { box-shadow: 0 0 0 2px rgba(255,255,255,.75), 0 0 0 26px rgba(28,79,139,0); }
      }`,
  });
  await page.evaluate(() => {
    if (document.getElementById('vidcursor')) return;
    const dot = document.createElement('div');
    dot.id = 'vidcursor';
    document.body.append(dot);
    window.__vidcursor = (x, y) => { dot.style.transform = `translate(${x}px,${y}px)`; };
    window.__vidtap = () => {
      dot.classList.remove('tap');
      void dot.offsetWidth;          // restart the animation
      dot.classList.add('tap');
    };
  });
}

/** Moves the visible cursor to an element and pauses, without clicking. */
async function moveTo(page, selector, { nth = 0 } = {}) {
  const el = page.locator(selector).nth(nth);
  await el.waitFor({ state: 'visible', timeout: 15000 });
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.evaluate(([px, py]) => window.__vidcursor?.(px, py), [x, y]);
  await page.mouse.move(x, y);
  await page.waitForTimeout(420);
  return el;
}

/** Moves there, shows the tap, then clicks. */
async function click(page, selector, { nth = 0, settle = 0.9 } = {}) {
  const el = await moveTo(page, selector, { nth });
  await page.evaluate(() => window.__vidtap?.());
  await page.waitForTimeout(160);
  await el.click();
  await hold(page, settle);
}

/** Types at a speed a viewer can read. */
async function type(page, selector, text, { nth = 0 } = {}) {
  const el = await moveTo(page, selector, { nth });
  await el.click();
  await el.type(text, { delay: 42 });
  await page.waitForTimeout(400);
}

/** Scrolls down smoothly rather than jumping, so the eye can follow. */
async function scroll(page, pixels, seconds = 1.6) {
  await page.evaluate(([px, ms]) => new Promise((done) => {
    const start = window.scrollY;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      window.scrollTo(0, start + px * eased);
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }), [pixels, seconds * 1000]);
  await page.waitForTimeout(250);
}

/**
 * Navigates and re-injects the cursor, which a reload destroys.
 *
 * `domcontentloaded` rather than `networkidle`: any screen with a sign-in gate
 * pulls Google's script from accounts.google.com, and the network never goes
 * idle on those, so waiting for it just times out after thirty seconds. The
 * fixed settle below is what actually makes the shot ready.
 */
async function go(page, route, { settle = 1.2 } = {}) {
  const target = `${BASE}#${route}`;
  if (page.url() === target) {
    // Navigating to the URL already showing is a same-document no-op: the
    // router never re-runs, so the screen stays exactly as it was. That matters
    // straight after a sign-in, where the page is still showing the gate the
    // sign-in just satisfied, and the section then waits for content that will
    // never appear.
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(target, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(1400);
  await cursor(page);
  await hold(page, settle);
}

/* ------------------------------------------------------------------ *
 * the detachment on screen
 * ------------------------------------------------------------------ */

const PEOPLE = {
  student:    { email: 'mia.alvarez@gmail.com',    name: 'Alvarez, Mia',   roles: ['student'],    asClass: 'AS200' },
  instructor: { email: 'ana.lindqvist@det025.edu', name: 'Lindqvist, Ana', roles: ['instructor'], asClass: '' },
  cadre:      { email: 'sam.okafor@det025.edu',    name: 'Okafor, Sam',    roles: ['cadre'],      asClass: '' },
  commander:  { email: 'maria.reyes@det025.edu',   name: 'Reyes, Maria',   roles: ['commander'],  asClass: '' },
  admin:      { email: 'dee.novak@det025.edu',     name: 'Novak, Dee',     roles: ['admin'],      asClass: '' },
};

/** Runs the wizard for real — section 1 films part of this. */
async function runWizard(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wizard');
  await cursor(page);
}

/**
 * Puts the app straight into a configured detachment, skipping the wizard.
 *
 * Only section 1 films setup; every other section opens on a unit that already
 * exists, which is what its viewer will have. Writing the connection directly
 * is also four seconds rather than forty, across six recordings.
 */
async function prepare(page) {
  // Written as an init script rather than after a load, so the *first painted
  // frame* is already a configured detachment. Setting it afterwards meant
  // every section opened on a second of the setup wizard before snapping to
  // where it belonged — accurate, and confusing in a video about roles.
  await page.context().addInitScript(() => {
    localStorage.setItem('nine31.connection.v1', JSON.stringify({
      backend: 'local', orgName: 'AFROTC Detachment 025',
      clientId: '000000000000-9thirtyonedemo.apps.googleusercontent.com',
      folderId: 'demo', proxyUrl: '', folderName: '9ThirtyOne',
      connectedAt: new Date().toISOString(),
    }));
    localStorage.setItem('nine31.setup.complete.v1', '1');
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1100);
  await seedDetachment(page);
  // Seeding runs the schema migration, which raises a "database updated" toast.
  // True, and nothing to do with what the section is about, so it does not get
  // to sit in the corner of the next shot.
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
}

/** Everything the later sections need to have something to show. */
async function seedDetachment(page, { withResponses = true } = {}) {
  await page.evaluate(async ([people, withResponses]) => {
    const a = await import('/js/auth.js');
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');

    const founder = await a.signInWithGoogle(
      { email: people.commander.email, name: people.commander.name, emailVerified: true }, null, 'tok');
    for (const key of ['instructor', 'cadre', 'admin']) await a.createAccount(people[key]);

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
    for (const [id, title, space, fid, subject] of [
      ['req_demo', 'AS200 Leadership Lab — Drill Block 3', 'shared', 'FB-2026-0001', 'lindqvist.ana'],
      ['req_cadre', 'Cadre climate check — Fall term', 'cadre', 'FB-2026-0014', 'okafor.sam'],
      ['req_cmdr', 'Commander’s assessment — AS400 leadership', 'commander', 'FB-2026-0015', 'reyes.maria'],
    ]) {
      const form = await m.db.saveForm({ id: `form_${id}`, name: title, space,
        sections: [{ title, items }] });
      await m.db.saveRequest({
        id, feedbackId: fid, title, eventName: title, formId: form.id, space, subject,
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        anonymous: true, status: 'open', assignedUsernames: [],
        instructions: 'Answer honestly — your name is never stored with your answers.',
      });
    }

    if (withResponses) {
      // Deliberately polarised, so the analysis has something true to say.
      const rows = [
        [9, 8, 9, 'Absolutely excellent instruction. Very clear and the drill practice was engaging.'],
        [8, 7, 8, 'Great pace overall. The labs were thorough and well organised.'],
        [9, 9, 8, 'Outstanding block. Learned a lot about leadership under pressure.'],
        [3, 2, 3, 'Disorganised and confusing. Honestly a waste of time.'],
        [2, 3, 2, 'The briefings were unclear and frustrating. Nobody knew the plan.'],
        [8, 8, 7, 'Really enjoyed the drill sequence. More reps would help.'],
        [7, 7, 8, 'Solid instruction, though the room was cold and we started late.'],
        [3, 2, 2, 'during the overnight some of the AS300s made the newer cadets stay up '
          + 'doing extra inventory checks until almost 0300 because someone misplaced a canteen.'],
      ];
      for (const [v1, v2, v3, text] of rows) {
        await m.db.saveResponse({
          requestId: 'req_demo', formId: 'form_req_demo', anonymous: true,
          asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
          answers: { q1: v1, q2: v2, q3: v3, q4: text },
        });
      }
      // Two about one person, so the commander section can show a withheld page.
      await m.db.saveRequest({ id: 'req_quiet', formId: 'form_req_demo',
        title: 'AS100 Drill Fundamentals', feedbackId: 'FB-2026-0021', status: 'open',
        asClass: 'AS200', anonymous: true, space: 'shared', subject: 'okafor.sam' });
      for (const v of [8, 7]) {
        await m.db.saveResponse({ requestId: 'req_quiet', formId: 'form_req_demo',
          anonymous: true, answers: { q1: v, q2: v, q3: v } });
      }
      // Deliberately skipping the first cadet: she is the one the student
      // section signs in as, and if she has already answered, her list opens on
      // the cadre and commander requests instead of the ordinary one. Both are
      // correct — a cadet answers requests from every area — but it is a
      // confusing first thing to show in a walkthrough about who sees what.
      for (const [email] of cadets.slice(1, 6)) {
        await m.db.addReceipt('req_demo', (await a.findByEmail(email)).username);
      }
    }
    await a.updateAccount(founder.id, { roles: people.commander.roles });
    a.signOut();
  }, [PEOPLE, withResponses]);
}

/**
 * Signs in, and checks it worked.
 *
 * A failed sign-in does not throw here — it leaves the app on its sign-in gate,
 * and the section then fails fifteen seconds later on a selector that was never
 * going to appear, pointing at the wrong thing entirely. Asserting the roles
 * that came back turns that into an error naming the actual cause.
 */
async function signInAs(page, person) {
  const got = await page.evaluate(async (p) => {
    const a = await import('/js/auth.js');
    a.signOut();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    try {
      const account = await a.signInWithGoogle({ ...p, emailVerified: true, exp }, null, 'tok');
      return { ok: true, roles: account.roles || [] };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, person);

  if (!got.ok) throw new Error(`sign-in as ${person.email} refused: ${got.error}`);
  const wanted = person.roles[0];
  if (!got.roles.includes(wanted)) {
    throw new Error(
      `signed in as ${person.email} but got [${got.roles}] not ${wanted} — `
      + 'the roster was probably not seeded, so this account claimed an empty one');
  }
}

/** A Client ID so the sign-in screens show Google's real button. */
const setClientId = (page) => page.evaluate(() => {
  const conn = JSON.parse(localStorage.getItem('nine31.connection.v1') || '{}');
  localStorage.setItem('nine31.connection.v1', JSON.stringify({
    ...conn, clientId: '000000000000-9thirtyonedemo.apps.googleusercontent.com',
  }));
});

/* ------------------------------------------------------------------ *
 * sections
 * ------------------------------------------------------------------ */

const SECTIONS = [
  {
    id: '1-overview',
    size: DESKTOP,
    async run(page) {
      // The wizard, filmed for real — this is the first thing an installer sees.
      await runWizard(page);
      await hold(page, 1.6);
      await type(page, '.wizard input[type=text]', 'AFROTC Detachment 025');
      await click(page, '.wizard .btn--primary');

      // The three places a detachment's records can live.
      await page.waitForSelector('.choice-list');
      await hold(page, 2.4);
      await moveTo(page, '.choice-list label', { nth: 0 });
      await hold(page, 1.4);
      await click(page, 'input[value="local"]');
      await click(page, '.wizard .btn--primary');

      await page.waitForSelector('.notice--warn');
      await hold(page, 1.8);
      await click(page, '.wizard .btn--primary');

      // The folder structure it creates: the database, in plain files.
      await page.waitForSelector('.tree');
      await hold(page, 3.4);
      await scroll(page, 220);
      await hold(page, 2.0);
      await click(page, '.wizard .btn--lg', { settle: 2.0 });

      await page.waitForSelector('.role-grid', { timeout: 15000 });
      await cursor(page);
      await hold(page, 3.4);
      await moveTo(page, '.role-card', { nth: 0 });
      await hold(page, 2.2);
      await moveTo(page, '.role-card', { nth: 1 });
      await hold(page, 2.0);
    },
  },
  {
    id: '2a-student-desktop',
    size: DESKTOP,
    async run(page) {
      await prepare(page);
      // What a cadet actually receives: a link, and nothing to configure.
      await go(page, '/join?c=000000000000-9thirtyonedemo&f=demo&n=AFROTC%20Detachment%20025&p=AKfycbxDEMO',
        { settle: 3.2 });
      await scroll(page, 180);
      await hold(page, 2.2);

      // The sign-in gate, with Google's own button.
      await go(page, '/student', { settle: 2.6 });
      await signInAs(page, PEOPLE.student);
      await go(page, '/student', { settle: 2.4 });
      // Only what is assigned to them, filtered.
      await moveTo(page, '.filters');
      await hold(page, 2.6);
      await moveTo(page, '.list__item');
      await hold(page, 2.0);
    },
  },
  {
    id: '2b-student-phone',
    size: PHONE,
    async run(page) {
      await prepare(page);
      await signInAs(page, PEOPLE.student);
      await go(page, '/student', { settle: 2.0 });
      await click(page, '.list__item', { settle: 2.4 });

      // The nine-point word scale — the thing cadets actually interact with.
      await hold(page, 2.4);
      await scroll(page, 320, 2.0);
      await hold(page, 2.6);
      await click(page, '.scale__opt', { nth: 7, settle: 1.8 });
      await scroll(page, 300, 1.8);
      await hold(page, 2.6);
      await click(page, '.scale__opt', { nth: 12, settle: 1.8 });
      await scroll(page, 340, 2.0);
      await hold(page, 3.4);
      await scroll(page, 320, 2.0);
      await hold(page, 3.0);
    },
  },
  {
    id: '3-instructor',
    size: DESKTOP,
    async run(page) {
      await prepare(page);
      await signInAs(page, PEOPLE.instructor);
      await go(page, '/instructor?tab=requests', { settle: 2.6 });

      // Building a form.
      await click(page, 'button:has-text("Create Feedback")', { settle: 2.2 });
      await type(page, 'input[placeholder^="e.g. AS200 Leadership"]',
        'AS200 Field Training Prep — Week 4');
      await hold(page, 1.4);
      await scroll(page, 420, 2.0);
      await hold(page, 2.6);

      // The analysis, which is the part worth watching.
      await go(page, '/instructor?tab=analysis', { settle: 4.0 });
      await hold(page, 2.6);
      await scroll(page, 400, 2.2);
      await hold(page, 4.0);          // the distribution
      await scroll(page, 480, 2.2);
      await hold(page, 4.2);          // the split called out
      await scroll(page, 520, 2.2);
      await hold(page, 4.0);          // written answers
      await scroll(page, 560, 2.2);
      await hold(page, 4.2);          // the safety screen
      await scroll(page, 520, 2.2);
      await hold(page, 3.4);          // who still owes feedback
    },
  },
  {
    id: '4-cadre',
    size: DESKTOP,
    async run(page) {
      await prepare(page);
      await signInAs(page, PEOPLE.cadre);
      await go(page, '/cadre?tab=requests', { settle: 3.4 });
      // The restricted notice, then the badge on the item itself.
      await moveTo(page, '.notice--info');
      await hold(page, 3.2);
      await scroll(page, 380, 2.0);
      await moveTo(page, '.badge--warn');
      await hold(page, 2.8);
      // Both panels, one button apart.
      await page.evaluate(() => window.scrollTo(0, 0));
      await hold(page, 0.6);
      await moveTo(page, 'button:has-text("Instructor Panel")');
      await hold(page, 2.4);

      // And what an instructor gets at the same address.
      await signInAs(page, PEOPLE.instructor);
      await go(page, '/cadre', { settle: 3.6 });
    },
  },
  {
    id: '5-commander',
    size: DESKTOP,
    async run(page) {
      await prepare(page);
      await signInAs(page, PEOPLE.commander);
      await go(page, '/cadre?tab=requests', { settle: 2.8 });
      await scroll(page, 380, 2.0);
      await hold(page, 3.0);          // the commander's own area, badged

      await go(page, '/instructor?tab=people', { settle: 3.4 });
      await hold(page, 2.4);
      // Somebody with enough responses to be summarised.
      await click(page, 'tbody tr', { nth: 0, settle: 3.2 });
      await scroll(page, 300, 1.8);
      await hold(page, 2.4);

      // And somebody under the threshold, where it refuses to answer.
      await page.evaluate(() => window.scrollTo(0, 0));
      await go(page, '/instructor?tab=people', { settle: 2.0 });
      const withheld = page.locator('tbody tr', { hasText: 'Okafor' });
      if (await withheld.count()) {
        await withheld.first().scrollIntoViewIfNeeded();
        await withheld.first().click();
        await hold(page, 4.2);
      }
    },
  },
  {
    id: '6-admin',
    size: DESKTOP,
    async run(page) {
      await prepare(page);
      await signInAs(page, PEOPLE.admin);
      await go(page, '/admin', { settle: 3.0 });
      await scroll(page, 320, 2.0);
      await hold(page, 3.0);          // the roster, and what each person may do

      // Getting people set up: one link, or a code on a screen.
      await go(page, '/admin/invite', { settle: 3.4 });
      await scroll(page, 300, 2.0);
      await hold(page, 3.4);

      // The activity log.
      await go(page, '/instructor?tab=database', { settle: 2.6 });
      await scroll(page, 620, 2.4);
      await hold(page, 3.6);          // the activity log
      await scroll(page, 520, 2.2);
      await hold(page, 4.0);          // the anonymised backup export
    },
  },
  {
    id: '7-close',
    size: DESKTOP,
    async run(page) {
      await prepare(page);
      await signInAs(page, PEOPLE.commander);
      await go(page, '/settings', { settle: 3.2 });
      await scroll(page, 360, 2.2);
      await hold(page, 3.4);
      await go(page, '/home', { settle: 4.5 });
      await hold(page, 4.0);
    },
  },
];

/* ------------------------------------------------------------------ *
 * run
 * ------------------------------------------------------------------ */

const wanted = process.argv.slice(2);
const todo = wanted.length ? SECTIONS.filter((s) => wanted.includes(s.id)) : SECTIONS;
if (!todo.length) {
  console.error(`no such section. known: ${SECTIONS.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

for (const section of todo) {
  const dir = path.join(OUT, section.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const ctx = await browser.newContext({
    viewport: section.size,
    recordVideo: { dir, size: section.size },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const started = Date.now();
  try {
    await section.run(page);
  } catch (err) {
    console.error(`  ${section.id}: ${err.message.split('\n')[0]}`);
  }
  await ctx.close();      // this is what writes the file

  // Playwright names the file for the page; give it the section's name.
  const written = fs.readdirSync(dir).find((f) => f.endsWith('.webm'));
  if (written) {
    fs.renameSync(path.join(dir, written), path.join(OUT, `${section.id}.webm`));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  ${section.id.padEnd(18)} ${seconds}s${errors.length ? `  (${errors.length} page errors)` : ''}`);
  for (const e of [...new Set(errors)].slice(0, 3)) console.log(`      ${e}`);
}

await browser.close();
console.log(`\nClips in ${OUT}/`);
