-- Small key/value store for server state. First use: a fingerprint of the admin
-- credentials, so changing the password or username logs out every existing session.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
