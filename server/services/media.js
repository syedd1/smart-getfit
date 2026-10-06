// Media metadata (read side). Upload processing is added in Phase 5.
// Files live in UPLOAD_DIR as <filename_base>-<width>.webp for each width in variantWidths().

export const SECTIONS = ['product', 'hero', 'banner', 'gallery'];
const TARGET_WIDTHS = [400, 800, 1600];

// Responsive widths generated for an image of the given width (never upscaled).
export function variantWidths(width) {
  const widths = TARGET_WIDTHS.filter((w) => w <= width);
  return widths.length ? widths : [width];
}

export const variantUrl = (base, width) => `/uploads/${base}-${width}.webp`;

// The only file names that may be requested under /uploads.
export const UPLOAD_FILE = /^\/[a-f0-9]{32}-\d{1,4}\.webp$/;

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
    srcset: widths.map((w) => `${variantUrl(row.filename_base, w)} ${w}w`).join(', '),
  };
}

export function createMediaService({ db }) {
  const list = db.prepare(`
    SELECT id, filename_base, product_id, section, alt, sort_order, width, height
    FROM media
    WHERE (@section IS NULL OR section = @section)
      AND (@productId IS NULL OR product_id = @productId)
    ORDER BY section, product_id, sort_order, id`);

  return {
    listPublic({ section = null, productId = null } = {}) {
      return list.all({ section, productId }).map(toPublicMedia);
    },
  };
}
