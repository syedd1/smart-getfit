// Boots the real app on a random port with an in-memory database and a temp upload dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createLogger } from '../server/lib/logger.js';
import { openDatabase, runMigrations } from '../server/db/db.js';
import { loadData } from '../server/services/catalogue.js';
import { renderSite } from '../server/views/index.js';
import { createApp } from '../server/index.js';

export async function startApp(env = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgfn-uploads-'));
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', UPLOAD_DIR: uploadDir, ...env });
  const logs = [];
  const logger = createLogger({ level: 'debug', write: (level, line) => logs.push(JSON.parse(line)) });
  const db = openDatabase(':memory:');
  runMigrations(db);
  const data = loadData({ dataDir: config.dataDir, publicDir: config.publicDir });
  const rendered = renderSite(data, { publicDir: config.publicDir });
  const app = createApp({ config, logger, db, data, rendered });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url, db, config, logs, uploadDir,
    get: (p, init) => fetch(url + p, { redirect: 'manual', ...init }),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

// Environment for a production-mode config that passes validation.
export const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  SITE_URL: 'https://smartgetfit.example.pk',
  ADMIN_USERNAME: 'owner',
  ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
  SESSION_SECRET: 'Zq8vN3kT1pW7rY2mL5xC9bH4dF6gJ0sA',
};
