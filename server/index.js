// The Smart GetFit Nutrition — single Node process serving the site, API and uploads.
//   createApp() builds the Express app from already-loaded dependencies (used by tests).
//   start() loads config, data and the database, refusing to start if any is invalid.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { loadConfig, ConfigError } from './config.js';
import { createLogger } from './lib/logger.js';
import { openDatabase, runMigrations } from './db/db.js';
import { loadData, DataError } from './services/catalogue.js';
import { createMediaService } from './services/media.js';
import { renderSite } from './views/index.js';
import { securityHeaders } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { createPublicRouter } from './routes/public.js';

export function createApp({ config, logger, db, data, rendered }) {
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

  app.use(createPublicRouter({ config, data, rendered, media: createMediaService({ db }), logger }));

  app.use(notFound);
  app.use(errorHandler({ logger, pages: rendered }));
  return app;
}

export function start() {
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
  let rendered;
  let db;
  try {
    data = loadData({ dataDir: config.dataDir, publicDir: config.publicDir });
    rendered = renderSite(data, { publicDir: config.publicDir });
    fs.mkdirSync(config.uploadDir, { recursive: true });
    db = openDatabase(config.databasePath);
    const applied = runMigrations(db);
    if (applied.length) logger.info('migrations applied', { migrations: applied });
  } catch (err) {
    logger.error('refusing to start', err instanceof DataError ? { problems: err.problems, file: err.file } : { err });
    process.exit(1);
  }

  const app = createApp({ config, logger, db, data, rendered });
  const server = app.listen(config.port, config.host, () => {
    logger.info('server started', {
      url: `http://${config.host}:${config.port}`, env: config.env,
      pages: rendered.pages.size, products: data.catalogue.products.length,
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
