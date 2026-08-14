import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123/index.html';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const ctx = await browser.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

const shot = async (name, opts = {}) => {
  await page.waitForTimeout(600);
  // Drop any lingering toasts so they never land in a published screenshot.
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log('  captured', name);
};

/* ---------- setup wizard ---------- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.wizard');
await shot('setup-1-org');

await page.fill('.wizard input[type=text]', 'AFROTC Detachment 025');
await page.click('.wizard .btn--primary');
await page.waitForSelector('.choice-list');
await shot('setup-2-storage');

await page.click('input[value="local"]', { force: true });
await page.click('.wizard .btn--primary');
await page.waitForSelector('.notice--warn');
await page.click('.wizard .btn--primary');
await page.waitForSelector('.tree');
await shot('setup-3-folders');

await page.click('.wizard .btn--lg');
await page.waitForSelector('.role-grid', { timeout: 12000 });

/* ---------- seed a realistic detachment ---------- */
await page.evaluate(async () => {
  const a = await import('/js/auth.js');
  const m = await import('/js/storage/index.js');
  const c = await import('/js/config.js');

  await a.createAccount({
    username: 'reyes.maria', name: 'Reyes, Maria', roles: ['admin', 'instructor'],
    password: 'changeme123',
  });
  const cadets = [
    ['alvarez.mia', 'Alvarez, Mia'], ['brooks.dan', 'Brooks, Dan'], ['chen.li', 'Chen, Li'],
    ['diaz.sam', 'Diaz, Sam'], ['ellis.jo', 'Ellis, Jo'], ['ford.kim', 'Ford, Kim'],
    ['grant.ade', 'Grant, Ade'], ['hall.rae', 'Hall, Rae'],
  ];
  for (const [u, n] of cadets) {
    await a.createAccount({ username: u, name: n, roles: ['student'], asClass: 'AS200', password: 'cadet123' });
  }
  await a.signIn('reyes.maria', 'changeme123', 'instructor');

  const anchors = { ...c.SCALE_ANCHORS };
  const form = await m.db.saveForm({
    id: 'form_demo', name: 'AS200 Leadership Lab — Drill Block 3',
    sections: [{ title: 'AS200 Leadership Lab — Drill Block 3', items: [
      { id: 'q1', type: 'scale', label: 'Instruction was clear and well paced', required: true, min: 1, max: 9, anchors },
      { id: 'q2', type: 'scale', label: 'The event was well organised', required: true, min: 1, max: 9, anchors },
      { id: 'q3', type: 'scale', label: 'I can apply what I learned', required: true, min: 1, max: 9, anchors },
      { id: 'q4', type: 'text', label: 'What should change next time?', required: false, rows: 4, wordLimit: 250 },
    ] }],
  });
  await m.db.saveRequest({
    id: 'req_demo', feedbackId: 'FB-2026-0001', title: 'AS200 Leadership Lab — Drill Block 3',
    eventName: 'AS200 Leadership Lab — Drill Block 3', formId: form.id,
    asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
    anonymous: true, status: 'open', assignedUsernames: [],
    instructions: 'Answer honestly — your name is never stored with your answers.',
  });

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
      requestId: 'req_demo', formId: form.id, anonymous: true,
      asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      answers: { q1: v1, q2: v2, q3: v3, q4: text },
    });
  }
  for (const [u] of cadets.slice(0, 7)) await m.db.addReceipt('req_demo', u);
});

/* ---------- home ---------- */
await page.goto(`${BASE}#/home`, { waitUntil: 'networkidle' });
await page.waitForSelector('.role-grid');
await shot('home');

/* ---------- student ---------- */
await page.evaluate(() => sessionStorage.clear());
await page.goto(`${BASE}#/student`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('input[type=password]');
await shot('student-signin');

await page.fill('input[type=text]', 'hall.rae');
await page.fill('input[type=password]', 'cadet123');
await page.click('.btn--lg');
await page.waitForSelector('.list__item', { timeout: 12000 });
await shot('student-list');

await page.click('.list__item');
await page.waitForSelector('.scale--words', { timeout: 12000 });
await shot('student-form', { fullPage: true });

// Mobile view of the same form.
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(700);
await shot('student-mobile', { fullPage: true });
await page.setViewportSize({ width: 1240, height: 900 });

/* ---------- instructor ---------- */
await page.evaluate(() => sessionStorage.clear());
await page.goto(`${BASE}#/instructor`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('input[type=password]');
await page.fill('input[type=text]', 'reyes.maria');
await page.fill('input[type=password]', 'changeme123');
await page.click('.btn--lg');
await page.waitForSelector('[role=tablist]', { timeout: 12000 });
await shot('instructor-portal');

await page.goto(`${BASE}#/instructor/create/new`, { waitUntil: 'networkidle' });
await page.waitForSelector('.qrow', { timeout: 12000 });
await page.fill('input[placeholder^="e.g. AS200 Leadership"]', 'AS200 Field Training Prep — Week 4');
await page.evaluate(() => {
  const rows = document.querySelectorAll('.qrow input.input');
  const texts = ['The brief prepared me for the exercise', 'Cadre feedback during the exercise was useful',
    'What would you change about the exercise?'];
  rows.forEach((r, i) => { if (texts[i]) { r.value = texts[i]; r.dispatchEvent(new Event('input', { bubbles: true })); } });
});
await shot('form-creator', { fullPage: true });

/* ---------- analysis ---------- */
await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
await page.waitForSelector('.hist', { timeout: 15000 });
await shot('analysis-ratings', { fullPage: true });

// Just the first question card, for a tighter slide image.
const card = await page.$('.card:has(.hist)');
if (card) { await card.screenshot({ path: `${OUT}/analysis-question.png` }); console.log('  captured analysis-question'); }

for (const t of await page.$$('.tabs .tab')) {
  if ((await t.textContent()).trim() === 'Word cloud') { await t.click(); break; }
}
await page.waitForSelector('svg.cloud', { timeout: 12000 });
await shot('analysis-cloud', { fullPage: true });
const cloud = await page.$('.card:has(svg.cloud)');
if (cloud) { await cloud.screenshot({ path: `${OUT}/wordcloud.png` }); console.log('  captured wordcloud'); }

/* ---------- safety screen ---------- */
await page.evaluate(async () => {
  const m = await import('/js/storage/index.js');
  await m.db.saveResponse({
    requestId: 'req_demo', formId: 'form_demo', anonymous: true,
    asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
    answers: { q1: 2, q2: 2, q3: 2,
      q4: 'A senior cadet hazed the new flight members and made us do push ups until we cried.' },
  });
  await m.db.addReceipt('req_demo', 'grant.ade');
});
await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
// Same hash as the current URL is a same-document navigation and will not
// re-render, so force a reload.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.quote--flagged', { timeout: 15000 });
const safety = await page.$('section:has(.quote--flagged)');
if (safety) { await safety.screenshot({ path: `${OUT}/safety.png` }); console.log('  captured safety'); }

/* ---------- admin ---------- */
await page.goto(`${BASE}#/admin`, { waitUntil: 'networkidle' });
await page.waitForSelector('table.table', { timeout: 12000 });
await shot('admin', { fullPage: true });

await browser.close();
console.log('\nAll screenshots captured to', OUT);
