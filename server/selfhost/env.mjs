import { resolve } from 'node:path';
import { openDatabase, d1Adapter } from './sqlite.mjs';
import { localBucket } from './objects.mjs';

let database, objects;
export const env = new Proxy({}, { get(_target, name) {
  const root = process.env.PROCONECT_DATA_DIR || '/data';
  if (name === 'DB') return database ??= d1Adapter(openDatabase(resolve(root, 'app.sqlite')));
  if (name === 'BUCKET') return objects ??= localBucket(resolve(root, 'files'));
  // This runtime can never fall back to password login.
  if (name === 'PROCONECT_AUTH_MODE') return 'cloudflare-access';
  return typeof name === "string" ? process.env[name] : undefined;
} });
