// Admin API — media management only. Mounted at /api/admin.
// Every state-changing route: same-origin check → rate limit → session → CSRF token.
import express from 'express';
import multer from 'multer';
import { HttpError } from '../middleware/errors.js';
import { rateLimit, quota } from '../middleware/rateLimit.js';
import { requireAuth, SESSION_IDLE_MS } from '../middleware/auth.js';
import { sameOrigin } from '../middleware/csrf.js';
import { loginSchema, uploadFieldsSchema, mediaUpdateSchema, reorderSchema, mediaId } from '../lib/validate.js';

const MAX_FILES_PER_REQUEST = 10;
export const UPLOADS_PER_HOUR = 30;

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, 'invalid_input', first?.message && !/^Invalid/.test(first.message) ? first.message : 'Some of the details sent were not valid.');
  }
  return result.data;
}

// Original file names are only echoed back in messages, never used for storage.
const displayName = (name) => String(name || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 80);

export function createAdminRouter({ config, logger, auth, csrf, media }) {
  const router = express.Router();
  const json = express.json({ limit: '16kb' });
  const authed = requireAuth(auth);

  const loginLimiter = rateLimit({
    name: 'admin-login', windowMs: 15 * 60_000, max: 5, blockMs: 15 * 60_000,
    onLimited: (info) => logger.warn('admin login blocked after repeated attempts', info),
  });
  const adminLimiter = rateLimit({
    name: 'admin-api', windowMs: 60_000, max: 60,
    onLimited: (info) => logger.warn('rate limit exceeded', info),
  });
  // Counted per photo (a 10-photo batch uses 10), across uploads and replacements.
  const uploadQuota = quota({
    name: 'admin-upload', windowMs: 60 * 60_000, max: UPLOADS_PER_HOUR,
    onLimited: (info) => logger.warn('upload limit reached', info),
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.uploadMaxBytes, files: MAX_FILES_PER_REQUEST,
      fields: 10, fieldSize: 1024, fieldNameSize: 100, parts: MAX_FILES_PER_REQUEST + 10, headerPairs: 100,
    },
  });
  // Parser problems are the client's fault: map them to clear 4xx responses.
  const parseUpload = (mw) => (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'file_too_large', `Each image must be ${Math.round(config.uploadMaxBytes / 1048576)} MB or smaller.`));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(new HttpError(400, 'too_many_files', `Upload at most ${MAX_FILES_PER_REQUEST} images at a time.`));
    return next(new HttpError(400, 'malformed_upload', 'The upload could not be read. Please try again.'));
  });

  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(sameOrigin(config));
  router.use(adminLimiter);
  if (!config.admin) {
    router.use((req, res, next) => next(new HttpError(503, 'admin_disabled', 'The admin panel is not configured on this server.')));
    return router;
  }

  const sessionInfo = (session) => ({
    authenticated: true,
    username: config.admin.username,
    csrfToken: csrf.tokenFor(session),
    expiresAt: new Date(session.expires_at).toISOString(),
    idleTimeoutMinutes: SESSION_IDLE_MS / 60_000,
    limits: { maxFileBytes: config.uploadMaxBytes, maxFilesPerUpload: MAX_FILES_PER_REQUEST, uploadsPerHour: UPLOADS_PER_HOUR },
  });

  // ── Session ────────────────────────────────────────────────────────────
  router.post('/login', loginLimiter, json, async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    if (!(await auth.verifyCredentials(username, password))) {
      logger.warn('admin login failed', { ip: req.ip });
      throw new HttpError(401, 'invalid_credentials', 'Incorrect username or password.');
    }
    loginLimiter.resetFor(req);
    const session = auth.startSession(req, res);
    logger.info('admin logged in', { ip: req.ip });
    res.json(sessionInfo(session));
  });

  router.get('/session', authed, (req, res) => res.json(sessionInfo(req.adminSession)));

  router.post('/logout', authed, csrf.verify, (req, res) => {
    auth.endSession(req, res);
    logger.info('admin logged out', { ip: req.ip });
    res.status(204).end();
  });

  // ── Media ──────────────────────────────────────────────────────────────
  router.get('/media', authed, (req, res) => res.json({ media: media.listAdmin() }));

  router.post('/media', authed, csrf.verify, uploadQuota.precheck, parseUpload(upload.array('files', MAX_FILES_PER_REQUEST)), async (req, res) => {
    const files = req.files || [];
    if (!files.length) throw new HttpError(400, 'no_files', 'Choose at least one image to upload.');
    const fields = parse(uploadFieldsSchema, req.body || {});
    uploadQuota.spend(req, res, files.length);

    const created = [];
    const failed = [];
    for (const file of files) {
      try {
        created.push(await media.create(file.buffer, fields));
      } catch (err) {
        if (!(err instanceof HttpError) || err.status >= 500) throw err;
        if (err.code === 'invalid_input') throw err; // same placement for every file: no point continuing
        logger.info('upload rejected', { code: err.code, ip: req.ip });
        failed.push({ name: displayName(file.originalname), error: err.code, message: err.message });
      }
    }
    if (!created.length) {
      res.status(422).json({ error: 'upload_failed', message: failed[0].message, failed });
      return;
    }
    res.status(201).json({ created, failed });
  });

  router.put('/media/reorder', authed, csrf.verify, json, (req, res) => {
    const body = parse(reorderSchema, req.body);
    res.json({ media: media.reorder({ section: body.section, productId: body.productId ?? null, ids: body.ids }) });
  });

  router.put('/media/:id', authed, csrf.verify, json, (req, res) => {
    const id = parse(mediaId, req.params.id);
    res.json({ media: media.update(id, parse(mediaUpdateSchema, req.body)) });
  });

  router.delete('/media/:id', authed, csrf.verify, async (req, res) => {
    await media.remove(parse(mediaId, req.params.id));
    res.status(204).end();
  });

  router.post('/media/:id/replace', authed, csrf.verify, uploadQuota.precheck, parseUpload(upload.single('file')), async (req, res) => {
    const id = parse(mediaId, req.params.id);
    if (!req.file) throw new HttpError(400, 'no_files', 'Choose an image to upload.');
    uploadQuota.spend(req, res, 1);
    res.json({ media: await media.replace(id, req.file.buffer) });
  });

  return router;
}
