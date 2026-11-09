import { resolve } from 'node:path';
import { openDatabase } from './sqlite.mjs';
import { migrateDatabase } from './migrations.mjs';

const db = openDatabase(resolve(process.env.PROCONECT_DATA_DIR || '/data', 'app.sqlite'));
try {
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
  const tracked = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='selfhost_migrations'").get();
  if (existing && !tracked) throw new Error('Baza existentă nu este pregătită. Folosește import-copy.mjs pentru o copie verificată, nu rula migrările direct pe un export necunoscut.');
  migrateDatabase(db);
  console.log('Schema locală este pregătită.');
} finally { db.close(); }
