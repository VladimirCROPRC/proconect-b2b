import { resolve, join, sep } from 'node:path';
import { mkdir, readFile, readdir, rename, rmdir, rm, stat, realpath, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { openDatabase } from './sqlite.mjs';
import { migrateDatabase, isolateCopy } from './migrations.mjs';
import { localBucket, objectPath } from './objects.mjs';

const digest = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};

export async function importCopy(sqlPath, sourceObjects, dataRoot) {
  const root = resolve(dataRoot), target = join(root, 'app.sqlite'), filesTarget = join(root, 'files');
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (existsSync(join(root, 'copy-manifest.json'))) throw new Error('Există deja un manifest de copie. Folosește un director de date gol.');
  if (existsSync(target)) throw new Error('Copia are deja o bază de date. Importul refuză să o suprascrie.');
  if (existsSync(filesTarget) && (await readdir(filesTarget)).length) throw new Error('Directorul fișierelor nu este gol. Importul refuză suprascrierea.');
  const stage = join(root, `.import-${randomUUID()}`), stagedFiles = join(stage, 'files');
  await mkdir(stagedFiles, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(stage, 'app.sqlite'));
  let closed = false;
  try {
    db.exec(await readFile(sqlPath, 'utf8'));
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Exportul bazei de date nu a trecut verificarea de integritate.');
    migrateDatabase(db, { adoptCurrent: true });
    isolateCopy(db);
    const objectRoot = await realpath(sourceObjects), bucket = localBucket(stagedFiles), manifest = [];
    for (const file of db.prepare('SELECT id, storage_key, content_type, byte_size FROM project_files ORDER BY id').all()) {
      const candidate = resolve(objectRoot, file.storage_key);
      if (!candidate.startsWith(objectRoot + sep)) throw new Error(`Cheie R2 nesigură: ${file.id}`);
      const actual = await realpath(candidate);
      if (!actual.startsWith(objectRoot + sep)) throw new Error(`Legătură de fișier nesigură: ${file.id}`);
      const info = await stat(actual);
      if (!info.isFile() || info.size !== file.byte_size) throw new Error(`Fișier absent sau dimensiune diferită pentru ${file.id}. Importul a fost oprit.`);
      const before = await digest(actual);
      await bucket.put(file.storage_key, Readable.toWeb(createReadStream(actual)), { httpMetadata: { contentType: file.content_type } });
      if (before !== await digest(objectPath(stagedFiles, file.storage_key))) throw new Error(`Verificarea SHA-256 a eșuat: ${file.id}`);
      manifest.push({ id: file.id, key: file.storage_key, bytes: info.size, sha256: before });
    }
    const counts = Object.fromEntries(['app_users', 'projects', 'project_files', 'project_estimates', 'orange_oroc_tickets'].map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); closed = true;
    if (existsSync(target)) throw new Error('O bază de date a apărut în timpul importului. Oprește aplicația și reia pe un director gol.');
    if (existsSync(filesTarget)) await rmdir(filesTarget);
    await rename(stagedFiles, filesTarget);
    await writeFile(join(root, 'copy-manifest.json'), JSON.stringify({ source: 'proconect.online', createdAt: new Date().toISOString(), counts, files: manifest }, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(join(stage, 'app.sqlite'), target);
    return { counts, verifiedFiles: manifest.length };
  } finally { if (!closed) db.close(); await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const [sql, objects] = process.argv.slice(2);
  if (!sql || !objects) throw new Error('Utilizare: node server/selfhost/import-copy.mjs /imports/proconect.sql /imports/r2');
  console.log(JSON.stringify(await importCopy(sql, objects, process.env.PROCONECT_DATA_DIR || '/data')));
}
