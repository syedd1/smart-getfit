// Upload pipeline and admin media API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { startApp, adminEnvironment, login } from './helpers.js';
import { detectImageType, processImage, variantWidths } from '../server/services/media.js';
import { createLocalStorage } from '../server/services/storage.js';

const PRODUCT = 'cellucor-c4-original';
const make = (w, h, format, color = '#c33') => sharp({ create: { width: w, height: h, channels: 3, background: color } })[format]().toBuffer();

// A tiny PNG whose header claims huge dimensions — the decompression-bomb shape.
// It holds a single row of pixel data: it must be refused from the header alone,
// before any decoding starts.
function pngHeaderOnly(width, height) {
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([length, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(1 + 3 * width))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

let app;
let admin;
before(async () => {
  app = await startApp(await adminEnvironment());
  admin = await login(app);
});
after(() => app.close());

function upload(files, fields = { section: 'product', productId: PRODUCT }, session = admin) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [buffer, name, type = 'image/jpeg'] of files) form.append('files', new Blob([buffer], { type }), name);
  return session.send('POST', '/api/admin/media', { body: form });
}

const rowCount = () => app.db.prepare('SELECT COUNT(*) FROM media').pluck().get();
const isWebp = (buf) => detectImageType(buf) === 'webp';

test('magic-byte detection ignores names and claimed types', async () => {
  assert.equal(detectImageType(await make(10, 10, 'jpeg')), 'jpeg');
  assert.equal(detectImageType(await make(10, 10, 'png')), 'png');
  assert.equal(detectImageType(await make(10, 10, 'webp')), 'webp');
  assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(detectImageType(Buffer.from('<svg onload="alert(1)"/>')), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

test('valid JPEG, PNG and WebP become WebP variants with no metadata', async () => {
  const jpeg = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#2a6' } })
    .jpeg().withExif({ IFD0: { Copyright: 'Store owner', Artist: 'Phone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '25/1 0/1 59/1' } }).toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif, 'fixture really has EXIF/GPS');

  const res = await upload([
    [jpeg, 'IMG_2041.jpg'],
    [await make(500, 300, 'png'), 'logo.png', 'image/png'],
    [await make(1600, 1600, 'webp'), 'shelf.webp', 'image/webp'],
  ]);
  assert.equal(res.status, 201);
  const { created, failed } = await res.json();
  assert.equal(created.length, 3);
  assert.deepEqual(failed, []);

  const [a, b, c] = created;
  assert.deepEqual([a.width, a.height], [2000, 1000]);
  assert.match(a.srcset, /-400\.webp 400w, .*-800\.webp 800w, .*-1600\.webp 1600w$/);
  assert.match(b.srcset, /-400\.webp 400w$/, 'a 500px image is not upscaled');
  assert.equal(variantWidths(1600).length, 3);
  assert.ok(!('filename_base' in a) && !JSON.stringify(a).includes(app.uploadDir), 'no internals in the response');

  for (const item of created) {
    for (const url of item.srcset.split(', ').map((s) => s.split(' ')[0])) {
      const file = await app.get(url);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get('content-type'), 'image/webp');
      const buf = Buffer.from(await file.arrayBuffer());
      assert.ok(isWebp(buf));
      const meta = await sharp(buf).metadata();
      assert.equal(meta.exif, undefined, 'EXIF/GPS stripped');
      assert.equal(meta.icc, undefined);
    }
  }
  assert.equal(app.files().length, 3 + 1 + 3);
  assert.ok(app.files().every((f) => /^[a-f0-9]{32}-\d+\.webp$/.test(f)), 'random names only');
});

test('EXIF orientation is applied, then dropped', async () => {
  const portraitTaggedSideways = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#555' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const out = await processImage(portraitTaggedSideways);
  assert.deepEqual([out.width, out.height], [600, 900]);
  const meta = await sharp(out.variants.at(-1).buffer).metadata(); // 600 wide → a single 400 px variant
  assert.deepEqual([meta.width, meta.height, meta.orientation], [400, 600, undefined]);
});

test('files that are not JPEG/PNG/WebP are refused, whatever their name', async () => {
  const before = rowCount();
  const filesBefore = app.files().length;
  const cases = [
    [Buffer.from('just text, not a picture'), 'photo.jpg'],
    [Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00'), 'anim.gif'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'logo.png', 'image/png'],
    [Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.php.jpg'],
  ];
  for (const file of cases) {
    const res = await upload([file]);
    assert.equal(res.status, 422, file[1]);
    const body = await res.json();
    assert.equal(body.error, 'upload_failed');
    assert.equal(body.failed[0].error, 'unsupported_type');
  }
  assert.equal(rowCount(), before);
  assert.equal(app.files().length, filesBefore);
});

test('a real PNG with a .jpg name is accepted as PNG', async () => {
  const res = await upload([[await make(64, 64, 'png'), 'actually-a-png.jpg', 'image/jpeg']]);
  assert.equal(res.status, 201);
});

test('right magic bytes but corrupt content: rejected, nothing written', async () => {
  const before = rowCount();
  const filesBefore = app.files().length;
  const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
  const truncated = (await make(800, 600, 'jpeg')).subarray(0, 600);
  for (const buf of [fakeJpeg, truncated]) {
    const res = await upload([[buf, 'broken.jpg']]);
    assert.equal(res.status, 422);
    assert.equal((await res.json()).failed[0].error, 'invalid_image');
  }
  assert.equal(rowCount(), before);
  assert.equal(app.files().length, filesBefore);
});

test('images over the pixel limit are refused before decoding', async () => {
  for (const [w, h] of [[10_000, 10_000], [20_000, 100]]) {
    const res = await upload([[pngHeaderOnly(w, h), 'bomb.png', 'image/png']]);
    assert.equal(res.status, 422, `${w}x${h}`);
    assert.equal((await res.json()).failed[0].error, 'image_too_large');
  }
});

test('files over the size limit get 413 and nothing is processed', async () => {
  const before = rowCount();
  const huge = Buffer.concat([await make(16, 16, 'jpeg'), Buffer.alloc(9 * 1024 * 1024)]);
  const res = await upload([[huge, 'huge.jpg']]);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'file_too_large');
  assert.equal(rowCount(), before);
});

test('malicious file names never reach the file system', async () => {
  const res = await upload([[await make(50, 50, 'png'), '../../../server/evil.js.png', 'image/png']]);
  assert.equal(res.status, 201);
  const nul = await upload([[await make(50, 50, 'png'), 'evil.js\u0000.png', 'image/png']]);
  assert.equal(nul.status, 400, 'a NUL byte in the name makes the upload malformed');
  assert.ok(!fs.existsSync(path.join(app.uploadDir, '..', '..', '..', 'server', 'evil.js')));
  assert.ok(app.files().every((f) => /^[a-f0-9]{32}-\d+\.webp$/.test(f)));
});

test('storage refuses any name that is not a generated image name', async () => {
  const storage = createLocalStorage({ dir: app.uploadDir });
  for (const name of ['../x.webp', '..\\x.webp', 'a/b.webp', 'evil.html', `${'a'.repeat(32)}-400.webp/../../x`, '', null]) {
    await assert.rejects(() => storage.put(name, Buffer.from('x')), /unsafe|outside/, String(name));
  }
});

test('malformed and empty uploads are rejected cleanly', async () => {
  const garbage = await admin.send('POST', '/api/admin/media', {
    body: '--xyz\r\nContent-Disposition: form-da', headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
  });
  assert.equal(garbage.status, 400);
  assert.equal((await garbage.json()).error, 'malformed_upload');

  const empty = await upload([]);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'no_files');

  const tooMany = await upload(Array.from({ length: 11 }, (_, i) => [Buffer.from('x'), `${i}.jpg`]));
  assert.equal(tooMany.status, 400);
  assert.equal((await tooMany.json()).error, 'too_many_files');
});

test('placement is validated: section, product id, alt length', async () => {
  const png = await make(20, 20, 'png');
  const cases = [
    [{ section: 'sidebar' }, 'invalid_input'],
    [{ section: 'product' }, 'invalid_input'],
    [{ section: 'product', productId: 'no-such-product' }, 'invalid_input'],
    [{ section: 'product', productId: '../../etc' }, 'invalid_input'],
    [{ section: 'hero', alt: 'x'.repeat(201) }, 'invalid_input'],
  ];
  for (const [fields, error] of cases) {
    const res = await upload([[png, 'a.png', 'image/png']], fields);
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.equal((await res.json()).error, error);
  }
});

test('update, reorder, replace and delete', async () => {
  const created = (await (await upload([
    [await make(900, 600, 'jpeg', '#111'), 'one.jpg'],
    [await make(900, 600, 'jpeg', '#222'), 'two.jpg'],
  ], { section: 'gallery', alt: 'Shelves' })).json()).created;
  const [one, two] = created;

  // update alt + move to hero
  const moved = await admin.send('PUT', `/api/admin/media/${one.id}`, { json: { alt: 'Front of the store', section: 'hero' } });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).media.section, 'hero');
  const toProductWithoutId = await admin.send('PUT', `/api/admin/media/${two.id}`, { json: { section: 'product' } });
  assert.equal(toProductWithoutId.status, 400);
  assert.equal((await admin.send('PUT', `/api/admin/media/${two.id}`, { json: { secret: 1 } })).status, 400);

  // reorder product images
  const p1 = (await (await upload([[await make(30, 30, 'png'), 'a.png', 'image/png']])).json()).created[0];
  const all = app.media.listAdmin().filter((m) => m.section === 'product' && m.productId === PRODUCT).map((m) => m.id);
  const reversed = [...all].reverse();
  const reordered = await admin.send('PUT', '/api/admin/media/reorder', { json: { section: 'product', productId: PRODUCT, ids: reversed } });
  assert.equal(reordered.status, 200);
  assert.deepEqual((await reordered.json()).media.map((m) => m.id), reversed);
  const stale = await admin.send('PUT', '/api/admin/media/reorder', { json: { section: 'product', productId: PRODUCT, ids: reversed.slice(1) } });
  assert.equal(stale.status, 409);

  // replace: new files, old files removed, same id
  const oldFiles = app.files().filter((f) => f.startsWith(two.src.split('/').pop().split('-')[0]));
  assert.ok(oldFiles.length > 0);
  const form = new FormData();
  form.append('file', new Blob([await make(1700, 900, 'png')], { type: 'image/png' }), 'new.png');
  const replaced = await admin.send('POST', `/api/admin/media/${two.id}/replace`, { body: form });
  assert.equal(replaced.status, 200);
  const after = (await replaced.json()).media;
  assert.equal(after.id, two.id);
  assert.notEqual(after.src, two.src);
  assert.deepEqual([after.width, after.height], [1700, 900]);
  for (const f of oldFiles) assert.ok(!app.files().includes(f), `old file ${f} removed`);

  // delete: row and every variant gone
  const base = after.src.split('/').pop().split('-')[0];
  const del = await admin.send('DELETE', `/api/admin/media/${two.id}`);
  assert.equal(del.status, 204);
  assert.ok(!app.files().some((f) => f.startsWith(base)));
  assert.equal(app.db.prepare('SELECT COUNT(*) FROM media WHERE id = ?').pluck().get(two.id), 0);
  assert.ok(app.logs.some((l) => l.msg === 'media deleted'));

  // unknown and invalid ids
  assert.equal((await admin.send('DELETE', `/api/admin/media/${two.id}`)).status, 404);
  assert.equal((await admin.send('PUT', '/api/admin/media/99999', { json: { alt: 'x' } })).status, 404);
  assert.equal((await admin.send('DELETE', '/api/admin/media/abc')).status, 400);
  assert.equal((await admin.send('DELETE', '/api/admin/media/-1')).status, 400);
  assert.ok(p1.id);
});

test('uploads show up on the public site straight away', async () => {
  const res = await upload([[await make(1800, 1000, 'jpeg', '#933'), 'hero.jpg']], { section: 'hero', alt: 'Our shop at night' });
  const hero = (await res.json()).created[0];
  // The homepage uses the first hero image; an earlier test already put one there.
  const heroIds = app.media.listAdmin().filter((m) => m.section === 'hero').map((m) => m.id);
  await admin.send('PUT', '/api/admin/media/reorder', { json: { section: 'hero', ids: [hero.id, ...heroIds.filter((id) => id !== hero.id)] } });
  const home = await (await app.get('/')).text();
  assert.ok(home.includes(hero.src), 'homepage renders the uploaded hero');
  assert.ok(home.includes('alt="Our shop at night"'));
  assert.match(home, /imagesrcset="[^"]*1600w/, 'the hero is preloaded responsively');

  const productPage = await (await app.get(`/products/${PRODUCT}`)).text();
  const firstPhoto = app.media.listAdmin().filter((m) => m.productId === PRODUCT).sort((a, b) => a.sortOrder - b.sortOrder)[0];
  assert.ok(productPage.includes(`srcset="${firstPhoto.srcset}"`), 'product page shows its first uploaded photo');

  const publicApi = await (await app.get(`/api/media/product/${PRODUCT}`)).json();
  assert.ok(publicApi.media.length > 0);
  assert.ok(publicApi.media.every((m) => !('sortOrder' in m) && !('createdAt' in m)), 'public API has no admin fields');
});

test('a write failure part-way leaves no files and no database row', async () => {
  const before = rowCount();
  const filesBefore = app.files();
  const original = app.media;
  // Fail the second variant write by making the upload dir read-only mid-way is OS-specific;
  // instead use a storage whose put() fails after the first file.
  const { createMediaService } = await import('../server/services/media.js');
  let writes = 0;
  const realStorage = createLocalStorage({ dir: app.uploadDir });
  const flaky = {
    put: async (name, buf) => { writes += 1; if (writes === 2) throw new Error('disk full'); return realStorage.put(name, buf); },
    remove: realStorage.remove,
  };
  const media = createMediaService({ db: app.db, storage: flaky, catalogue: app.data.catalogue, logger: { info() {}, warn() {} } });
  const image = await make(1000, 500, 'jpeg');
  await assert.rejects(() => media.create(image, { section: 'gallery', alt: '' }), /disk full/);
  assert.equal(rowCount(), before);
  assert.deepEqual(app.files(), filesBefore);
  assert.ok(original);
});

test('alt text loses control and direction-override characters', async () => {
  const res = await upload([[await make(20, 20, 'png'), 'a.png', 'image/png']], { section: 'gallery', alt: 'Whey\u0000 on‮ the shelf\u0007' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).created[0].alt, 'Whey on the shelf');
});

test('photos of products removed from products.json are not public', async () => {
  app.db.prepare("INSERT INTO media (filename_base, product_id, section, width, height) VALUES ('ffffffffffffffffffffffffffffffff', 'discontinued-product', 'product', 400, 400)").run();
  const all = (await (await app.get('/api/media')).json()).media;
  assert.ok(!all.some((m) => m.productId === 'discontinued-product'));
  const adminView = (await (await admin.send('GET', '/api/admin/media')).json()).media;
  assert.ok(adminView.some((m) => m.productId === 'discontinued-product' && m.productMissing), 'the admin still sees them, flagged');
});
