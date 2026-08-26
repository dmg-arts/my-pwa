/**
 * Starts a server, runs the end-to-end suite against it, and shuts it down.
 *
 *     npm run test:e2e
 *
 * Kept separate from the suite itself so the suite can also be pointed at a
 * server that is already running, which is faster when iterating:
 *
 *     python3 serve.py --port 8123 --no-open &
 *     node tests/e2e/app.test.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PORT = process.env.PORT || '8123';
const BASE = `http://127.0.0.1:${PORT}/index.html`;

const server = spawn('python3', ['serve.py', '--port', PORT, '--no-open', '--host', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});

const shutdown = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

// Wait for the port rather than sleeping a fixed amount.
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

if (!(await ready())) {
  console.error(`Server never came up on ${BASE}`);
  shutdown();
  process.exit(1);
}

/** Runs one suite against the server already up, resolving to its exit code. */
const run = (file) => new Promise((done) => {
  const suite = spawn(process.execPath, [resolve(HERE, file)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, BASE_URL: BASE },
  });
  suite.on('exit', (code) => done(code ?? 1));
});

// Both share one server. The Drive suite intercepts googleapis.com in the
// browser rather than reaching Google, so it needs nothing else.
let failed = 0;
for (const file of ['app.test.mjs', 'drive.test.mjs']) {
  failed += (await run(file)) === 0 ? 0 : 1;
}
shutdown();
process.exit(failed ? 1 : 0);
