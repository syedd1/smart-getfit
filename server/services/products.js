// Products added in the admin panel.
//
// They are stored in SQLite, not in data/products.json: a redeploy (git pull) replaces
// that file, but the database lives outside the code. products.json stays the source of
// the built-in products, which the admin panel only lists.
//
// An added product is shown on the site only when
//   - it has at least one photo (so the site never shows a missing image),
//   - its category still exists in products.json, and
//   - its id is not used by a product or category in products.json (which can happen if
//     the file gains one later — the built-in product then wins).
// Otherwise it stays saved, and the admin panel says why it is hidden.
import { HttpError } from '../middleware/errors.js';

const COLUMNS = 'id, brand, name, category, size, flavour, description, price, available, featured, created_at, updated_at';

// The same shape as a product from products.json (minus the built-in image).
const toProduct = (row) => ({
  id: row.id,
  brand: row.brand,
  name: row.name,
  category: row.category,
  size: row.size,
  ...(row.flavour ? { flavour: row.flavour } : {}),
  description: row.description,
  ...(row.price ? { price: row.price } : {}),
  available: row.available === 1,
  featured: row.featured === 1,
});

export function createProductService({ db, base, media, logger, onChange: notify = () => {} }) {
  // As in the media service: the change is saved; a failed re-render is logged, not reported.
  const onChange = () => {
    try {
      notify();
    } catch (err) {
      logger.error('re-rendering pages after a product change failed', { err });
    }
  };

  const builtInIds = new Set(base.products.map((p) => p.id));
  const categoryById = new Map(base.categories.map((c) => [c.id, c]));

  const q = {
    all: db.prepare(`SELECT ${COLUMNS} FROM products ORDER BY created_at, id`),
    get: db.prepare(`SELECT ${COLUMNS} FROM products WHERE id = ?`),
    insert: db.prepare(`INSERT INTO products (id, brand, name, category, size, flavour, description, price, available, featured)
      VALUES (@id, @brand, @name, @category, @size, @flavour, @description, @price, @available, @featured)`),
    update: db.prepare(`UPDATE products SET brand = @brand, name = @name, category = @category, size = @size, flavour = @flavour,
      description = @description, price = @price, available = @available, featured = @featured,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = @id`),
    remove: db.prepare('DELETE FROM products WHERE id = ?'),
    withPhotos: db.prepare("SELECT DISTINCT product_id FROM media WHERE section = 'product'").pluck(),
    photoCount: db.prepare("SELECT COUNT(*) FROM media WHERE section = 'product' AND product_id = ?").pluck(),
    lastChanged: db.prepare('SELECT MAX(updated_at) FROM products').pluck(),
  };

  // 'live' | 'needs-photo' | 'id-taken' | 'no-category'
  function status(row, withPhotos) {
    if (builtInIds.has(row.id) || categoryById.has(row.id)) return 'id-taken';
    if (!categoryById.has(row.category)) return 'no-category';
    if (!withPhotos.has(row.id)) return 'needs-photo';
    return 'live';
  }

  const toAdmin = (row, withPhotos) => ({
    ...toProduct(row),
    flavour: row.flavour,
    price: row.price,
    categoryName: categoryById.get(row.category)?.name ?? row.category,
    builtIn: false,
    status: status(row, withPhotos),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  const photoSet = () => new Set(q.withPhotos.all());

  function mustGet(id) {
    const row = q.get.get(id);
    if (!row) throw new HttpError(404, 'not_found', 'That product no longer exists.');
    return row;
  }

  function checkCategory(category) {
    if (!categoryById.has(category)) throw new HttpError(400, 'invalid_input', 'Choose one of the existing categories.');
  }

  const toRow = (id, input) => ({
    id,
    brand: input.brand,
    name: input.name,
    category: input.category,
    size: input.size,
    flavour: input.flavour,
    description: input.description,
    price: input.price,
    available: input.available ? 1 : 0,
    featured: input.featured ? 1 : 0,
  });

  return {
    // Added products that belong on the site, in the order they were added.
    visible() {
      const withPhotos = photoSet();
      return q.all.all().filter((row) => status(row, withPhotos) === 'live').map(toProduct);
    },

    // Any saved added product, shown or not: photos may be attached to it.
    exists(id) {
      return q.get.get(id) !== undefined;
    },

    lastChanged() {
      const latest = q.lastChanged.get();
      return latest ? new Date(latest) : null;
    },

    // Built-in products first (read-only), then added ones.
    listAdmin() {
      const withPhotos = photoSet();
      const builtIn = base.products.map((p) => ({
        id: p.id, brand: p.brand, name: p.name, category: p.category, categoryName: categoryById.get(p.category).name,
        size: p.size, flavour: p.flavour ?? null, description: p.description, price: p.price ?? null,
        available: p.available, featured: p.featured, builtIn: true, status: 'built-in',
      }));
      return [...builtIn, ...q.all.all().map((row) => toAdmin(row, withPhotos))];
    },

    categories() {
      return base.categories.map((c) => ({ id: c.id, name: c.name }));
    },

    create(input) {
      if (builtInIds.has(input.id)) throw new HttpError(409, 'id_taken', 'A built-in product already uses this web address. Choose another one.');
      if (categoryById.has(input.id)) throw new HttpError(409, 'id_taken', 'A category already uses this web address. Choose another one.');
      checkCategory(input.category);
      const row = db.transaction(() => {
        if (q.get.get(input.id)) throw new HttpError(409, 'id_taken', 'Another product already uses this web address. Choose another one.');
        // Photos left from a removed products.json product would otherwise attach themselves.
        if (q.photoCount.get(input.id) > 0) {
          throw new HttpError(409, 'id_taken', 'Photos of an old product still use this web address. Delete them in Photos first, or choose another address.');
        }
        q.insert.run(toRow(input.id, input));
        return q.get.get(input.id);
      })();
      logger.info('product added', { id: row.id });
      onChange();
      return toAdmin(row, photoSet());
    },

    update(id, input) {
      checkCategory(input.category);
      const row = db.transaction(() => {
        mustGet(id);
        q.update.run(toRow(id, input));
        return q.get.get(id);
      })();
      logger.info('product updated', { id });
      onChange();
      return toAdmin(row, photoSet());
    },

    // Deletes the product and its photos — except when a built-in product now uses the
    // same id: the photos then belong to that product and stay.
    async remove(id) {
      mustGet(id);
      const deleteRow = () => {
        if (q.remove.run(id).changes === 0) throw new HttpError(404, 'not_found', 'That product no longer exists.');
      };
      if (builtInIds.has(id)) db.transaction(deleteRow)();
      else await media.removeProductPhotos(id, deleteRow);
      logger.info('product deleted', { id });
      onChange();
    },
  };
}
