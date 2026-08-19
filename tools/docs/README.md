# Regenerating the documents

Both files in `docs/` are generated from the running app, so every screenshot
shows real behaviour with seeded data rather than a mock-up.

These scripts are for maintainers and are **not** needed to run TOP-Feedback.
They have dependencies the app itself does not: Playwright with a Chrome
binary, and `python-pptx`.

## 1. Screenshots

Start the dev server, then drive the app through a scripted session:

```bash
python3 serve.py --port 8123 --no-open &
npm install playwright                     # once
node tools/docs/capture-screenshots.mjs ./shots
```

The script completes the setup wizard, signs in a founding instructor the way
Google's callback does, seeds a detachment with eight cadets and a form with a
deliberately polarised set of responses, and captures each screen.

For the sign-in screenshot it temporarily sets a Client ID so Google's own button
renders — these captures run on the local backend, which has none — and clears it
straight afterwards. Everything else is real behaviour with seeded data.

## 2. The setup guide (PDF)

`setup-guide.html` is written print-first — page breaks, running footer,
Letter margins — and Chrome is the renderer those rules were tuned against:

```bash
node tools/docs/build-guide.mjs ./shots docs/TOP-Feedback-Setup-Guide.pdf
```

It inlines the two screenshot placeholders (`SHOT_SETUP_STORAGE`,
`SHOT_SETUP_FOLDERS`) as data URIs and prints through Chrome's own engine.

Two layout rules to know before editing the HTML. `ol.steps > li > strong` is a
**block-level step heading**, so a bold phrase in the middle of a sentence breaks
onto its own line — lead with it, or use `<em>`. And check the result: run
`pdftoppm -png` over the pages you changed and look at them. The last two
regressions in this document were both invisible in the source.

## 3. The introduction deck (PPTX)

```bash
python3 -m venv .venv && .venv/bin/pip install python-pptx
.venv/bin/python tools/docs/build-deck.py ./shots docs/TOP-Feedback-Introduction.pptx
```

Slide layouts, colours and speaker notes all live in that one file. It uses the
app's own palette so the deck and the product read as one thing.

## Keeping them honest

Both documents state how sign-in works, the three-response disclosure threshold,
and the limits of the safety screen. If any of those change in `js/config.js`,
update the documents in the same commit — a setup guide that contradicts the app
is worse than none.
