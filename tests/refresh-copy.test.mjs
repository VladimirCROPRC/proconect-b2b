import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fixtureSql } from './selfhost-fixtures.mjs';
import { importCopy } from '../server/selfhost/import-copy.mjs';
import { refreshCopy } from '../server/selfhost/refresh-copy.mjs';
import { openDatabase } from '../server/selfhost/sqlite.mjs';
import { localBucket } from '../server/selfhost/objects.mjs';

const temporaryRoot = resolve('.sites-runtime/tmp');
await mkdir(temporaryRoot, { recursive: true });

async function prepare() {
  const root = await mkdtemp(join(temporaryRoot, 'refresh-test-'));
  const sql = join(root, 'source.sql'), objects = join(root, 'r2'), data = join(root, 'data');
  await mkdir(join(objects, 'RID1/client'), { recursive: true });
  await writeFile(join(objects, 'RID1/client/photo.jpg'), 'test');
  await writeFile(sql, fixtureSql());
  await importCopy(sql, objects, data);
  const db = openDatabase(join(data, 'app.sqlite'));
  db.prepare('INSERT INTO app_user_access VALUES (?,?)').run('u2', 'admin@local.test');
  db.prepare('INSERT INTO app_teams VALUES (?,?,?)').run('local-team', 'Echipa locală', 'echipa locală');
  db.prepare('INSERT INTO app_team_members VALUES (?,?)').run('u1', 'local-team');
  db.prepare("INSERT INTO onedrive_connection(id,mode,generation,refresh_token,drive_id,root_id) VALUES ('onedrive','onedrive','local-generation','encrypted-local-refresh','local-drive','local-folder')").run();
  return { root, sql, objects, data, db };
}

function cloneProject(db, id) {
  const columns = db.prepare('PRAGMA table_info(projects)').all().map(column => column.name);
  return `INSERT INTO projects SELECT ${columns.map(column => column === 'id' ? `'${id}'` : `"${column}"`).join(',')} FROM projects WHERE id='RID1';`;
}

test('refresh updates source works and files, retains local accounts, Access mappings, teams, OneDrive and local-only works', async () => {
  const { root, sql, objects, data, db } = await prepare();
  try {
    const clone = cloneProject(db, 'LOCAL-ONLY'); db.exec(clone);
    const updated = fixtureSql() + cloneProject(db, 'RID2') + `
      UPDATE projects SET client='Production latest',updated_at=10 WHERE id='RID1';
      UPDATE project_files SET byte_size=6 WHERE id='photo';
      INSERT INTO project_estimates(project_id,content_json,updated_by,updated_at) VALUES ('RID1','[]','admin',10);
      INSERT INTO app_users(id,username,name,role,password_hash,password_salt,password_iterations,password_reset_required,active,jobs,created_at,updated_at)
        SELECT 'u3','newtech','New Technician',role,password_hash,password_salt,password_iterations,password_reset_required,active,0,10,10 FROM app_users WHERE id='u1';
      UPDATE projects SET technician_username='newtech',technician='New Technician' WHERE id='RID2';
      INSERT INTO orange_oroc_tickets(id,ticket_number,work_date,service_package_code,technician_username,technician_name,created_by,created_at,updated_by,updated_at)
        VALUES ('ticket-new','FITT-NEW','2026-11-18','SP2 FOA','newtech','New Technician','admin',10,'admin',10);
    `;
    db.close();
    await writeFile(sql, updated); await writeFile(join(objects, 'RID1/client/photo.jpg'), 'newest');
    const result = await refreshCopy(sql, objects, data);
    assert.equal(result.refreshedProjects, 2); assert.equal(result.addedUsers, 1);
    const local = openDatabase(join(data, 'app.sqlite'));
    try {
      assert.equal(local.prepare("SELECT client FROM projects WHERE id='RID1'").get().client, 'Production latest');
      assert.equal(local.prepare("SELECT COUNT(*) AS n FROM projects WHERE id='LOCAL-ONLY'").get().n, 1);
      assert.equal(local.prepare("SELECT email FROM app_user_access WHERE user_id='u2'").get().email, 'admin@local.test');
      assert.equal(local.prepare("SELECT team_id FROM app_team_members WHERE user_id='u1'").get().team_id, 'local-team');
      assert.equal(local.prepare("SELECT refresh_token FROM onedrive_connection").get().refresh_token, 'encrypted-local-refresh');
      assert.equal(local.prepare("SELECT COUNT(*) AS n FROM project_estimates").get().n, 1);
      assert.equal(local.prepare("SELECT COUNT(*) AS n FROM orange_oroc_tickets").get().n, 1);
      assert.equal(local.prepare("SELECT COUNT(*) AS n FROM onedrive_jobs WHERE revision>done_revision").get().n, 4);
      assert.deepEqual(local.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { local.close(); }
    assert.equal(await new Response((await localBucket(join(data, 'files')).get('RID1/client/photo.jpg')).body).text(), 'newest');
    assert.equal(await new Response((await localBucket(join(result.backup, 'files')).get('RID1/client/photo.jpg')).body).text(), 'test');
    const old = openDatabase(join(result.backup, 'app.sqlite'));
    try { assert.notEqual(old.prepare("SELECT client FROM projects WHERE id='RID1'").get().client, 'Production latest'); } finally { old.close(); }
    const repeated = await refreshCopy(sql, objects, data);
    assert.equal(repeated.counts.projects, result.counts.projects);
    assert.equal(repeated.addedUsers, 0);
    const manifest = JSON.parse(await readFile(join(data, 'copy-manifest.json'), 'utf8'));
    assert.equal(manifest.files.length, 1); assert.equal(manifest.files[0].bytes, 6);
    await writeFile(sql, updated + 'DELETE FROM project_files;');
    const withoutPhoto = await refreshCopy(sql, objects, data);
    assert.equal(withoutPhoto.counts.project_files, 0);
    assert.equal(withoutPhoto.verifiedFiles, 0);
    const finalManifest = JSON.parse(await readFile(join(data, 'copy-manifest.json'), 'utf8'));
    assert.equal(finalManifest.files.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing source objects and failed business-table writes leave the local copy unchanged', async () => {
  const { root, sql, objects, data, db } = await prepare();
  try {
    const original = db.prepare("SELECT client FROM projects WHERE id='RID1'").get().client;
    db.close();
    const manifest = await readFile(join(data, 'copy-manifest.json'), 'utf8');
    await rm(join(objects, 'RID1/client/photo.jpg'));
    await assert.rejects(refreshCopy(sql, objects, data));
    assert.equal(await readFile(join(data, 'copy-manifest.json'), 'utf8'), manifest);
    await writeFile(join(objects, 'RID1/client/photo.jpg'), 'test');
    const local = openDatabase(join(data, 'app.sqlite'));
    local.exec("CREATE TRIGGER reject_refresh BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT,'test rollback'); END"); local.close();
    await writeFile(sql, fixtureSql() + "UPDATE projects SET client='Must not commit' WHERE id='RID1';");
    await assert.rejects(refreshCopy(sql, objects, data), /test rollback/);
    const checked = openDatabase(join(data, 'app.sqlite'));
    try {
      assert.equal(checked.prepare("SELECT client FROM projects WHERE id='RID1'").get().client, original);
      assert.equal(checked.prepare("SELECT email FROM app_user_access WHERE user_id='u2'").get().email, 'admin@local.test');
    } finally { checked.close(); }
    assert.equal(await readFile(join(data, 'copy-manifest.json'), 'utf8'), manifest);
    assert.ok(existsSync(join(data, 'files')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
