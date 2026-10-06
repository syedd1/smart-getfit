// The entry point (server/main.js) must open its port quickly and start the site however
// a hosting platform launches it — directly, or by importing it from its own loader.
// (An earlier "only start if run directly" check silently did nothing under a loader.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'server', 'main.js');

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// Launch `args` as a child process; resolves with the statuses seen while it started.
async function launch(args, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgfn-main-'));
  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: path.join(dir, 'site.db'), UPLOAD_DIR: path.join(dir, 'uploads'), LOG_LEVEL: 'info', ...extraEnv },
  });
  child.stdout.on('data', (d) => output.push(String(d)));
  child.stderr.on('data', (d) => output.push(String(d)));
  let hasExited = false;
  const exited = new Promise((resolve) => child.on('exit', (code) => { hasExited = true; resolve(code); }));

  const statuses = [];
  const started = Date.now();
  let firstAnswerMs = null;
  while (!hasExited && Date.now() - started < 15_000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      firstAnswerMs ??= Date.now() - started;
      statuses.push(res.status);
      if (res.status === 200) break;
    } catch { /* port not open yet */ }
    await new Promise((r) => setTimeout(r, 10));
  }
  return {
    statuses, firstAnswerMs, port, output: () => output.join(''), exited,
    async stop() {
      child.kill();
      await exited;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('server/main.js starts when run directly, answering "starting" until the site is ready', async () => {
  const run = await launch([MAIN]);
  try {
    assert.equal(run.statuses.at(-1), 200, `never became ready:\n${run.output()}`);
    assert.match(run.output(), /"msg":"server started"/);
    const home = await fetch(`http://127.0.0.1:${run.port}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Fuel Your/);
  } finally {
    await run.stop();
  }
});

test('it also starts when a platform loader imports it (process.argv[1] is not main.js)', async () => {
  const loaderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgfn-loader-'));
  const loader = path.join(loaderDir, 'loader.mjs');
  fs.writeFileSync(loader, `process.argv[1] = '/opt/platform/loader.js';\nawait import(${JSON.stringify(pathToFileURL(MAIN).href)});\n`);
  const run = await launch([loader]);
  try {
    assert.equal(run.statuses.at(-1), 200, `never became ready under a loader:\n${run.output()}`);
    assert.match(run.output(), /"msg":"server started"/);
  } finally {
    await run.stop();
    fs.rmSync(loaderDir, { recursive: true, force: true });
  }
});

test('invalid configuration stops the process with the reason instead of hanging', async () => {
  const run = await launch([MAIN], { NODE_ENV: 'production', SESSION_SECRET: 'too-short' });
  try {
    assert.equal(await Promise.race([run.exited, new Promise((r) => setTimeout(() => r('still running'), 10_000))]), 1);
    assert.match(run.output(), /SESSION_SECRET must be at least 32 characters/);
  } finally {
    await run.stop();
  }
});

test('import ./index.js alone does not start a server (so tests and tools can import it)', async () => {
  const run = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'server', 'index.js')).href)}); console.log('imported'); process.exit(0)`], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
  });
  assert.equal(run.code, 0);
  assert.match(run.out, /imported/);
  assert.doesNotMatch(run.out, /server started/);
});
