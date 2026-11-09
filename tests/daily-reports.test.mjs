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
const { dailyReportSheets } = await import(moduleUrl(await source('app/daily-report-workbook.ts')));
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

test('daily export groups each work once across days, separates Orange and preserves unknown and undated amounts', () => {
  const report = build({ projects: [project([row('site-patch'), row('route-0-aerial'), row('manual-extra')])], photos: [photo('site', '2026-11-09'), photo('route', '2026-11-10')], tickets: [{ id: '1', ticketNumber: 'RID', workDate: '2026-11-10', packageCode: 'SP2 FOA', technicianUsername: 'tech' }, { id: '2', ticketNumber: 'FITT', workDate: '2026-11-10', packageCode: 'SP1 FO', technicianUsername: 'tech' }] });
  const [main, orange] = dailyReportSheets(report);
  assert.equal(main.rows.filter(row => row[2] === 'RID').length, 1);
  assert.equal(orange.rows.filter(row => row[2] === 'RID').length, 1);
  assert.equal(main.rows[0][6], 40);
  assert.equal(main.dataRowCount,1); assert.equal(orange.dataRowCount,2);
  assert.equal(main.rows[0][0], '2026-11-09\n2026-11-10');
  assert.match(main.rows[0][4], /site-patch/); assert.match(main.rows[0][4], /route-0-aerial/);
  assert.match(main.rows[0][7], /1 manopere fără dată/);
  assert.equal(orange.rows.find(row => row[2] === 'FITT')[6], null);
  assert.deepEqual(main.rows[2][6], { formula: "'Orange OROC'!G7", value: 300 });
  assert.deepEqual(main.rows[3][6], { formula: 'SUM(G6:G7)', value: 340 });
  const undated = dailyReportSheets(build({ projects: [project([row('manual-extra')])] }));
  assert.equal(undated[0].rows[0][6], null);
  assert.equal(undated[0].rows.at(-1)[6].value, 0);
});

test('two-sheet XLSX opens independently with cross-sheet formulas, cached totals and typed dates', () => {
  const report = build({ projects: [project([row('site-patch')])], photos: [photo('site', '2026-11-09')], tickets: [{ id: '1', ticketNumber: 'FITT', workDate: '2026-11-10', packageCode: 'SP2 FOA', technicianUsername: 'tech' }] });
  const sheets = dailyReportSheets(report);
  const result = spawnSync('python3', ['-c', `import io,sys,zipfile,xml.etree.ElementTree as E
raw=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(raw)); assert z.testzip() is None
for n in z.namelist(): E.fromstring(z.read(n))
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
wb=E.fromstring(z.read('xl/workbook.xml')); assert [s.attrib['name'] for s in wb.find('s:sheets',ns)]==['Raport zilnic','Orange OROC']
w=E.fromstring(z.read('xl/worksheets/sheet1.xml')); cells={c.attrib['r']:c for c in w.findall('.//s:c',ns)}
assert cells['G7'].find('s:f',ns).text=="'Orange OROC'!G6"
assert cells['G8'].find('s:v',ns).text=='320'
assert w.find('s:autoFilter',ns).attrib['ref']=='A4:H5'
try:
 import openpyxl,datetime
 w=openpyxl.load_workbook(io.BytesIO(raw),data_only=True)
 assert w.sheetnames==['Raport zilnic','Orange OROC']
 assert w.worksheets[0]['A5'].value==datetime.datetime(2026,11,9)
 assert w.worksheets[0]['G8'].value==320
 assert w.worksheets[1]['G5'].value==300
 f=openpyxl.load_workbook(io.BytesIO(raw),data_only=False)
 assert f.worksheets[0]['G7'].value=="='Orange OROC'!G6"
except ImportError: pass`], { input: createExcelWorkbook(sheets) });
  assert.equal(result.status, 0, result.stderr.toString());
});

test('two-sheet export keeps valid zero totals for empty sides without circular references', () => {
  const [main, orange] = dailyReportSheets(build({}));
  assert.equal(main.rows.length, 3); assert.equal(orange.rows.length, 1);
  assert.deepEqual(main.rows[0][6], { formula: '0', value: 0 });
  assert.deepEqual(main.rows[1][6], { formula: "'Orange OROC'!G5", value: 0 });
  assert.deepEqual(main.rows[2][6], { formula: 'SUM(G5:G6)', value: 0 });
  assert.deepEqual(orange.rows[0][6], { formula: '0', value: 0 });
  const base = { ...main, rows: [] };
  assert.throws(() => createExcelWorkbook([]));
  assert.throws(() => createExcelWorkbook([base, base]));
  assert.throws(() => createExcelWorkbook({ ...base, name: 'Orange/OROC' }));
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
