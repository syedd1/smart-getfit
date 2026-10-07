-- Products added in the admin panel. They live here rather than in data/products.json
-- (which a redeploy overwrites) and are shown after the products from that file.
-- id is also the URL (/products/<id>) and links photos in media.product_id, so it never
-- changes. category refers to a category id in data/products.json.
CREATE TABLE products (
  id          TEXT    PRIMARY KEY,
  brand       TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  size        TEXT    NOT NULL,
  flavour     TEXT,
  description TEXT    NOT NULL,
  price       INTEGER CHECK (price IS NULL OR price > 0),
  available   INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  featured    INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
