import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const catalogUrl = moduleUrl(await source('app/boq-catalog.ts'));
const budgetUrl = moduleUrl((await source('app/project-budget.ts')).replace('"./boq-catalog"', JSON.stringify(catalogUrl)));
const valuesUrl = moduleUrl(await source('app/estimate-values.ts'));
const reportUrl = moduleUrl((await source('app/technician-report.ts')).replace('"./estimate-values"', JSON.stringify(valuesUrl)));
const dates = await import(reportUrl);
const dailyUrl = moduleUrl((await source('app/daily-technician-report.ts')).replace('"./project-budget"', JSON.stringify(budgetUrl)).replace('"./technician-report"', JSON.stringify(reportUrl)));
const { buildDailyReport } = await import(dailyUrl);
const { dailyReportSheet } = await import(moduleUrl(await source('app/daily-report-workbook.ts')));
const { createExcelWorkbook } = await import(moduleUrl(await source('app/excel-export.ts')));
const technician = { username: 'tech', name: 'Technician' };
const at = date => dates.dayStart(date) + 3600000;
const row = (id, extras = {}) => ({ id, category: 'Manoperă', catalogPosition: '108', name: id, unit: 'buc', unitPrice: 10, quantity: 2, selected: true, evidence: '', ...extras });
const project = (rows, data = {}) => ({ id: 'RID', client: 'Client', estimate: JSON.stringify(rows), documentation: JSON.stringify(data) });
const photo = (section, date, category = 'photo', extras = {}) => ({ projectId: 'RID', section, category, uploadedBy: 'tech', uploadedAt: at(date), capturedAt: at(date), ...extras });
const build = extras => buildDailyReport({ technician, from: '2026-11-09', to: '2026-11-10', projects: [], photos: [], tickets: [], ...extras });

test('daily report dates each operation independently, ignoring other uploaders, materials and unrelated photos', () => {
  const report = build({ projects: [project([row('route-0-aerial'), row('site-patch'), row('manual-extra'), row('material-boat', { category: 'Material' })])], photos: [photo('route', '2026-11-09'), photo('site', '2026-11-10'), photo('client', '2026-11-10'), photo('route', '2026-11-10', 'photo', { uploadedBy: 'admin' })] });
  assert.deepEqual(report.days.map(day => [day.date, day.lines.map(line => line.name)]), [['2026-11-09', ['route-0-aerial']], ['2026-11-10', ['site-patch']]]);
  assert.equal(report.total, 40); assert.equal(report.undated.length, 1); assert.equal(report.undated[0].name, 'manual-extra');
});

test('latest operation photo is selected before date filtering and its stamped date is displayed', () => {
  const report = build({ to: '2026-11-09', projects: [project([row('site-patch')])], photos: [photo('site', '2026-11-09'), photo('site', '2026-11-10')] });
  assert.equal(report.days.length, 0); assert.equal(report.undated.length, 0);
  const stamped = build({ projects: [project([row('site-patch')])], photos: [photo('site', '2026-11-10', 'photo', { capturedAt: at('2026-11-09') })] });
  assert.equal(stamped.days[0].date, '2026-11-09');
});

test('splice junctions and individual intervention activities use their own record photographs', () => {
  const data = { route: { endpoints: { b: { id: 'j1' } } }, splices: { records: [{ id: 's1', junction: { id: 'j1' } }, { id: 's2', junction: { id: 'j2' } }] } };
  const report = build({ projects: [project([row('closure-j1'), row('additional-splices-j2'), row('intervention-op1'), row('intervention-op2')], data)], photos: [photo('route', '2026-11-10'), photo('splices', '2026-11-09', 's1:open'), photo('splices', '2026-11-10', 's2:closed'), photo('intervention-execution', '2026-11-09', 'op1:photo'), photo('intervention-execution', '2026-11-10', 'op2:photo')] });
  assert.deepEqual(report.days.map(day => day.lines.map(line => line.name).sort()), [['closure-j1', 'intervention-op1'], ['additional-splices-j2', 'intervention-op2']]);
});

test('field documentation works without a saved estimate, missing quantities remain unknown and no intervention is excluded', () => {
  const data = { route: { segments: [{ method: 'aerial', lengthMeters: 25, label: 'A-B', cableType: 'FO' }], aerialMaterials: {} }, intervention: { execution: { activities: [{ id: 'test', type: 'diagnostics' }] } } };
  const report = build({ projects: [{ id: 'RID', client: 'C', estimate: null, documentation: JSON.stringify(data) }], photos: [photo('route', '2026-11-09'), photo('intervention-execution', '2026-11-09', 'test:photo')] });
  assert.equal(report.days[0].total, 0); assert.equal(report.days[0].unpriced, 2);
  assert.equal(report.days[0].lines.find(line => line.code === '91').quantity, 25);
  assert.equal(report.days[0].lines.find(line => line.code === '111').quantity, null);
  const skipped = build({ projects: [project([row('site-patch')], { site: { noIntervention: true } })], photos: [photo('site', '2026-11-09')] });
  assert.equal(skipped.days.length, 0); assert.equal(skipped.undated.length, 0);
  const broken = build({ projects: [{ id: 'RID', client: 'C', estimate: 'broken', documentation: '{}' }] });
  assert.equal(broken.warnings.length, 1);
});

test('Orange daily totals use work dates, configured tariffs and per-package ticket quantities', () => {
  const ticket = (id, packageCode, extras = {}) => ({ id, ticketNumber: id, workDate: '2026-11-09', packageCode, technicianUsername: 'tech', ...extras });
  const report = build({ tickets: [ticket('1', 'SP2 FOA'), ticket('2', 'SP2 FOA'), ticket('3', 'SP1 FO'), ticket('4', 'SP2 FOA', { technicianUsername: 'other' }), ticket('5', 'SP2 FOA', { workDate: '2026-11-11' })] });
  assert.equal(report.total, 600); assert.equal(report.days[0].unpriced, 1);
  assert.equal(report.days[0].summary.find(item => item.code === 'SP2 FOA').quantity, 2);
  assert.equal(report.days[0].lines.find(line => line.code === 'SP1 FO').total, null);
});

test('daily XLSX contains typed dates, per-day totals, a non-duplicating period total and undated exclusions', () => {
  const report = build({ projects: [project([row('site-patch'), row('manual-extra')])], photos: [photo('site', '2026-11-09')], tickets: [{ id: '1', ticketNumber: 'FITT', workDate: '2026-11-10', packageCode: 'SP2 FOA', technicianUsername: 'tech' }] });
  const sheet = dailyReportSheet(report);
  assert.deepEqual(sheet.rows[0][0], { date: '2026-11-09' });
  const total = sheet.rows.find(row => row[0] === 'TOTAL PERIOADĂ');
  assert.deepEqual(total[10], { formula: 'K6+K8', value: 320 });
  assert.equal(sheet.rows.at(-1)[10], null);
  const result = spawnSync('python3', ['-c', `import io,sys,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None
for n in z.namelist(): E.fromstring(z.read(n))
try:
 import openpyxl,datetime
 w=openpyxl.load_workbook(io.BytesIO(z.fp.getvalue()),data_only=True)
 assert w.active['A5'].value==datetime.datetime(2026,11,9)
 assert w.active['K9'].value==320
except ImportError: pass`], { input: createExcelWorkbook(sheet) });
  assert.equal(result.status, 0, result.stderr.toString());
});

test('daily API enforces management access, joins real operations and excludes non-images and foreign photos', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE app_users(username TEXT,name TEXT,role TEXT); CREATE TABLE projects(id TEXT,client TEXT,technician_username TEXT,technician TEXT); CREATE TABLE project_field_documentation(project_id TEXT,content_json TEXT); CREATE TABLE project_estimates(project_id TEXT,content_json TEXT); CREATE TABLE project_files(project_id TEXT,section TEXT,category TEXT,uploaded_by TEXT,created_at INTEGER,captured_at INTEGER,content_type TEXT); CREATE TABLE orange_oroc_tickets(id TEXT,ticket_number TEXT,work_date TEXT,service_package_code TEXT,technician_username TEXT,technician_name TEXT); INSERT INTO app_users VALUES('tech','Technician','Tehnician'); INSERT INTO projects VALUES('RID','Client','other','Other');");
  db.prepare('INSERT INTO project_estimates VALUES(?,?)').run('RID', JSON.stringify([row('site-patch')]));
  for (const [user, type, date] of [['tech','image/jpeg','2026-11-09'], ['tech','application/pdf','2026-11-10'], ['admin','image/jpeg','2026-11-10']]) db.prepare('INSERT INTO project_files VALUES(?,?,?,?,?,?,?)').run('RID','site','photo',user,at(date),at(date),type);
  let session = null;
  globalThis.__dailyApi = { buildDailyReport, reportRange: dates.reportRange, currentSession: async () => session, isManagementRole: account => account.role === 'Admin', getRawDb: () => ({ prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async all() { return { results: db.prepare(sql).all(...args) }; } }; } }) };
  const code = (await source('app/api/daily-technician-reports/route.ts')).replace(/^import .*;$/gm, '');
  const { GET } = await import(moduleUrl('const {buildDailyReport,reportRange,currentSession,isManagementRole,getRawDb}=globalThis.__dailyApi;\n' + code));
  const request = (user = 'tech') => new Request(`https://example.test/api/daily-technician-reports?technician=${user}&from=2026-11-09&to=2026-11-10`);
  try {
    assert.equal((await GET(request())).status, 401);
    session = { account: { role: 'Tehnician' } }; assert.equal((await GET(request())).status, 403);
    session.account.role = 'Admin'; assert.equal((await GET(request('unknown'))).status, 400);
    const response = await GET(request()); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const { report } = await response.json(); assert.equal(report.days.length, 1); assert.equal(report.days[0].date, '2026-11-09'); assert.equal(report.total, 20);
    session.account.passwordResetRequired = true; assert.equal((await GET(request())).status, 401);
  } finally { delete globalThis.__dailyApi; db.close(); }
});
