/**
 * End-to-end suite: drives the real app in a real browser.
 *
 *     npm run test:e2e        (starts its own server)
 *
 * Covers the guarantees that are expensive to get wrong and easy to break
 * silently — anonymity, one submission per cadet, the disclosure threshold,
 * concurrent writes, schema migrations and access control.
 */


import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/index.html';
const shots = process.argv[2] || null;
const errors = [];

// Prefer Playwright's own browser if it has been installed; otherwise fall back
// to a system Chrome, which is what most people already have.
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

const step = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (e) { console.log(`  FAIL ${label}: ${e.message.split('\n')[0]}`); errors.push(label); }
};

await page.goto(BASE, { waitUntil: 'networkidle' });

await step('setup completes', async () => {
  await page.waitForSelector('.wizard');
  await page.fill('.wizard input[type=text]', 'Det 025');
  await page.click('.wizard .btn--primary');
  await page.waitForSelector('.choice-list');
  await page.click('input[value="local"]', { force: true });
  await page.click('.wizard .btn--primary');
  await page.waitForSelector('.notice--warn');
  await page.click('.wizard .btn--primary');
  await page.waitForSelector('.tree');
  await page.click('.wizard .btn--lg');
  await page.waitForSelector('.role-grid', { timeout: 10000 });
});

/* ---------- built-in admin ---------- */
await step('built-in admin signs in on an empty folder', async () => {
  await page.goto(`${BASE}#/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=password]', { timeout: 8000 });
  await page.fill('input[type=text]', 'Admin');           // capitalised on purpose
  await page.fill('input[type=password]', '#admin-Password');
  await page.click('.btn--lg');
  await page.waitForSelector('.page-title:has-text("Database Administration")', { timeout: 10000 });
});

await step('console warns that only the built-in credential exists', async () => {
  const text = await page.textContent('#view');
  if (!/No named administrator account exists/.test(text)) throw new Error('no prompt shown');
  if (!/built-in administrator/i.test(text)) throw new Error('no built-in banner');
});

await step('wrong built-in password is rejected', async () => {
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=password]', { timeout: 8000 });
  await page.fill('input[type=text]', 'Admin');
  await page.fill('input[type=password]', 'wrong');
  await page.click('.btn--lg');
  await page.waitForSelector('.field__error:not([hidden])', { timeout: 8000 });
  if (await page.$('table.table')) throw new Error('signed in with a wrong password');
  await page.fill('input[type=password]', '#admin-Password');
  await page.click('.btn--lg');
  await page.waitForSelector('.page-title:has-text("Database Administration")', { timeout: 10000 });
});

/* ---------- students now need passwords ---------- */
await step('student account is created with a password', async () => {
  await page.click('.btn--primary:has-text("Create account")');
  await page.waitForSelector('dialog.modal');
  const texts = await page.$$('dialog input[type=text]');
  await texts[0].fill('Alvarez, Mia');
  await texts[1].fill('alvarez.mia');
  await page.fill('dialog input[type=password]', 'cadet123');
  await page.selectOption('dialog select', 'AS200');
  await page.click('dialog .btn--primary');
  await page.waitForTimeout(1200);
  const rows = await page.$$eval('table.table tbody tr', (r) => r.length);
  if (rows < 1) throw new Error('account not created');
});

await step('a student without a password is refused', async () => {
  const msg = await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    try { await a.createAccount({ username: 'nopass.user', name: 'No Pass', roles: ['student'] }); return 'NO ERROR'; }
    catch (e) { return e.message; }
  });
  if (!/needs a password/i.test(msg)) throw new Error(`message was: ${msg}`);
});

await step('short student passwords are refused', async () => {
  const msg = await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    try { await a.createAccount({ username: 'short.pw', name: 'Short', roles: ['student'], password: '123' }); return 'NO ERROR'; }
    catch (e) { return e.message; }
  });
  if (!/at least 6/i.test(msg)) throw new Error(`message was: ${msg}`);
});

/* ---------- password reset ---------- */
await step('admin can reset a student password', async () => {
  await page.click('.btn--ghost[title="Reset password"]');
  await page.waitForSelector('dialog.modal');
  const pws = await page.$$('dialog input[type=password]');
  await pws[0].fill('newpass99');
  await pws[1].fill('newpass99');
  await page.click('dialog .btn--primary');
  await page.waitForTimeout(1200);
  const ok = await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    try { await a.signIn('alvarez.mia', 'newpass99', 'student'); return true; } catch { return false; }
  });
  if (!ok) throw new Error('new password does not work');
  const oldGone = await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    try { await a.signIn('alvarez.mia', 'cadet123', 'student'); return false; } catch { return true; }
  });
  if (!oldGone) throw new Error('old password still works');
});
if (shots) await page.screenshot({ path: `${shots}/m1-admin.png`, fullPage: true });

/* ---------- create feedback with anchors ---------- */
await step('a feedback form is issued', async () => {
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}#/instructor/create/new`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  // The form creator is deep-linkable, so it must gate on its own.
  await page.waitForSelector('input[type=password]', { timeout: 8000 });
  await page.fill('input[type=text]', 'Admin');
  await page.fill('input[type=password]', '#admin-Password');
  await page.click('.btn--lg');
  await page.waitForSelector('.qrow', { timeout: 10000 });
  const rows = await page.$$('.qrow');
  const texts = ['Instruction was clear', 'Event was organised', 'What should change?'];
  for (let i = 0; i < rows.length; i++) {
    await (await rows[i].$('input.input')).fill(texts[i] || `Q${i}`);
  }
  await page.fill('input[placeholder^="e.g. AS200 Leadership"]', 'AS200 Drill Block 3');
  await page.selectOption('.filters select', 'AS200');
  await page.click('.btn--primary:has-text("Issue to students")');
  await page.waitForSelector('.list__item', { timeout: 10000 });
});

/* ---------- student sign-in ---------- */
await step('student page now requires a password', async () => {
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}#/student`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.page-title:has-text("Student sign-in")', { timeout: 8000 });
});

await step('wrong student password is rejected', async () => {
  await page.fill('input[type=text]', 'alvarez.mia');
  await page.fill('input[type=password]', 'nope');
  await page.click('.btn--lg');
  await page.waitForSelector('.field__error:not([hidden])', { timeout: 8000 });
  if (await page.$('.list__item')) throw new Error('got in with a wrong password');
});

await step('student signs in and sees their feedback', async () => {
  await page.fill('input[type=password]', 'newpass99');
  await page.click('.btn--lg');
  await page.waitForSelector('.list__item', { timeout: 10000 });
});

await step('school year and semester filters are present', async () => {
  const labels = await page.$$eval('.filters .field__label', (n) => n.map((x) => x.textContent.trim()));
  for (const want of ['School year', 'Semester', 'Class', 'Due from', 'Due to']) {
    if (!labels.some((l) => l.startsWith(want))) throw new Error(`missing "${want}" — saw ${labels.join(', ')}`);
  }
});

await step('students choose words, never numbers', async () => {
  await page.click('.list__item');
  await page.waitForSelector('.scale--words', { timeout: 8000 });

  const labels = await page.$$eval(
    '.q[data-qtype=scale] .scale--words .scale__opt span',
    (n) => n.map((x) => x.textContent.trim()));
  const expected = ['Detrimental', 'Significant', 'Unfavorable', 'Minor', 'Neutral',
    'Slight', 'Favorable', 'Major', 'Outstanding'];
  const firstNine = labels.slice(0, 9);
  if (JSON.stringify(firstNine) !== JSON.stringify(expected)) {
    throw new Error(`scale reads ${JSON.stringify(firstNine)}`);
  }
  // No digit should be visible anywhere in a rating question.
  const digits = labels.filter((l) => /\d/.test(l));
  if (digits.length) throw new Error(`numbers shown to students: ${digits.join(', ')}`);

  // ...but the value carried for the maths is the 1-9 number.
  const values = await page.$$eval(
    '.q[data-qtype=scale]:first-of-type input[type=radio]', (n) => n.map((x) => x.value));
  if (JSON.stringify(values) !== JSON.stringify(['1','2','3','4','5','6','7','8','9'])) {
    throw new Error(`underlying values are ${JSON.stringify(values)}`);
  }
  // The scale must render as one column per point, not wrap into two groups.
  const cols = await page.evaluate(() => {
    const g = document.querySelector('.q[data-qtype=scale] .scale--words');
    return {
      count: g.style.getPropertyValue('--scale-count'),
      columns: getComputedStyle(g).gridTemplateColumns.split(' ').length,
    };
  });
  if (cols.count !== '9') throw new Error(`--scale-count is "${cols.count}"`);
});
if (shots) await page.screenshot({ path: `${shots}/m2-form.png`, fullPage: true });

await step('student submits and is receipted', async () => {
  await page.evaluate(() => {
    for (const q of document.querySelectorAll('.q[data-qtype=scale]')) {
      // 7th option = "Favorable" = 7
      q.querySelectorAll('input[type=radio]')[6]?.click();
    }
    for (const t of document.querySelectorAll('.q[data-qtype=text] textarea')) {
      t.value = 'More reps on the drill sequence.';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.click('.btn--lg:has-text("Submit")');
  await page.waitForSelector('dialog.modal', { timeout: 8000 });
  await page.click('dialog .btn--primary');
  await page.waitForSelector('.empty__title:has-text("Feedback submitted")', { timeout: 10000 });
});

await step('a second submission is blocked at the form', async () => {
  await page.goto(`${BASE}#/student`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('.check input[type=checkbox]');
  await page.waitForSelector('.list__item', { timeout: 8000 });
  await page.click('.list__item');
  await page.waitForSelector('.notice--ok:has-text("already submitted")', { timeout: 10000 });
});

await step('anonymity holds: response has no username, receipt does', async () => {
  const r = await page.evaluate(async () => {
    const all = await new Promise((res) => {
      const q = indexedDB.open('topfb');
      q.onsuccess = () => {
        const t = q.result.transaction('docs').objectStore('docs').getAll();
        t.onsuccess = () => res(t.result);
      };
    });
    return {
      responses: JSON.stringify(all.filter((x) => /^responses\/.+\/res_/.test(x.path)).map((x) => x.data)),
      receipts: JSON.stringify(all.filter((x) => x.path.startsWith('receipts/')).map((x) => x.data)),
    };
  });
  if (r.responses.includes('alvarez.mia')) throw new Error('USERNAME LEAKED INTO ANONYMOUS RESPONSE');
  if (!r.receipts.includes('alvarez.mia')) throw new Error('no receipt written');
  // The word the cadet picked must be stored as its number, not as text.
  const answers = JSON.parse(r.responses)[0].answers;
  const rated = Object.values(answers).filter((v) => typeof v === 'number');
  if (!rated.length) throw new Error('no numeric ratings stored');
  if (!rated.every((v) => v === 7)) throw new Error(`expected 7 for Satisfactory, got ${rated.join(',')}`);
});

await step('analysis reports the mean back in words', async () => {
  // One anonymous response is withheld by design now, so add two more from
  // other cadets to clear the disclosure threshold before checking the maths.
  await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const reqs = await m.db.listRequests();
    const target = reqs.find((r) => r.status === 'open');
    for (const [user, rating] of [['top.up1', 7], ['top.up2', 7]]) {
      await m.db.saveResponse({
        requestId: target.id, formId: target.formId, anonymous: true,
        asClass: target.asClass, schoolYear: target.schoolYear, semester: target.semester,
        answers: Object.fromEntries(
          Object.keys((await m.db.listResponses(target.id))[0].answers).map((k) => [k, rating])),
      });
      await m.db.addReceipt(target.id, user);
    }
  });
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=password]', { timeout: 8000 });
  await page.fill('input[type=text]', 'Admin');
  await page.fill('input[type=password]', '#admin-Password');
  await page.click('.btn--lg');
  await page.waitForSelector('.bar-row', { timeout: 12000 });
  const text = await page.textContent('.stack-lg');
  if (!/Favorable/.test(text)) throw new Error('mean not described in words');
  const bar = await page.textContent('.bar-row__val');
  if (!/·/.test(bar)) throw new Error(`bar value reads "${bar}"`);
});

/* ---------- migrations ---------- */
await step('a v1 folder is migrated forward on load', async () => {
  const result = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    // Simulate a folder written by the previous release.
    await m.db.saveOrg({ schemaVersion: 1 });
    await m.db.adapter.writeDoc('roster/students.json', {
      students: [{ id: 'stu_old', name: 'Legacy, Cadet', asClass: 'AS100', active: true }],
    });
    await m.db.adapter.writeDoc('requests/req_legacy.json', {
      id: 'req_legacy', title: 'Old form', formId: 'form_x', status: 'closed',
      createdAt: '2025-09-01T00:00:00.000Z',
    });
    const before = await m.db.migrationStatus();
    const ran = await m.db.migrate();
    const after = await m.db.migrationStatus();
    const legacyReq = await m.db.getRequest('req_legacy');
    const users = (await m.db.getUsers()).users || [];
    return {
      pendingBefore: before.pending.length,
      from: ran.from, to: ran.to, ran: ran.ran, notes: ran.notes,
      pendingAfter: after.pending.length,
      legacyFeedbackId: legacyReq?.feedbackId || null,
      migratedUser: users.find((u) => u.name === 'Legacy, Cadet') || null,
    };
  });
  if (result.pendingBefore !== 2) throw new Error(`expected 2 pending, saw ${result.pendingBefore}`);
  if (result.from !== 1 || result.to !== 3) throw new Error(`migrated ${result.from}->${result.to}`);
  if (result.pendingAfter !== 0) throw new Error('still pending after migrate');
  if (!/^FB-\d{4}-\d{4}$/.test(result.legacyFeedbackId || '')) {
    throw new Error(`legacy request not stamped: ${result.legacyFeedbackId}`);
  }
  if (!result.migratedUser) throw new Error('roster student not converted to an account');
  if (!result.migratedUser.needsPassword) throw new Error('migrated student not flagged for a password');
  console.log(`       ${result.ran[0]}`);
  for (const n of result.notes) console.log(`       · ${n}`);
});

await step('migrations are idempotent', async () => {
  const again = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const r = await m.db.migrate();
    return { ran: r.ran.length, from: r.from, to: r.to };
  });
  if (again.ran !== 0) throw new Error(`re-ran ${again.ran} migrations on an up-to-date folder`);
});

await step('a newer folder refuses to be downgraded', async () => {
  const msg = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    await m.db.saveOrg({ schemaVersion: 99 });
    try { await m.db.migrate(); return 'NO ERROR'; }
    catch (e) { return e.message; }
    finally { await m.db.saveOrg({ schemaVersion: 2 }); }
  });
  if (!/newer version/i.test(msg)) throw new Error(`message was: ${msg}`);
});

await step('schema panel reports the version', async () => {
  // Signed in as a student at this point; the admin console needs admin.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}#/admin`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=password]', { timeout: 8000 });
  await page.fill('input[type=text]', 'Admin');
  await page.fill('input[type=password]', '#admin-Password');
  await page.click('.btn--lg');
  await page.waitForSelector('.section-title:has-text("Schema version")', { timeout: 10000 });
  const text = await page.textContent('#view');
  if (!/Up to date/.test(text)) throw new Error('schema panel does not show up-to-date');
});
if (shots) await page.screenshot({ path: `${shots}/m3-schema.png`, fullPage: true });


/* ---------- folded in from the retired suite ---------- */

await step('home shows all three entries', async () => {
  await page.goto(`${BASE}#/home`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.role-grid', { timeout: 8000 });
  const text = await page.textContent('.role-grid');
  for (const want of ['Student', 'Instructor Portal', 'Database Administration']) {
    if (!text.includes(want)) throw new Error(`missing "${want}"`);
  }
});

await step('duplicate usernames are rejected, case-insensitively', async () => {
  const msg = await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    try {
      await a.createAccount({ username: 'ALVAREZ.MIA', name: 'Dup', roles: ['student'], password: 'dupe123' });
      return 'NO ERROR';
    } catch (e) { return e.message; }
  });
  if (!/already taken/i.test(msg)) throw new Error(`message was: ${msg}`);
});

await step('home stats read the index, not every response', async () => {
  const reads = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const adapter = m.db.adapter;
    let count = 0;
    const original = adapter.readDoc.bind(adapter);
    adapter.readDoc = (p) => { count++; return original(p); };
    m.db.use('local');                      // cold cache, as on a fresh load
    await m.db.stats();
    adapter.readDoc = original;
    return count;
  });
  if (reads > 12) throw new Error(`db.stats() made ${reads} reads`);
  console.log(`       db.stats() = ${reads} document reads`);
});

await step('a write made offline is queued, then drains on reconnect', async () => {
  await ctx.setOffline(true);
  const queued = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const adapter = m.db.adapter;
    const real = adapter.writeDoc.bind(adapter);
    adapter.writeDoc = () => Promise.reject(new TypeError('Failed to fetch'));
    const saved = await m.db.saveResponse({
      requestId: 'req_offline_test', formId: 'f1', anonymous: true, answers: { q1: 9 },
    });
    const state = await m.queueState();
    adapter.writeDoc = real;
    return { queued: saved.queued, pending: state.pending };
  });
  if (!queued.queued || queued.pending < 1) throw new Error('write was not queued');

  await ctx.setOffline(false);
  const remaining = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    for (let i = 0; i < 40; i++) {
      const state = await m.queueState();
      if (state.pending === 0) return 0;
      if (!state.draining) await m.flushQueue().catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
    }
    return (await m.queueState()).pending;
  });
  if (remaining !== 0) throw new Error(`${remaining} still queued after reconnect`);
  console.log(`       queued ${queued.pending}, drained to 0`);
});

await step('analysis renders with completion tracking', async () => {
  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bar-row', { timeout: 12000 });
  await page.waitForSelector('.meter__fill', { timeout: 12000 });
  const text = await page.textContent('.stack-lg');
  if (!/Completion/.test(text)) throw new Error('no completion panel');
  if (!/submitted/.test(text)) throw new Error('no submission counts');
});

await step('old /cadre bookmark redirects to the portal', async () => {
  await page.goto(`${BASE}#/cadre`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const hash = await page.evaluate(() => location.hash);
  if (!hash.startsWith('#/instructor')) throw new Error(`landed on ${hash}`);
});


/* ---------- disclosure threshold ---------- */

await step('a lone anonymous response is withheld from analysis', async () => {
  // Fresh admin session, then a form with exactly one response.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=password]', { timeout: 8000 });
  await page.fill('input[type=text]', 'Admin');
  await page.fill('input[type=password]', '#admin-Password');
  await page.click('.btn--lg');
  await page.waitForSelector('.stack-lg', { timeout: 12000 });

  await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');
    const anchors = { ...c.SCALE_ANCHORS };
    const form = await m.db.saveForm({
      id: 'form_thin', name: 'Thin Flight Feedback',
      sections: [{ title: 'Thin', items: [
        { id: 'tq1', type: 'scale', label: 'Secret rating', required: true, min: 1, max: 9, anchors },
        { id: 'tq2', type: 'text', label: 'Secret comment', required: false, rows: 3, wordLimit: 250 },
      ] }],
    });
    await m.db.saveRequest({
      id: 'req_thin', feedbackId: 'FB-2026-9001', title: 'Thin Flight Feedback',
      formId: form.id, asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      anonymous: true, status: 'open', assignedUsernames: [],
    });
    await m.db.saveResponse({
      requestId: 'req_thin', formId: form.id, anonymous: true,
      asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      answers: { tq1: 1, tq2: 'CANARY-SECRET-COMMENT' },
    });
    await m.db.addReceipt('req_thin', 'alvarez.mia');
  });

  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.stack-lg', { timeout: 12000 });
  await page.waitForTimeout(1200);

  const text = await page.textContent('#view');
  if (text.includes('CANARY-SECRET-COMMENT')) throw new Error('WITHHELD COMMENT WAS DISPLAYED');
  if (!/Results withheld/.test(text)) throw new Error('no withheld notice shown');
  if (!/2 more/.test(text)) throw new Error('does not say how many more are needed');
  // The counts must remain, so cadre can still chase people.
  if (!/Completion/.test(text)) throw new Error('completion panel disappeared');
});

await step('the withheld form is excluded from the statistics', async () => {
  // "Secret rating" is a 1; if it leaked into the pooled stats it would appear
  // as a rated question row.
  const questions = await page.$$eval('table.table tbody tr td:first-child',
    (n) => n.map((x) => x.textContent.trim()));
  if (questions.includes('Secret rating')) throw new Error('withheld question appears in the stats table');
});

await step('CSV export cannot be used to bypass the threshold', async () => {
  const csv = await page.evaluate(async () => {
    // Intercept the download rather than writing a file.
    const rows = [];
    const realCreate = URL.createObjectURL;
    let captured = '';
    URL.createObjectURL = (blob) => { rows.push(blob); return realCreate.call(URL, blob); };
    const btns = [...document.querySelectorAll('button')];
    const exportBtn = btns.find((b) => /Export CSV/.test(b.textContent));
    exportBtn.click();
    await new Promise((r) => setTimeout(r, 600));
    URL.createObjectURL = realCreate;
    for (const blob of rows) captured += await blob.text();
    return captured;
  });
  if (csv.includes('CANARY-SECRET-COMMENT')) throw new Error('WITHHELD DATA LEAKED VIA CSV EXPORT');
});

await step('results are released once the threshold is met', async () => {
  await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    for (const [user, rating] of [['brooks.dan', 5], ['chen.li', 9]]) {
      await m.db.saveResponse({
        requestId: 'req_thin', formId: 'form_thin', anonymous: true,
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        answers: { tq1: rating, tq2: `comment from ${user}` },
      });
      await m.db.addReceipt('req_thin', user);
    }
  });
  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.stack-lg', { timeout: 12000 });
  await page.waitForTimeout(1200);

  const text = await page.textContent('#view');
  if (!text.includes('CANARY-SECRET-COMMENT')) throw new Error('results still withheld at 3 responses');
  if (/Results withheld/.test(text)) throw new Error('still showing the withheld notice');
});

await step('attributed feedback is never withheld', async () => {
  await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const form = await m.db.saveForm({
      id: 'form_named', name: 'Named Feedback',
      sections: [{ title: 'Named', items: [
        { id: 'nq1', type: 'text', label: 'Comment', required: false, rows: 3, wordLimit: 250 },
      ] }],
    });
    await m.db.saveRequest({
      id: 'req_named', feedbackId: 'FB-2026-9002', title: 'Named Feedback',
      formId: form.id, asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      anonymous: false, status: 'open', assignedUsernames: [],
    });
    await m.db.saveResponse({
      requestId: 'req_named', formId: form.id, anonymous: false,
      respondent: { username: 'alvarez.mia', name: 'Alvarez, Mia' },
      asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      answers: { nq1: 'NAMED-SINGLE-RESPONSE' },
    });
  });
  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.stack-lg', { timeout: 12000 });
  await page.waitForTimeout(1200);
  const text = await page.textContent('#view');
  if (!text.includes('NAMED-SINGLE-RESPONSE')) {
    throw new Error('attributed feedback was withheld — it should not be');
  }
});


/* ---------- concurrency ---------- */

await step('simultaneous submissions never lose a response or a receipt', async () => {
  const result = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');
    const anchors = { ...c.SCALE_ANCHORS };
    const form = await m.db.saveForm({
      id: 'form_race', name: 'Race Test',
      sections: [{ title: 'Race', items: [
        { id: 'rq1', type: 'scale', label: 'Rating', required: true, min: 1, max: 9, anchors },
      ] }],
    });
    await m.db.saveRequest({
      id: 'req_race', feedbackId: 'FB-2026-9500', title: 'Race Test', formId: form.id,
      asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      anonymous: true, status: 'open', assignedUsernames: [],
    });

    // Twelve cadets hitting Submit at the same moment — the end-of-class case.
    const users = Array.from({ length: 12 }, (_, i) => `racer${String(i).padStart(2, '0')}`);
    await Promise.all(users.map(async (u, i) => {
      await m.db.saveResponse({
        requestId: 'req_race', formId: form.id, anonymous: true,
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        answers: { rq1: (i % 9) + 1 },
      });
      await m.db.addReceipt('req_race', u);
    }));

    const responses = await m.db.listResponses('req_race');
    const receipts = await m.db.listReceipts('req_race');
    const missing = users.filter((u) => !receipts.some((r) => r.username === u));
    return { responses: responses.length, receipts: receipts.length, missing };
  });

  if (result.responses !== 12) throw new Error(`${result.responses}/12 responses survived`);
  if (result.receipts !== 12) throw new Error(`${result.receipts}/12 receipts survived — missing ${result.missing.join(', ')}`);
  console.log(`       12 concurrent submissions -> ${result.responses} responses, ${result.receipts} receipts`);
});

await step('a submission writes only paths nobody else touches', async () => {
  const paths = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const adapter = m.db.adapter;
    const written = [];
    const real = adapter.writeDoc.bind(adapter);
    adapter.writeDoc = (p, d) => { written.push(p); return real(p, d); };
    await m.db.saveResponse({
      requestId: 'req_race', formId: 'form_race', anonymous: true, answers: { rq1: 5 },
    });
    await m.db.addReceipt('req_race', 'racer99');
    adapter.writeDoc = real;
    return written;
  });
  // Both paths must be unique to this student. A shared document would be a
  // path with no id or username in it.
  const shared = paths.filter((p) => p.endsWith('_index.json') || p.endsWith('_counts.json'));
  if (shared.length) throw new Error(`submission wrote shared documents: ${shared.join(', ')}`);
  console.log(`       submission wrote: ${paths.join(', ')}`);
});

await step('a stale index self-heals on read', async () => {
  const result = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');
    // Corrupt the index to look like it predates several submissions.
    await m.db.writeRaw(c.INDEXES.responsesFor('req_race'), {
      requestId: 'req_race', count: 1, responses: [], updatedAt: new Date().toISOString(),
    });
    const rows = await m.db.listResponses('req_race');
    const index = await m.db.readRaw(c.INDEXES.responsesFor('req_race'));
    return { rows: rows.length, indexRows: index.responses.length };
  });
  if (result.rows !== 13) throw new Error(`read returned ${result.rows}, expected 13`);
  if (result.indexRows !== 13) throw new Error('the index was not repaired on disk');
  console.log('       stale index detected and rebuilt from the response files');
});

await step('two admins editing different students both succeed', async () => {
  const result = await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    await a.createAccount({ username: 'race.one', name: 'Race One', roles: ['student'], password: 'cadet123' });
    await a.createAccount({ username: 'race.two', name: 'Race Two', roles: ['student'], password: 'cadet123' });
    const before = (await a.listAccounts()).length;

    // Both admins read, then both write — the classic lost-update setup.
    const one = (await a.listAccounts()).find((u) => u.username === 'race.one');
    const two = (await a.listAccounts()).find((u) => u.username === 'race.two');
    await Promise.all([
      a.updateAccount(one.id, { section: 'Alpha' }),
      a.updateAccount(two.id, { section: 'Bravo' }),
    ]);

    const after = await a.listAccounts();
    return {
      before,
      after: after.length,
      one: after.find((u) => u.username === 'race.one')?.section,
      two: after.find((u) => u.username === 'race.two')?.section,
    };
  });
  if (result.after !== result.before) throw new Error(`account count changed ${result.before} -> ${result.after}`);
  if (result.one !== 'Alpha' || result.two !== 'Bravo') {
    throw new Error(`lost update: one=${result.one} two=${result.two}`);
  }
  console.log('       concurrent account edits both retained');
});

await step('editing a form someone else changed raises a conflict', async () => {
  const result = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const req = await m.db.getRequest('req_race');
    const staleRev = Number(req.rev) || 0;

    // Another instructor saves first.
    await m.db.saveRequest({ ...req, title: 'Changed by someone else' }, { expectRev: staleRev });

    // We then save from the revision we loaded before their change.
    try {
      await m.db.saveRequest({ ...req, title: 'My version' }, { expectRev: staleRev });
      return { threw: false };
    } catch (err) {
      return { threw: true, conflict: Boolean(err.conflict), theirs: err.theirs?.title };
    }
  });
  if (!result.threw) throw new Error('the stale save was allowed through');
  if (!result.conflict) throw new Error('error was not flagged as a conflict');
  if (result.theirs !== 'Changed by someone else') throw new Error(`theirs was "${result.theirs}"`);
  console.log('       conflict raised, with the other version attached');
});

await step('a deliberate overwrite still works after re-reading', async () => {
  const title = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const fresh = await m.db.getRequest('req_race');
    await m.db.saveRequest({ ...fresh, title: 'Overwritten on purpose' },
      { expectRev: Number(fresh.rev) || 0 });
    return (await m.db.getRequest('req_race')).title;
  });
  if (title !== 'Overwritten on purpose') throw new Error(`title is "${title}"`);
});

await step('legacy receipt arrays migrate to per-student files', async () => {
  const result = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');
    await m.db.saveRequest({
      id: 'req_legacy_rcpt', feedbackId: 'FB-2026-9600', title: 'Legacy Receipts',
      formId: 'form_race', asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      anonymous: true, status: 'closed', assignedUsernames: [],
    });
    // Write the v2 shape directly.
    await m.db.writeRaw(c.INDEXES.legacyReceiptsFor('req_legacy_rcpt'), {
      requestId: 'req_legacy_rcpt',
      receipts: [
        { username: 'old.one', submittedAt: '2026-01-05T10:00:00.000Z' },
        { username: 'old.two', submittedAt: '2026-01-05T10:01:00.000Z' },
      ],
    });
    // Un-migrated folders must still block a double submission.
    const beforeMigration = await m.db.hasSubmitted('req_legacy_rcpt', 'old.one');

    await m.db.saveOrg({ schemaVersion: 2 });
    const ran = await m.db.migrate();

    const perFile = await m.db.readRaw(c.INDEXES.receiptFor('req_legacy_rcpt', 'old.one'));
    const listed = await m.db.listReceipts('req_legacy_rcpt');
    return {
      beforeMigration,
      ran: ran.ran,
      perFileExists: Boolean(perFile),
      listed: listed.map((r) => r.username).sort(),
    };
  });
  if (!result.beforeMigration) throw new Error('legacy receipts were not honoured before migrating');
  if (!result.perFileExists) throw new Error('receipt was not split into its own file');
  if (JSON.stringify(result.listed) !== JSON.stringify(['old.one', 'old.two'])) {
    throw new Error(`listed ${JSON.stringify(result.listed)}`);
  }
  console.log(`       ${result.ran.join(' | ')}`);
});


/* ---------- analysis: quantitative + text ---------- */

await step('a rich form is seeded for analysis', async () => {
  await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');
    const anchors = { ...c.SCALE_ANCHORS };
    const form = await m.db.saveForm({
      id: 'form_an', name: 'Analysis Sample',
      sections: [{ title: 'Sample', items: [
        { id: 'aq1', type: 'scale', label: 'Instruction was clear', required: true, min: 1, max: 9, anchors },
        { id: 'aq2', type: 'text', label: 'What should change?', required: false, rows: 3, wordLimit: 250 },
      ] }],
    });
    await m.db.saveRequest({
      id: 'req_an', feedbackId: 'FB-2026-9700', title: 'Analysis Sample', formId: form.id,
      asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      anonymous: true, status: 'open', assignedUsernames: [],
    });
    // A deliberately polarised set with one clear outlier and mixed prose.
    const rows = [
      [9, 'Absolutely excellent instruction, very clear and engaging.'],
      [8, 'Great pace and the drill practice was extremely helpful.'],
      [9, 'Outstanding. Learned a lot about leadership.'],
      [2, 'Disorganised and confusing. A waste of time honestly.'],
      [2, 'The briefings were unclear and frustrating.'],
      [1, 'Poor preparation, felt rushed and pointless.'],
      [8, 'Really enjoyed the labs, thorough and well organised.'],
    ];
    for (const [rating, text] of rows) {
      await m.db.saveResponse({
        requestId: 'req_an', formId: form.id, anonymous: true,
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        answers: { aq1: rating, aq2: text },
      });
    }
    for (let i = 0; i < 7; i++) await m.db.addReceipt('req_an', `anstudent${i}`);
  });

  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hist', { timeout: 15000 });
});

await step('the distribution histogram renders every scale point', async () => {
  const cols = await page.$$eval('.hist', (n) => n[0].querySelectorAll('.hist__col').length);
  if (cols !== 9) throw new Error(`expected 9 columns, saw ${cols}`);
});

await step('a polarised question is called out, not averaged away', async () => {
  const text = await page.textContent('#view');
  if (!/Opinion is split/.test(text)) throw new Error('split not detected in the UI');
  if (!/describes nobody/.test(text)) throw new Error('no explanation of why the mean misleads');
  if (!/Sharply divided|Mixed views/.test(text)) throw new Error('no agreement reading shown');
});

await step('cohort breakdown and rater analysis render', async () => {
  const text = await page.textContent('#view');
  if (!/Breakdown by cohort/.test(text)) throw new Error('no cohort breakdown');
  if (!/Consistently different raters/.test(text)) throw new Error('no rater panel');
});

await step('sentiment tab summarises and ranks answers', async () => {
  const text = await page.textContent('#view');
  if (!/Positive/.test(text) || !/Negative/.test(text)) throw new Error('no sentiment buckets');
  if (!/lexicon count, not comprehension/.test(text)) throw new Error('no accuracy caveat shown');
  // Most negative should be ranked first.
  const first = await page.textContent('.quote');
  if (!/waste of time|pointless|unclear/i.test(first)) {
    throw new Error(`most-negative not first: "${first.slice(0, 60)}"`);
  }
});

await step('word cloud renders and is backed by a table', async () => {
  const tabs = await page.$$('.tabs .tab');
  const cloudTab = await (async () => {
    for (const t of tabs) if ((await t.textContent()).trim() === 'Word cloud') return t;
    return null;
  })();
  if (!cloudTab) throw new Error('no word cloud tab');
  await cloudTab.click();
  await page.waitForSelector('svg.cloud', { timeout: 8000 });
  const words = await page.$$eval('.cloud__word', (n) => n.length);
  if (words < 5) throw new Error(`only ${words} words placed`);
  // The accessible table must carry the same data.
  const rows = await page.$$eval('table.table tbody tr', (n) => n.length);
  if (rows < 5) throw new Error('term table missing or too small');
  const label = await page.getAttribute('svg.cloud', 'aria-label');
  if (!/table below/.test(label || '')) throw new Error('cloud not described for screen readers');
});

await step('selecting a word shows the answers containing it', async () => {
  await page.click('.cloud__word');
  await page.waitForTimeout(500);
  const marks = await page.$$eval('mark', (n) => n.length);
  if (!marks) throw new Error('no highlighted matches shown');
});

await step('a clean safety screen says so honestly', async () => {
  const text = await page.textContent('#view');
  if (!/Safety screen: nothing flagged/.test(text)) throw new Error('no clean-screen notice');
  if (!/not proof that nothing was reported/.test(text)) throw new Error('missing false-negative caveat');
});

await step('safety screen flags a hazing disclosure', async () => {
  await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    await m.db.saveResponse({
      requestId: 'req_an', formId: 'form_an', anonymous: true,
      asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      answers: { aq1: 1, aq2: 'The senior cadet hazed us and made us do push ups until we cried.' },
    });
    await m.db.addReceipt('req_an', 'anstudent9');
  });
  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.quote--flagged', { timeout: 15000 });

  const text = await page.textContent('#view');
  if (!/Hazing and abuse of authority/.test(text)) throw new Error('category not named');
  if (!/flagged for review/.test(text)) throw new Error('no review prompt');
  if (!/not a finding/.test(text)) throw new Error('missing "not a finding" caveat');
  const marks = await page.$$eval('.quote--flagged mark', (n) => n.map((x) => x.textContent.toLowerCase()));
  if (!marks.some((m) => m.includes('hazed'))) throw new Error(`matched terms not highlighted: ${marks}`);
});

await step('a flag on a withheld form alerts without exposing', async () => {
  const result = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');
    const form = await m.db.saveForm({
      id: 'form_thin2', name: 'Thin Flagged',
      sections: [{ title: 'T', items: [
        { id: 'tq', type: 'text', label: 'Anything to raise?', required: false, rows: 3, wordLimit: 250 },
      ] }],
    });
    await m.db.saveRequest({
      id: 'req_thin2', feedbackId: 'FB-2026-9800', title: 'Thin Flagged', formId: form.id,
      asClass: 'AS100', schoolYear: '2026-2027', semester: 'Fall',
      anonymous: true, status: 'open', assignedUsernames: [],
    });
    await m.db.saveResponse({
      requestId: 'req_thin2', formId: form.id, anonymous: true,
      asClass: 'AS100', schoolYear: '2026-2027', semester: 'Fall',
      answers: { tq: 'CANARY2 I was hazed by the flight commander repeatedly.' },
    });
    await m.db.addReceipt('req_thin2', 'thinstudent');
    return true;
  });
  void result;

  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.quote--flagged, .notice--warn', { timeout: 15000 });
  await page.waitForTimeout(800);

  const text = await page.textContent('#view');
  // The alert must exist...
  if (!/withheld for anonymity/.test(text)) throw new Error('no withheld-but-flagged warning');
  if (!/may identify/.test(text)) throw new Error('privacy cost not stated');
  // ...but the content must not be on screen until asked for.
  if (text.includes('CANARY2')) throw new Error('WITHHELD FLAGGED CONTENT SHOWN WITHOUT CONSENT');

  await page.click('button:has-text("Show anyway")');
  await page.waitForTimeout(500);
  const after = await page.textContent('#view');
  if (!after.includes('CANARY2')) throw new Error('content did not appear after explicit consent');
});

/* ---------- form reuse ---------- */

await step('a form can be saved as a template and reused', async () => {
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}#/instructor/create/new`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=password]', { timeout: 8000 });
  await page.fill('input[type=text]', 'Admin');
  await page.fill('input[type=password]', '#admin-Password');
  await page.click('.btn--lg');
  await page.waitForSelector('.qrow', { timeout: 12000 });

  const labels = ['Reusable question one', 'Reusable question two', 'Reusable question three'];
  const rows = await page.$$('.qrow');
  for (let i = 0; i < rows.length; i++) {
    await (await rows[i].$('input.input')).fill(labels[i] || `Q${i}`);
  }
  await page.fill('input[placeholder^="e.g. AS200 Leadership"]', 'Template Source Event');

  await page.click('button:has-text("Save as template")');
  await page.waitForSelector('dialog.modal', { timeout: 8000 });
  await page.fill('dialog input[type=text]', 'Standard block feedback');
  await page.click('dialog .btn--primary');
  await page.waitForTimeout(1500);

  // A fresh form should now offer it under "Start from".
  await page.goto(`${BASE}#/instructor/create/new`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.qrow', { timeout: 12000 });
  const text = await page.textContent('#view');
  if (!/Start from/.test(text)) throw new Error('no "Start from" section on a new form');

  const options = await page.$$eval('select option', (n) => n.map((o) => o.textContent));
  if (!options.some((o) => /Template — Standard block feedback/.test(o))) {
    throw new Error(`template not offered: ${options.slice(0, 6).join(' | ')}`);
  }
});

await step('starting from a template copies the questions, not links them', async () => {
  const selects = await page.$$('select');
  await selects[0].selectOption({ label: 'Template — Standard block feedback' });
  await page.waitForTimeout(1200);

  const values = await page.$$eval('.qrow input.input', (n) => n.map((i) => i.value));
  if (values[0] !== 'Reusable question one') {
    throw new Error(`questions not loaded: ${JSON.stringify(values.slice(0, 3))}`);
  }

  // Editing the copy must not touch the stored template.
  const ids = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const forms = await m.db.listForms();
    const tpl = forms.find((f) => f.isTemplate && f.name === 'Standard block feedback');
    return (tpl.sections[0].items || []).map((i) => i.id);
  });
  const draftIds = await page.evaluate(() =>
    [...document.querySelectorAll('.qrow')].length);
  if (!ids.length || !draftIds) throw new Error('template or draft empty');
  console.log(`       template kept ${ids.length} questions; draft has ${draftIds}`);
});

/* ---------- annual rollover ---------- */

await step('the rollover previews who moves where', async () => {
  await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    for (const [u, cls] of [['roll.a', 'AS100'], ['roll.b', 'AS100'], ['roll.c', 'AS400']]) {
      await a.createAccount({ username: u, name: `Roll ${u}`, roles: ['student'],
                              asClass: cls, password: 'cadet123' });
    }
  });
  await page.goto(`${BASE}#/admin`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.section-title:has-text("Academic year rollover")', { timeout: 12000 });
  await page.waitForTimeout(800);
  const text = await page.textContent('#view');
  if (!/Currently/.test(text)) throw new Error('no preview table');
  if (!/Graduating/.test(text)) throw new Error('AS400 not shown as graduating');
});

await step('advancing the year moves levels and retires AS400', async () => {
  await page.click('button:has-text("Advance the academic year")');
  await page.waitForSelector('dialog.modal', { timeout: 8000 });
  await page.click('dialog .btn--danger');
  await page.waitForTimeout(2500);

  const after = await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    const all = await a.listAccounts();
    const get = (u) => all.find((x) => x.username === u);
    return {
      a: get('roll.a')?.asClass, b: get('roll.b')?.asClass,
      c: get('roll.c')?.asClass, cActive: get('roll.c')?.active,
    };
  });
  if (after.a !== 'AS200' || after.b !== 'AS200') {
    throw new Error(`AS100 did not advance: ${JSON.stringify(after)}`);
  }
  if (after.cActive !== false) throw new Error('graduating cadet was not deactivated');
  if (after.c !== 'AS400') throw new Error('graduating cadet should keep their level, not be blanked');
  console.log('       AS100 -> AS200, AS400 deactivated but retained');
});

/* ---------- audit trail ---------- */

await step('destructive actions are recorded with who did them', async () => {
  const entries = await page.evaluate(async () => {
    const a = await import('/js/audit.js');
    return (await a.recent({ months: 2, limit: 200 })).map((e) => ({
      action: e.action, who: e.actor?.username, summary: e.summary,
    }));
  });
  const actions = entries.map((e) => e.action);
  for (const want of ['account.created', 'roster.rollover']) {
    if (!actions.includes(want)) throw new Error(`${want} not recorded — saw ${[...new Set(actions)].join(', ')}`);
  }
  if (!entries.every((e) => e.who)) throw new Error('an entry has no actor');
  console.log(`       ${entries.length} entries, actions: ${[...new Set(actions)].join(', ')}`);
});

await step('the activity log is visible in the admin console', async () => {
  await page.goto(`${BASE}#/admin`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.section-title:has-text("Activity log")', { timeout: 12000 });
  await page.waitForTimeout(1500);
  const text = await page.textContent('#view');
  if (!/Academic year advanced|Account created/.test(text)) {
    throw new Error('no entries rendered in the activity log');
  }
});

await step('the audit module exposes no way to delete an entry', async () => {
  const exported = await page.evaluate(async () => Object.keys(await import('/js/audit.js')));
  const destructive = exported.filter((k) => /delete|remove|clear|wipe|purge/i.test(k));
  if (destructive.length) throw new Error(`audit exposes ${destructive.join(', ')}`);
});

/* ---------- flagged responses are protected ---------- */

await step('an instructor cannot delete flagged feedback', async () => {
  await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const c = await import('/js/config.js');
    const anchors = { ...c.SCALE_ANCHORS };
    const form = await m.db.saveForm({
      id: 'form_prot', name: 'Protected',
      sections: [{ title: 'P', items: [
        { id: 'pq1', type: 'scale', label: 'Rating', required: true, min: 1, max: 9, anchors },
        { id: 'pq2', type: 'text', label: 'Anything to raise?', required: false, rows: 3, wordLimit: 250 },
      ] }],
    });
    await m.db.saveRequest({
      id: 'req_prot', feedbackId: 'FB-2026-9900', title: 'Protected Form', formId: form.id,
      asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
      anonymous: true, status: 'open', assignedUsernames: [],
    });
    // Three responses so results are not withheld, one of them flagged.
    for (const [rating, text] of [[7, 'All fine.'], [8, 'Good session.'],
      [2, 'PROTECTED-CANARY the flight commander hazed us repeatedly.']]) {
      await m.db.saveResponse({
        requestId: 'req_prot', formId: form.id, anonymous: true,
        asClass: 'AS200', schoolYear: '2026-2027', semester: 'Fall',
        answers: { pq1: rating, pq2: text },
      });
    }
    // Sign in as an instructor who is NOT an admin.
    const a = await import('/js/auth.js');
    await a.createAccount({ username: 'plain.instructor', name: 'Plain Instructor',
                            roles: ['instructor'], password: 'instructor123' });
    a.signOut();
    await a.signIn('plain.instructor', 'instructor123', 'instructor');
  });

  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.list__item', { timeout: 15000 });

  // Open the flagged response from the individual list.
  const items = await page.$$('.list__item');
  let opened = false;
  for (const item of items) {
    await item.click();
    await page.waitForSelector('dialog.modal', { timeout: 8000 });
    const body = await page.textContent('dialog.modal');
    if (/PROTECTED-CANARY/.test(body)) { opened = true; break; }
    await page.click('dialog .btn:has-text("Close")');
    await page.waitForTimeout(300);
  }
  if (!opened) throw new Error('could not open the flagged response');

  await page.click('dialog .btn--danger');
  await page.waitForSelector('dialog.modal:has-text("cannot be deleted")', { timeout: 8000 });
  const refusal = await page.textContent('dialog.modal');
  if (!/cannot be deleted/.test(refusal)) throw new Error('deletion was not refused');
  if (!/database administrator/i.test(refusal)) throw new Error('no route to escalate offered');
  await page.click('dialog .btn');
  await page.waitForTimeout(400);

  const still = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const rows = await m.db.listResponses('req_prot');
    return rows.some((r) => String(r.answers?.pq2 || '').includes('PROTECTED-CANARY'));
  });
  if (!still) throw new Error('THE FLAGGED RESPONSE WAS DELETED');
});

await step('an admin can delete it, but only with a recorded reason', async () => {
  await page.evaluate(async () => {
    const a = await import('/js/auth.js');
    a.signOut();
    await a.signIn('Admin', '#admin-Password', 'admin');
  });
  await page.goto(`${BASE}#/instructor?tab=analysis`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.list__item', { timeout: 15000 });

  const items = await page.$$('.list__item');
  for (const item of items) {
    await item.click();
    await page.waitForSelector('dialog.modal', { timeout: 8000 });
    if (/PROTECTED-CANARY/.test(await page.textContent('dialog.modal'))) break;
    await page.click('dialog .btn:has-text("Close")');
    await page.waitForTimeout(300);
  }
  await page.click('dialog .btn--danger');
  await page.waitForSelector('dialog.modal:has-text("Delete flagged feedback")', { timeout: 8000 });
  await page.fill('dialog textarea', 'Duplicate of a report already referred to the commander.');
  await page.click('dialog .btn--danger');
  await page.waitForTimeout(2500);

  const gone = await page.evaluate(async () => {
    const m = await import('/js/storage/index.js');
    const rows = await m.db.listResponses('req_prot');
    return !rows.some((r) => String(r.answers?.pq2 || '').includes('PROTECTED-CANARY'));
  });
  if (!gone) throw new Error('admin deletion did not take effect');

  const logged = await page.evaluate(async () => {
    const a = await import('/js/audit.js');
    const rows = await a.recent({ months: 2, limit: 200 });
    return rows.find((e) => e.action === 'response.deleted' && e.reason);
  });
  if (!logged) throw new Error('the deletion was not recorded with a reason');
  if (!/FLAGGED/.test(logged.summary)) throw new Error('the record does not note it was flagged');
  console.log(`       recorded: "${logged.summary}" by ${logged.actor.username}`);
});
await step('mobile: anchored scale does not overflow', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}#/student`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 1) throw new Error(`${over}px overflow`);
});
if (shots) await page.screenshot({ path: `${shots}/m4-mobile.png`, fullPage: true });

await browser.close();
console.log('\n' + (errors.length ? `${errors.length} problem(s):` : 'No runtime errors.'));
for (const e of [...new Set(errors)]) console.log('  - ' + e);
process.exit(errors.length ? 1 : 0);
