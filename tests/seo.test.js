// SEO output (canonical, social tags, structured data, sitemap, robots) and the
// performance plumbing (responsive images, cache headers, compression).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, PRODUCTION_ENV } from './helpers.js';

const SITE = PRODUCTION_ENV.SITE_URL;
let prod;
let pages;
before(async () => {
  prod = await startApp(PRODUCTION_ENV);
  pages = [...prod.data.catalogue.products.map((p) => p.url), ...prod.data.catalogue.categories.map((c) => c.url), '/', '/products'];
});
after(() => prod.close());

const html = async (path) => (await prod.get(path)).text();
const jsonLd = (page) => [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const meta = (page, attr, name) => page.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];

test('every page has one H1, a canonical URL, a title and a description under 160 characters', async () => {
  for (const path of pages) {
    const page = await html(path);
    assert.equal((page.match(/<h1[\s>]/g) || []).length, 1, `one H1 on ${path}`);
    assert.match(page, new RegExp(`<link rel="canonical" href="${SITE}${path === '/' ? '/' : path}">`), path);
    assert.match(page, /<title>[^<]{10,}<\/title>/, path);
    const description = meta(page, 'name', 'description').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    assert.ok(description.length >= 50 && description.length <= 160, `${path}: ${description.length} chars`);
  }
});

test('social previews use absolute URLs to real images', async () => {
  const page = await html('/products/cellucor-c4-original');
  assert.equal(meta(page, 'property', 'og:url'), `${SITE}/products/cellucor-c4-original`);
  assert.equal(meta(page, 'property', 'og:type'), 'product');
  const image = meta(page, 'property', 'og:image');
  assert.ok(image.startsWith(`${SITE}/assets/`), image);
  assert.equal((await prod.get(image.slice(SITE.length))).status, 200, 'the preview image exists');
  assert.equal(meta(page, 'name', 'twitter:card'), 'summary_large_image');
  assert.ok(Number(meta(page, 'property', 'og:image:width')) >= 400);
});

test('homepage structured data describes the physical store', async () => {
  const [store, website] = jsonLd(await html('/'));
  assert.equal(store['@type'], 'Store');
  assert.equal(store.foundingDate, '2015');
  assert.equal(store.telephone, '+923372106695');
  assert.equal(store.address.addressLocality, 'Karachi');
  assert.match(store.address.streetAddress, /Gulshan-e-Maymar/);
  assert.equal(store.openingHoursSpecification[0].opens, '17:00');
  assert.equal(store.openingHoursSpecification[0].dayOfWeek.length, 6);
  assert.deepEqual(store.areaServed.map((a) => a.name), ['Ahsanabad, Karachi', 'Taiser Town, Karachi', 'Surjani Town, Karachi', 'North Karachi, Karachi', 'Scheme 33, Karachi', 'Karachi']);
  assert.ok(store.geo.latitude && store.sameAs.length === 2);
  assert.ok(store.image.every((u) => u.startsWith(SITE)));
  assert.equal(website['@type'], 'WebSite');
});

test('product structured data has no Offer unless a real price is listed', async () => {
  const [product, crumbs] = jsonLd(await html('/products/cellucor-c4-original'));
  assert.equal(product['@type'], 'Product');
  assert.equal(product.brand.name, 'Cellucor');
  assert.equal(product.offers, undefined, 'no invented prices');
  assert.equal(crumbs['@type'], 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i) => i.name), ['Products', 'Pre-Workout', 'C4 Original']);

  // With a price in products.json, an Offer appears.
  const { renderSite } = await import('../server/views/index.js');
  const priced = { ...prod.data.catalogue.products[0], price: 12500, priceText: 'Rs 12,500' };
  const rendered = renderSite({ ...prod.data, catalogue: { ...prod.data.catalogue, products: [priced, ...prod.data.catalogue.products.slice(1)] } }, { publicDir: prod.config.publicDir, site: { siteUrl: SITE } });
  const [withOffer] = jsonLd(rendered.pages.get(priced.url));
  assert.deepEqual([withOffer.offers.price, withOffer.offers.priceCurrency, withOffer.offers.availability], ['12500', 'PKR', 'https://schema.org/InStock']);
});

test('sitemap lists every page on the canonical domain', async () => {
  const res = await prod.get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  const xml = await res.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, pages.length);
  for (const path of pages) assert.ok(locs.includes(`${SITE}${path}`), path);
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

test('robots.txt: production keeps admin and API out; other environments block everything', async () => {
  const robots = await (await prod.get('/robots.txt')).text();
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/admin\/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap.xml$`, 'm'));
  assert.doesNotMatch(robots, /^Disallow: \/$/m);

  const dev = await startApp();
  try {
    assert.equal(await (await dev.get('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
  } finally {
    await dev.close();
  }
});

test('error pages are not indexable', async () => {
  const page = await html('/no-such-page');
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(page, /rel="canonical"/);
});

test('every image has dimensions and alt; photos have responsive sources', async () => {
  for (const path of ['/', '/products/pre-workout', '/products/cellucor-c4-original']) {
    const page = await html(path);
    for (const tag of page.match(/<img\b[^>]*>/g)) {
      if (tag.includes('data-pd=') || tag.includes('data-lb-img')) continue; // filled in by script
      assert.match(tag, /\swidth="\d+" height="\d+"/, tag);
      assert.match(tag, /\salt="/, tag);
    }
  }
  const card = (await html('/')).match(/<img class="pcard__img"[^>]*>/)[0];
  assert.match(card, /srcset="[^"]*-400\.webp\?v=\w+ 400w, [^"]*-800\.webp\?v=\w+ 800w, [^"]* 1200w"/);
  assert.match(card, /loading="lazy"/);
  const hero = (await html('/')).match(/<link rel="preload" as="image"[^>]*>/)[0];
  assert.match(hero, /imagesrcset=/);
});

test('version-stamped files are cached for a year; plain URLs are revalidated', async () => {
  const page = await html('/');
  const css = page.match(/href="(\/css\/site\.css\?v=\w+)"/)[1];
  const versioned = await prod.get(css);
  assert.equal(versioned.status, 200);
  assert.equal(versioned.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await prod.get('/css/site.css')).headers.get('cache-control'), 'no-cache');
  const image = page.match(/src="(\/assets\/products\/[^"]+\?v=\w+)"/)[1];
  assert.equal((await prod.get(image)).headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const dev = await startApp();
  try {
    assert.equal((await dev.get(css)).headers.get('cache-control'), 'no-cache', 'development never caches long-term');
  } finally {
    await dev.close();
  }
});

test('pages and text files are compressed when the browser accepts it', async () => {
  const raw = (path, encoding) => prod.get(path, { headers: { 'accept-encoding': encoding } });
  const plain = await (await raw('/', 'identity')).text();
  for (const encoding of ['br', 'gzip']) {
    const res = await raw('/', encoding);
    assert.equal(res.headers.get('content-encoding'), encoding);
    assert.match(res.headers.get('vary'), /Accept-Encoding/i);
    assert.equal(await res.text(), plain, 'fetch decodes it back to the same page');
  }
  assert.equal((await raw('/', 'identity')).headers.get('content-encoding'), null);
  assert.equal((await raw('/', 'br;q=0, gzip')).headers.get('content-encoding'), 'gzip', 'q=0 means "not acceptable"');
  assert.equal((await raw('/css/site.css', 'br')).headers.get('content-encoding'), 'br');
  assert.equal((await raw('/assets/logo-sm.webp', 'br')).headers.get('content-encoding'), null, 'images are already compressed');

  const http = await import('node:http');
  const size = (encoding) => new Promise((resolve) => {
    http.get(`${prod.url}/`, { headers: { 'accept-encoding': encoding } }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve(n));
    });
  });
  const [identity, brotli] = [await size('identity'), await size('br')];
  assert.ok(brotli < identity / 4, `homepage ${identity} → ${brotli} bytes`);
});

test('the static text handler cannot be used to escape public/', async () => {
  for (const p of ['/%2e%2e/server/config.js', '/..%5cserver%5cconfig.js', '/css/..%2f..%2fpackage.json', '/%00.css']) {
    assert.equal((await prod.get(p)).status, 404, p);
  }
});
