// Products added in the admin panel: API, validation, visibility rules and clean-up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startApp, adminEnvironment, login } from './helpers.js';
import { createLogger } from '../server/lib/logger.js';
import { loadData } from '../server/services/catalogue.js';
import { createApp } from '../server/index.js';

const BUILT_IN = 'cellucor-c4-original';
const png = (color = '#3a3') => sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).png().toBuffer();

let app;
let admin;
before(async () => {
  app = await startApp(await adminEnvironment());
  admin = await login(app);
});
after(() => app.close());

const bar = (extra = {}) => ({
  id: 'nibl-peanut-crunch-bar',
  brand: 'nibl',
  name: 'Peanut Crunch Bar',
  category: 'healthy-snacks',
  size: '45 g',
  flavour: 'Peanut',
  description: 'A crunchy peanut protein bar.',
  price: 450,
  available: true,
  featured: false,
  ...extra,
});

const createProduct = (body) => admin.send('POST', '/api/admin/products', { json: body });
const listAdmin = async () => (await (await admin.send('GET', '/api/admin/products')).json()).products;
const page = async (path) => {
  const res = await app.get(path);
  return { status: res.status, body: await res.text() };
};

async function uploadPhoto(productId, color) {
  const form = new FormData();
  form.append('section', 'product');
  form.append('productId', productId);
  form.append('alt', '');
  form.append('files', new Blob([await png(color)], { type: 'image/png' }), 'p.png');
  const res = await admin.send('POST', '/api/admin/media', { body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).created[0];
}

test('the product API needs a session, the CSRF token and the same origin', async () => {
  assert.equal((await app.get('/api/admin/products')).status, 401);
  const noSession = await app.get('/api/admin/products', {
    method: 'POST', headers: { origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify(bar()),
  });
  assert.equal(noSession.status, 401);
  const noToken = await admin.send('POST', '/api/admin/products', { json: bar({ id: 'no-token' }), headers: { 'x-csrf-token': '' } });
  assert.equal(noToken.status, 403);
  const otherOrigin = await admin.send('POST', '/api/admin/products', { json: bar({ id: 'other-origin' }), headers: { origin: 'https://evil.example' } });
  assert.equal(otherOrigin.status, 403);
  assert.ok(!(await listAdmin()).some((p) => p.id === 'no-token' || p.id === 'other-origin'), 'nothing was saved');
});

test('invalid input is refused with a clear message', async () => {
  const cases = [
    [bar({ id: 'Bad Id' }), /web address/i],
    [bar({ id: 'a--b' }), /web address/i],
    [bar({ brand: '   ' }), /Brand is required/],
    [bar({ name: 'x'.repeat(81) }), /Name can be at most 80/],
    [bar({ description: 'x'.repeat(301) }), /Description can be at most 300/],
    [bar({ price: 12.5 }), /whole number/],
    [bar({ price: '450' }), /whole number/],
    [bar({ price: 0 }), /more than 0/],
    [bar({ category: 'no-such-category' }), /existing categories/],
    [{ ...bar(), image: '/assets/x.webp' }, /image/],
  ];
  for (const [body, message] of cases) {
    const res = await createProduct(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const json = await res.json();
    assert.equal(json.error, 'invalid_input');
    assert.match(json.message, message);
  }
  assert.ok(!(await listAdmin()).some((p) => p.id === bar().id), 'nothing was saved');
});

test('web addresses already in use are refused', async () => {
  assert.equal((await createProduct(bar({ id: BUILT_IN }))).status, 409, 'a built-in product');
  assert.equal((await createProduct(bar({ id: 'healthy-snacks' }))).status, 409, 'a category');

  assert.equal((await createProduct(bar({ id: 'twice' }))).status, 201);
  const again = await createProduct(bar({ id: 'twice' }));
  assert.equal(again.status, 409, 'another added product');
  assert.equal((await again.json()).error, 'id_taken');
  assert.equal((await admin.send('DELETE', '/api/admin/products/twice')).status, 204);

  // Photos left by a product that was removed from products.json must not attach to a new one.
  app.db.prepare("INSERT INTO media (filename_base, product_id, section, width, height) VALUES ('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'old-removed-product', 'product', 400, 400)").run();
  const orphan = await createProduct(bar({ id: 'old-removed-product' }));
  assert.equal(orphan.status, 409);
  assert.match((await orphan.json()).message, /Photos of an old product/);
  app.db.prepare("DELETE FROM media WHERE product_id = 'old-removed-product'").run();
});

test('a new product stays hidden until it has a photo, then appears everywhere', async () => {
  const productsBefore = (await (await app.get('/api/products')).json()).products.length;
  const res = await createProduct(bar());
  assert.equal(res.status, 201);
  const created = (await res.json()).product;
  assert.equal(created.status, 'needs-photo');
  assert.equal(created.builtIn, false);

  // Hidden
  assert.equal((await page(`/products/${bar().id}`)).status, 404);
  assert.equal((await app.get(`/api/products/${bar().id}`)).status, 404);
  assert.ok(!(await page('/')).body.includes(bar().name));
  assert.ok(!(await page('/sitemap.xml')).body.includes(`/products/${bar().id}<`));

  // A photo puts it on the site
  const photo = await uploadPhoto(bar().id);
  assert.equal((await listAdmin()).find((p) => p.id === bar().id).status, 'live');
  const productPage = await page(`/products/${bar().id}`);
  assert.equal(productPage.status, 200);
  assert.ok(productPage.body.includes('Peanut Crunch Bar'));
  assert.ok(productPage.body.includes('Rs 450'));
  assert.ok(productPage.body.includes(`srcset="${photo.srcset}"`), 'uses the uploaded photo');
  assert.match(productPage.body, /wa\.me\/\d+\?text=[^"]*Peanut%20Crunch%20Bar/, 'WhatsApp link names the product');

  const home = (await page('/')).body;
  const snacks = home.slice(home.indexOf('class="snacks'), home.indexOf('class="story"'));
  assert.ok(snacks.includes('Peanut Crunch Bar'), 'listed with the healthy snacks on the homepage');
  assert.ok((await page('/products/healthy-snacks')).body.includes('Peanut Crunch Bar'), 'category page');
  assert.ok((await page('/products')).body.includes('Peanut Crunch Bar'), 'all-products page');
  assert.ok((await page('/sitemap.xml')).body.includes(`/products/${bar().id}<`), 'sitemap');
  const api = (await (await app.get('/api/products')).json()).products;
  assert.equal(api.length, productsBefore + 1);
  assert.equal(api.at(-1).id, bar().id, 'added products come after the built-in ones');
  assert.equal(api.at(-1).image, null);

  // Without its photo it is hidden again
  assert.equal((await admin.send('DELETE', `/api/admin/media/${photo.id}`)).status, 204);
  assert.equal((await page(`/products/${bar().id}`)).status, 404);
  assert.equal((await listAdmin()).find((p) => p.id === bar().id).status, 'needs-photo');
  await uploadPhoto(bar().id);
});

test('editing changes the page; the web address cannot change', async () => {
  const res = await admin.send('PUT', `/api/admin/products/${bar().id}`, { json: { ...bar({ name: 'Peanut Crunch Bar XL', price: null, available: false }), id: undefined } });
  assert.equal(res.status, 200, await res.clone().text());
  const updated = (await res.json()).product;
  assert.equal(updated.name, 'Peanut Crunch Bar XL');
  assert.equal(updated.price, null);
  const body = (await page(`/products/${bar().id}`)).body;
  assert.ok(body.includes('Peanut Crunch Bar XL'));
  assert.ok(body.includes('Currently Unavailable'));
  assert.ok(!body.includes('Rs 450'));

  const withId = { ...bar(), id: 'renamed' };
  assert.equal((await admin.send('PUT', `/api/admin/products/${bar().id}`, { json: withId })).status, 400);
  assert.equal((await admin.send('PUT', '/api/admin/products/does-not-exist', { json: { ...bar(), id: undefined } })).status, 404);
  assert.equal((await admin.send('PUT', '/api/admin/products/..%2F..%2Fetc', { json: { ...bar(), id: undefined } })).status, 404);
});

test('built-in products cannot be edited or deleted from the admin', async () => {
  const builtIn = (await listAdmin()).find((p) => p.id === BUILT_IN);
  assert.equal(builtIn.builtIn, true);
  assert.equal(builtIn.status, 'built-in');
  assert.equal((await admin.send('PUT', `/api/admin/products/${BUILT_IN}`, { json: { ...bar(), id: undefined } })).status, 404);
  assert.equal((await admin.send('DELETE', `/api/admin/products/${BUILT_IN}`)).status, 404);
  assert.equal((await page(`/products/${BUILT_IN}`)).status, 200);
});

test('text is cleaned and HTML-escaped', async () => {
  const res = await createProduct(bar({ id: 'escape-test', name: '<script>alert(1)</script>', brand: 'Brand\u0000‮X' }));
  assert.equal(res.status, 201);
  const product = (await res.json()).product;
  assert.equal(product.brand, 'BrandX');
  const lines = await admin.send('PUT', '/api/admin/products/escape-test', { json: { ...bar({ name: '<script>alert(1)</script>', description: 'Great taste.\r\nHigh protein.\n\n\tNo sugar.' }), id: undefined } });
  assert.equal((await lines.json()).product.description, 'Great taste. High protein. No sugar.', 'line breaks become spaces');
  await uploadPhoto('escape-test');
  const body = (await page('/products/escape-test')).body;
  assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((await admin.send('DELETE', '/api/admin/products/escape-test')).status, 204);
});

test('products and their photos survive a restart', async () => {
  // A second app on the same database, with the data files freshly loaded as start() does.
  const logger = createLogger({ level: 'error', write: () => {} });
  const data = loadData({ dataDir: app.config.dataDir, publicDir: app.config.publicDir });
  assert.ok(!data.catalogue.productById.has(bar().id), 'products.json does not contain it');
  const second = createApp({ config: app.config, logger, db: app.db, data });
  const server = await new Promise((resolve) => { const s = second.app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/products/${bar().id}`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('Peanut Crunch Bar XL'));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an added product whose id or category no longer fits is hidden, never breaking the site', async () => {
  const insert = app.db.prepare(`INSERT INTO products (id, brand, name, category, size, description) VALUES (?, 'B', ?, ?, '1 kg', 'D')`);
  // products.json gained a product with the same id after this one was added
  insert.run(BUILT_IN, 'Shadowed duplicate', 'whey-protein');
  // its category was removed from products.json
  insert.run('lost-category-product', 'Lost category', 'removed-category');
  app.db.prepare("INSERT INTO media (filename_base, product_id, section, width, height) VALUES ('dddddddddddddddddddddddddddddddd', 'lost-category-product', 'product', 400, 400)").run();
  const builtInPhoto = await uploadPhoto(BUILT_IN, '#933');
  // Any change re-renders the site with the rows above in place.
  assert.equal((await admin.send('PUT', `/api/admin/products/${bar().id}`, { json: { ...bar({ name: 'Peanut Crunch Bar XL', price: null, available: false }), id: undefined } })).status, 200);

  const list = await listAdmin();
  assert.equal(list.find((p) => !p.builtIn && p.id === BUILT_IN).status, 'id-taken');
  assert.equal(list.find((p) => p.id === 'lost-category-product').status, 'no-category');
  const builtInPage = (await page(`/products/${BUILT_IN}`)).body;
  assert.ok(builtInPage.includes('C4 Original'), 'the built-in product wins');
  assert.ok(!builtInPage.includes('Shadowed duplicate'));
  assert.equal((await page('/products/lost-category-product')).status, 404);
  assert.equal((await page('/')).status, 200);

  // Deleting the shadowed duplicate keeps the built-in product's photos
  assert.equal((await admin.send('DELETE', `/api/admin/products/${BUILT_IN}`)).status, 204);
  assert.ok(app.media.listAdmin().some((m) => m.id === builtInPhoto.id));
  assert.equal((await admin.send('DELETE', `/api/admin/media/${builtInPhoto.id}`)).status, 204);
  app.db.prepare("DELETE FROM media WHERE product_id = 'lost-category-product'").run();
  assert.equal((await admin.send('DELETE', '/api/admin/products/lost-category-product')).status, 204);
});

test('deleting a product removes its page and its photos', async () => {
  const photos = app.media.listAdmin().filter((m) => m.productId === bar().id);
  assert.ok(photos.length > 0);
  const bases = photos.map((m) => m.src.split('/').pop().split('-')[0]);
  assert.equal((await admin.send('DELETE', `/api/admin/products/${bar().id}`)).status, 204);
  assert.equal((await page(`/products/${bar().id}`)).status, 404);
  assert.ok(!(await page('/products/healthy-snacks')).body.includes('Peanut Crunch Bar'));
  assert.equal(app.db.prepare('SELECT COUNT(*) FROM media WHERE product_id = ?').pluck().get(bar().id), 0);
  for (const base of bases) assert.ok(!app.files().some((f) => f.startsWith(base)), 'photo files removed');
  assert.equal((await admin.send('DELETE', `/api/admin/products/${bar().id}`)).status, 404);
  assert.ok(app.logs.some((l) => l.msg === 'product deleted'));
});
