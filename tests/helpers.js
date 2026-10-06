// Boots the real app on a random port with an in-memory database and a temp upload dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import argon2 from 'argon2';
import { loadConfig } from '../server/config.js';
import { createLogger } from '../server/lib/logger.js';
import { openDatabase, runMigrations } from '../server/db/db.js';
import { loadData } from '../server/services/catalogue.js';
import { createApp } from '../server/index.js';

export async function startApp(env = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgfn-uploads-'));
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, ...env });
  const logs = [];
  const logger = createLogger({ level: 'debug', write: (level, line) => logs.push(JSON.parse(line)) });
  const db = openDatabase(':memory:');
  runMigrations(db);
  const data = loadData({ dataDir: config.dataDir, publicDir: config.publicDir });
  const { app, auth, media } = createApp({ config, logger, db, data });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url, db, config, logs, uploadDir, auth, media, data,
    get: (p, init) => fetch(url + p, { redirect: 'manual', ...init }),
    files: () => fs.readdirSync(uploadDir).sort(),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (db.open) db.close();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

// Environment for a production-mode config that passes validation.
export const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  SITE_URL: 'https://smartgetfit.example.pk',
  TRUST_PROXY: 'loopback',
  ADMIN_USERNAME: 'owner',
  ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
  SESSION_SECRET: 'Zq8vN3kT1pW7rY2mL5xC9bH4dF6gJ0sA',
};

// A test admin with a real Argon2id hash (low cost so tests stay fast).
export const ADMIN = { username: 'owner', password: 'correct horse battery staple' };
let adminEnv;
export async function adminEnvironment(extra = {}) {
  adminEnv ??= {
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD_HASH: await argon2.hash(ADMIN.password, { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 }),
    SESSION_SECRET: 'Zq8vN3kT1pW7rY2mL5xC9bH4dF6gJ0sA',
  };
  return { ...adminEnv, ...extra };
}

// Logs in and returns helpers that send the session cookie and CSRF token.
export async function login(app, credentials = ADMIN) {
  const res = await app.get('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: app.url },
    body: JSON.stringify(credentials),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await res.json();
  const send = (method, p, { body, json, headers = {} } = {}) => app.get(p, {
    method,
    headers: {
      cookie, origin: app.url, 'x-csrf-token': csrfToken,
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  return { cookie, csrfToken, send };
}
