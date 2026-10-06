// Public site: rendered pages, static files, uploaded images and the read-only API.
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { slug } from '../lib/validate.js';
import { SECTIONS } from '../services/media.js';
import { FILE_NAME } from '../services/storage.js';
import { HttpError } from '../middleware/errors.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { UPLOAD_CSP } from '../middleware/security.js';
import { createCompressionCache } from '../lib/compress.js';

const TEXT_FILE = /\.(css|js|svg|txt|json|xml)$/;

const sectionParam = z.enum(SECTIONS);

// Only what the public site needs from the data files.
const publicProduct = (p) => ({
  id: p.id, brand: p.brand, name: p.name, category: p.category, categoryName: p.categoryName,
  size: p.size, flavour: p.flavour ?? null, description: p.description, image: p.image,
  price: p.price ?? null, available: p.available, featured: p.featured, url: p.url,
  whatsappUrl: p.available ? (p.price ? p.waAbout : p.waPrice) : p.waAvailability,
});

const publicSite = (s) => ({
  name: s.name, foundingYear: s.foundingYear,
  phone: { display: s.phone.display, href: s.phoneHref },
  whatsapp: { display: s.whatsapp.display, url: s.wa.general },
  address: s.address, geo: s.geo ?? null, hours: s.hours, maps: s.maps, social: s.social,
  deliveryAreas: s.deliveryAreas,
});

function parseParam(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(404, 'not_found', 'Not found.');
  return result.data;
}

export function createPublicRouter({ config, data, rendered, media, logger }) {
  const router = express.Router();
  const { catalogue, site } = data;

  // ── Read-only API ──────────────────────────────────────────────────────
  const api = express.Router();
  api.use(rateLimit({
    name: 'public-api', windowMs: 60_000, max: 120,
    onLimited: (info) => logger.warn('rate limit exceeded', info),
  }));
  api.use((req, res, next) => { res.set('Cache-Control', 'public, max-age=60'); next(); });

  const products = catalogue.products.map(publicProduct);
  const productsById = new Map(products.map((p) => [p.id, p]));
  const siteInfo = publicSite(site);

  api.get('/products', (req, res) => res.json({ products }));
  api.get('/products/:id', (req, res) => {
    const product = productsById.get(parseParam(slug, req.params.id));
    if (!product) throw new HttpError(404, 'not_found', 'No product with that id.');
    res.json({ product });
  });
  api.get('/site', (req, res) => res.json({ site: siteInfo }));
  api.get('/media', (req, res) => res.set('Cache-Control', 'no-cache').json({ media: media.listPublic() }));
  api.get('/media/product/:productId', (req, res) => {
    const productId = parseParam(slug, req.params.productId);
    if (!catalogue.productById.has(productId)) throw new HttpError(404, 'not_found', 'No product with that id.');
    res.set('Cache-Control', 'no-cache').json({ media: media.listPublic({ section: 'product', productId }) });
  });
  api.get('/media/section/:section', (req, res) => {
    const section = parseParam(sectionParam, req.params.section);
    res.set('Cache-Control', 'no-cache').json({ media: media.listPublic({ section }) });
  });
  router.use('/api', api);

  // Files referenced with ?v=<content hash> never change under that URL: cache them for
  // a year. (Not in development, where files change without a restart.)
  const cacheControl = (req, file) => {
    if (config.isProduction && req.query.v) return 'public, max-age=31536000, immutable';
    return /\.(css|js)$/.test(file) ? 'no-cache' : 'public, max-age=604800';
  };

  // ── Rendered pages, sitemap.xml, robots.txt ────────────────────────────
  const pageCache = createCompressionCache();
  let generation = rendered.generation;
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (rendered.generation !== generation) { // pages were re-rendered: drop old compressed copies
      pageCache.clear();
      generation = rendered.generation;
    }
    const pageBody = rendered.pages.get(req.path);
    if (pageBody) {
      res.set('Cache-Control', 'no-cache');
      return pageCache.send(req, res, req.path, pageBody, 'html');
    }
    const file = rendered.files.get(req.path);
    if (file) {
      res.set('Cache-Control', 'public, max-age=3600');
      return pageCache.send(req, res, req.path, file.body, file.type);
    }
    // /products/ → /products (one canonical URL per page)
    const trimmed = req.path.replace(/\/+$/, '');
    if (trimmed !== req.path && rendered.pages.has(trimmed)) {
      const q = req.originalUrl.indexOf('?');
      return res.redirect(301, trimmed + (q === -1 ? '' : req.originalUrl.slice(q)));
    }
    return next();
  });

  // ── Uploaded images: served as files only, never as anything executable ─
  router.use('/uploads', (req, res, next) => {
    if (!FILE_NAME.test(req.path.slice(1))) return next(new HttpError(404, 'not_found', 'Not found.'));
    res.set({ 'Content-Security-Policy': UPLOAD_CSP, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return next();
  }, express.static(config.uploadDir, { index: false, redirect: false, dotfiles: 'deny', fallthrough: true }));

  // ── Static assets ──────────────────────────────────────────────────────
  // Text files (CSS, JS, SVG) are served compressed; the rest (images, fonts, video)
  // are already compressed formats and go straight through express.static.
  const staticCache = createCompressionCache();
  router.use(async (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !TEXT_FILE.test(req.path)) return next();
    let file;
    try {
      file = path.join(config.publicDir, path.normalize(decodeURIComponent(req.path)));
    } catch {
      return next();
    }
    if (!file.startsWith(config.publicDir + path.sep)) return next(); // path traversal
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return next();
    }
    if (!stat.isFile()) return next();
    res.set('Cache-Control', cacheControl(req, file));
    return staticCache.send(req, res, `${file}:${stat.mtimeMs}`, await fs.readFile(file), path.extname(file));
  });

  router.use(express.static(config.publicDir, {
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    setHeaders(res, file) {
      res.set('Cache-Control', cacheControl(res.req, file));
    },
  }));

  return router;
}
