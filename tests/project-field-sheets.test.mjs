import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const { spliceFieldSheet, materialFieldSheet, fieldSheetExcel, fieldSheetPrintHtml } = await import(moduleUrl(await source('app/project-field-sheets.ts')));
const { createExcelWorkbook } = await import(moduleUrl(await source('app/excel-export.ts')));
const project = { id: 'RID1', client: 'Șantier & client', address: 'București', splice: 'Diagrama.pdf' };
const record = { id: 's1', junction: { code: 'J1', name: 'Joncțiune', documented: false, lat: 44.1234567, lon: 26.1234567 }, junctionKind: 'new', network: 'mobile', siteBuffer: 'Roșu', siteFiber: '1', clientBuffer: 'Albastru', clientFiber: '2' };

test('restored splice sheet preserves correspondence, location, networks and historical multi-connection records', () => {
  const sheet = spliceFieldSheet(project, { splices: { records: [record, record, { ...record, id: 's2', siteCableType: 'FO 24', clientCableType: 'FO 12', connections: [{ siteBuffer: '1', siteFiber: '3', clientBuffer: '2', clientFiber: '4' }, { siteBuffer: '1', siteFiber: '5', clientBuffer: '2', clientFiber: '6' }] }] } });
  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.rows[0][1], 'J1'); assert.equal(sheet.rows[0][3], 'Nouă / Vodafone Mobil');
  assert.equal(sheet.rows[0][4], '44.123457, 26.123457');
  assert.equal(sheet.rows[0][6], 'Roșu / 1'); assert.equal(sheet.rows[0][8], 'Albastru / 2');
  assert.equal(sheet.rows[2][5], 'FO 24'); assert.equal(sheet.rows[2][8], '2 / 6');
  assert.match(sheet.notes.join(' '), /Total suduri: 3/);
  assert.match(sheet.notes.join(' '), /Diagrama.pdf/);
});

test('no intervention and legacy totals do not invent splice connections', () => {
  const empty = spliceFieldSheet(project, { splices: { noIntervention: true, noInterventionReason: 'Nu este necesar', records: [record] } });
  assert.equal(empty.rows.length, 0); assert.match(empty.notes[0], /Nu este necesar/);
  const legacy = spliceFieldSheet(project, { splices: { count: 9 } });
  assert.equal(legacy.rows.length, 0); assert.match(legacy.notes[0], /9 suduri salvate ca total/);
  assert.match(spliceFieldSheet(project, {}).notes[0], /Nu există suduri/);
});

test('material sheet groups cables and equipment, separates owners and respects no-intervention flags', () => {
  const data = { client: { equipment: ['CPE A', 'SFP optic', 'SFP optic'] }, route: { segments: [{ cableType: 'FO 24', lengthMeters: 10.5 }, { cableType: 'FO 24', lengthMeters: 20.25 }], aerialMaterials: { boat: 2, stainlessClamp: 3, hook: 4, armorod: 0 } } };
  const sheet = materialFieldSheet(project, data);
  assert.deepEqual(sheet.rows.find(row => row[1] === 'FO 24'), ['Vodafone', 'FO 24', 30.75, 'm']);
  assert.deepEqual(sheet.rows.find(row => row[1] === 'SFP optic'), ['Vodafone', 'SFP optic', 2, 'buc.']);
  assert.deepEqual(sheet.rows.find(row => row[1] === 'Cârlig'), ['Proconect', 'Cârlig', 4, 'buc.']);
  assert.equal(sheet.rows.some(row => row[1] === 'Armorod'), false);
  const skipped = materialFieldSheet(project, { client: { ...data.client, noIntervention: true }, route: { ...data.route, noIntervention: true } });
  assert.equal(skipped.rows.length, 0);
  assert.equal(materialFieldSheet(project, {}).rows.length, 0);
  const historical = materialFieldSheet(project, { client: { equipment: ['SFP optic'], sfpType: 'SFP 10G', sfpQuantity: 4 } });
  assert.deepEqual(historical.rows[0], ['Vodafone', 'SFP 10G', 4, 'buc.']);
});

test('restored XLSX sheets have metadata, typed quantities and an empty A2; print output is isolated and escaped', () => {
  const malicious = { ...project, client: '<script>alert(1)</script>' };
  const material = materialFieldSheet(project, { client: { equipment: ['CPE A'] } });
  const sheets = [fieldSheetExcel(spliceFieldSheet(project, { splices: { records: [record] } })), fieldSheetExcel(material)];
  const result = spawnSync('python3', ['-c', `import sys,io,zipfile,xml.etree.ElementTree as E
raw=sys.stdin.buffer.read();z=zipfile.ZipFile(io.BytesIO(raw));assert z.testzip() is None
for n in z.namelist():E.fromstring(z.read(n))
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
sheet=E.fromstring(z.read('xl/worksheets/sheet2.xml'));c={x.attrib['r']:x for x in sheet.findall('.//s:c',ns)}
assert c['A2'].find('s:is',ns) is None
assert c['F5'].find('s:v',ns).text=='1'
try:
 import openpyxl
 w=openpyxl.load_workbook(io.BytesIO(raw),data_only=True)
 assert w.sheetnames==['Fișă de suduri','Fișă de materiale']
 assert w.worksheets[0]['J5'].value=='Roșu / 1'
 assert w.worksheets[1]['B5'].value=='Șantier & client'
except ImportError:pass`], { input: createExcelWorkbook(sheets) });
  assert.equal(result.status, 0, result.stderr.toString());
  const print = fieldSheetPrintHtml(materialFieldSheet(malicious, {}));
  assert.match(print, /size:A4 landscape/); assert.match(print, /&lt;script&gt;/); assert.doesNotMatch(print, /<script>/);
  assert.doesNotMatch(print, /<button|navigation|Raport zilnic/);
});
