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

The script completes the setup wizard, seeds a detachment with eight cadets and
a form with a deliberately polarised set of responses, and captures each screen.

## 2. The setup guide (PDF)

`setup-guide.html` is written print-first — page breaks, running footer,
Letter margins. Chrome's print engine renders it:

```bash
node -e "…"   # see the pdf() call in the project history, or:
```

Open `setup-guide.html` in Chrome and use **Print → Save as PDF**, with
background graphics enabled and margins set to Default. Two screenshot
placeholders (`SHOT_SETUP_STORAGE`, `SHOT_SETUP_FOLDERS`) must be replaced with
image paths or data URIs first.

## 3. The introduction deck (PPTX)

```bash
python3 -m venv .venv && .venv/bin/pip install python-pptx
.venv/bin/python tools/docs/build-deck.py ./shots docs/TOP-Feedback-Introduction.pptx
```

Slide layouts, colours and speaker notes all live in that one file. It uses the
app's own palette so the deck and the product read as one thing.

## Keeping them honest

Both documents state the built-in administrator credential, the three-response
disclosure threshold, and the limits of the safety screen. If any of those
change in `js/config.js`, update the documents in the same commit — a setup
guide that contradicts the app is worse than none.
