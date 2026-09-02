/**
 * Renders a print-first HTML document to PDF through Chrome's own engine.
 *
 *     node tools/docs/build-doc.mjs tools/docs/how-to-guide.html docs/9ThirtyOne-How-To-Guide.pdf
 *
 * The generalised sibling of build-guide.mjs. That one is hard-wired to the
 * setup guide and its two placeholders; this one takes any source and resolves
 * placeholders by convention, so a 16:9 deck and a Letter guide share a script.
 *
 * `preferCSSPageSize` is the whole reason one script can do both: geometry comes
 * from each document's own `@page { size: ... }` rule rather than from a flag
 * here, so a document cannot be built at a size its own stylesheet was not
 * written for.
 *
 * Placeholders are `SHOT[path]`, resolved against docs/screens/ then shots/, and
 * `APP_ICON` for the product mark. A miss throws rather than emitting a broken
 * image: a silently missing screenshot in a 30-page PDF is not something anyone
 * notices before it ships.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: build-doc.mjs <source.html> <out.pdf>');
  process.exit(1);
}

const ROOTS = ['docs/screens', 'shots', '.'];

/** Resolves one placeholder path against the image roots, in order. */
const resolveShot = (rel) => {
  for (const root of ROOTS) {
    const path = `${root}/${rel}`;
    if (existsSync(path)) return path;
  }
  throw new Error(`missing image: ${rel} (looked in ${ROOTS.join(', ')})`);
};

const dataUri = (path) =>
  `data:image/png;base64,${readFileSync(path).toString('base64')}`;

let html = readFileSync(SRC, 'utf8');

// Inline every SHOT[...] reference. Counted so the build reports what it embedded.
const wanted = [...html.matchAll(/SHOT\[([^\]]+)\]/g)].map((m) => m[1]);
const unique = [...new Set(wanted)];
for (const rel of unique) {
  const uri = dataUri(resolveShot(rel));
  html = html.replaceAll(`SHOT[${rel}]`, uri);
}

if (html.includes('APP_ICON')) {
  html = html.replaceAll('APP_ICON', dataUri('icons/icon-512.png'));
}

const left = html.match(/SHOT\[[^\]]*\]|APP_ICON/);
if (left) throw new Error(`unresolved placeholder: ${left[0]}`);

const tmp = `/tmp/${basename(SRC, '.html')}.inlined.html`;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome']
    .find((p) => existsSync(p));
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();
await page.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: OUT,
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
console.log(`wrote ${OUT} — ${unique.length} image(s) embedded`);
