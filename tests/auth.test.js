// Admin authentication, sessions and CSRF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, adminEnvironment, login, ADMIN, PRODUCTION_ENV } from './helpers.js';
import { hashToken, SESSION_IDLE_MS } from '../server/middleware/auth.js';

const postLogin = (app, body, headers = {}) => app.get('/api/admin/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: app.url, ...headers },
  body: JSON.stringify(body),
});

async function withApp(fn, env = {}) {
  const app = await startApp(await adminEnvironment(env));
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

test('valid login sets a secure session cookie and returns a CSRF token', () => withApp(async (app) => {
  const res = await postLogin(app, ADMIN);
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^sgfn_admin=[A-Za-z0-9_-]{43};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=43200/);
  const body = await res.json();
  assert.equal(body.authenticated, true);
  assert.ok(body.csrfToken.length > 20);

  // Only a hash of the token is stored.
  const token = cookie.split(';')[0].split('=')[1];
  const rows = app.db.prepare('SELECT token_hash FROM sessions').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, hashToken(token));
  assert.notEqual(rows[0].token_hash, token);
  assert.ok(app.logs.some((l) => l.msg === 'admin logged in'));
}));

test('wrong password and wrong username get the same generic 401', () => withApp(async (app) => {
  const badPassword = await postLogin(app, { username: ADMIN.username, password: 'wrong password!!' });
  const badUser = await postLogin(app, { username: 'admin', password: ADMIN.password });
  for (const res of [badPassword, badUser]) {
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.deepEqual(await res.json(), { error: 'invalid_credentials', message: 'Incorrect username or password.' });
  }
  assert.equal(app.logs.filter((l) => l.msg === 'admin login failed').length, 2);
  assert.ok(!JSON.stringify(app.logs).includes('wrong password!!'), 'passwords are never logged');
}));

test('malformed login bodies are rejected', () => withApp(async (app) => {
  assert.equal((await postLogin(app, { username: 'x' })).status, 400);
  assert.equal((await postLogin(app, { username: 'x', password: 'y', admin: true })).status, 400);
  const notJson = await app.get('/api/admin/login', { method: 'POST', headers: { origin: app.url, 'content-type': 'text/plain' }, body: 'username=x' });
  assert.equal(notJson.status, 400);
}));

test('five failed attempts lock the IP out for 15 minutes, even with the right password', () => withApp(async (app) => {
  for (let i = 0; i < 5; i += 1) assert.equal((await postLogin(app, { ...ADMIN, password: `nope-${i}-nope-nope` })).status, 401);
  const locked = await postLogin(app, ADMIN);
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get('retry-after'), String(15 * 60));
  assert.equal((await locked.json()).error, 'too_many_requests');
  assert.ok(app.logs.some((l) => l.msg === 'admin login blocked after repeated attempts'));
}));

test('a successful login resets the failure count', () => withApp(async (app) => {
  for (let i = 0; i < 4; i += 1) await postLogin(app, { ...ADMIN, password: 'not-the-password' });
  assert.equal((await postLogin(app, ADMIN)).status, 200);
  for (let i = 0; i < 4; i += 1) assert.equal((await postLogin(app, { ...ADMIN, password: 'not-the-password' })).status, 401);
}));

test('admin endpoints require a session', () => withApp(async (app) => {
  for (const [method, p] of [['GET', '/api/admin/session'], ['GET', '/api/admin/media'], ['POST', '/api/admin/media'], ['DELETE', '/api/admin/media/1'], ['PUT', '/api/admin/media/reorder'], ['POST', '/api/admin/logout']]) {
    const res = await app.get(p, { method, headers: { origin: app.url } });
    assert.equal(res.status, 401, `${method} ${p}`);
    assert.equal((await res.json()).error, 'unauthenticated');
  }
}));

test('logout ends the session on the server', () => withApp(async (app) => {
  const { send, cookie } = await login(app);
  assert.equal((await send('GET', '/api/admin/session')).status, 200);
  const out = await send('POST', '/api/admin/logout');
  assert.equal(out.status, 204);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(app.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get(), 0);
  const after = await app.get('/api/admin/session', { headers: { cookie } });
  assert.equal(after.status, 401, 'the old cookie no longer works');
}));

test('logging in again replaces the previous session', () => withApp(async (app) => {
  const first = await login(app);
  const res = await postLogin(app, ADMIN, { cookie: first.cookie });
  assert.equal(res.status, 200);
  assert.equal((await app.get('/api/admin/session', { headers: { cookie: first.cookie } })).status, 401);
  assert.equal(app.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get(), 1);
}));

test('idle and expired sessions are rejected and deleted', () => withApp(async (app) => {
  const idle = await login(app);
  app.db.prepare('UPDATE sessions SET last_seen_at = ?').run(Date.now() - SESSION_IDLE_MS - 1000);
  const res = await app.get('/api/admin/session', { headers: { cookie: idle.cookie } });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/, 'the browser is told to drop the cookie');
  assert.equal(app.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get(), 0);

  const old = await login(app);
  app.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await app.get('/api/admin/session', { headers: { cookie: old.cookie } })).status, 401);
}));

test('a forged or garbage cookie is ignored', () => withApp(async (app) => {
  for (const cookie of ['sgfn_admin=' + 'a'.repeat(43), 'sgfn_admin=../../etc', 'sgfn_admin=']) {
    assert.equal((await app.get('/api/admin/session', { headers: { cookie } })).status, 401);
  }
}));

test('state-changing requests need the CSRF token of their own session', () => withApp(async (app) => {
  const a = await login(app);
  const noToken = await app.get('/api/admin/media/1', { method: 'DELETE', headers: { cookie: a.cookie, origin: app.url } });
  assert.equal(noToken.status, 403);
  assert.equal((await noToken.json()).error, 'csrf_failed');

  const wrong = await a.send('DELETE', '/api/admin/media/1', { headers: { 'x-csrf-token': 'x'.repeat(43) } });
  assert.equal(wrong.status, 403);

  // Token from another session (e.g. an old tab) does not work.
  const b = await login(app);
  const crossed = await app.get('/api/admin/logout', { method: 'POST', headers: { cookie: b.cookie, origin: app.url, 'x-csrf-token': a.csrfToken } });
  assert.equal(crossed.status, 403);

  const ok = await b.send('DELETE', '/api/admin/media/1');
  assert.equal(ok.status, 404, 'passes CSRF; the image simply does not exist');
}));

test('cross-site requests are refused before anything else', () => withApp(async (app) => {
  const foreign = await postLogin(app, ADMIN, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, 'cross_origin');

  const crossSite = await app.get('/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(ADMIN),
  });
  assert.equal(crossSite.status, 403);
}));

test('in production the cookie is __Host- prefixed and Secure', async () => {
  const env = await adminEnvironment({ ...PRODUCTION_ENV, ADMIN_PASSWORD_HASH: undefined });
  const app = await startApp({ ...env, ADMIN_PASSWORD_HASH: (await adminEnvironment()).ADMIN_PASSWORD_HASH });
  try {
    const res = await postLogin(app, ADMIN);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /^__Host-sgfn_admin=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
  } finally {
    await app.close();
  }
});

test('the admin API is off when no admin is configured', async () => {
  const app = await startApp();
  try {
    const res = await postLogin(app, ADMIN);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'admin_disabled');
  } finally {
    await app.close();
  }
});

test('stale sessions are swept', () => withApp(async (app) => {
  await login(app);
  await login(app); // second login from a cookieless client → two rows
  app.db.prepare('UPDATE sessions SET expires_at = 0').run();
  assert.equal(app.auth.removeStaleSessions(), 2);
}));
