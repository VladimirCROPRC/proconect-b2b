import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { openDatabase, d1Adapter } from '../server/selfhost/sqlite.mjs';
import { localBucket, objectPath } from '../server/selfhost/objects.mjs';
import { migrateDatabase } from '../server/selfhost/migrations.mjs';
import { importCopy } from '../server/selfhost/import-copy.mjs';

const temporaryRoot = resolve('.sites-runtime/tmp');
await mkdir(temporaryRoot, { recursive: true });
const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const access = await import(moduleUrl((await source('app/access-auth.ts')).replace('"jose"', JSON.stringify(import.meta.resolve('jose')))));
const issuer = 'https://test-team.cloudflareaccess.com', audience = 'a'.repeat(64);
const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test' };
const resolver = createLocalJWKSet({ keys: [jwk] });
const token = (overrides = {}) => new SignJWT({ email: 'tech@example.com', type: 'app', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(issuer).setAudience(audience).setSubject('subject').setIssuedAt().setExpirationTime('10m').sign(keys.privateKey);
const request = jwt => new Request('https://b2b.proconect.online/api/projects', { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });

import { fixtureSql, d1StyleFixtureSql } from './selfhost-fixtures.mjs';

test('Access requires signed app JWT with correct issuer, audience, expiration and verified email; bare email headers are ignored', async () => {
  const config = access.accessConfiguration(issuer, audience);
  assert.deepEqual(await access.accessIdentity(request(await token()), config, resolver), { email: 'tech@example.com', subject: 'subject' });
  assert.equal(await access.accessIdentity(request(), config, resolver), null);
  assert.equal(await access.accessIdentity(new Request('https://b2b.proconect.online', { headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' } }), config, resolver), null);
  assert.equal(await access.accessIdentity(request(await token({ type: 'org' })), config, resolver), null);
  assert.equal(await access.accessIdentity(request(await token({ email: 'invalid' })), config, resolver), null);
  assert.equal(await access.accessIdentity(request(await token()), { ...config, audience: 'b'.repeat(64) }, resolver), null);
  assert.equal(await access.accessIdentity(request(await token()), { ...config, issuer: 'https://other.cloudflareaccess.com' }, resolver), null);
  const expired = await new SignJWT({ email: 'tech@example.com', type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(issuer).setAudience(audience).setSubject('subject').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 20).sign(keys.privateKey);
  assert.equal(await access.accessIdentity(request(expired), config, resolver), null);
  assert.equal(await access.accessIdentity(request((await token()).slice(0, -12) + 'tamperedxxxx'), config, resolver), null);
  assert.throws(() => access.accessConfiguration('http://localhost', audience));
  assert.throws(() => access.accessConfiguration('https://test.cloudflareaccess.com.attacker.test', audience));
  assert.throws(() => access.accessConfiguration(issuer, undefined));
});

test('SQLite adapter preserves bound values, returning rows, changed-row counts and atomic batch rollback', async () => {
  const db = openDatabase(':memory:'), api = d1Adapter(db);
  try {
    await api.exec('CREATE TABLE demo(id TEXT PRIMARY KEY, n INTEGER)');
    assert.equal((await api.prepare('INSERT INTO demo VALUES (?,?)').bind('x', 2).run()).meta.changes, 1);
    assert.equal(await api.prepare('SELECT n FROM demo WHERE id=?').bind('x').first('n'), 2);
    assert.equal(await api.prepare('SELECT n FROM demo WHERE id=?').bind("x' OR 1=1 --").first(), null);
    await assert.rejects(api.batch([api.prepare('UPDATE demo SET n=9 WHERE id=?').bind('x'), api.prepare('INSERT INTO absent VALUES(1)')]));
    assert.equal(await api.prepare('SELECT n FROM demo').first('n'), 2);
    assert.equal((await api.prepare('DELETE FROM demo WHERE id=? RETURNING n').bind('x').first()).n, 2);
    assert.equal((await api.prepare('UPDATE demo SET n=3').run()).meta.changes, 0);
  } finally { db.close(); }
});

test('object storage roundtrips streams and metadata without interpreting object keys as filesystem paths', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'b2b-bucket-'));
  try {
    const bucket = localBucket(root), key = '../../unsafe/path';
    assert.ok(objectPath(root, key).startsWith(root + '/'));
    await bucket.put(key, new Blob(['test']).stream(), { httpMetadata: { contentType: 'text/plain' } });
    const object = await bucket.get(key);
    assert.equal(await new Response(object.body).text(), 'test'); assert.equal(object.size, 4);
    assert.equal(object.httpMetadata.contentType, 'text/plain');
    await bucket.delete(key); assert.equal(await bucket.get(key), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('copy import preserves production users, projects and file checksums while isolating local sessions and integrations', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'b2b-copy-'));
  try {
    const sql = join(root, 'source.sql'), objects = join(root, 'r2'), target = join(root, 'data');
    await writeFile(sql, fixtureSql()); await mkdir(join(objects, 'RID1/client'), { recursive: true });
    await writeFile(join(objects, 'RID1/client/photo.jpg'), 'test');
    const result = await importCopy(sql, objects, target);
    assert.equal(result.verifiedFiles, 1); assert.equal(result.counts.projects, 1); assert.equal(result.counts.app_users, 2);
    const db = openDatabase(join(target, 'app.sqlite'));
    try {
      assert.equal(db.prepare("SELECT password_hash FROM app_users WHERE username='tech'").get().password_hash, 'copied-hash');
      assert.equal(db.prepare('SELECT technician_username FROM projects').get().technician_username, 'tech');
      for (const table of ['app_sessions', 'onedrive_connection', 'onedrive_jobs']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
      migrateDatabase(db); // Repeated starts do not replay imported ALTER TABLE migrations.
    } finally { db.close(); }
    const object = await localBucket(join(target, 'files')).get('RID1/client/photo.jpg');
    assert.equal(await new Response(object.body).text(), 'test');
    const manifest = JSON.parse(await readFile(join(target, 'copy-manifest.json'), 'utf8'));
    assert.equal(manifest.files[0].sha256, '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    assert.equal(await readFile(join(objects, 'RID1/client/photo.jpg'), 'utf8'), 'test');
    await assert.rejects(importCopy(sql, objects, target), /deja|suprascrie/);
    const missingTarget = join(root, 'missing-target'); await rm(join(objects, 'RID1/client/photo.jpg'));
    await assert.rejects(importCopy(sql, objects, missingTarget)); assert.equal(existsSync(join(missingTarget, 'app.sqlite')), false);
    assert.deepEqual(await readdir(missingTarget), []);
    const outside = join(root, 'outside'); await writeFile(outside, 'test'); await symlink(outside, join(objects, 'RID1/client/photo.jpg'));
    await assert.rejects(importCopy(sql, objects, join(root, 'symlink-target')), /nesigură/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('D1 dump loads child tables before parents and still rejects dangling foreign keys', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'b2b-d1-order-'));
  try {
    const dump = d1StyleFixtureSql(), sql = join(root, 'source.sql'), objects = join(root, 'r2');
    assert.ok(dump.indexOf('INSERT INTO "app_sessions"') < dump.indexOf('CREATE TABLE `app_users`'));
    const before = openDatabase(':memory:');
    try { assert.throws(() => before.exec(dump), /no such table.*app_users/); } finally { before.close(); }
    await writeFile(sql, dump); await mkdir(join(objects, 'RID1/client'), { recursive: true });
    await writeFile(join(objects, 'RID1/client/photo.jpg'), 'test');
    const target = join(root, 'copy');
    assert.equal((await importCopy(sql, objects, target)).verifiedFiles, 1);
    const db = openDatabase(join(target, 'app.sqlite'));
    try { assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); } finally { db.close(); }
    await writeFile(sql, dump.replace("'old','u1','old-token'", "'old','absent-user','old-token'"));
    const invalid = join(root, 'invalid');
    await assert.rejects(importCopy(sql, objects, invalid), /integritate/);
    assert.equal(existsSync(join(invalid, 'app.sqlite')), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Access maps email to existing usernames and local roles, refuses unmapped/inactive users and disables password fallback', async () => {
  const db = openDatabase(':memory:'); db.exec(fixtureSql()); migrateDatabase(db, { adoptCurrent: true });
  db.prepare('INSERT INTO app_user_access VALUES (?,?)').run('u1', 'tech@example.com');
  const env = { DB: d1Adapter(db), PROCONECT_AUTH_MODE: 'cloudflare-access', PROCONECT_APP_URL: 'https://b2b.proconect.online', CF_ACCESS_TEAM_DOMAIN: issuer, CF_ACCESS_AUD: audience };
  globalThis.__selfhostAuth = { env, ...access, accessIdentity: (request, config) => access.accessIdentity(request, config, resolver) };
  const code = (await source('app/server-auth.ts')).replace(/^import .*;$/gm, '');
  const auth = await import(moduleUrl('const {env,accessConfiguration,accessIdentity,normalizedAccessEmail}=globalThis.__selfhostAuth;\n' + code));
  try {
    await auth.ensureInitialAccounts(); assert.equal(db.prepare('SELECT count(*) AS n FROM app_users').get().n, 2);
    const current = await auth.currentSession(request(await token({ role: 'Admin' })));
    assert.equal(current.account.username, 'tech'); assert.equal(current.account.role, 'Tehnician'); assert.equal(current.account.passwordResetRequired, false);
    assert.equal((await auth.signIn('tech', 'anything')).status, 405);
    assert.equal((await auth.updatePassword(request(), 'anything')).status, 405);
    assert.equal(await auth.currentSession(request()), null);
    assert.equal(await auth.currentSession(request(await token({ email: 'unmapped@example.com' }))), null);
    db.prepare('UPDATE app_users SET active=0 WHERE id=?').run('u1'); assert.equal(await auth.currentSession(request(await token())), null);
    db.prepare('UPDATE app_users SET active=1 WHERE id=?').run('u1');
    assert.equal(auth.sameOrigin(new Request('http://localhost:3000', { headers: { Origin: 'https://b2b.proconect.online' } })), true);
    assert.equal(auth.sameOrigin(new Request('https://b2b.proconect.online', { headers: { Origin: 'https://attacker.test' } })), false);
    assert.equal((await auth.setAccessEmail('admin', 'tech@example.com')).status, 409);
    assert.equal((await auth.setAccessEmail('missing', 'new@example.com')).status, 404);
    assert.equal((await auth.setAccessEmail('admin', 'admin@example.com')).email, 'admin@example.com');
    const added = await auth.addAccount({ username: 'newtech', name: 'New Technician', role: 'Tehnician', password: '', email: 'NEW@EXAMPLE.COM' });
    assert.equal(added.account.email, 'new@example.com'); assert.equal(added.account.passwordResetRequired, false);
    assert.equal((await auth.addAccount({ username: 'duplicate', name: 'Duplicate', role: 'Tehnician', password: '', email: 'new@example.com' })).status, 409);
    assert.equal(db.prepare('SELECT technician_username FROM projects').get().technician_username, 'tech');
  } finally { delete globalThis.__selfhostAuth; db.close(); }
});


test('teams preserve existing accounts, enforce one team per user and survive repeated migration', async () => {
  const teams = await import(moduleUrl(await source('app/server-teams.ts')));
  const db = openDatabase(':memory:');
  try {
    db.exec(fixtureSql()); migrateDatabase(db, { adoptCurrent: true });
    const adapter = d1Adapter(db);
    assert.equal((await teams.teamDirectory(adapter)).users.length, 2);
    assert.ok((await teams.teamDirectory(adapter)).users.every(user => user.teamId === null));
    await teams.changeTeam(adapter, { action: 'create', name: '  Echipa   Nord  ' });
    await assert.rejects(teams.changeTeam(adapter, { action: 'create', name: 'ECHIPA NORD' }), /deja/);
    await assert.rejects(teams.changeTeam(adapter, { action: 'create', name: ' ' }), /80/);
    await teams.changeTeam(adapter, { action: 'create', name: 'Sud' });
    const directory = await teams.teamDirectory(adapter);
    const north = directory.teams.find(team => team.name === 'Echipa Nord').id;
    const south = directory.teams.find(team => team.name === 'Sud').id;
    await teams.changeTeam(adapter, { action: 'assign', username: 'tech', teamId: north });
    await assert.rejects(teams.changeTeam(adapter, { action: 'delete', id: north }), /Mută/);
    await assert.rejects(teams.changeTeam(adapter, { action: 'assign', username: 'missing', teamId: north }), /nu există/);
    await assert.rejects(teams.changeTeam(adapter, { action: 'assign', username: 'tech', teamId: 'missing' }), /nu mai există/);
    await teams.changeTeam(adapter, { action: 'assign', username: 'tech', teamId: south });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_team_members').get().n, 1);
    await teams.changeTeam(adapter, { action: 'rename', id: south, name: 'Centru' });
    migrateDatabase(db);
    assert.equal((await teams.teamDirectory(adapter)).users.find(user => user.username === 'tech').teamId, south);
    assert.equal(db.prepare('SELECT technician_username FROM projects').get().technician_username, 'tech');
    assert.equal(db.prepare('SELECT role FROM app_users WHERE username=?').get('tech').role, 'Tehnician');
    await teams.changeTeam(adapter, { action: 'delete', id: north });
    await teams.changeTeam(adapter, { action: 'assign', username: 'tech', teamId: null });
    await teams.changeTeam(adapter, { action: 'delete', id: south });
    assert.equal((await teams.teamDirectory(adapter)).teams.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n, 2);
  } finally { db.close(); }
});
