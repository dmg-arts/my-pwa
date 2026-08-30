/**
 * Turns the recorded clips into the finished video.
 *
 *     node tools/video/build.mjs
 *
 * Needs `record.mjs` to have run first. Writes
 * `tools/video/out/9thirtyone-walkthrough.mp4`.
 *
 * WHAT THIS DOES, IN ORDER
 *
 *   1. Speaks each narration line with `say`, and measures how long it took.
 *   2. Renders a title card per titled section, in the app's own type and
 *      colours, through the browser rather than ffmpeg's text drawing.
 *   3. Fits each clip to its narration — see below.
 *   4. Concatenates everything and muxes the audio.
 *
 * THE FOOTAGE FITS THE WORDS, NOT THE OTHER WAY ROUND
 *
 * A section's clip and its narration are recorded independently and will never
 * be the same length. Cutting narration to fit footage would mean rewriting the
 * script every time a hold changes; speeding footage up to fit narration looks
 * frantic.
 *
 * So a clip shorter than its line is extended by **holding its last frame**,
 * which reads as the presenter pausing on the result, and a clip longer than its
 * line keeps playing under silence. Both are what a person editing this by hand
 * would do, and it means editing a sentence in `script.mjs` changes that
 * section's length and nothing else.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SECTIONS, spoken } from './script.mjs';
import { CARDS } from './cards.mjs';

const OUT = path.resolve('tools/video/out');
const RAW = path.join(OUT, 'raw');
const WORK = path.join(OUT, 'work');
const FINAL = path.join(OUT, '9thirtyone-walkthrough.mp4');

/**
 * Chosen from the voices installed here.
 *
 * Was Daniel (en_GB), the best of the *legacy* voices and still audibly a 2010
 * satnav. Allison is one of Apple's Enhanced voices, and en_US, which suits an
 * AFROTC audience better anyway. `say -v '?'` lists what is installed; the
 * Premium voices are a further step up and download by hand from System
 * Settings → Accessibility → Spoken Content → System Voice → Manage Voices.
 */
const VOICE = process.env.VOICE || 'Allison (Enhanced)';

/** System Chrome, as the recorder uses — Playwright's own build is not installed. */
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
/**
 * Words per minute. 168 is this voice's brisk end and read as hurried against
 * screens a viewer is also trying to look at; 152 leaves room to watch.
 */
const WPM = process.env.WPM || '152';

const W = 1920;
const H = 1080;
const TITLE_SECONDS = 2.6;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const ff = (args) => run('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const seconds = (file) =>
  Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file]).toString().trim());

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

/* ------------------------------------------------------------------ *
 * 1. narration
 * ------------------------------------------------------------------ */

console.log(`Narrating with "${VOICE}" at ${WPM} words per minute`);
for (const section of SECTIONS) {
  const aiff = path.join(WORK, `${section.id}.aiff`);
  const wav = path.join(WORK, `${section.id}.wav`);
  run('say', ['-v', VOICE, '-r', WPM, '-o', aiff, spoken(section)]);
  // A short lead-in and tail so lines do not start on the cut.
  ff(['-i', aiff, '-af', 'adelay=450|450,apad=pad_dur=0.9', '-ar', '48000', '-ac', '2', wav]);
  fs.rmSync(aiff, { force: true });
  section.audio = wav;
  section.spokenFor = seconds(wav);
  console.log(`  ${section.id.padEnd(19)} ${section.spokenFor.toFixed(1)}s`);
}

/* ------------------------------------------------------------------ *
 * 2. title cards
 * ------------------------------------------------------------------ */

const titled = SECTIONS.filter((s) => s.title);
const carded = SECTIONS.filter((s) => s.card);
if (titled.length || carded.length) {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();

  // The why chapter's stills. Same browser, same canvas as the title cards —
  // the only difference is that these are held for as long as the line takes
  // rather than a fixed beat, because they carry text a viewer has to read.
  for (const section of carded) {
    const html = CARDS[section.card];
    if (!html) {
      console.error(`  unknown card: "${section.card}" — see tools/video/cards.mjs`);
      process.exit(1);
    }
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(WORK, `${section.id}-card.png`) });
  }
  if (carded.length) console.log(`Cards: ${carded.length}`);

  for (const section of titled) {
    await page.setContent(`
      <style>
        @font-face { font-family: x; src: local("Helvetica Neue"); }
        html,body { margin:0; height:100%; }
        body {
          background:#1c4f8b; color:#fff; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:18px;
          font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;
        }
        h1 { font-size:82px; margin:0; letter-spacing:-.02em; font-weight:700; }
        p  { font-size:34px; margin:0; opacity:.86; font-weight:400; }
        .rule { width:120px; height:3px; background:#fff; opacity:.6; margin-top:10px; }
      </style>
      <h1>${section.title}</h1>
      ${section.subtitle ? `<p>${section.subtitle}</p>` : ''}
      <div class="rule"></div>`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(WORK, `${section.id}-title.png`) });
  }
  await browser.close();
  console.log(`Title cards: ${titled.length}`);
}

/* ------------------------------------------------------------------ *
 * 3. one segment per section
 * ------------------------------------------------------------------ */

const parts = [];
for (const section of SECTIONS) {
  const clip = section.clip ? path.join(RAW, `${section.clip}.webm`) : null;
  if (clip && !fs.existsSync(clip)) {
    console.error(`  missing clip: ${clip} — run record.mjs first`);
    process.exit(1);
  }

  // A title card, silent, ahead of the sections that have one.
  if (section.title) {
    const card = path.join(WORK, `${section.id}-title.mp4`);
    ff(['-loop', '1', '-i', path.join(WORK, `${section.id}-title.png`),
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', String(TITLE_SECONDS), '-r', '30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', card]);
    parts.push(card);
  }

  // A card section is a still under its own narration: no footage to fit, so
  // the length is simply how long the line takes to say.
  if (section.card) {
    const body = path.join(WORK, `${section.id}-body.mp4`);
    ff(['-loop', '1', '-i', path.join(WORK, `${section.id}-card.png`), '-i', section.audio,
      '-t', section.spokenFor.toFixed(2), '-r', '30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', body]);
    parts.push(body);
    console.log(`  ${section.id.padEnd(19)} card              narration ${section.spokenFor.toFixed(1)}s`);
    continue;
  }

  // The phone clip is a tall sliver; centre it on the same canvas as the rest
  // rather than letting the concat stretch it.
  const fit = section.phone
    ? `scale=-2:${H},pad=${W}:${H}:(ow-iw)/2:0:color=0x0d1b2e`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;

  const footage = seconds(clip);
  const needed = section.spokenFor;
  const body = path.join(WORK, `${section.id}-body.mp4`);

  if (needed > footage) {
    // Hold the last frame rather than slow the action down: it reads as a pause
    // on the result, which is what the narration is describing by then.
    ff(['-i', clip, '-i', section.audio,
      '-filter_complex', `[0:v]${fit},tpad=stop_mode=clone:stop_duration=${(needed - footage).toFixed(2)},fps=30[v]`,
      '-map', '[v]', '-map', '1:a', '-t', needed.toFixed(2),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', body]);
  } else {
    // Footage outlasts the words: let it play out under silence.
    ff(['-i', clip, '-i', section.audio,
      '-filter_complex', `[0:v]${fit},fps=30[v];[1:a]apad[a]`,
      '-map', '[v]', '-map', '[a]', '-t', footage.toFixed(2),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', body]);
  }
  parts.push(body);
  console.log(`  ${section.id.padEnd(19)} footage ${footage.toFixed(1)}s  narration ${needed.toFixed(1)}s`);
}

/* ------------------------------------------------------------------ *
 * 4. join it up
 * ------------------------------------------------------------------ */

const list = path.join(WORK, 'concat.txt');
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', list,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', FINAL]);

const total = seconds(FINAL);
const mins = Math.floor(total / 60);
console.log(`\n${FINAL}`);
console.log(`${mins}:${String(Math.round(total % 60)).padStart(2, '0')}  (${total.toFixed(1)}s)`);
// ~6:30: the why chapter, then the walkthrough. Widened from the old 4:30–5:30
// when the opening chapter was added.
if (total < 360 || total > 420) {
  console.log('Not close to six and a half minutes. Read the per-section lines above before');
  console.log('editing anything: a clip section lasts max(footage, narration), so where footage');
  console.log('is the larger number, trimming a sentence changes nothing and the holds in');
  console.log('record.mjs are the lever. Card sections are narration-length by definition.');
}
