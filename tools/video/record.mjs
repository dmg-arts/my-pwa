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

/** Navigates and re-injects the cursor, which a reload destroys. */
async function go(page, route, { settle = 1.2 } = {}) {
  await page.goto(`${BASE}#${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
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
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wizard');
  await cursor(page);
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
      for (const [email] of cadets.slice(0, 5)) {
        await m.db.addReceipt('req_demo', (await a.findByEmail(email)).username);
      }
    }
    await a.updateAccount(founder.id, { roles: people.commander.roles });
    a.signOut();
  }, [PEOPLE, withResponses]);
}

const signInAs = (page, person) => page.evaluate(async (p) => {
  const a = await import('/js/auth.js');
  a.signOut();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  await a.signInWithGoogle({ ...p, emailVerified: true, exp }, null, 'tok');
}, person);

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
      await hold(page, 3.0);
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
