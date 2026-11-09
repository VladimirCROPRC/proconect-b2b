import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform', disableExperimentalWarning: true })).toString('base64');
const catalogUrl = moduleUrl(await source('app/boq-catalog.ts'));
const { boqCatalog } = await import(catalogUrl);
const budget = await import(moduleUrl((await source('app/project-budget.ts')).replace('"./boq-catalog"', JSON.stringify(catalogUrl))));

test('catalog contains all 201 attached BoQ rows with original units and rates', () => {
  assert.equal(boqCatalog.length, 201);
  assert.equal(new Set(boqCatalog.map(item => item.row)).size, 201);
  assert.equal(boqCatalog.find(item => item.row === 91).unitPrice, 0.47764);
  assert.ok(Math.abs(boqCatalog.find(item => item.row === 128).unitPrice - 40.5994) < 1e-10);
  assert.equal(boqCatalog.find(item => item.row === 138).unitPrice, 0.76);
  assert.ok(boqCatalog.every(item => item.unit && Number.isFinite(item.unitPrice)));
});

const route = { segments: ['aerial', 'duct', 'tray', 'facade', 'aerial'].map(method => ({ method, label: method, cableType: 'FO 12F', lengthMeters: 125 })), aerialMaterials: { boat: 2, stainlessClamp: 3, hook: 4, armorod: 5 } };
test('every route segment has a unique row, <=10mm default, meter quantities and catalog materials', () => {
  const rows = budget.buildBudgetSuggestions({ route });
  assert.deepEqual(rows.slice(0, 5).map(row => row.catalogPosition), ['91', '83', '95', '88', '91']);
  assert.deepEqual(rows.slice(0, 5).map(row => row.quantity), [125, 125, 125, 125, 125]);
  assert.equal(new Set(rows.map(row => row.id)).size, 9);
  assert.equal(rows.find(row => row.id === 'material-boat').unitPrice, 0.76);
});

test('no-intervention excludes stale route, splice, site and client execution data', () => {
  const rows = budget.buildBudgetSuggestions({
    route: { ...route, noIntervention: true },
    splices: { noIntervention: true, count: 9, records: [], junctions: [] },
    client: { noIntervention: true, equipment: ['CPE', 'SFP optic'], service: 'Internet' },
    site: { noIntervention: true, odf: 'ODF', etn: 'eTN' },
  });
  assert.deepEqual(rows, []);
});

test('client and site actions are represented and patchcord installation is not billed', () => {
  const rows = budget.buildBudgetSuggestions({ client: { service: 'Internet', equipment: ['CPE', 'SFP optic', 'Media Converter', 'Terminal Box'] }, site: { odf: 'A', odfPort: '1', etn: 'B', etnPort: '2' } });
  assert.deepEqual(rows.map(row => row.id), ['client-cpe', 'client-optics', 'client-terminal-box', 'site-patch']);
  assert.equal(rows[1].quantity, 2);
  assert.equal(rows[3].catalogPosition, 'included');
  assert.equal(rows[3].unitPrice, 0);
  assert.equal(budget.budgetReady(rows), true);
  assert.deepEqual(budget.buildBudgetSuggestions({}), []);
});

test('splice bundles count each junction once and bill only splices above the included threshold', () => {
  const records = Array.from({ length: 14 }, (_, i) => ({ id: 'a-' + i, junction: { id: 'A', code: 'A' }, junctionKind: 'new' }));
  records.push(...Array.from({ length: 5 }, (_, i) => ({ id: 'b-' + i, junction: { id: 'B', code: 'B' }, junctionKind: 'existing' })));
  const rows = budget.buildBudgetSuggestions({ splices: { count: 19, records } });
  assert.equal(rows.find(row => row.id === 'closure-A').quantity, 1);
  assert.equal(rows.find(row => row.id === 'closure-A').catalogPosition, '100');
  assert.equal(rows.find(row => row.id === 'additional-splices-A').quantity, 2);
  assert.equal(rows.find(row => row.id === 'additional-splices-B').quantity, 1);
  assert.equal(rows.find(row => row.id === 'closure-B').catalogPosition, '102');
  assert.equal(rows.filter(row => row.id.startsWith('box-')).length, 1);
  assert.equal(budget.budgetReady(rows), false);
});

test('legacy splice distribution stays visible for verification rather than inventing bundles', () => {
  const rows = budget.buildBudgetSuggestions({ splices: { count: 10, junctions: [] } });
  assert.equal(rows[0].quantity, 10);
  assert.equal(rows[0].catalogPosition, '');
});

test('102 is used without new client cable, 103 only at the source junction of a documented client cable', () => {
  const records = ['A', 'B'].map(id => ({ id: 'splice-' + id, junction: { id, code: id }, junctionKind: 'existing' }));
  const splices = { count: 2, records };
  const clientRoute = { ...route, junction: { kind: 'documented', label: 'B · Junction B' }, endpoints: { b: { id: 'B', code: 'B' } } };
  const rows = budget.buildBudgetSuggestions({ route: clientRoute, splices });
  assert.equal(rows.find(row => row.id === 'closure-A').catalogPosition, '102');
  assert.equal(rows.find(row => row.id === 'closure-B').catalogPosition, '103');
  assert.equal(rows.filter(row => row.id === 'closure-B').length, 1);
  for (const routeData of [undefined, { ...clientRoute, segments: [] }, { ...clientRoute, noIntervention: true }]) {
    const noCableRows = budget.buildBudgetSuggestions({ route: routeData, splices });
    assert.equal(noCableRows.find(row => row.id === 'closure-B').catalogPosition, '102');
  }
  const routeOnly = budget.buildBudgetSuggestions({ route: clientRoute });
  assert.equal(routeOnly.find(row => row.id === 'closure-B').catalogPosition, '103');
});

test('saved access tariffs are refreshed, and patchcord is free even in legacy/manual estimates', () => {
  const records = [{ id: 's', junction: { id: 'J', code: 'J' }, junctionKind: 'existing' }];
  const generated = budget.buildBudgetSuggestions({ splices: { count: 1, records }, site: { odf: 'A', etn: 'B' } });
  const saved = generated.map(row => ({ ...row, catalogPosition: row.id === 'site-patch' ? '109' : '103', unitPrice: 999 }));
  const restored = budget.reconcileBudget(generated, saved);
  assert.equal(restored.find(row => row.id === 'closure-J').catalogPosition, '102');
  assert.equal(restored.find(row => row.id === 'site-patch').unitPrice, 0);
  for (const position of [108, 109]) {
    const manual = budget.catalogSuggestion('manual-patch', position, 3, 'Patchcord');
    assert.equal(manual.unitPrice, 0);
    const normalized = budget.normalizeBudget([{ ...manual, catalogPosition: String(position), unitPrice: 999 }]);
    assert.equal(normalized[0].unitPrice, 0);
  }
  const corrected = budget.applyBudgetRules(saved, generated);
  assert.equal(corrected.find(row => row.id === 'closure-J').catalogPosition, '102');
  assert.equal(corrected.find(row => row.id === 'site-patch').unitPrice, 0);
});

test('a new junction declared in route appears once, including when also recorded in splices', () => {
  const data = { route: { ...route, junction: { kind: 'new', label: 'New' }, endpoints: { b: { id: 'J', code: 'J' } } } };
  let rows = budget.buildBudgetSuggestions(data);
  assert.equal(rows.filter(row => row.catalogPosition === '100').length, 1);
  data.splices = { count: 1, records: [{ id: 's', junction: { id: 'J', code: 'J' }, junctionKind: 'new' }] };
  rows = budget.buildBudgetSuggestions(data);
  assert.equal(rows.filter(row => row.catalogPosition === '100').length, 1);
  assert.equal(rows.filter(row => row.id === 'box-J').length, 1);
});

test('every intervention activity is represented without guessing mounting method or measured fiber count', () => {
  const activities = ['fo-installation', 'junction-installation', 'diagnostics', 'splice-repair'].map((type, i) => ({ id: String(i), type, cableLengthMeters: 50, junction: { code: 'J' } }));
  const rows = budget.buildBudgetSuggestions({ intervention: { execution: { activities: [...activities, activities[0]] } } });
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map(row => row.id)).size, 5);
  assert.equal(rows[0].quantity, 50);
  assert.equal(rows.find(row => row.id === 'intervention-2').quantity, 0);
  assert.equal(budget.budgetReady(rows), false);
});

test('reconciliation retains tariff choices and manual rows, adds new actions and removes no-intervention rows', () => {
  const generated = budget.buildBudgetSuggestions({ route });
  const saved = generated.map(row => ({ ...row }));
  saved[0] = { ...saved[0], catalogPosition: '92', quantity: 130 };
  saved.push(budget.catalogSuggestion('manual-test', 115, 2, 'Lucrare aprobată'));
  const reconciled = budget.reconcileBudget(generated, saved);
  assert.equal(reconciled[0].catalogPosition, '92');
  assert.equal(reconciled[0].quantity, 130);
  const changed = budget.buildBudgetSuggestions({ route: { ...route, segments: [{ ...route.segments[0], lengthMeters: 140 }] } });
  assert.equal(budget.reconcileBudget(changed, saved)[0].quantity, 140);
  assert.deepEqual(budget.reconcileBudget([], saved).map(row => row.id), ['manual-test']);
});

test('server normalization derives prices from BoQ and rejects invalid or unpriced input', () => {
  const row = budget.catalogSuggestion('route-test', 91, 100, 'Traseu documentat');
  const normalized = budget.normalizeBudget([{ ...row, unitPrice: 999, name: 'fake', unit: 'km' }]);
  assert.equal(normalized[0].unitPrice, 0.47764);
  assert.equal(normalized[0].unit, 'meter');
  for (const quantity of [-1, 0, NaN, Infinity, '100']) assert.equal(budget.normalizeBudget([{ ...row, quantity }]), null);
  assert.equal(budget.normalizeBudget([row, row]), null);
  assert.equal(budget.normalizeBudget([{ ...row, catalogPosition: '' }]), null);
  assert.equal(budget.normalizeBudget([{ ...row, catalogPosition: 'included' }]), null);
  assert.equal(budget.normalizeBudget([{ ...row, catalogPosition: 'included', note: 'Inclus în poziția 100 pentru joncțiunea A' }])[0].unitPrice, 0);
});

test('estimate API restricts access, validates source coverage and persists canonical BoQ prices', async () => {
  let session = null, authorized = true, saved = null, writes = 0;
  const documentation = { client: { service: 'VPN', equipment: ['CPE'] } };
  const generated = budget.buildBudgetSuggestions(documentation);
  const db = { prepare(sql) { return {
    bind(...args) { this.args = args; return this; },
    async first() { return sql.includes('project_field_documentation') ? { content_json: JSON.stringify(documentation) } : saved; },
    async run() { writes++; saved = { content_json: this.args[1], updated_at: this.args[3] }; },
  }; } };
  globalThis.__budgetApi = {
    getRawDb: () => db, getAuthorizedProject: async () => authorized ? {} : null,
    isManagementRole: account => ['Admin', 'Manager', 'Coordonator'].includes(account.role),
    currentSession: async () => session,
    sameOrigin: request => request.headers.get('Origin') === 'https://example.test',
    ...budget,
  };
  const routeSource = (await source('app/api/estimates/route.ts')).replace(/^import .*;$/gm, '');
  const api = await import(moduleUrl('const { getRawDb, getAuthorizedProject, isManagementRole, applyBudgetRules, buildBudgetSuggestions, normalizeBudget, currentSession, sameOrigin } = globalThis.__budgetApi;\n' + routeSource));
  const request = (rows = generated, source = JSON.stringify(generated), origin = 'https://example.test') => new Request('https://example.test/api/estimates', { method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'P', rows, source }) });
  const get = () => api.GET(new Request('https://example.test/api/estimates?projectId=P'));
  try {
    assert.equal((await get()).status, 401);
    assert.equal((await api.PATCH(request())).status, 401);
    session = { account: { username: 'tech', role: 'Tehnician' } };
    assert.equal((await get()).status, 403);
    assert.equal((await api.PATCH(request())).status, 403);
    session.account.role = 'Admin';
    assert.equal((await api.PATCH(request(generated, JSON.stringify(generated), 'https://other.test'))).status, 403);
    authorized = false;
    assert.equal((await get()).status, 404);
    assert.equal((await api.PATCH(request())).status, 404);
    authorized = true;
    assert.equal((await api.PATCH(request(generated, 'old source'))).status, 409);
    assert.equal((await api.PATCH(request([budget.catalogSuggestion('manual-extra', 128, 1, 'Extra')]))).status, 400);
    assert.equal(writes, 0);
    const response = await api.PATCH(request(generated.map(row => ({ ...row, unitPrice: 999 }))));
    assert.equal(response.status, 200);
    assert.equal(writes, 1);
    assert.ok(Math.abs((await response.json()).rows[0].unitPrice - 40.5994) < 1e-10);
    const restored = await (await get()).json();
    assert.deepEqual(restored.saved.rows, JSON.parse(saved.content_json));
    session.account.passwordResetRequired = true;
    assert.equal((await api.PATCH(request())).status, 401);
  } finally { delete globalThis.__budgetApi; }
});
