import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';
const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const url = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const oldCatalog = url(await source('app/boq-catalog.ts'));
const catalog = url(await source('app/deployment-catalog.ts'));
const budget = url((await source('app/project-budget.ts')).replace('"./boq-catalog"', JSON.stringify(oldCatalog)));
const code = (await source('app/deployment-budget.ts')).replace('"./boq-catalog"', JSON.stringify(oldCatalog)).replace('"./deployment-catalog"', JSON.stringify(catalog)).replace('"./project-budget"', JSON.stringify(budget));
const nd = await import(url(code));
const { deploymentCatalog } = await import(catalog);
const values = url(await source('app/estimate-values.ts'));
const report = url((await source('app/technician-report.ts')).replace('"./estimate-values"', JSON.stringify(values)));
const templateCode = (await source('app/estimate-template.ts')).replace('"fflate"', JSON.stringify(import.meta.resolve('fflate'))).replace('"./technician-report"', JSON.stringify(report));
const { fillDeploymentEstimateTemplate } = await import(url(templateCode));
const template = new Uint8Array(await readFile(new URL('../public/templates/boq-nd-fo.xlsx', import.meta.url)));
const xml = bytes => strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
const cell = (sheet, address) => sheet.match(new RegExp(`<c\\b[^>]*?\\br="${address}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`))?.[1];

test('all 166 ND positions preserve original rows and rates, and blanks remain unpriced', () => {
  assert.equal(deploymentCatalog.length, 166);
  assert.equal(deploymentCatalog.filter(item => item.unitPrice === null).length, 22);
  const original = xml(template);
  for (const item of deploymentCatalog) {
    const raw = cell(original, 'I' + item.row)?.match(/<v>([^<]+)<\/v>/)?.[1];
    assert.equal(item.unitPrice, raw ? Number(raw) : null);
  }
  assert.equal(deploymentCatalog.find(item => item.code === '130.010').unitPrice, 5.28);
});

test('site A and existing site use ND tariffs, including night premium, and server ignores forged prices', () => {
  const site = { odf: 'A', odfPort: '1', etn: 'B', etnPort: '2' };
  const generated = nd.buildDeploymentBudget({ 'site-a': site, site });
  assert.equal(generated.length, 2);
  assert.ok(generated.every(row => row.catalogPosition === '143' && row.unitPrice === 5.28 && row.catalog === 'deployment-nd'));
  const rows = generated.map(row => ({ ...row, night: true, unitPrice: 999 }));
  const normalized = nd.normalizeDeploymentBudget(rows);
  assert.ok(normalized.every(row => row.unitPrice === 6.6000000000000005));
  assert.equal(nd.normalizeDeploymentBudget([{ ...rows[0], catalogPosition: '15' }]), null);
  assert.equal(nd.normalizeDeploymentBudget([{ ...rows[0], catalog: undefined }]), null);
  assert.equal(nd.normalizeDeploymentBudget([rows[0], { ...rows[1], night: false }]), null);
  assert.equal(nd.deploymentBudgetReady([nd.deploymentSuggestion('manual-1', undefined, 1, 'Manual')]), false);
});

test('Excel export retains template/formulas, applies quantities and NIGHT, and reconciles totals', () => {
  const rows = [nd.deploymentSuggestion('site-a', 143, 2, 'A', undefined, true), nd.deploymentSuggestion('site', 143, 1, 'B', undefined, true), nd.deploymentSuggestion('manual-1', 10, 1, 'Planning')];
  const output = fillDeploymentEstimateTemplate(template, { id: 'RID123', client: 'Site test' }, rows, '2026-11-18');
  const originalFiles = unzipSync(template), files = unzipSync(output), sheet = xml(output);
  for (const name of Object.keys(originalFiles)) if (name !== 'xl/worksheets/sheet1.xml') assert.deepEqual(files[name], originalFiles[name], name);
  assert.match(cell(sheet, 'G143'), /<v>3<\/v>/);
  assert.match(cell(sheet, 'H143'), />Yes</);
  assert.match(cell(sheet, 'J143'), /<f\b/);
  assert.ok(Math.abs(Number(cell(sheet, 'J143').match(/<v>([^<]+)/)[1]) - 19.8) < 1e-9);
  const total = Number(cell(sheet, 'G6').match(/<v>([^<]+)/)[1]);
  assert.ok(Math.abs(total - (215.49 + 19.8)) < 1e-9);
  assert.match(cell(sheet, 'G4'), />RID123</);
  assert.match(cell(sheet, 'C4'), />Site test</);
  assert.throws(() => fillDeploymentEstimateTemplate(template, { id: 'RID1', client: '' }, [nd.deploymentSuggestion('missing', 15, 1, '')]), /Tariful/);
});

test('new and existing junctions retain included-splice allowances while using ND prices', () => {
  const junction = { id: 'j1', code: 'J1', name: 'Junction' };
  const records = Array.from({ length: 14 }, (_, i) => ({ id: String(i), junction, junctionKind: 'new' }));
  const rows = nd.buildDeploymentBudget({ splices: { count: 14, junctions: [], records } });
  const closure = rows.find(row => row.id === 'closure-j1');
  const extra = rows.find(row => row.id === 'additional-splices-j1');
  assert.equal(closure.catalogPosition, '134'); assert.equal(closure.unitPrice, 19.91);
  assert.equal(extra.catalogPosition, '135'); assert.equal(extra.quantity, 2); assert.equal(extra.unitPrice, 6.05);
});
