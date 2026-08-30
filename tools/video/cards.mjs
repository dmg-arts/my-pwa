/**
 * The still cards the why/how chapter is made of.
 *
 * The walkthrough sections record the real app. The opening chapter cannot —
 * there is no screen that shows "AFROTC uses a centralized detachment model" —
 * so those sections are rendered here instead, as HTML, through the same
 * headless Chrome `build.mjs` already uses to draw title cards.
 *
 * **Words live in `script.mjs`, pictures live here.** A card carries no
 * narration and the narration names no card beyond its key; changing a sentence
 * never means touching this file, and vice versa.
 *
 * Each card is held on screen for exactly as long as its line takes to speak,
 * so a card that gains a bullet does not need a timing change anywhere — but it
 * does need the line to grow with it, or the extra bullet is on screen for no
 * longer than the reader has to read what was already there.
 *
 * Palette is the app's own, as the deck's is. Light ground rather than the
 * title cards' navy: these carry real text, and long white-on-navy paragraphs
 * are harder to read at a distance than the reverse.
 */

const SHELL = `
  html, body { margin: 0; height: 100%; }
  body {
    width: 1920px; height: 1080px; box-sizing: border-box;
    padding: 96px 120px;
    background: #f7f9fc; color: #14181f;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    display: flex; flex-direction: column;
  }
  .eyebrow {
    font-size: 26px; font-weight: 700; letter-spacing: .14em;
    text-transform: uppercase; color: #1c4f8b; margin-bottom: 26px;
  }
  h1 { font-size: 74px; line-height: 1.06; margin: 0 0 18px; letter-spacing: -.02em; }
  .sub { font-size: 34px; color: #55606e; margin: 0 0 18px; }
  /* margin-top rather than a margin on .sub, because not every card has one and
     without it the first line sits directly under the heading. align-items
     centre so a short column and a tall diagram share a middle instead of both
     hugging the top of a 1080-tall frame. */
  .cols {
    display: flex; gap: 72px; flex: 1;
    align-items: center; margin-top: 34px;
  }
  .col { flex: 1; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { font-size: 34px; line-height: 1.4; margin-bottom: 30px; }
  li .under { display: block; font-size: 27px; color: #55606e; margin-top: 8px; }
  .panel {
    background: #ecf2fa; border-radius: 18px; padding: 44px 48px;
  }
  .panel h2 { font-size: 30px; color: #1c4f8b; margin: 0 0 26px; letter-spacing: .01em; }
  .panel p { font-size: 30px; line-height: 1.4; margin: 0 0 22px; }
  .panel p:last-child { margin-bottom: 0; }
  .lead { font-weight: 650; }
  svg { display: block; }
`;

const shell = (eyebrow, h1, sub, body) => `
  <style>${SHELL}</style>
  <div class="eyebrow">${eyebrow}</div>
  <h1>${h1}</h1>
  ${sub ? `<p class="sub">${sub}</p>` : ''}
  ${body}`;

/**
 * One detachment, several universities, and no system common to them.
 *
 * Drawn rather than described because the shape *is* the argument: four schools
 * feeding one unit is why no single school's IT can serve it, and a reader sees
 * that faster than they read it.
 */
const crosstownSVG = `
<svg width="760" height="420" viewBox="0 0 760 420" role="img"
     aria-label="Four Crosstown universities feeding one detachment, with no shared IT system">
  <defs>
    <marker id="a" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="#9aa6b4"/>
    </marker>
  </defs>
  ${[0, 1, 2, 3].map((i) => {
    const x = 20 + i * 182;
    return `<rect x="${x}" y="18" width="158" height="66" rx="10" fill="#fff" stroke="#d3dce8" stroke-width="2"/>
      <text x="${x + 79}" y="49" text-anchor="middle" font-size="21" font-weight="600" fill="#14181f"
            font-family="-apple-system,Helvetica Neue,Arial">University ${i + 1}</text>
      <text x="${x + 79}" y="72" text-anchor="middle" font-size="17" fill="#8a939f"
            font-family="-apple-system,Helvetica Neue,Arial">its own IT system</text>
      <line x1="${x + 79}" y1="92" x2="380" y2="196" stroke="#9aa6b4" stroke-width="2"
            marker-end="url(#a)"/>`;
  }).join('')}
  <rect x="212" y="206" width="336" height="86" rx="12" fill="#1c4f8b"/>
  <text x="380" y="242" text-anchor="middle" font-size="27" font-weight="700" fill="#fff"
        font-family="-apple-system,Helvetica Neue,Arial">One AFROTC detachment</text>
  <text x="380" y="273" text-anchor="middle" font-size="20" fill="#c9d8ec"
        font-family="-apple-system,Helvetica Neue,Arial">serving all of their cadets</text>

  <rect x="212" y="326" width="336" height="64" rx="12" fill="#fff" stroke="#d3dce8"
        stroke-width="2" stroke-dasharray="7 6"/>
  <text x="380" y="365" text-anchor="middle" font-size="22" fill="#8a939f"
        font-family="-apple-system,Helvetica Neue,Arial">no system common to them</text>
  <line x1="380" y1="292" x2="380" y2="326" stroke="#9aa6b4" stroke-width="2" marker-end="url(#a)"/>
</svg>`;

/**
 * Where the data sits, and what is deliberately absent from the middle.
 *
 * The empty slot is the whole point of the picture, so it is drawn as a real
 * gap with a dashed outline rather than left out — an absence you can see is an
 * argument; an absence you cannot see is just a diagram with two boxes.
 */
const ownershipSVG = `
<svg width="780" height="330" viewBox="0 0 780 330" role="img"
     aria-label="The app in a browser, the data in your own Drive, and no vendor server between them">
  <defs>
    <marker id="b" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="#9aa6b4"/>
    </marker>
  </defs>
  <rect x="10" y="40" width="250" height="112" rx="12" fill="#fff" stroke="#d3dce8" stroke-width="2"/>
  <text x="135" y="82" text-anchor="middle" font-size="24" font-weight="700" fill="#14181f"
        font-family="-apple-system,Helvetica Neue,Arial">The app</text>
  <text x="135" y="112" text-anchor="middle" font-size="19" fill="#55606e"
        font-family="-apple-system,Helvetica Neue,Arial">a web page, in a browser</text>
  <text x="135" y="136" text-anchor="middle" font-size="19" fill="#55606e"
        font-family="-apple-system,Helvetica Neue,Arial">or on a phone home screen</text>

  <rect x="300" y="40" width="180" height="112" rx="12" fill="#fff" stroke="#d3dce8"
        stroke-width="2" stroke-dasharray="7 6"/>
  <text x="390" y="90" text-anchor="middle" font-size="21" font-weight="600" fill="#8a939f"
        font-family="-apple-system,Helvetica Neue,Arial">no vendor</text>
  <text x="390" y="118" text-anchor="middle" font-size="21" font-weight="600" fill="#8a939f"
        font-family="-apple-system,Helvetica Neue,Arial">no server</text>

  <rect x="520" y="40" width="250" height="112" rx="12" fill="#1c4f8b"/>
  <text x="645" y="80" text-anchor="middle" font-size="24" font-weight="700" fill="#fff"
        font-family="-apple-system,Helvetica Neue,Arial">Your Drive folder</text>
  <text x="645" y="110" text-anchor="middle" font-size="19" fill="#c9d8ec"
        font-family="-apple-system,Helvetica Neue,Arial">in the Det Google Account</text>
  <text x="645" y="134" text-anchor="middle" font-size="19" fill="#c9d8ec"
        font-family="-apple-system,Helvetica Neue,Arial">you already own</text>

  <line x1="264" y1="96" x2="296" y2="96" stroke="#9aa6b4" stroke-width="2"/>
  <line x1="484" y1="96" x2="516" y2="96" stroke="#9aa6b4" stroke-width="2" marker-end="url(#b)"/>

  <rect x="10" y="206" width="760" height="104" rx="12" fill="#ecf2fa"/>
  <text x="44" y="252" font-size="23" font-weight="700" fill="#1c4f8b"
        font-family="-apple-system,Helvetica Neue,Arial">The app can only reach files it created itself.</text>
  <text x="44" y="286" font-size="21" fill="#14181f"
        font-family="-apple-system,Helvetica Neue,Arial">The rest of that Google account was never granted — not withheld by policy.</text>
</svg>`;

export const CARDS = {
  problem: shell('Why it exists', 'A detachment cannot run on a university&rsquo;s system',
    'Which is the reason none of the ordinary tooling fits.', `
    <div class="cols">
      <div class="col">${crosstownSVG}</div>
      <div class="col">
        <ul>
          <li>AFROTC is a <strong>centralized detachment model</strong>.
            <span class="under">One host facility, cadets from several Crosstown universities.</span></li>
          <li>So no one university&rsquo;s IT system can serve it.
            <span class="under">It has cadets at schools that system has never heard of.</span></li>
          <li>So the detachment stands up a <strong>Det Google Account</strong>.
            <span class="under">Which solves communications, and loses everything else.</span></li>
        </ul>
      </div>
    </div>`),

  costs: shell('Why it exists', 'What that costs', null, `
    <div class="cols">
      <div class="col">
        <ul>
          <li>No feedback system standardized across detachments.</li>
          <li>Aerospace Studies runs through host university systems, with varying degrees of return.</li>
        </ul>
      </div>
      <div class="col">
        <ul>
          <li><strong>Leadership Laboratory has no capture at all.</strong>
            <span class="under">The part of the program where cadets lead cadets.</span></li>
          <li>Upperclassmen improvise on personal accounts.
            <span class="under">No oversight, no archive, gone at graduation.</span></li>
        </ul>
      </div>
    </div>`),

  instructors: shell('Why it exists',
    'Cadets are required to instruct. Nothing certifies them to.', null, `
    <div class="cols">
      <div class="col">
        <ul>
          <li>AFROTC requires upperclassmen to instruct lowerclassmen.</li>
          <li>It provides no formal certification process for doing it.
            <span class="under">No baseline, no structured feedback, no record of improvement.</span></li>
          <li>Cadre are accountable for the outcome, working without instruments.</li>
        </ul>
      </div>
      <div class="col">
        <div class="panel">
          <h2>Where feedback stops being admin</h2>
          <p>A cadet instructor who can see how a block landed &mdash; and see it again next
             term, measured the same way &mdash; is being developed.</p>
          <p class="lead">One who cannot is being assigned.</p>
        </div>
      </div>
    </div>`),

  how: shell('How it works', 'Your Google account, and nothing in the middle', null, `
    <div class="cols">
      <div class="col">${ownershipSVG}</div>
      <div class="col">
        <div class="panel">
          <h2>What a detachment runs</h2>
          <p>Records are ordinary files in one Drive folder &mdash; readable in Drive,
             with no special software.</p>
          <p>Cadets get <strong>no Drive access at all</strong>. A small script inside your
             own Google account files their answers for them, so nobody can read anyone
             else&rsquo;s feedback.</p>
          <p>A join link carries the setup, so a cadet taps it, signs in, and is done.</p>
        </div>
      </div>
    </div>`),
};
