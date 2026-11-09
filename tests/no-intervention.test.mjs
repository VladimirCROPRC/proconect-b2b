import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const server = await readFile(new URL('../app/project-server.ts', import.meta.url), 'utf8');
const saveSource = server.slice(server.indexOf('export async function saveFieldDocumentation('), server.indexOf('export async function addCpe('));
const code = stripTypeScriptTypes(saveSource, { mode: 'transform', disableExperimentalWarning: true });
const services = ['Internet', 'VPN', 'Internet+OL', 'OL'];

function setup({ categories = [], safety = true, grounding = true } = {}) {
  let saved = false;
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: categories.map(category => ({ category })) }; },
        async first() { return null; },
        async run() { saved = true; },
      };
    },
  };
  const save = new Function('getAuthorizedProject', 'hasCompletedProjectSafety', 'getRawDb',
    code.replace('export async function', 'async function') + '; return saveFieldDocumentation;'
  )(async () => ({ cpe_requires_grounding: grounding }), async () => safety, () => db);
  return { save: (section, content) => save('project', section, content, { username: 'tech' }), saved: () => saved };
}

test('every no-intervention section saves a reason without photos', async () => {
  for (const section of ['client', 'route', 'splices', 'site']) {
    for (const service of services) {
      const context = setup();
      const content = { noIntervention: true, noInterventionReason: 'Acces indisponibil', service };
      const result = await context.save(section, content);
      assert.deepEqual(result.documentation?.[section], content);
      assert.equal(context.saved(), true);
    }
  }
});

test('no-intervention still requires a reason and completed safety checks', async () => {
  for (const section of ['client', 'route', 'splices', 'site']) {
    for (const reason of ['', '   ', 'x'.repeat(2001)]) {
      const context = setup();
      assert.equal((await context.save(section, { noIntervention: true, noInterventionReason: reason, service: 'Internet' })).status, 400);
      assert.equal(context.saved(), false);
    }
    const context = setup({ safety: false });
    assert.equal((await context.save(section, { noIntervention: true, noInterventionReason: 'Acces indisponibil', service: 'Internet' })).status, 403);
  }
});

test('intervened client still requires report, applicable tests, execution and grounding photos', async () => {
  for (const service of services) {
    const categories = ['report', 'overview', 'detail', 'labels', 'grounding',
      ...(service.includes('Internet') ? ['speed'] : []),
      ...(service.includes('OL') ? ['olTest'] : [])];
    for (const missing of categories) {
      const context = setup({ categories: categories.filter(category => category !== missing) });
      assert.equal((await context.save('client', { noIntervention: false, service })).status, 400, service + ': ' + missing);
      assert.equal(context.saved(), false);
    }
    const context = setup({ categories });
    assert.ok((await context.save('client', { noIntervention: false, service })).documentation);
  }
});

test('client form has no photo requirements and finite progress when no intervention is selected', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const start = page.indexOf('  const requiredClientPhotoKeys:');
  const end = page.indexOf('  const filteredProjects', start);
  const evaluate = new Function('clientNoIntervention', 'clientNoInterventionReason', 'clientService', 'activeProject', 'clientHasNoGroundingSystem', 'clientPhotos',
    stripTypeScriptTypes(page.slice(start, end), { mode: 'transform', disableExperimentalWarning: true }) + '; return { requiredClientPhotoKeys, clientProgress };');
  for (const service of services) {
    assert.deepEqual(evaluate(true, 'Acces indisponibil', service, { cpeRequiresGrounding: true }, false, {}), { requiredClientPhotoKeys: [], clientProgress: 100 });
    assert.equal(evaluate(true, '  ', service, {}, false, {}).clientProgress, 0);
    const normal = evaluate(false, '', service, { cpeRequiresGrounding: true }, false, {});
    assert.ok(normal.requiredClientPhotoKeys.includes('report'));
    assert.ok(normal.requiredClientPhotoKeys.includes('grounding'));
    assert.equal(normal.clientProgress, 0);
  }
});
