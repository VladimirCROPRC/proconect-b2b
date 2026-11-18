import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function migrationFiles(root = resolve('drizzle')) {
  const journal = JSON.parse(readFileSync(resolve(root, 'meta/_journal.json'), 'utf8'));
  return journal.entries.map(entry => {
    const name = `${entry.tag}.sql`, sql = readFileSync(resolve(root, name), 'utf8');
    return { name, sql, hash: createHash('sha256').update(sql).digest('hex') };
  });
}

export function assertCurrentSourceSchema(db, migrations = migrationFiles()) {
  const expected = new DatabaseSync(':memory:');
  try {
    for (const migration of migrations) expected.exec(migration.sql);
    const quote = name => `"${name.replaceAll('"', '""')}"`;
    for (const { name } of expected.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(column => column.name));
      for (const column of expected.prepare(`PRAGMA table_info(${quote(name)})`).all()) if (!columns.has(column.name)) throw new Error(`Exportul sursă nu are schema curentă: lipsește ${name}.${column.name}. Actualizează sursa înainte de copiere.`);
    }
  } finally { expected.close(); }
}

export function migrateDatabase(db, { adoptCurrent = false, migrations = migrationFiles() } = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS app_reporting_state(id TEXT PRIMARY KEY, signature TEXT NOT NULL, daily_date TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS app_reporting_months(month TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS selfhost_migrations(name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
  if (adoptCurrent) {
    assertCurrentSourceSchema(db, migrations);
    for (const migration of migrations) db.prepare('INSERT OR IGNORE INTO selfhost_migrations VALUES (?,?)').run(migration.name, migration.hash);
  }
  for (const migration of migrations) {
    const previous = db.prepare('SELECT hash FROM selfhost_migrations WHERE name=?').get(migration.name);
    if (previous) { if (previous.hash !== migration.hash) throw new Error(`Migrarea aplicată a fost modificată: ${migration.name}`); continue; }
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(migration.sql); db.prepare('INSERT INTO selfhost_migrations VALUES (?,?)').run(migration.name, migration.hash); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec('CREATE TABLE IF NOT EXISTS app_deleted_users(user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE, deleted_at INTEGER NOT NULL, deleted_by TEXT NOT NULL)');
  db.exec(`CREATE TABLE IF NOT EXISTS app_teams(
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS app_team_members(
    user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES app_teams(id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS app_team_members_team_idx ON app_team_members(team_id);`);
  db.exec('CREATE TABLE IF NOT EXISTS app_user_access(user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE, email TEXT NOT NULL COLLATE NOCASE UNIQUE)');
  db.exec(`CREATE TABLE IF NOT EXISTS app_user_roles(
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('Admin','Manager','Coordonator','Tehnician')),
    PRIMARY KEY(user_id,role)
  );
  INSERT OR IGNORE INTO app_user_roles(user_id,role)
    SELECT id,role FROM app_users WHERE role IN ('Admin','Manager','Coordonator','Tehnician');
  CREATE TABLE IF NOT EXISTS app_role_sessions(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    identity_hash TEXT NOT NULL, active_role TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS app_role_sessions_user_idx ON app_role_sessions(user_id);
  CREATE TRIGGER IF NOT EXISTS app_roles_keep_last_admin BEFORE DELETE ON app_user_roles
  WHEN OLD.role='Admin'
    AND EXISTS (SELECT 1 FROM app_users WHERE id=OLD.user_id AND active=1)
    AND NOT EXISTS (SELECT 1 FROM app_user_roles r JOIN app_users u ON u.id=r.user_id
      WHERE r.role='Admin' AND u.active=1 AND u.id!=OLD.user_id)
  BEGIN SELECT RAISE(ABORT,'LAST_ACTIVE_ADMIN'); END;`);
}

export function isolateCopy(db) {
  // These are local rows in the imported copy, never requests to either provider.
  const tables = ['app_role_sessions', 'app_sessions', 'google_drive_oauth_states', 'google_drive_file_sync', 'google_drive_project_folders', 'google_drive_settings', 'onedrive_oauth_states', 'onedrive_jobs', 'onedrive_connection'];
  db.exec('BEGIN IMMEDIATE');
  try { for (const table of tables) db.exec(`DELETE FROM ${table}`); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
