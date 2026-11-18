import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../app/onedrive-client.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source, { mode: 'transform', disableExperimentalWarning: true });
const { readOneDriveResponse } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('OneDrive handles HTML error pages and Access login redirects without leaking raw page content', async () => {
  for (const status of [200, 403, 502, 504]) {
    const response = new Response('<!DOCTYPE html><html>private page contents</html>', { status, headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(readOneDriveResponse(response), error => error.message.includes(String(status)) && !error.message.includes('private page contents') && !error.message.includes('Unexpected token'));
  }
  const login = new Response('<!DOCTYPE html>', { headers: { 'Content-Type': 'text/html' } });
  Object.defineProperty(login, 'url', { value: 'https://proconect.cloudflareaccess.com/cdn-cgi/access/login/b2b.proconect.online' });
  await assert.rejects(readOneDriveResponse(login), /Sesiunea Cloudflare Access/);
});

test('OneDrive preserves API errors and successful results, and reports truncated JSON clearly', async () => {
  assert.deepEqual(await readOneDriveResponse(Response.json({ connected: true })), { connected: true });
  await assert.rejects(readOneDriveResponse(Response.json({ error: 'Acces rezervat administratorului.' }, { status: 403 })), /Acces rezervat administratorului/);
  await assert.rejects(readOneDriveResponse(new Response('{', { headers: { 'Content-Type': 'application/json' } })), /incomplet sau invalid/);
  await assert.rejects(readOneDriveResponse(Response.json(null)), /format invalid/);
});
