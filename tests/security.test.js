// Security headers, error responses, uploads serving and production config checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { startApp, PRODUCTION_ENV } from './helpers.js';
import { loadConfig, ConfigError } from '../server/config.js';
import { errorHandler } from '../server/middleware/errors.js';
import { createLogger } from '../server/lib/logger.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('pages carry the security headers and no X-Powered-By', async () => {
  const res = await app.get('/');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('referrer-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('strict-transport-security'), null, 'no HSTS outside production');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS');
});

test('HSTS is sent in production', async () => {
  const prod = await startApp(PRODUCTION_ENV);
  try {
    const res = await prod.get('/');
    assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.match(res.headers.get('content-security-policy'), /upgrade-insecure-requests/);
  } finally {
    await prod.close();
  }
});

test('unknown pages get the HTML 404 page; unknown API paths get JSON', async () => {
  const page = await app.get('/does-not-exist');
  assert.equal(page.status, 404);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /isn&#39;t on the shelf/);

  const api = await app.get('/api/nothing-here');
  assert.equal(api.status, 404);
  assert.deepEqual(await api.json(), { error: 'not_found', message: 'Not found.' });
});

test('API rejects invalid ids and sections', async () => {
  for (const p of ['/api/products/NOT_A_SLUG', '/api/products/..%2f..%2fdata', '/api/media/section/admin', '/api/media/product/nope']) {
    const res = await app.get(p);
    assert.equal(res.status, 404, p);
    assert.equal((await res.json()).error, 'not_found');
  }
});

test('data files and server code are not reachable over HTTP', async () => {
  for (const p of ['/data/site.json', '/server/config.js', '/package.json', '/.env', '/%2e%2e/data/site.json', '/assets/../../data/site.json']) {
    const res = await app.get(p);
    assert.equal(res.status, 404, p);
  }
});

test('uploads: only <hex>-<width>.webp names are served, as image/webp with a sandbox CSP', async () => {
  const name = `${'a'.repeat(32)}-400.webp`;
  fs.writeFileSync(path.join(app.uploadDir, name), Buffer.from('RIFF\0\0\0\0WEBPVP8 '));
  fs.writeFileSync(path.join(app.uploadDir, 'evil.html'), '<script>alert(1)</script>');

  const ok = await app.get(`/uploads/${name}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/webp');
  assert.match(ok.headers.get('content-security-policy'), /sandbox/);
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');

  for (const p of ['/uploads/evil.html', '/uploads/../data/site.json', `/uploads/${name}.html`, '/uploads/']) {
    assert.equal((await app.get(p)).status, 404, p);
  }
});

test('server errors never leak stack traces or messages', async () => {
  const pages = { notFound: 'not found page', serverError: 'server error page' };
  const logs = [];
  const logger = createLogger({ level: 'debug', write: (l, line) => logs.push(line) });
  const broken = express();
  broken.get('/api/boom', () => { throw new Error('SQLITE_ERROR: no such table: secret_stuff at /srv/app/db.js'); });
  broken.get('/boom', () => { throw new Error('ENOENT /home/app/.env'); });
  broken.use(errorHandler({ logger, pages }));
  const server = broken.listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const api = await fetch(`${url}/api/boom`);
    assert.equal(api.status, 500);
    const body = await api.text();
    assert.equal(body, JSON.stringify({ error: 'internal_error', message: 'Something went wrong. Please try again.' }));

    const page = await fetch(`${url}/boom`);
    assert.equal(page.status, 500);
    assert.equal(await page.text(), 'server error page');

    assert.ok(logs.some((l) => l.includes('SQLITE_ERROR')), 'details are logged server-side');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('production refuses to start with missing or weak secrets', () => {
  assert.doesNotThrow(() => loadConfig(PRODUCTION_ENV));
  const cases = [
    [{ SESSION_SECRET: '' }, /SESSION_SECRET is required/],
    [{ SESSION_SECRET: 'short' }, /at least 32 characters/],
    [{ SESSION_SECRET: 'change-me-change-me-change-me-change-me' }, /placeholder/],
    [{ SESSION_SECRET: 'a'.repeat(40) }, /placeholder/],
    [{ ADMIN_PASSWORD_HASH: '' }, /ADMIN_PASSWORD_HASH is required/],
    [{ ADMIN_PASSWORD_HASH: 'plaintext-password' }, /Argon2id/],
    [{ ADMIN_USERNAME: '' }, /ADMIN_USERNAME is required/],
    [{ SITE_URL: 'http://smartgetfit.pk' }, /https/],
    [{ ADMIN_PATH: '/../etc' }, /ADMIN_PATH/],
    [{ PORT: 'eighty' }, /PORT/],
  ];
  for (const [override, message] of cases) {
    assert.throws(() => loadConfig({ ...PRODUCTION_ENV, ...override }), (err) => err instanceof ConfigError && message.test(err.message), JSON.stringify(override));
  }
});

test('empty lines copied from .env.example fall back to defaults', () => {
  const config = loadConfig({ ...PRODUCTION_ENV, LOG_LEVEL: '', HOST: '', PORT: ' ', UPLOAD_MAX_MB: '' });
  assert.equal(config.logLevel, 'info');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.uploadMaxBytes, 8 * 1024 * 1024);
});

test('the logger redacts secrets', () => {
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (l, line) => lines.push(line) });
  logger.info('login', { username: 'owner', password: 'hunter2', sessionToken: 'abc', nested: { cookie: 'sid=1' } });
  assert.doesNotMatch(lines[0], /hunter2|abc|sid=1/);
  assert.match(lines[0], /owner/);
});

test('/healthz reports ok, and 503 when the database is gone', async () => {
  const res = await app.get('/healthz');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');

  const other = await startApp();
  other.db.close();
  const down = await other.get('/healthz');
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { status: 'error', database: 'unavailable' });
  await other.close();
});

test('trailing-slash URLs redirect to the canonical page', async () => {
  const res = await app.get('/products/pre-workout/');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/products/pre-workout');
});

test('admin page: served under ADMIN_PATH, never indexed or cached, previews allowed', async () => {
  const custom = await startApp({ ADMIN_PATH: '/manage-7f3a' });
  try {
    const bare = await custom.get('/manage-7f3a?x=1');
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get('location'), '/manage-7f3a/?x=1');

    const page = await custom.get('/manage-7f3a/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy'), /img-src 'self' blob:/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-inline/);
    const html = await page.text();
    assert.doesNotMatch(html, /<script>|onclick=|style="/, 'no inline script, handlers or styles');

    assert.equal((await custom.get('/manage-7f3a/admin.js')).status, 200);
    assert.equal((await custom.get('/manage-7f3a/../server/config.js')).status, 404);
    assert.equal((await custom.get('/admin/')).status, 404, 'the default path is not served when ADMIN_PATH is changed');

    const site = await custom.get('/');
    assert.doesNotMatch(site.headers.get('content-security-policy'), /blob:/, 'blob: is only allowed on the admin page');
  } finally {
    await custom.close();
  }
});

test('production refuses proxy settings that would break per-visitor rate limits', () => {
  const bad = [
    [{ TRUST_PROXY: 'true' }, /TRUST_PROXY=true/],
    [{ TRUST_PROXY: 'false', HOST: '127.0.0.1' }, /set TRUST_PROXY=loopback/],
    [{ TRUST_PROXY: '', HOST: '127.0.0.1' }, /set TRUST_PROXY=loopback/],
  ];
  for (const [override, message] of bad) {
    assert.throws(() => loadConfig({ ...PRODUCTION_ENV, ...override }), (err) => message.test(err.message), JSON.stringify(override));
  }
  assert.doesNotThrow(() => loadConfig({ ...PRODUCTION_ENV, TRUST_PROXY: 'loopback' }));
  assert.doesNotThrow(() => loadConfig({ ...PRODUCTION_ENV, TRUST_PROXY: '1', HOST: '0.0.0.0' }), 'PaaS: one proxy hop');
  assert.doesNotThrow(() => loadConfig({ ...PRODUCTION_ENV, TRUST_PROXY: 'false', HOST: '0.0.0.0' }), 'directly exposed, no proxy');
});
