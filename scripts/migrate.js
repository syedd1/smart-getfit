// Apply pending database migrations: npm run migrate
// (The server also applies them on startup; this lets you run them on their own.)
import { loadConfig, ConfigError } from '../server/config.js';
import { openDatabase, runMigrations } from '../server/db/db.js';

try {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const applied = runMigrations(db);
  db.close();
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : `Migration failed: ${err.message}`);
  process.exit(1);
}
