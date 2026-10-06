#!/usr/bin/env bash
# Back up everything the site can't rebuild from Git:
#   - the SQLite database (photo records + admin sessions), copied safely while the
#     site is running and integrity-checked
#   - uploads/ (the processed photos)
#   - data/products.json and data/site.json (in case they were edited on the server)
# into one dated archive: backups/smart-getfit-YYYY-MM-DD_HHMMSS.tar.gz
#
#   npm run backup                         (or: bash scripts/backup.sh)
#   BACKUP_DIR=/home/me/backups KEEP_DAYS=30 bash scripts/backup.sh
#
# .env is NOT included: it holds secrets. Keep a copy of it somewhere safe yourself.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Paths come from .env (DATABASE_PATH, UPLOAD_DIR), with the same defaults as the server.
read -r DB_PATH UPLOAD_PATH < <(node --env-file-if-exists=.env -e '
  const path = require("path");
  const resolve = (p, d) => path.resolve(process.cwd(), (p || "").trim() || d);
  console.log(resolve(process.env.DATABASE_PATH, "var/smart-getfit.db"), resolve(process.env.UPLOAD_DIR, "uploads"));
')

if [ ! -f "$DB_PATH" ]; then
  echo "No database at $DB_PATH — has the server been started at least once?" >&2
  exit 1
fi

# SQLite's online backup API: a consistent copy even while the server is writing.
mkdir -p "$WORK/snapshot/data"
node -e '
  const Database = require("better-sqlite3");
  const [source, target] = process.argv.slice(1);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  db.backup(target).then(() => {
    db.close();
    // A single self-contained file (no -wal/-shm beside it); the server re-enables WAL.
    const copy = new Database(target);
    copy.pragma("journal_mode = DELETE");
    const result = copy.pragma("integrity_check", { simple: true });
    copy.close();
    if (result !== "ok") { console.error("Backup copy failed its integrity check: " + result); process.exit(1); }
  }).catch((err) => { console.error("Database backup failed: " + err.message); process.exit(1); });
' "$DB_PATH" "$WORK/snapshot/smart-getfit.db"

cp data/products.json data/site.json "$WORK/snapshot/data/"
mkdir -p "$WORK/snapshot/uploads" # present even when nothing has been uploaded yet
if [ -d "$UPLOAD_PATH" ]; then
  find "$UPLOAD_PATH" -maxdepth 1 -type f -name '*.webp' -exec cp {} "$WORK/snapshot/uploads/" \;
fi

mkdir -p "$BACKUP_DIR"
ARCHIVE="$BACKUP_DIR/smart-getfit-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK/snapshot" .
chmod 600 "$ARCHIVE" 2>/dev/null || true

# Keep only the last KEEP_DAYS days of archives.
find "$BACKUP_DIR" -maxdepth 1 -name 'smart-getfit-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

PHOTOS=$(find "$WORK/snapshot/uploads" -type f | wc -l | tr -d ' ')
echo "Backup written: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1), $PHOTOS photo files)"
