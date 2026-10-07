// "Inside the Store" gallery: uploads add to the built-in photos, and the desktop layout
// never leaves holes whatever the number of tiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../server/services/catalogue.js';
import { toPublicMedia } from '../server/services/media.js';
import { renderSite } from '../server/views/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(ROOT, 'public');
const data = loadData({ dataDir: path.join(ROOT, 'data'), publicDir });
const BUILT_IN_TILES = 8; // store video + 7 built-in photos

const upload = (i) => toPublicMedia({ id: i + 1, section: 'gallery', product_id: null, alt: `Upload ${i}`, width: 1200, height: 800, filename_base: String(i).padStart(32, '0') });

function galleryTiles(uploads) {
  const media = { hero: [], banner: [], gallery: Array.from({ length: uploads }, (_, i) => upload(i)), product: new Map() };
  const home = renderSite(data, { publicDir, media }).pages.get('/');
  const grid = home.slice(home.indexOf('data-gallery>'), home.indexOf('data-lightbox'));
  return [...grid.matchAll(/<figure class="([^"]*)"[^>]*data-label="([^"]*)"/g)].map(([, cls, label]) => ({
    label, width: Number((cls.match(/gitem--w(\d+)/) || [])[1]) || null,
  }));
}

test('uploads come after the store video and before the built-in photos', () => {
  const labels = galleryTiles(2).map((t) => t.label);
  assert.equal(labels.length, BUILT_IN_TILES + 2);
  assert.equal(labels[0], 'Take a look inside');
  assert.deepEqual(labels.slice(1, 3), ['Upload 0', 'Upload 1']);
  assert.equal(labels[3], 'Our supplement wall');
});

test('a last, incomplete group of 8 tiles fills whole rows on desktop', () => {
  for (let uploads = 0; uploads <= 17; uploads++) {
    const tiles = galleryTiles(uploads);
    const tail = tiles.length % 8;
    const full = tiles.slice(0, tiles.length - tail);
    const rest = tiles.slice(tiles.length - tail);
    assert.ok(full.every((t) => t.width === null), `${uploads} uploads: complete groups keep the bento layout`);
    assert.ok(rest.every((t) => [3, 4, 6, 12].includes(t.width)), `${uploads} uploads: every tail tile gets a width`);
    // Tail tiles fill rows of exactly 12 columns.
    let row = 0;
    for (const t of rest) {
      row += t.width;
      assert.ok(row <= 12, `${uploads} uploads: a row overflows`);
      if (row === 12) row = 0;
    }
    assert.equal(row, 0, `${uploads} uploads: the last row is not full`);
  }
});
