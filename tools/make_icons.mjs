/**
 * Renders the app icon set from one source SVG.
 *
 *     node tools/make_icons.mjs
 *
 * The master is `icons/9thirtyone-icon.svg`. Everything else in `icons/` is
 * generated from it and should not be edited by hand — change the master and
 * re-run.
 *
 * WHAT REPLACED WHAT
 *
 * `tools/make_icons.py` drew the previous icon — a checkmark — with signed
 * distance functions and no dependencies, which was a good answer when the icon
 * was two shapes and a rounded rectangle. It cannot draw this one, and worse, it
 * would happily overwrite it: `npm run icons` on the old script silently
 * restored the old design over the new files.
 *
 * So this renders the real SVG through the browser that is already a dev
 * dependency for the screenshot and PDF tooling. No new dependency, and the
 * output is whatever a browser actually shows rather than a second
 * implementation of the artwork that can drift from it.
 *
 * THE MASKABLE ONE IS NOT JUST A RESIZE
 *
 * Android crops adaptive icons to a shape it chooses — circle, squircle,
 * teardrop, depending on the launcher — and anything outside the middle 80% can
 * be cut. So that variant is rendered differently on purpose: the background
 * bleeds to the edge with no rounded corners, because the platform supplies the
 * corners, and the artwork is scaled into the safe zone. Shipping the ordinary
 * icon as maskable is why so many Android home screens show a logo with its
 * edges sliced off.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = resolve(HERE, '../icons');
const MASTER = resolve(ICONS, '9thirtyone-icon.svg');

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => existsSync(p));

const source = readFileSync(MASTER, 'utf8');

/** The artwork inside the master, without its own background rectangle. */
const artwork = source
  .replace(/^[\s\S]*?<rect[^>]*\/>/, '')       // drop the rounded background
  .replace(/<\/svg>\s*$/, '')
  .trim();

/** The background colour the master paints, so the bleed matches it exactly. */
const background = /<rect[^>]*fill="([^"]+)"/.exec(source)?.[1] || '#120A8F';

/** The master's coordinate system, so the scaling below is not guesswork. */
const box = /viewBox="0 0 (\d+) (\d+)"/.exec(source);
const [W, H] = box ? [Number(box[1]), Number(box[2])] : [240, 240];

/**
 * A full-bleed variant with the artwork inside Android's safe zone.
 *
 * 80% is the documented safe area: the launcher may crop to a circle inscribed
 * in the icon, so anything beyond that radius is not guaranteed to survive.
 */
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="${background}"/>
  <g transform="translate(${W * 0.1} ${H * 0.1}) scale(0.8)">${artwork}</g>
</svg>`;

const TARGETS = [
  { file: 'icon-192.png', size: 192, svg: source },
  { file: 'icon-512.png', size: 512, svg: source },
  { file: 'icon-1024.png', size: 1024, svg: source },
  // iOS applies its own rounded mask and does not respect transparency, so the
  // apple-touch icon wants the square artwork rather than the maskable one.
  { file: 'icon-180.png', size: 180, svg: source },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable },
];

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

for (const { file, size, svg } of TARGETS) {
  const ctx = await browser.newContext({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${
      svg.replace(/width="\d+"\s+height="\d+"/, `width="${size}" height="${size}"`)}`,
    { waitUntil: 'load' },
  );
  // Fonts have to be settled before the text in the artwork is rasterised.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(ICONS, file), omitBackground: true });
  await ctx.close();
  console.log(`  ${file}  ${size}x${size}`);
}

await browser.close();

// The favicon and the manifest's scalable entry both point at icon.svg, so it
// is generated rather than kept as a second hand-edited copy that can drift.
writeFileSync(resolve(ICONS, 'icon.svg'), source);
console.log('  icon.svg  (copied from the master)');
