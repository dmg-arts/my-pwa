# Tests

The app itself has **no dependencies and no build step** — that has not changed.
`package.json` exists only to pin the test tooling and give the commands names.
Nothing in `js/` imports anything from `node_modules`.

## Running them

```bash
node tests/unit/analysis.test.mjs     # ~1 second, no browser needed
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
| Access control | Every gated route rejects a wrong password and a signed-out session, including deep links. |
| Offline queue | A write that fails is queued and drains on reconnect. |
| Read amplification | `db.stats()` stays under a fixed number of document reads regardless of how much feedback exists. |
| Analysis | The scale renders words and never digits; the mean is reported back in words; statistics refuse to compute below their minimum sample. |

The unit file additionally checks the maths and the lexicons directly: a
polarised set is detected as split, a lone dissenter is flagged, benign text is
*not* flagged, negation flips sentiment, and a clause break stops a negation
reaching across it.

## When you change something

- Touched `js/analysis/` → run the unit file first, it is instant.
- Touched storage, auth or a view → run the full suite. The concurrency and
  anonymity assertions are the ones worth waiting for.
- Changed the disclosure threshold, the scale wording or the built-in admin
  credential → the tests assert the current values and will fail. Update them in
  the same commit, and update `docs/` too.
