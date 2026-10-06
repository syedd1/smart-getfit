// Intrinsic sizes of the built-in WebP images in public/assets, read from the file
// header once and cached, so every <img> gets explicit width/height (no layout shift).
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

export function createAssetSizer(publicDir) {
  const cache = new Map();
  return (src) => {
    if (!cache.has(src)) {
      let size = null;
      try {
        const fd = fs.openSync(path.join(publicDir, src), 'r');
        const head = Buffer.alloc(32);
        fs.readSync(fd, head, 0, 32, 0);
        fs.closeSync(fd);
        size = webpSize(head);
      } catch { /* missing file: rendered without dimensions */ }
      cache.set(src, size);
    }
    return cache.get(src);
  };
}
