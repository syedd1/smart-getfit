// SQLite connection + a minimal numbered-migration runner.
// Migrations are server/db/migrations/NNN_name.sql, applied in order, each in its own
// transaction; applied versions are recorded in schema_migrations.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export class MigrationError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'MigrationError';
  }
}

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');   // readers don't block the writer
  db.pragma('synchronous = NORMAL'); // safe with WAL, much faster than FULL
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function readMigrations(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set();
  return files.map((file) => {
    const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(file);
    if (!match) throw new MigrationError(`Bad migration filename "${file}" (expected NNN_name.sql)`);
    const version = Number(match[1]);
    if (seen.has(version)) throw new MigrationError(`Two migrations share version ${match[1]}`);
    seen.add(version);
    return { version, file, sql: fs.readFileSync(path.join(dir, file), 'utf8') };
  });
}

// Returns the list of migrations applied by this call (empty when up to date).
export function runMigrations(db, dir = MIGRATIONS_DIR) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all());
  const pending = readMigrations(dir).filter((m) => !applied.has(m.version));
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');

  for (const m of pending) {
    try {
      db.transaction(() => {
        db.exec(m.sql);
        record.run(m.version, m.file);
      })();
    } catch (err) {
      throw new MigrationError(`Migration ${m.file} failed and was rolled back: ${err.message}`, err);
    }
  }
  return pending.map((m) => m.file);
}
