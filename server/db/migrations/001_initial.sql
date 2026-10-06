-- Media metadata. Product data itself stays in data/products.json; product_id only
-- links an image to a product id from that file.
CREATE TABLE media (
  id            INTEGER PRIMARY KEY,
  filename_base TEXT    NOT NULL UNIQUE,          -- random name; files are <base>-<width>.webp
  product_id    TEXT,
  section       TEXT    NOT NULL CHECK (section IN ('product', 'hero', 'banner', 'gallery')),
  alt           TEXT    NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  width         INTEGER NOT NULL CHECK (width > 0),
  height        INTEGER NOT NULL CHECK (height > 0),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((section = 'product') = (product_id IS NOT NULL))
);
CREATE INDEX media_by_placement ON media (section, product_id, sort_order);

-- Admin sessions. Only a SHA-256 hash of the session token is stored; the raw token
-- exists only in the admin's cookie. Times are Unix milliseconds.
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT    NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);
