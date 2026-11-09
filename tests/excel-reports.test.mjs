import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const reportUrl = moduleUrl(await source('app/technician-report.ts'));
const reports = await import(reportUrl);
const excel = await import(moduleUrl(await source('app/excel-export.ts')));
const models = await import(moduleUrl((await source('app/workbook-models.ts')).replace('"./technician-report"', JSON.stringify(reportUrl))));

test('completion timestamps are stable, editable and cleared on reopening', () => {
  const { completionTimestamp } = reports;
  assert.equal(completionTimestamp('Planificat', null, 'Finalizat', undefined, 2000), 2000);
  assert.equal(completionTimestamp('Finalizat', 1000, 'Finalizat', undefined, 2000), 1000);
  assert.equal(completionTimestamp('Finalizat', null, 'Finalizat', undefined, 2000), null);
  assert.equal(completionTimestamp('Finalizat', null, 'Finalizat', 1000, 2000), 1000);
  assert.equal(completionTimestamp('Finalizat', 1000, 'În desfășurare', undefined, 2000), null);
  for (const invalid of [0, -1, 3000, '1000', NaN, 1.2]) assert.throws(() => completionTimestamp('Planificat', null, 'Finalizat', invalid, 2000));
});

test('project updates persist completion dates without changing them on ordinary edits', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE app_users(username TEXT,name TEXT,role TEXT,active INTEGER); INSERT INTO app_users VALUES ('tech','Tech','Tehnician',1); CREATE TABLE projects(id TEXT PRIMARY KEY,activity_type TEXT,client TEXT,address TEXT,contact TEXT,phone TEXT,email TEXT,requirements TEXT,technician TEXT,technician_username TEXT,cpe TEXT,cpe_requires_grounding INTEGER,sfp INTEGER,mc INTEGER,terminal_box INTEGER,status TEXT,scheduled_label TEXT,ipwo TEXT,splice TEXT,completed_at INTEGER,updated_at INTEGER); INSERT INTO projects(id,cpe,technician,technician_username,status) VALUES ('RID1','CPE','Tech','tech','Planificat');");
  const adapter = { prepare(sql) { let args=[]; return { bind(...values) { args=values; return this; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { return db.prepare(sql).run(...args); } }; }, async batch(statements) { for (const statement of statements) await statement.run(); } };
  const server = await source('app/project-server.ts');
  const body = server.slice(server.indexOf('export async function updateProject('), server.indexOf('export async function deleteProject('));
  const code = stripTypeScriptTypes(body, { mode: 'transform', disableExperimentalWarning: true });
  const update = new Function('getRawDb','validWorkIdentifier','completionTimestamp',code.replace('export async function','async function')+'; return updateProject;')(() => adapter, () => true, reports.completionTimestamp);
  const input={id:'RID1',activityType:'Instalare',client:'Client',address:'Address',contact:'Contact',phone:'123',email:'',requirements:'Work',technician:'Tech',cpe:'CPE',status:'Finalizat',date:'Astăzi',ipwo:'file',splice:'file'};
  try {
    const result=await update(input);
    assert.ok(result.project?.completedAt > 0);
    const completedAt=result.project.completedAt;
    assert.equal(db.prepare("SELECT completed_at FROM projects WHERE id='RID1'").get().completed_at,completedAt);
    const edited=await update({...input,client:'Client edited'});
    assert.equal(edited.project.completedAt,completedAt);
    await update({...input,status:'În desfășurare'});
    assert.equal(db.prepare("SELECT completed_at FROM projects WHERE id='RID1'").get().completed_at,null);
    db.exec("UPDATE app_users SET active=0");
    const manual=await update({...input,completedAt:1700000000000});
    assert.equal(manual.project.completedAt,1700000000000);
    assert.equal((await update({...input,completedAt:Date.now()+86400000})).status,400);
  } finally { db.close(); }
});

test('report periods include the entire local day and handle Romanian DST boundaries', () => {
  assert.equal(reports.dayStart('2026-11-09'), Date.parse('2026-11-08T22:00:00Z'));
  assert.equal(reports.reportRange('2026-03-29', '2026-03-29').end - reports.dayStart('2026-03-29'), 23 * 3600000);
  assert.equal(reports.reportRange('2026-10-25', '2026-10-25').end - reports.dayStart('2026-10-25'), 25 * 3600000);
  for (const date of ['2026-02-30', '2026-13-01', '', '2026-1-1', '2026-11-09 junk']) assert.equal(reports.dayStart(date), null);
  assert.equal(reports.reportRange('2026-11-10', '2026-11-09'), null);
  assert.equal(reports.localDate(Date.parse('2026-11-08T23:30:00Z')), '2026-11-09');
});

test('saved totals round each line and distinguish zero, missing and corrupt estimates', () => {
  const row = { id: 'one', quantity: 3, unitPrice: 3.5823 };
  assert.equal(reports.savedEstimateTotal(JSON.stringify([row, { ...row, id: 'two' }])), 21.5);
  assert.equal(reports.savedEstimateTotal(JSON.stringify([{ ...row, unitPrice: 0 }])), 0);
  for (const bad of [null, '[]', 'broken', JSON.stringify([row, row]), JSON.stringify([{ ...row, unitPrice: -1 }]), JSON.stringify([{ ...row, quantity: '3' }])]) assert.equal(reports.savedEstimateTotal(bad), null);
});

test('actual XLSX ZIP opens with independent XML/CRC reader, formulas and typed numeric values', () => {
  const sheet = models.estimateSheet({ id: 'RID1', client: '=MALICIOUS & Client', address: 'București <Centru>' }, [
    { id: 'a', catalogPosition: '108', name: '=1+1', unit: 'each/patchcord', quantity: 3, unitPrice: 3.5823, evidence: 'Șantier & client', note: 'până la 5 m' },
    { id: 'b', catalogPosition: '102', name: 'Acces', unit: 'each', quantity: 1, unitPrice: 14.09038, evidence: 'FO', note: '' },
  ]);
  const bytes = excel.createExcelWorkbook(sheet);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  const result = spawnSync('python3', ['-c', `import sys,zipfile,io,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None
for n in z.namelist(): E.fromstring(z.read(n))
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
w=E.fromstring(z.read('xl/worksheets/sheet1.xml')); cells={c.attrib['r']:c for c in w.findall('.//s:c',ns)}
assert cells['E5'].attrib.get('t') is None and cells['E5'].find('s:v',ns).text=='3'
assert cells['F5'].find('s:v',ns).text=='3.5823'
assert cells['C5'].attrib['t']=='inlineStr' and ''.join(cells['C5'].itertext())=='=1+1'
assert cells['G5'].find('s:f',ns).text=='ROUND(E5*F5,2)'
assert cells['G5'].find('s:v',ns).text=='10.75'
assert cells['G7'].find('s:f',ns).text=='SUM(G5:G6)'
assert cells['G7'].find('s:v',ns).text=='24.84'
assert w.find('s:autoFilter',ns).attrib['ref']=='A4:I6'
assert w.find('.//s:pane',ns).attrib['state']=='frozen'
assert 'București <Centru>' in ''.join(w.itertext())
try:
 import openpyxl
 workbook=openpyxl.load_workbook(io.BytesIO(z.fp.getvalue()),data_only=False)
 assert workbook['Deviz']['G5'].value=='=ROUND(E5*F5,2)'
 assert workbook['Deviz']['C5'].data_type=='s'
 values=openpyxl.load_workbook(io.BytesIO(z.fp.getvalue()),data_only=True)
 assert values['Deviz']['G7'].value==24.84
except ImportError: pass
print('XLSX structure, CRC, numeric cells, formulas, cached totals and Unicode verified')`], { input: bytes });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(result.stdout.toString(), /verified/);
});

test('report workbook includes null amounts as blank and a summable total', () => {
  const sheet = models.technicianReportSheet({ technician: { username: 'a', name: 'Andrei' }, from: '2026-11-01', to: '2026-11-30', works: [
    { id: 'RID1', activityType: 'Instalare', client: 'A', address: 'B', completedAt: reports.dayStart('2026-11-09'), total: 10.75, estimateStatus: 'salvat' },
    { id: 'RID2', activityType: 'Instalare', client: 'A', address: 'B', completedAt: reports.dayStart('2026-11-09'), total: null, estimateStatus: 'lipsă' },
  ], total: 10.75, missingEstimates: 1, undated: [] });
  assert.equal(sheet.rows[1][5], null);
  assert.deepEqual(sheet.rows[0][4], { date: '2026-11-09' });
  assert.deepEqual(sheet.rows[2][5], { formula: 'SUM(F5:F6)', value: 10.75 });
  const result = spawnSync('python3', ['-c', `import sys,io,zipfile,xml.etree.ElementTree as E
raw=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(raw)); assert z.testzip() is None
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
root=E.fromstring(z.read('xl/worksheets/sheet1.xml')); cells={c.attrib['r']:c for c in root.findall('.//s:c',ns)}
assert cells['E5'].attrib['s']=='5' and float(cells['E5'].find('s:v',ns).text)>45000
assert cells['F6'].find('s:v',ns) is None
try:
 import openpyxl,datetime
 w=openpyxl.load_workbook(io.BytesIO(raw),data_only=True)
 assert w.active['E5'].value==datetime.datetime(2026,11,9)
 assert w.active['F6'].value is None
except ImportError: pass`], { input: excel.createExcelWorkbook(sheet) });
  assert.equal(result.status, 0, result.stderr.toString());
});

test('completion migration backfills only actual intervention validation dates', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, status TEXT, activity_type TEXT, technician_username TEXT); CREATE TABLE project_field_documentation(project_id TEXT, content_json TEXT);");
  for (const [id, type, status] of [['I', 'Intervenție', 'Finalizat'], ['A', 'Instalare', 'Finalizat'], ['P', 'Intervenție', 'Planificat']]) db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run(id, status, type, 'tech');
  const validatedAt = reports.dayStart('2026-11-01');
  for (const id of ['I', 'P']) db.prepare('INSERT INTO project_field_documentation VALUES (?,?)').run(id, JSON.stringify({ intervention: { documentation: { validatedAt } } }));
  db.exec(await source('drizzle/0007_project_completion.sql'));
  assert.equal(db.prepare("SELECT completed_at FROM projects WHERE id='I'").get().completed_at, validatedAt);
  assert.equal(db.prepare("SELECT completed_at FROM projects WHERE id='A'").get().completed_at, null);
  assert.equal(db.prepare("SELECT completed_at FROM projects WHERE id='P'").get().completed_at, null);
  db.close();
});

test('report API enforces access and filters by username, final status and inclusive local dates', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE app_users(username TEXT, name TEXT, role TEXT); CREATE TABLE projects(id TEXT,client TEXT,address TEXT,activity_type TEXT,technician_username TEXT,technician TEXT,status TEXT,completed_at INTEGER); CREATE TABLE project_estimates(project_id TEXT,content_json TEXT);');
  db.exec("INSERT INTO app_users VALUES ('a','Same Name','Tehnician'),('b','Same Name','Tehnician');");
  const { start, end } = reports.reportRange('2026-11-09', '2026-11-09');
  for (const [id, user, status, at] of [['start','a','Finalizat',start],['late','a','Finalizat',end-1],['end','a','Finalizat',end],['other','b','Finalizat',start],['open','a','În desfășurare',start],['undated','a','Finalizat',null]]) db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(id,'Client','Address','Instalare',user,'Same Name',status,at);
  db.prepare('INSERT INTO project_estimates VALUES (?,?)').run('start',JSON.stringify([{id:'patch',quantity:3,unitPrice:3.5823}]));
  let session = null;
  globalThis.__techReports = { ...reports, currentSession: async () => session, isManagementRole: account => ['Admin','Manager','Coordonator'].includes(account.role),
    getRawDb: () => ({ prepare(sql) { let args=[]; return { bind(...values) { args=values; return this; }, async all() { return { results: db.prepare(sql).all(...args) }; } }; } }) };
  const code = (await source('app/api/technician-reports/route.ts')).replace(/^import .*;$/gm,'');
  const api = await import(moduleUrl('const {getRawDb,isManagementRole,currentSession,reportRange,savedEstimateTotal}=globalThis.__techReports;\n'+code));
  const request = query => new Request('https://example.test/api/technician-reports'+(query ? '?'+query : ''));
  try {
    assert.equal((await api.GET(request())).status,401);
    session={account:{role:'Tehnician'}}; assert.equal((await api.GET(request())).status,403);
    session.account.role='Admin';
    const list = await (await api.GET(request())).json(); assert.equal(list.technicians.length,2);
    assert.equal((await api.GET(request('technician=unknown&from=2026-11-09&to=2026-11-09'))).status,400);
    assert.equal((await api.GET(request('technician=a&from=2026-02-30&to=2026-11-09'))).status,400);
    const response=await api.GET(request('technician=a&from=2026-11-09&to=2026-11-09'));
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const {report}=await response.json();
    assert.deepEqual(report.works.map(work=>work.id),['start','late']);
    assert.equal(report.total,10.75); assert.equal(report.missingEstimates,1);
    assert.equal(report.works[1].total,null); assert.equal(report.works[1].estimateStatus,'lipsă');
    assert.equal(report.undated[0].id,'undated');
    session.account.passwordResetRequired=true; assert.equal((await api.GET(request())).status,401);
  } finally { delete globalThis.__techReports; db.close(); }
});
