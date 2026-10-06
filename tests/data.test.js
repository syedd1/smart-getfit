// data/products.json + data/site.json validation: the server must refuse broken data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, DataError } from '../server/services/catalogue.js';
import { renderSite } from '../server/views/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(ROOT, 'public');
const realSite = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/site.json'), 'utf8'));
const realCatalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/products.json'), 'utf8'));

// Writes the given data into a temp data dir and loads it.
function load({ catalogue = realCatalogue, site = realSite, rawCatalogue } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgfn-data-'));
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(site));
  fs.writeFileSync(path.join(dir, 'products.json'), rawCatalogue ?? JSON.stringify(catalogue));
  try {
    return loadData({ dataDir: dir, publicDir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const withProducts = (mutate) => {
  const copy = structuredClone(realCatalogue);
  mutate(copy);
  return copy;
};

function assertRejects(fn, pattern) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof DataError, `expected DataError, got ${err}`);
    assert.match(err.message, pattern);
    return true;
  });
}

test('the shipped data files are valid and render every page', () => {
  const data = load();
  const site = renderSite(data, { publicDir });
  assert.equal(site.pages.size, 2 + data.catalogue.categories.length + data.catalogue.products.length);
  const home = site.pages.get('/');
  assert.equal(home.match(/class="pcard[ "]/g).length, data.catalogue.products.length);
});

test('malformed JSON is rejected with a clear message', () => {
  assertRejects(() => load({ rawCatalogue: '{ "categories": [' }), /products\.json.*not valid JSON/s);
});

test('duplicate product ids are rejected', () => {
  const data = withProducts((c) => { c.products[1].id = c.products[0].id; });
  assertRejects(() => load({ catalogue: data }), /duplicate product id/);
});

test('unknown category is rejected', () => {
  const data = withProducts((c) => { c.products[0].category = 'wey-protein'; });
  assertRejects(() => load({ catalogue: data }), /products\[0\]\.category: unknown category "wey-protein"/);
});

test('a product id that clashes with a category id is rejected', () => {
  const data = withProducts((c) => { c.products[0].id = c.categories[0].id; });
  assertRejects(() => load({ catalogue: data }), /clashes with a category id/);
});

test('misspelled fields are rejected instead of silently ignored', () => {
  const data = withProducts((c) => { c.products[0].pirce = 1000; });
  assertRejects(() => load({ catalogue: data }), /products\[0\].*pirce/);
});

test('ids must be URL-safe', () => {
  const data = withProducts((c) => { c.products[0].id = '../../etc/passwd'; });
  assertRejects(() => load({ catalogue: data }), /products\[0\]\.id/);
});

test('image paths must stay inside /assets and point at an existing file', () => {
  const outside = withProducts((c) => { c.products[0].image = '/assets/../../server/config.js'; });
  assertRejects(() => load({ catalogue: outside }), /products\[0\]\.image/);
  const missing = withProducts((c) => { c.products[0].image = '/assets/products/does-not-exist.webp'; });
  assertRejects(() => load({ catalogue: missing }), /image not found/);
});

test('site.json rejects non-https links and bad WhatsApp numbers', () => {
  assertRejects(() => load({ site: { ...realSite, maps: { ...realSite.maps, url: 'javascript:alert(1)' } } }), /maps\.url/);
  assertRejects(() => load({ site: { ...realSite, whatsapp: { ...realSite.whatsapp, number: '0337 2106695' } } }), /whatsapp\.number/);
});

test('a listed price is shown and the CTA changes; no price → "Ask for Price"', () => {
  const data = load({ catalogue: withProducts((c) => { c.products[0].price = 12500; }) });
  const site = renderSite(data, { publicDir });
  const priced = site.pages.get(data.catalogue.products[0].url);
  assert.match(priced, /Rs 12,500/);
  assert.match(priced, /Ask on WhatsApp/);
  const unpriced = site.pages.get(data.catalogue.products[1].url);
  assert.match(unpriced, /Ask for Price/);
  assert.doesNotMatch(unpriced, /Rs \d/);
});

test('WhatsApp links are prefilled with the product name', () => {
  const p = load().catalogue.products[0];
  assert.ok(p.waPrice.startsWith('https://wa.me/923372106695?text='));
  assert.match(decodeURIComponent(p.waPrice.split('?text=')[1]), new RegExp(`${p.brand} ${p.name}`));
});

test('text from the data files is HTML-escaped', () => {
  const data = load({ catalogue: withProducts((c) => { c.products[0].name = '<script>alert(1)</script>'; }) });
  const html = renderSite(data, { publicDir }).pages.get('/');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
