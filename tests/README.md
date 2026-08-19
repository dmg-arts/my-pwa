# Tests

The app itself has **no dependencies and no build step** — that has not changed.
`package.json` exists only to pin the test tooling and give the commands names.
Nothing in `js/` imports anything from `node_modules`.

## Running them

```bash
npm run test:unit                     # ~1 second, no browser needed
npm install                           # once, for the browser suite
npm test                              # both
```

`npm run test:e2e` starts its own server on port 8123 and shuts it down
afterwards. When iterating it is faster to leave one running:

```bash
python3 serve.py --port 8123 --no-open &
node tests/e2e/app.test.mjs
```

## What is covered, and why these things

The suite is deliberately weighted toward guarantees that **fail silently**.
A broken button is obvious the first time someone clicks it; a lost receipt or
a leaked username is not, and may not surface for a term.

| Area | What is asserted |
|---|---|
| Anonymity | A stored response contains no username while its receipt does. A canary string in a withheld response is absent from the page *and* the CSV export, then present once the threshold is met. |
| One submission per cadet | A second attempt is refused at the form. |
| Disclosure threshold | Anonymous results stay hidden below three responses; attributed feedback is never withheld. |
| Concurrent writes | Twelve simultaneous submissions produce twelve responses and twelve receipts. A submission writes only paths unique to that student. Two admins editing different accounts both succeed. |
| Self-healing indexes | A deliberately corrupted index is rebuilt from the response files on the next read. |
| Schema migrations | A fabricated v1 folder migrates forward, is idempotent on a second run, and a folder claiming a newer version refuses to load. |
| Access control | Every gated route rejects a signed-out session and an account without the role, including deep links. |
| Google identity | A malformed, expired, unverified or misdirected ID token is refused; a valid one yields a lowercased email and an intact non-ASCII name. |
| The roster | An empty folder is claimed by the first sign-in and closes behind it; an unknown email is turned away; a deactivated account cannot sign in; changing someone's email leaves the handle their receipts are filed under alone. |
| Offline queue | A write that fails is queued and drains on reconnect. |
| Read amplification | `db.stats()` stays under a fixed number of document reads regardless of how much feedback exists. |
| Analysis | The scale renders words and never digits; the mean is reported back in words; statistics refuse to compute below their minimum sample. |

The unit files additionally check the maths, the lexicons and the token decoder
directly: a polarised set is detected as split, a lone dissenter is flagged,
benign text is *not* flagged, negation flips sentiment, and a clause break stops
a negation reaching across it.

**Why sign-in is split across the two suites.** Google will not issue an ID
token to an automated browser — that is an anti-automation measure on their side,
not a gap in the app. So `tests/unit/identity.test.mjs` covers the decode and its
refusals with fabricated tokens, and the browser suite calls `signInWithGoogle`
with an already-decoded profile, exactly as the real callback does. The one thing
neither can cover is a real click on Google's button; that has to be done by
hand, once, against a real Client ID.

## When you change something

- Touched `js/analysis/` → run the unit file first, it is instant.
- Touched storage, auth or a view → run the full suite. The concurrency and
  anonymity assertions are the ones worth waiting for.
- Changed the disclosure threshold or the scale wording → the tests assert the
  current values and will fail. Update them in the same commit, and update
  `docs/` too.
