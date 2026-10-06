// Rate limiter: unit behaviour plus the public API limit end-to-end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { rateLimit, MemoryStore } from '../server/middleware/rateLimit.js';
import { errorHandler } from '../server/middleware/errors.js';
import { createLogger } from '../server/lib/logger.js';
import { startApp } from './helpers.js';

const silent = createLogger({ level: 'silent' });

// A tiny app with one limited route, a controllable clock and a fake client IP.
async function limitedApp(options) {
  let clock = 0;
  let ip = '1.1.1.1';
  const limited = [];
  const store = new MemoryStore();
  const app = express();
  app.use((req, res, next) => { Object.defineProperty(req, 'ip', { value: ip }); next(); });
  app.get('/x', rateLimit({ name: 't', store, now: () => clock, onLimited: (i) => limited.push(i), ...options }), (req, res) => res.json({ ok: true }));
  app.use(errorHandler({ logger: silent, pages: { notFound: '', serverError: '' } }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/x`;
  return {
    hit: () => fetch(url, { headers: { accept: 'application/json' } }),
    advance: (ms) => { clock += ms; },
    setIp: (v) => { ip = v; },
    limited,
    close: () => { store.close(); server.closeAllConnections(); server.close(); },
  };
}

test('allows `max` requests per window, then answers 429 with Retry-After', async () => {
  const t = await limitedApp({ windowMs: 60_000, max: 3 });
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await t.hit()).status, 200);
    const blocked = await t.hit();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');
    assert.equal((await blocked.json()).error, 'too_many_requests');
    assert.equal(t.limited.length, 1, 'the limit event is logged once');
    await t.hit();
    assert.equal(t.limited.length, 1);
  } finally {
    t.close();
  }
});

test('the window resets, and different IPs are counted separately', async () => {
  const t = await limitedApp({ windowMs: 60_000, max: 2 });
  try {
    await t.hit(); await t.hit();
    assert.equal((await t.hit()).status, 429);
    t.setIp('2.2.2.2');
    assert.equal((await t.hit()).status, 200, 'another visitor is unaffected');
    t.setIp('1.1.1.1');
    t.advance(60_001);
    assert.equal((await t.hit()).status, 200, 'allowed again after the window');
  } finally {
    t.close();
  }
});

test('blockMs keeps an abuser locked out beyond the window', async () => {
  const t = await limitedApp({ windowMs: 60_000, max: 2, blockMs: 15 * 60_000 });
  try {
    await t.hit(); await t.hit();
    const blocked = await t.hit();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), String(15 * 60));
    t.advance(60_001);
    assert.equal((await t.hit()).status, 429, 'still blocked after the normal window');
    t.advance(15 * 60_000);
    assert.equal((await t.hit()).status, 200);
  } finally {
    t.close();
  }
});

test('the store forgets expired entries', () => {
  const store = new MemoryStore();
  store.increment('a', 1000, 0);
  store.increment('b', 5000, 0);
  store.prune(2000);
  assert.deepEqual([...store.entries.keys()], ['b']);
  store.close();
});

test('public API allows 120 requests per minute per IP', async () => {
  const app = await startApp();
  try {
    const statuses = [];
    for (let i = 0; i < 121; i += 1) statuses.push((await app.get('/api/site')).status);
    assert.ok(statuses.slice(0, 120).every((s) => s === 200));
    assert.equal(statuses[120], 429);
    assert.equal((await app.get('/')).status, 200, 'pages are not rate limited');
    assert.ok(app.logs.some((l) => l.msg === 'rate limit exceeded'));
  } finally {
    await app.close();
  }
});
