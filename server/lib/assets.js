// Facts about the built-in files in public/, read once and cached:
//   size(src)     intrinsic WebP dimensions, so every <img> gets width/height
//   url(src)      src?v=<content hash> — a changed file gets a new URL, so files can be
//                 cached for a year without anyone seeing a stale one
//   variants(src) smaller copies made by `npm run optimize-images` (name-400.webp, …)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function webpSize(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
  if (chunk === 'VP8 ') return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return null;
}

export const VARIANT_WIDTHS = [400, 800];
export const variantPath = (src, width) => src.replace(/\.webp$/, `-${width}.webp`);

export function createAssets(publicDir) {
  const cache = new Map();

  function info(src) {
    if (!cache.has(src)) {
      let entry = { size: null, version: null };
      try {
        const data = fs.readFileSync(path.join(publicDir, src));
        entry = {
          size: src.endsWith('.webp') ? webpSize(data) : null,
          version: crypto.createHash('sha256').update(data).digest('hex').slice(0, 10),
        };
      } catch { /* missing file: served unversioned, without dimensions */ }
      cache.set(src, entry);
    }
    return cache.get(src);
  }

  return {
    size: (src) => info(src).size,
    url: (src) => (info(src).version ? `${src}?v=${info(src).version}` : src),
    // [{ width, url }] for each smaller copy that exists, plus the original.
    variants(src) {
      const original = info(src).size;
      if (!original) return [];
      const smaller = VARIANT_WIDTHS
        .filter((w) => w < original[0] && info(variantPath(src, w)).size)
        .map((w) => ({ width: w, url: this.url(variantPath(src, w)) }));
      return [...smaller, { width: original[0], url: this.url(src) }];
    },
  };
}
