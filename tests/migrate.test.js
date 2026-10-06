// The migration runner: order, idempotency, and rollback on failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, runMigrations, MigrationError } from '../server/db/db.js';

function migrationsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgfn-mig-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

test('the real migrations apply cleanly and only once', () => {
  const db = openDatabase(':memory:');
  assert.deepEqual(runMigrations(db), ['001_initial.sql']);
  assert.deepEqual(runMigrations(db), [], 'second run is a no-op');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
  assert.deepEqual(tables, ['media', 'schema_migrations', 'sessions']);
  db.close();
});

test('migrations run in numeric order', () => {
  const dir = migrationsDir({
    '002_add.sql': 'INSERT INTO t VALUES (2);',
    '001_create.sql': 'CREATE TABLE t (v INTEGER);',
  });
  const db = openDatabase(':memory:');
  assert.deepEqual(runMigrations(db, dir), ['001_create.sql', '002_add.sql']);
  assert.deepEqual(db.prepare('SELECT v FROM t').pluck().all(), [2]);
  db.close();
});

test('a failing migration is rolled back and reported, earlier ones stay applied', () => {
  const dir = migrationsDir({
    '001_ok.sql': 'CREATE TABLE a (v INTEGER);',
    '002_bad.sql': 'CREATE TABLE b (v INTEGER); INSERT INTO nope VALUES (1);',
  });
  const db = openDatabase(':memory:');
  assert.throws(() => runMigrations(db, dir), (err) => err instanceof MigrationError && /002_bad\.sql failed/.test(err.message));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
  assert.ok(tables.includes('a'));
  assert.ok(!tables.includes('b'), 'partial changes from the failed migration are rolled back');
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').pluck().all(), [1]);
  db.close();
});

test('bad filenames and duplicate versions are refused', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => runMigrations(db, migrationsDir({ 'init.sql': 'SELECT 1;' })), /Bad migration filename/);
  assert.throws(() => runMigrations(db, migrationsDir({ '001_a.sql': 'SELECT 1;', '001_b.sql': 'SELECT 1;' })), /share version 001/);
  db.close();
});

test('the media table enforces product/section consistency', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const insert = db.prepare('INSERT INTO media (filename_base, product_id, section, width, height) VALUES (?, ?, ?, 100, 100)');
  insert.run('a1', 'cellucor-c4-original', 'product');
  insert.run('a2', null, 'hero');
  assert.throws(() => insert.run('a3', null, 'product'), /CHECK/);
  assert.throws(() => insert.run('a4', 'cellucor-c4-original', 'hero'), /CHECK/);
  assert.throws(() => insert.run('a5', null, 'sidebar'), /CHECK/);
  db.close();
});
