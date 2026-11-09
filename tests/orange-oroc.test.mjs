import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const valuesUrl = moduleUrl(await source('app/estimate-values.ts'));
const reportUrl = moduleUrl((await source('app/technician-report.ts')).replace('"./estimate-values"', JSON.stringify(valuesUrl)));
const catalogUrl = moduleUrl(await source('app/orange-services.ts'));
const { orangeServicePackages } = await import(catalogUrl);
const { validateOrangeTicket } = await import(moduleUrl((await source('app/orange-oroc-data.ts')).replace('"./orange-services"', JSON.stringify(catalogUrl)).replace('"./technician-report"', JSON.stringify(reportUrl))));

test('QAF packages preserve all seven main codes and do not import the example quantities or specific works', () => {
  assert.deepEqual(orangeServicePackages.map(item => item.code), ['SP1 FO','SP2 FOA','SP3 FOA','CR4 FOA','SP5 FOU','CR6 FOU','CR7 FOU']);
  assert.deepEqual(orangeServicePackages.map(item => item.sourceRow), [4,5,6,7,8,9,10]);
  assert.ok(orangeServicePackages.every(item => item.unit === 'intervention' && item.description && item.label));
  assert.ok(orangeServicePackages.every(item => !('quantity' in item) && !('price' in item)));
});

test('ticket validation normalizes numbers, checks real calendar dates and accepts only QAF service packages', () => {
  const input = { ticketNumber: '  fitt00123  ', workDate: '2026-11-09', servicePackageCode: 'SP1 FO' };
  assert.deepEqual(validateOrangeTicket(input), { ...input, ticketNumber: 'FITT00123' });
  for (const service of orangeServicePackages) assert.ok(validateOrangeTicket({ ...input, servicePackageCode: service.code }));
  for (const workDate of ['2026-02-30','2026-13-01','','09.11.2026']) assert.equal(validateOrangeTicket({ ...input, workDate }), null);
  assert.ok(validateOrangeTicket({ ...input, workDate: '2028-02-29' }));
  for (const ticketNumber of ['', 'FITT 123', '<script>', 'x'.repeat(65)]) assert.equal(validateOrangeTicket({ ...input, ticketNumber }), null);
  for (const servicePackageCode of ['SP4 FOA','SP6 FOU','SP7 FOU','Directed drilling','invalid']) assert.equal(validateOrangeTicket({ ...input, servicePackageCode }), null);
});

test('Orange/OROC API persists create/edit with audit, rejects duplicates and restricts access to coordination', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(await source('drizzle/0010_orange_oroc_tickets.sql'));
  let session = null;
  const adapter = { prepare(sql) { let args = []; return {
    bind(...values) { args=values; return this; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { return db.prepare(sql).run(...args); },
  }; } };
  globalThis.__orangeApi = { getRawDb: () => adapter, currentSession: async () => session,
    sameOrigin: request => request.headers.get('Origin') === 'https://example.test',
    isManagementRole: account => ['Admin','Manager','Coordonator'].includes(account.role), validateOrangeTicket };
  const code = (await source('app/api/orange-oroc/route.ts')).replace(/^import .*;$/gm, '');
  const api = await import(moduleUrl('const {getRawDb,currentSession,sameOrigin,isManagementRole,validateOrangeTicket}=globalThis.__orangeApi;\n'+code));
  const input = { ticketNumber: 'fitt00123', workDate: '2026-11-09', servicePackageCode: 'CR4 FOA' };
  const request = (body=input, method='POST', origin='https://example.test') => new Request('https://example.test/api/orange-oroc', { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const get = () => api.GET(new Request('https://example.test/api/orange-oroc'));
  try {
    assert.equal((await get()).status,401);
    assert.equal((await api.POST(request())).status,401);
    session={account:{username:'tech',role:'Tehnician'}};
    assert.equal((await get()).status,403);
    assert.equal((await api.POST(request())).status,403);
    assert.equal((await api.PATCH(request({...input,id:'missing'},'PATCH'))).status,403);
    session={account:{username:'coord',role:'Coordonator'}};
    assert.equal((await api.POST(request(input,'POST','https://other.test'))).status,403);
    assert.equal((await api.POST(request({...input,workDate:'2026-02-30'}))).status,400);
    assert.equal((await api.POST(request({...input,servicePackageCode:'SP4 FOA'}))).status,400);
    const response=await api.POST(request()); assert.equal(response.status,201);
    const {ticket}=await response.json();
    assert.equal(ticket.ticketNumber,'FITT00123'); assert.equal(ticket.servicePackageCode,'CR4 FOA');
    assert.equal((await api.POST(request({...input,ticketNumber:'FITT00123'}))).status,409);
    assert.equal(db.prepare('SELECT count(*) AS n FROM orange_oroc_tickets').get().n,1);
    const created=db.prepare('SELECT * FROM orange_oroc_tickets').get();
    assert.equal(created.created_by,'coord');
    session.account={username:'manager',role:'Manager'};
    const edited=await api.PATCH(request({...input,id:ticket.id,ticketNumber:'FITT00456',workDate:'2026-11-10',servicePackageCode:'CR6 FOU'},'PATCH'));
    assert.equal(edited.status,200); assert.equal((await edited.json()).ticket.createdAt,ticket.createdAt);
    const restored=await get(); assert.equal(restored.headers.get('Cache-Control'),'no-store');
    const list=await restored.json(); assert.equal(list.tickets.length,1);
    assert.equal(list.tickets[0].ticketNumber,'FITT00456'); assert.equal(list.tickets[0].workDate,'2026-11-10');
    assert.equal(list.tickets[0].servicePackageCode,'CR6 FOU');
    const stored=db.prepare('SELECT * FROM orange_oroc_tickets').get();
    assert.equal(stored.created_by,'coord'); assert.equal(stored.updated_by,'manager'); assert.equal(stored.created_at,created.created_at);
    assert.equal((await api.PATCH(request({...input,id:'missing'},'PATCH'))).status,404);
    session.account.passwordResetRequired=true;
    assert.equal((await get()).status,401); assert.equal((await api.POST(request())).status,401);
  } finally { delete globalThis.__orangeApi; db.close(); }
});
