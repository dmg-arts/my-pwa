/**
 * Renders tools/docs/setup-guide.html to docs/TOP-Feedback-Setup-Guide.pdf.
 *
 * Chrome's own print engine is used rather than a PDF library: the guide is
 * written print-first (page breaks, running footer, Letter margins) and Chrome
 * is the renderer those rules were tuned against.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SHOTS = process.argv[2] || './shots';
const OUT = process.argv[3] || 'docs/TOP-Feedback-Setup-Guide.pdf';

const dataUri = (name) => {
  const path = `${SHOTS}/${name}`;
  if (!existsSync(path)) throw new Error(`missing screenshot: ${path}`);
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
};

let html = readFileSync('tools/docs/setup-guide.html', 'utf8')
  .replace('SHOT_SETUP_STORAGE', dataUri('setup-2-storage.png'))
  .replace('SHOT_SETUP_FOLDERS', dataUri('setup-3-folders.png'));

const tmp = '/tmp/setup-guide.inlined.html';
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome']
    .find((p) => existsSync(p));
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();
await page.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: OUT, format: 'Letter', printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
console.log('wrote', OUT);
