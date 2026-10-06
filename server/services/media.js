// Media: upload processing and metadata.
//
// Pipeline for every uploaded image:
//   size limit (multer) → real type from magic bytes (JPEG/PNG/WebP only) →
//   header check against the pixel limit → decode with Sharp → auto-rotate →
//   WebP variants at 400/800/1600 px (never upscaled), metadata stripped →
//   random file names → files written atomically → only then the DB row.
// Any failure removes files already written, so no broken record or orphan remains.
import crypto from 'node:crypto';
import sharp from 'sharp';
import { HttpError } from '../middleware/errors.js';

export const SECTIONS = ['product', 'hero', 'banner', 'gallery'];
export const MAX_PIXELS = 40_000_000; // 40 MP — far above any phone photo, stops decompression bombs
const MAX_SIDE = 12_000;
const TARGET_WIDTHS = [400, 800, 1600];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

sharp.cache(false); // processed buffers are written once; caching only costs memory

// Responsive widths generated for an image of the given width (never upscaled).
export function variantWidths(width) {
  const widths = TARGET_WIDTHS.filter((w) => w <= width);
  return widths.length ? widths : [width];
}

export const variantName = (base, width) => `${base}-${width}.webp`;
export const variantUrl = (base, width) => `/uploads/${variantName(base, width)}`;

// The real file type, from the first bytes — the file name and the browser's
// Content-Type are never trusted.
export function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const unreadable = () => new HttpError(422, 'invalid_image', 'This file could not be read as an image.');
const tooManyPixels = () => new HttpError(422, 'image_too_large', `Images can be at most ${MAX_PIXELS / 1_000_000} megapixels and ${MAX_SIDE} px on a side.`);

export async function processImage(buffer, { maxPixels = MAX_PIXELS } = {}) {
  const type = detectImageType(buffer);
  if (!type) throw new HttpError(415, 'unsupported_type', 'Only JPEG, PNG and WebP images are accepted.');

  const open = () => sharp(buffer, { limitInputPixels: maxPixels, failOn: 'truncated' });
  let meta;
  try {
    meta = await open().metadata(); // reads the header only — nothing is decoded yet
  } catch (err) {
    throw /pixel limit/i.test(err.message) ? tooManyPixels() : unreadable();
  }
  if (meta.format !== type || !meta.width || !meta.height) throw unreadable();
  if (meta.width * meta.height > maxPixels || Math.max(meta.width, meta.height) > MAX_SIDE) throw tooManyPixels();

  const sideways = (meta.orientation ?? 1) >= 5; // EXIF rotation of 90°/270°
  const width = sideways ? meta.height : meta.width;
  const height = sideways ? meta.width : meta.height;

  try {
    const pipeline = open().rotate(); // apply EXIF orientation; output carries no EXIF/GPS/ICC metadata
    const variants = [];
    for (const w of variantWidths(width)) {
      const data = await pipeline.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toBuffer();
      variants.push({ width: w, buffer: data });
    }
    return { width, height, variants };
  } catch (err) {
    throw /pixel limit/i.test(err.message) ? tooManyPixels() : unreadable();
  }
}

// The shape the public site sees: no file paths, timestamps or other internals.
export function toPublicMedia(row) {
  const widths = variantWidths(row.width);
  const display = widths.filter((w) => w <= 800).at(-1) ?? widths[0];
  return {
    id: row.id,
    section: row.section,
    productId: row.product_id,
    alt: row.alt,
    width: row.width,
    height: row.height,
    src: variantUrl(row.filename_base, display),
    full: variantUrl(row.filename_base, widths.at(-1)),
    srcset: widths.map((w) => `${variantUrl(row.filename_base, w)} ${w}w`).join(', '),
  };
}

const toAdminMedia = (row) => ({ ...toPublicMedia(row), sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at });

export function createMediaService({ db, storage, catalogue, logger, onChange: notify = () => {} }) {
  // The change is already saved when this runs: if refreshing the pages fails, log it
  // and keep serving the previous pages rather than reporting the upload as failed.
  const onChange = () => {
    try {
      notify();
    } catch (err) {
      logger.error('re-rendering pages after a media change failed', { err });
    }
  };

  const COLUMNS = 'id, filename_base, product_id, section, alt, sort_order, width, height, created_at, updated_at';
  const q = {
    list: db.prepare(`SELECT ${COLUMNS} FROM media
      WHERE (@section IS NULL OR section = @section) AND (@productId IS NULL OR product_id = @productId)
      ORDER BY section, product_id, sort_order, id`),
    get: db.prepare(`SELECT ${COLUMNS} FROM media WHERE id = ?`),
    nextOrder: db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) FROM media WHERE section = @section AND product_id IS @productId').pluck(),
    insert: db.prepare(`INSERT INTO media (filename_base, product_id, section, alt, sort_order, width, height)
      VALUES (@base, @productId, @section, @alt, @sortOrder, @width, @height)`),
    replaceFile: db.prepare(`UPDATE media SET filename_base = @base, width = @width, height = @height,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = @id`),
    update: db.prepare(`UPDATE media SET section = @section, product_id = @productId, alt = @alt, sort_order = @sortOrder,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = @id`),
    setOrder: db.prepare('UPDATE media SET sort_order = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM media WHERE id = ?'),
  };

  function placement({ section, productId }) {
    if (section === 'product') {
      if (!productId) throw new HttpError(400, 'invalid_input', 'Choose the product this image belongs to.');
      if (!catalogue.productById.has(productId)) throw new HttpError(400, 'invalid_input', `There is no product with id "${productId}" in products.json.`);
      return { section, productId };
    }
    return { section, productId: null };
  }

  function mustGet(id) {
    const row = q.get.get(id);
    if (!row) throw new HttpError(404, 'not_found', 'That image no longer exists.');
    return row;
  }

  // Writes every variant, or none: on failure the ones already written are removed.
  async function writeVariants(image) {
    const base = crypto.randomBytes(16).toString('hex');
    const written = [];
    try {
      for (const v of image.variants) {
        const name = variantName(base, v.width);
        await storage.put(name, v.buffer);
        written.push(name);
      }
    } catch (err) {
      await removeFiles(written);
      throw err;
    }
    return { base, written };
  }

  async function removeFiles(names) {
    for (const name of names) {
      try {
        await storage.remove(name);
      } catch (err) {
        logger.warn('could not delete image file', { name, err });
      }
    }
  }

  const filesOf = (row) => variantWidths(row.width).map((w) => variantName(row.filename_base, w));

  return {
    // Photos of products no longer in products.json are not public.
    listPublic({ section = null, productId = null } = {}) {
      return q.list.all({ section, productId })
        .filter((row) => row.product_id === null || catalogue.productById.has(row.product_id))
        .map(toPublicMedia);
    },

    // When media last changed (for sitemap lastmod), or null when there is none.
    lastChanged() {
      const latest = db.prepare('SELECT MAX(updated_at) FROM media').pluck().get();
      return latest ? new Date(latest) : null;
    },

    listAdmin() {
      return q.list.all({ section: null, productId: null }).map((row) => ({
        ...toAdminMedia(row),
        productMissing: row.product_id !== null && !catalogue.productById.has(row.product_id),
      }));
    },

    // Media grouped for page rendering. Images attached to products that were
    // removed from products.json are simply not shown.
    grouped() {
      const groups = { hero: [], banner: [], gallery: [], product: new Map() };
      for (const row of q.list.all({ section: null, productId: null })) {
        const item = toPublicMedia(row);
        if (row.section !== 'product') groups[row.section].push(item);
        else if (catalogue.productById.has(row.product_id)) {
          if (!groups.product.has(row.product_id)) groups.product.set(row.product_id, []);
          groups.product.get(row.product_id).push(item);
        }
      }
      return groups;
    },

    async create(buffer, fields) {
      const where = placement(fields);
      const image = await processImage(buffer);
      const { base, written } = await writeVariants(image);
      try {
        const row = db.transaction(() => {
          const sortOrder = q.nextOrder.get(where);
          const { lastInsertRowid } = q.insert.run({ base, ...where, alt: fields.alt, sortOrder, width: image.width, height: image.height });
          return q.get.get(lastInsertRowid);
        })();
        logger.info('media uploaded', { id: row.id, section: row.section, productId: row.product_id, width: row.width, height: row.height, bytes: buffer.length });
        onChange();
        return toAdminMedia(row);
      } catch (err) {
        await removeFiles(written);
        throw err;
      }
    },

    async replace(id, buffer) {
      const before = mustGet(id);
      const image = await processImage(buffer);
      const { base, written } = await writeVariants(image);
      let row;
      try {
        row = db.transaction(() => {
          mustGet(id); // deleted while we were processing?
          q.replaceFile.run({ id, base, width: image.width, height: image.height });
          return q.get.get(id);
        })();
      } catch (err) {
        await removeFiles(written);
        throw err;
      }
      await removeFiles(filesOf(before)); // after commit: the page never points at a missing file
      logger.info('media replaced', { id, bytes: buffer.length });
      onChange();
      return toAdminMedia(row);
    },

    update(id, changes) {
      const row = db.transaction(() => {
        const current = mustGet(id);
        const where = placement({
          section: changes.section ?? current.section,
          productId: changes.productId !== undefined ? changes.productId : current.product_id,
        });
        const moved = where.section !== current.section || where.productId !== current.product_id;
        q.update.run({
          id, ...where,
          alt: changes.alt ?? current.alt,
          sortOrder: moved ? q.nextOrder.get(where) : current.sort_order,
        });
        return q.get.get(id);
      })();
      logger.info('media updated', { id, section: row.section, productId: row.product_id });
      onChange();
      return toAdminMedia(row);
    },

    async remove(id) {
      const row = db.transaction(() => {
        const current = mustGet(id);
        q.remove.run(id);
        return current;
      })();
      await removeFiles(filesOf(row));
      logger.info('media deleted', { id, section: row.section, productId: row.product_id });
      onChange();
    },

    // ids must be exactly the images currently in that section (and product).
    reorder({ section, productId, ids }) {
      const where = placement({ section, productId });
      db.transaction(() => {
        const current = q.list.all({ section: where.section, productId: where.productId }).map((r) => r.id);
        const same = current.length === ids.length && new Set(ids).size === ids.length && ids.every((id) => current.includes(id));
        if (!same) throw new HttpError(409, 'stale_order', 'The image list changed in the meantime. Reload and try again.');
        ids.forEach((id, i) => q.setOrder.run(i, id));
      })();
      logger.info('media reordered', { section: where.section, productId: where.productId, count: ids.length });
      onChange();
      return q.list.all({ section: where.section, productId: where.productId }).map(toAdminMedia);
    },
  };
}
