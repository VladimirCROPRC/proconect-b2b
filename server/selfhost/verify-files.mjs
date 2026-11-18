import { resolve } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { openDatabase } from './sqlite.mjs';
import { objectPath } from './objects.mjs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const root = process.env.PROCONECT_DATA_DIR || '/data', db = openDatabase(resolve(root, 'app.sqlite'));
try {
  for (const file of db.prepare('SELECT id,storage_key,byte_size FROM project_files').all()) {
    if ((await stat(objectPath(resolve(root, 'files'), file.storage_key))).size !== file.byte_size) throw new Error(`Dimensiune invalidă: ${file.id}`);
  }
  const manifest = JSON.parse(await readFile(resolve(root, 'copy-manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(objectPath(resolve(root, 'files'), file.key))) hash.update(chunk);
    if (hash.digest('hex') !== file.sha256) throw new Error(`SHA-256 invalid: ${file.id}`);
  }
  console.log(`Verificare completă: ${manifest.files.length} fișiere copiate.`);
} finally { db.close(); }
