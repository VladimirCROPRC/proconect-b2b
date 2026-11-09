import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function objectPath(root, key) {
  if (typeof key !== 'string' || !key || key.length > 2048) throw new Error('Cheie de fișier invalidă.');
  const hash = createHash('sha256').update(key).digest('hex');
  return join(root, hash.slice(0, 2), hash);
}

export function localBucket(root) {
  return {
    async put(key, value, options = {}) {
      const path = objectPath(root, key), temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
      try {
        if (value instanceof ReadableStream) await pipeline(Readable.fromWeb(value), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
        else await writeFile(temporary, new Uint8Array(value), { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
        await writeFile(`${path}.json`, JSON.stringify({ key, httpMetadata: options.httpMetadata ?? {} }), { mode: 0o600 });
      } finally { await unlink(temporary).catch(() => {}); }
    },
    async get(key) {
      const path = objectPath(root, key);
      try {
        const info = await stat(path);
        const metadata = JSON.parse(await readFile(`${path}.json`, 'utf8').catch(() => '{}'));
        return { body: Readable.toWeb(createReadStream(path)), size: info.size, httpMetadata: metadata.httpMetadata ?? {} };
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async delete(key) {
      const path = objectPath(root, key);
      await Promise.all([path, `${path}.json`].map(file => unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; })));
    },
  };
}
