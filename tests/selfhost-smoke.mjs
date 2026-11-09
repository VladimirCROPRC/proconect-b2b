import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { openDatabase } from '../server/selfhost/sqlite.mjs';
import { migrateDatabase, isolateCopy } from '../server/selfhost/migrations.mjs';
import { localBucket } from '../server/selfhost/objects.mjs';
import { fixtureSql } from './selfhost-fixtures.mjs';

await mkdir('.sites-runtime/tmp', { recursive: true });
const root = await mkdtemp(resolve('.sites-runtime/tmp/smoke-'));
const db = openDatabase(join(root, 'app.sqlite')); db.exec(fixtureSql()); migrateDatabase(db, { adoptCurrent: true }); isolateCopy(db);
db.prepare('INSERT INTO app_user_access VALUES (?,?)').run('u1', 'tech@example.com');
db.prepare('INSERT INTO app_user_access VALUES (?,?)').run('u2', 'admin@example.com'); db.close();
await localBucket(join(root, 'files')).put('RID1/client/photo.jpg', new TextEncoder().encode('test').buffer);
const keys = await generateKeyPair('RS256'), audience = 'a'.repeat(64);
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test' };
await writeFile(join(root, 'jwks.json'), JSON.stringify({ keys: [jwk] }));
const jwt = email => new SignJWT({ email, type: 'app' }).setSubject(email).setIssuedAt().setExpirationTime('10m').setIssuer('https://test-team.cloudflareaccess.com').setAudience(audience).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(keys.privateKey);
const port = process.env.SELFHOST_TEST_PORT || '32771';
const child = spawn(process.execPath, ['--import', resolve('tests/selfhost-jwks-hook.mjs'), '.next-selfhost/standalone/server.js'], { env: { ...process.env, PROCONECT_SELF_HOSTED: '1', PROCONECT_DATA_DIR: root, PROCONECT_APP_URL: 'https://b2b.proconect.online', CF_ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com', CF_ACCESS_AUD: audience, SELFHOST_TEST_JWKS: join(root, 'jwks.json'), PORT: port, HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', value => { log += value; }); child.stderr.on('data', value => { log += value; });
const origin = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(log);
    try { if ((await fetch(origin + '/api/selfhost/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, log);
  assert.equal((await fetch(origin + '/api/projects')).status, 401);
  const technician = await jwt('tech@example.com'), admin = await jwt('admin@example.com');
  const headers = token => ({ 'Cf-Access-Jwt-Assertion': token, Origin: 'https://b2b.proconect.online', 'Content-Type': 'application/json' });
  const session = await (await fetch(origin + '/api/auth', { headers: headers(technician) })).json();
  assert.equal(session.authMode, 'cloudflare-access'); assert.equal(session.account.username, 'tech'); assert.equal(session.account.passwordResetRequired, false);
  const projects = await (await fetch(origin + '/api/projects', { headers: headers(technician) })).json();
  assert.equal(projects.projects[0].id, 'RID1');
  assert.equal((await fetch(origin + '/api/accounts', { headers: headers(technician) })).status, 403);
  assert.equal((await fetch(origin + '/api/auth', { method: 'POST', headers: headers(admin), body: JSON.stringify({ username: 'admin', password: 'ignored' }) })).status, 405);
  assert.equal((await fetch(origin + '/api/files/photo', { headers: headers(admin) })).status, 200);
  const image = await fetch(origin + '/api/files/photo', { headers: headers(admin) }); assert.equal(await image.text(), 'test');
  const ticket = await fetch(origin + '/api/orange-oroc', { method: 'POST', headers: headers(admin), body: JSON.stringify({ ticketNumber: 'FITT-SMOKE', workDate: '2026-11-09', servicePackageCode: 'SP2 FOA', technicianUsername: 'tech' }) });
  assert.equal(ticket.status, 201, await ticket.text());
  const list = await (await fetch(origin + '/api/orange-oroc', { headers: headers(technician) })).json(); assert.equal(list.tickets[0].ticketNumber, 'FITT-SMOKE');
  const forbidden = await fetch(origin + '/api/accounts', { method: 'PATCH', headers: { ...headers(admin), Origin: 'https://attacker.test' }, body: JSON.stringify({ username: 'tech', email: 'other@example.com' }) });
  assert.equal(forbidden.status, 403);
  console.log('Self-hosted HTTP smoke passed: Access-only login, local roles, copied projects, local files and Orange ticket writes.');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  await rm(root, { recursive: true, force: true });
}
