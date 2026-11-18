import { resolve, join } from 'node:path';
import { mkdir, readFile, writeFile, rename, cp, rm, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { backup } from 'node:sqlite';
import { openDatabase } from './sqlite.mjs';
import { migrateDatabase } from './migrations.mjs';
import { importCopy } from './import-copy.mjs';
import { objectPath } from './objects.mjs';

const workTables = ['projects', 'project_field_documentation', 'project_reports', 'project_estimates', 'project_files'];
const quote = name => '"' + name.replaceAll('"', '""') + '"';

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function upsert(db, table, row, primary = 'id') {
  const columns = Object.keys(row);
  const updates = columns.filter(column => column !== primary);
  db.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')})
    VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(${quote(primary)}) DO UPDATE SET
    ${updates.map(column => `${quote(column)}=excluded.${quote(column)}`).join(',')}`)
    .run(...columns.map(column => row[column]));
}

export async function refreshCopy(sqlPath, sourceObjects, dataRoot) {
  const root = resolve(dataRoot);
  const target = join(root, 'app.sqlite');
  if (!existsSync(target) || !existsSync(join(root, 'copy-manifest.json'))) {
    throw new Error('Lipsește copia inițială. Folosește import-copy.mjs pentru primul import.');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = `${stamp}-${randomUUID().slice(0, 8)}`;
  const stage = join(root, `.refresh-${runId}`);
  const sourceRoot = join(stage, 'source');
  const mergedFiles = join(stage, 'merged-files');
  const backupRoot = join(root, 'backups', `before-refresh-${runId}`);
  const filesRoot = join(root, 'files');
  const savedFiles = join(backupRoot, 'files');
  await mkdir(stage, { recursive: true, mode: 0o700 });
  let db, source, transaction = false, filesMoved = false, newFilesInstalled = false, committed = false;
  let oldManifest;
  try {
    // The full source and all referenced objects are verified in isolation first.
    const imported = await importCopy(sqlPath, sourceObjects, sourceRoot);
    source = openDatabase(join(sourceRoot, 'app.sqlite'));
    await cp(filesRoot, mergedFiles, { recursive: true });
    await cp(join(sourceRoot, 'files'), mergedFiles, { recursive: true, force: true });
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    oldManifest = await readFile(join(root, 'copy-manifest.json'));
    await writeFile(join(backupRoot, 'copy-manifest.json'), oldManifest, { mode: 0o600 });
    db = openDatabase(target);
    await backup(db, join(backupRoot, 'app.sqlite'));
    await writeFile(join(backupRoot, 'README.txt'),
      'Snapshot local înainte de actualizare. Oprește aplicația înainte de restaurare. app.sqlite, files și copy-manifest.json formează împreună copia de siguranță.\n',
      { mode: 0o600 });
    migrateDatabase(db);
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    let addedUsers = 0;
    for (const user of source.prepare('SELECT * FROM app_users ORDER BY username').all()) {
      if (db.prepare('SELECT id FROM app_users WHERE username=?').get(user.username)) continue;
      if (db.prepare('SELECT username FROM app_users WHERE id=?').get(user.id)) {
        throw new Error(`Identitatea utilizatorului ${user.username} intră în conflict cu un cont local.`);
      }
      const columns = Object.keys(user);
      db.prepare(`INSERT INTO app_users (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        .run(...columns.map(column => user[column]));
      addedUsers++;
    }
    const projects = source.prepare('SELECT * FROM projects ORDER BY id').all();
    for (const project of projects) {
      upsert(db, 'projects', project);
      // For works present in the source, their latest complete documentation
      // replaces the old snapshot, including deleted photos and estimate lines.
      for (const table of workTables.slice(1)) {
        db.prepare(`DELETE FROM ${quote(table)} WHERE project_id=?`).run(project.id);
        for (const row of source.prepare(`SELECT * FROM ${quote(table)} WHERE project_id=?`).all(project.id)) {
          upsert(db, table, row, table === 'project_files' ? 'id' : 'project_id');
        }
      }
    }
    const tickets = source.prepare('SELECT * FROM orange_oroc_tickets ORDER BY id').all();
    for (const ticket of tickets) {
      const local = db.prepare('SELECT id FROM orange_oroc_tickets WHERE ticket_number=?').get(ticket.ticket_number);
      upsert(db, 'orange_oroc_tickets', local ? { ...ticket, id: local.id } : ticket);
    }
    db.exec(`DELETE FROM onedrive_jobs WHERE kind='file' AND NOT EXISTS (SELECT 1 FROM project_files WHERE id=item_id);
      DELETE FROM onedrive_jobs WHERE kind='project' AND NOT EXISTS (SELECT 1 FROM projects WHERE id=item_id);
      DELETE FROM app_reporting_state;`);
    const connection = db.prepare("SELECT mode,refresh_token FROM onedrive_connection WHERE id='onedrive'").get();
    if (connection?.refresh_token && ['onedrive', 'both'].includes(connection.mode)) {
      for (const [kind, table] of [['project', 'projects'], ['file', 'project_files']]) {
        db.exec(`INSERT INTO onedrive_jobs(id,kind,item_id,revision,done_revision,attempts,next_at,last_error)
          SELECT '${kind}:'||id,'${kind}',id,1,0,0,0,'' FROM ${table} WHERE true
          ON CONFLICT(id) DO UPDATE SET revision=revision+1,attempts=0,next_at=0,last_error=''`);
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length || db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('Actualizarea nu a trecut verificarea de integritate.');
    }
    const manifestFiles = [];
    for (const file of db.prepare('SELECT id,storage_key,byte_size FROM project_files ORDER BY id').all()) {
      const path = objectPath(mergedFiles, file.storage_key);
      const info = await stat(path);
      if (!info.isFile() || info.size !== file.byte_size) throw new Error(`Fișier invalid după actualizare: ${file.id}`);
      manifestFiles.push({ id: file.id, key: file.storage_key, bytes: info.size, sha256: await sha256(path) });
    }
    const counts = Object.fromEntries(['app_users', ...workTables, 'orange_oroc_tickets'].map(table =>
      [table, db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get().n]));
    const manifest = {
      source: 'proconect.online', createdAt: new Date().toISOString(), counts, files: manifestFiles,
      refreshedFrom: imported.counts, backup: backupRoot,
    };
    await writeFile(join(stage, 'copy-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await rename(filesRoot, savedFiles);
    filesMoved = true;
    await rename(mergedFiles, filesRoot);
    newFilesInstalled = true;
    await rename(join(stage, 'copy-manifest.json'), join(root, 'copy-manifest.json'));
    db.exec('COMMIT');
    transaction = false;
    committed = true;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { counts, refreshedProjects: projects.length, refreshedTickets: tickets.length, addedUsers,
      verifiedFiles: manifestFiles.length, backup: backupRoot };
  } catch (error) {
    if (transaction) { db.exec('ROLLBACK'); transaction = false; }
    if (!committed && filesMoved) {
      if (newFilesInstalled) await rename(filesRoot, join(stage, 'failed-files'));
      await rename(savedFiles, filesRoot);
      await writeFile(join(root, 'copy-manifest.json'), oldManifest, { mode: 0o600 });
    }
    throw error;
  } finally {
    source?.close();
    db?.close();
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const [sql, objects] = process.argv.slice(2);
  if (!sql || !objects) throw new Error('Utilizare: refresh-copy.mjs /imports/proconect-refresh.sql /imports/r2');
  console.log(JSON.stringify(await refreshCopy(sql, objects, process.env.PROCONECT_DATA_DIR || '/data')));
}
