// Make smaller copies of the built-in photos for responsive images:
//   npm run optimize-images
// For every public/assets/**/*.webp wider than 400 / 800 px, writes name-400.webp /
// name-800.webp next to it (skipped when already up to date). Run it after adding or
// replacing a built-in photo, then commit the new files. Photos uploaded through the
// admin panel get their copies automatically and don't need this.
//   --force   rebuild every copy, even if it looks up to date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { VARIANT_WIDTHS, variantPath } from '../server/lib/assets.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const isVariant = (file) => /-\d{3,4}\.webp$/.test(file);
const force = process.argv.includes('--force');

function* webpFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* webpFiles(full);
    else if (entry.name.endsWith('.webp') && !isVariant(entry.name)) yield full;
  }
}

let written = 0;
let skipped = 0;
for (const file of webpFiles(ASSETS)) {
  const { width } = await sharp(file).metadata();
  const sourceTime = fs.statSync(file).mtimeMs;
  for (const w of VARIANT_WIDTHS.filter((v) => v < width)) {
    const target = variantPath(file, w);
    if (!force && fs.existsSync(target) && fs.statSync(target).mtimeMs >= sourceTime) {
      skipped += 1;
      continue;
    }
    await sharp(file).resize({ width: w }).webp({ quality: 70, effort: 6 }).toFile(target);
    written += 1;
    console.log(`  ${path.relative(ASSETS, target)}`);
  }
}
console.log(`Done: ${written} written, ${skipped} already up to date.`);
