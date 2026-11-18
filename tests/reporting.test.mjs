import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';
const source = path => readFile(new URL('../app/' + path, import.meta.url), 'utf8');
const url = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
let text = await source('reporting-workbook.ts');
for (const name of ['boq-catalog', 'orange-services']) text = text.replace('"./' + name + '"', JSON.stringify(url(await source(name + '.ts'))));
const { reportingSheets, reportingFilename } = await import(url(text));
const { createExcelWorkbook } = await import(url(await source('excel-export.ts')));
const tech = { name: 'Technician', username: 'tech' };
const entry = { username: 'tech', source: 'Vodafone', workId: 'RID1', date: '2026-11-18', code: '102', name: 'Custom estimate line', unit: 'buc', price: 12.5, quantity: 2 };

test('report rebuild reflects added, edited and deleted estimate lines without accumulating previous runs', () => {
  let sheets = reportingSheets([tech], [entry]);
  assert.equal(sheets[0].rows[0][2].value, 25);
  const added = { ...entry, code: '999', name: 'New coordinator operation', price: 7, quantity: 3 };
  sheets = reportingSheets([tech], [entry, added]);
  assert.equal(sheets[0].rows[0][2].value, 46);
  assert.ok(sheets[1].rows.some(row => row[2] === added.name && row[6].value === 21));
  assert.deepEqual(reportingSheets([tech], [entry, added]), sheets);
  assert.equal(reportingSheets([tech], [{ ...entry, quantity: 1 }])[0].rows[0][2].value, 12.5);
  assert.equal(reportingSheets([tech], [])[0].rows[0][2].value, 0);
});

test('new technicians get individual sheets, duplicate and invalid Excel names remain unique', () => {
  const users = [tech, { username: 'new', name: 'New Technician' }, { username: 'duplicate', name: 'Technician' }, { username: 'bad', name: "'Bad/Name:*?'" }];
  const sheets = reportingSheets(users, []);
  assert.equal(sheets.length, users.length + 1);
  assert.equal(sheets[2].name, 'New Technician');
  assert.equal(new Set(sheets.map(sheet => sheet.name)).size, sheets.length);
  const files = unzipSync(createExcelWorkbook(sheets));
  assert.ok(strFromU8(files['xl/workbook.xml']).includes('New Technician'));
});

test('different prices for the same operation stay distinct and unknown Orange tariffs are exposed', () => {
  const sheets = reportingSheets([tech], [entry, { ...entry, price: 15 }, { ...entry, source: 'Orange/OROC', workId: 'FITT1', code: 'SP2 FOA', name: 'Package', unit: 'intervention', quantity: 1, price: 300 }, { ...entry, source: 'Orange/OROC', workId: 'FITT2', code: 'SP1 FO', name: 'Unpriced', unit: 'intervention', quantity: 1, price: null }]);
  assert.equal(sheets[0].rows[0][2].value, 55);
  assert.equal(sheets[0].rows[0][3].value, 300);
  assert.equal(sheets[0].rows[0][4].value, 355);
  assert.equal(sheets[0].rows[0][5].value, 1);
  assert.equal(sheets[1].rows.filter(row => row[2] === entry.name).length, 2);
  const bytes = createExcelWorkbook(sheets);
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
  assert.ok(!xml.includes('#REF!'));
});


test('monthly workbooks use execution month, keep separate totals and reflect corrections to historical months', () => {
  const october = { ...entry, workId: 'OCT', date: '2026-10-31', quantity: 1 };
  const november = { ...entry, workId: 'NOV', date: '2026-11-01', quantity: 2 };
  const december = { ...entry, workId: 'DEC', date: '2026-12-01', quantity: 3 };
  const all = [october, november, december];
  const octSheets = reportingSheets([tech], all, '2026-10');
  const novSheets = reportingSheets([tech], all, '2026-11');
  assert.equal(octSheets[0].rows[0][2].value, 12.5);
  assert.equal(novSheets[0].rows[0][2].value, 25);
  assert.ok(novSheets[1].headers.some(header => header.includes('NOV')));
  assert.ok(!novSheets[1].headers.some(header => header.includes('OCT') || header.includes('DEC')));
  assert.ok(novSheets[0].title.includes('2026-11'));
  assert.equal(reportingFilename('2026-11'), 'Reporting b2b 2026-11.xlsx');
  assert.equal(reportingSheets([tech], [{ ...october, quantity: 4 }, november], '2026-10')[0].rows[0][2].value, 50);
  assert.equal(reportingSheets([tech], [november], '2026-10')[0].rows[0][2].value, 0);
  assert.equal(reportingSheets([tech], [november], '2026-12')[0].rows[0][2].value, 0);
  assert.throws(() => reportingFilename('2026-13'), /invalidă/);
  assert.throws(() => reportingSheets([tech], all, '../2026-11'), /invalidă/);
});
