// The Smart GetFit Nutrition — single Node process serving the site, API and uploads.
//   createApp() builds the Express app from already-loaded config, data and database (used by tests).
//   start() loads config, data and the database, refusing to start if any is invalid.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { loadConfig, ConfigError, ROOT } from './config.js';
import { createLogger } from './lib/logger.js';
import { openDatabase, runMigrations } from './db/db.js';
import { loadData, DataError } from './services/catalogue.js';
import { createMediaService } from './services/media.js';
import { createLocalStorage } from './services/storage.js';
import { renderSite } from './views/index.js';
import { securityHeaders, contentSecurityPolicy } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { createAuth } from './middleware/auth.js';
import { createCsrf } from './middleware/csrf.js';
import { createPublicRouter } from './routes/public.js';
import { createAdminRouter } from './routes/admin.js';

export function createApp({ config, logger, db, data }) {
  const storage = createLocalStorage({ dir: config.uploadDir });

  // Pages are rendered in memory; any media change re-renders them (takes ~50 ms).
  const rendered = { generation: 0 };
  let media;
  const dataChanged = ['products.json', 'site.json']
    .map((f) => fs.statSync(path.join(config.dataDir, f)).mtime)
    .reduce((a, b) => (a > b ? a : b));
  const render = () => Object.assign(rendered, renderSite(data, {
    publicDir: config.publicDir,
    media: media.grouped(),
    site: {
      siteUrl: config.siteUrl,
      adminPath: config.adminPath,
      isProduction: config.isProduction,
      lastModified: [dataChanged, media.lastChanged()].filter(Boolean).reduce((a, b) => (a > b ? a : b)),
    },
  }), { generation: rendered.generation + 1 });
  media = createMediaService({ db, storage, catalogue: data.catalogue, logger, onChange: render });
  render();

  const auth = createAuth({ db, config });
  const revoked = auth.revokeSessionsIfCredentialsChanged();
  if (revoked) logger.warn('admin credentials changed: ended all existing sessions', { sessions: revoked });
  const csrf = createCsrf({ secret: config.sessionSecret || 'admin-disabled' });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config));

  // Liveness + database check for uptime monitors and the process manager.
  app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
    } catch (err) {
      logger.error('health check failed', { err });
      res.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  app.use('/api/admin', createAdminRouter({ config, logger, auth, csrf, media }));

  // Admin screen: static files from admin/. It holds no secrets — everything it
  // shows comes from the authenticated API. Never indexed, never cached.
  const adminCsp = contentSecurityPolicy(config, { extraImgSrc: 'blob:' });
  app.use(config.adminPath, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const [pathname, query = ''] = req.originalUrl.split('?');
    if (pathname === config.adminPath) return res.redirect(301, `${config.adminPath}/${query ? `?${query}` : ''}`);
    res.set({ 'Content-Security-Policy': adminCsp, 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
    return next();
  }, express.static(path.join(ROOT, 'admin'), { index: 'index.html', redirect: false, dotfiles: 'ignore' }));
  app.use(createPublicRouter({ config, data, rendered, media, logger }));

  app.use(notFound);
  app.use(errorHandler({ logger, pages: rendered }));

  return { app, auth, storage, media };
}

export async function start() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Refusing to start: ${err.message}`);
    process.exit(1);
  }
  const logger = createLogger({ level: config.logLevel });

  let data;
  let db;
  try {
    data = loadData({ dataDir: config.dataDir, publicDir: config.publicDir });
    db = openDatabase(config.databasePath);
    const applied = runMigrations(db);
    if (applied.length) logger.info('migrations applied', { migrations: applied });
  } catch (err) {
    logger.error('refusing to start', err instanceof DataError ? { problems: err.problems, file: err.file } : { err });
    process.exit(1);
  }

  const { app, auth, storage } = createApp({ config, logger, db, data });
  const removed = await storage.cleanupPartials();
  if (removed) logger.warn('removed partial upload files left by an earlier crash', { count: removed });
  if (!config.admin) logger.warn('admin panel disabled: set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and SESSION_SECRET to enable it');

  const sweep = setInterval(() => auth.removeStaleSessions(), 60 * 60_000);
  sweep.unref();

  const server = app.listen(config.port, config.host, () => {
    logger.info('server started', {
      url: `http://${config.host}:${config.port}`, env: config.env,
      products: data.catalogue.products.length, admin: config.admin ? config.adminPath : 'disabled',
    });
  });
  server.on('error', (err) => {
    logger.error('server error', { err });
    process.exit(1);
  });

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    setTimeout(() => {
      logger.error('forced exit: connections did not close in 10s');
      process.exit(1);
    }, 10_000).unref();
    server.close(() => {
      db.close();
      logger.info('stopped');
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // A crash leaves the process in an unknown state: log it and let PM2/systemd restart.
  process.on('uncaughtException', (err) => { logger.error('uncaught exception', { err }); process.exit(1); });
  process.on('unhandledRejection', (err) => { logger.error('unhandled rejection', { err }); process.exit(1); });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) start();
