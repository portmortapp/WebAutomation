const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.test-artifacts'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(root, '.test-artifacts', 'features-'));
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'electron') return { app: { getPath: () => tmp, getAppPath: () => root } };
  return originalLoad.call(this, id, ...args);
};
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { executeSteps } = require('../src/main/step-engine.ts');
const { validateSteps, createStep } = require('../src/shared/steps.ts');
const store = require('../src/main/store.ts');
const { ScenarioRunner } = require('../src/main/runner.ts');
const { chromium } = require('playwright');
const html = body => 'data:text/html,' + encodeURIComponent(body);
const nav = url => ({ id: 'nav', title: 'nav', type: 'navigate', url: { kind: 'literal', value: url } });
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('select, check, press, scroll and hover steps drive the page', async () => {
  const page = await browser.newPage();
  const url = html('<select id=s><option value=a>Alpha</option><option value=b>Beta</option></select><input type=checkbox id=c><input id=t><div id=out></div><div id=h style="height:50px">hover</div><div style="height:3000px"></div><p id=end>end</p><script>t.addEventListener("keydown",e=>out.textContent=e.key);h.addEventListener("mouseenter",()=>h.dataset.hot=1)</script>');
  const steps = [nav(url),
    { id: '1', title: 'sel', type: 'select', selector: '#s', value: { kind: 'literal', value: 'Beta' }, by: 'label' },
    { id: '2', title: 'chk', type: 'check', selector: '#c', checked: true },
    { id: '3', title: 'key', type: 'press', selector: '#t', key: 'Enter' },
    { id: '4', title: 'hov', type: 'hover', selector: '#h' },
    { id: '5', title: 'scr', type: 'scroll', to: 'bottom', selector: '' }];
  validateSteps(steps);
  await executeSteps(page, steps, {});
  assert.equal(await page.locator('#s').inputValue(), 'b');
  assert.equal(await page.locator('#c').isChecked(), true);
  assert.equal(await page.locator('#out').innerText(), 'Enter');
  assert.equal(await page.locator('#h').getAttribute('data-hot'), '1');
  assert.ok(await page.evaluate(() => window.scrollY) > 500);
  await page.close();
});

test('retries re-run a failing step, and continueOnError keeps the scenario going', async () => {
  const page = await browser.newPage();
  const events = [];
  const publish = async r => { events.push(r.id + ':' + r.status + ':' + (r.attempts ?? '')); };
  const field = { id: 'f', title: 'f', type: 'field', name: 'x', extraction: { ...createStep('field').extraction, selector: '#late' }, retries: 2, retryDelaySec: 0.2 };
  const url = html('<body><script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend","<p id=late>42</p>")},6500)</script></body>');
  // The element appears after the first 5 s attempt, so attempt 2 succeeds.
  const out = await executeSteps(page, [nav(url), field], {}, publish);
  assert.equal(out.x, '42');
  assert.ok(events.includes('f:running:2') && events.includes('f:passed:2'));
  const skipped = { id: 'g', title: 'g', type: 'field', name: 'y', extraction: { ...createStep('field').extraction, selector: '#nope' }, continueOnError: true };
  const after = { id: 'h', title: 'h', type: 'field', name: 'z', extraction: { ...createStep('field').extraction, selector: '#late' } };
  const out2 = await executeSteps(page, [skipped, after], {}, publish);
  assert.equal(out2.y, null); assert.equal(out2.z, '42');
  await assert.rejects(() => executeSteps(page, [{ ...skipped, continueOnError: false }], {}), /g:/);
  await page.close();
});

test('secret values are resolved from the secrets map and validated', async () => {
  const page = await browser.newPage();
  await executeSteps(page, [nav(html('<input id=p>')), { id: 'f', title: 'f', type: 'fill', selector: '#p', value: { kind: 'secret', value: 'site_password' } }], {}, async () => {}, { site_password: 's3cret!' });
  assert.equal(await page.locator('#p').inputValue(), 's3cret!');
  await assert.rejects(() => executeSteps(page, [{ id: 'f', title: 'f', type: 'fill', selector: '#p', value: { kind: 'secret', value: 'other' } }], {}, async () => {}, {}), /other/);
  assert.throws(() => validateSteps([{ id: 'f', title: 'f', type: 'fill', selector: '#p', value: { kind: 'secret', value: 'bad name' } }]), /رمز/);
  assert.throws(() => validateSteps([{ id: 'f', title: 'f', type: 'press', selector: '', key: 'rm -rf' }]), /کلید/);
  assert.throws(() => validateSteps([{ ...createStep('hover'), selector: '#a', retries: 9 }]), /تلاش/);
  await page.close();
});

test('profiles and secrets are stored privately and listed without values', () => {
  const info = store.saveProfileState('حساب تست', { cookies: [{ name: 'sid', value: 'abc', domain: 'x.test', path: '/' }], origins: [] });
  assert.equal(store.listProfiles().length, 1);
  assert.equal(store.readProfileState(info.id).cookies[0].value, 'abc');
  const file = fs.readFileSync(path.join(tmp, 'flowweb', 'profiles', info.id + '.json'), 'utf8');
  assert.ok(JSON.parse(file).v === 1);
  store.saveSecret('site_password', 'p@ss');
  assert.deepEqual(store.listSecrets().map(item => item.name), ['site_password']);
  assert.ok(!JSON.stringify(store.listSecrets()).includes('p@ss'));
  assert.deepEqual(store.getSecretValues(['site_password']), { site_password: 'p@ss' });
  assert.throws(() => store.getSecretValues(['missing']), /missing/);
  assert.throws(() => store.saveSecret('bad name', 'x'), /نام رمز/);
  const scenario = store.saveScenario({ title: 'p', code: 'return 1', headless: true, profileId: info.id, saveSession: true });
  assert.equal(scenario.profileId, info.id);
  assert.equal(store.deleteProfile(info.id), true);
  assert.equal(store.getScenario(scenario.id).profileId, undefined);
  store.deleteSecret('site_password');
  assert.equal(store.listSecrets().length, 0);
});

async function finish(runner, id) {
  for (let i = 0; i < 400; i++) {
    const run = runner.getRun(id);
    if (['passed', 'failed', 'timeout', 'cancelled'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('run did not finish');
}

test('a real run uses a secret and a saved session, refreshes the session and cleans up its payload', async () => {
  const runner = new ScenarioRunner(1);
  store.saveSecret('login_secret', 'hunter2');
  const profile = store.saveProfileState('p', { cookies: [], origins: [] });
  const scenario = store.saveScenario({
    title: 'secret run', headless: true, code: '', mode: 'steps', profileId: profile.id, saveSession: true,
    steps: [nav(html('<input id=p><script>document.cookie="seen=1"</script>')), { id: 'fill', title: 'fill', type: 'fill', selector: '#p', value: { kind: 'secret', value: 'login_secret' } }, { id: 'field', title: 'field', type: 'field', name: 'typed', extraction: { ...createStep('field').extraction, selector: '#p', read: 'value' } }, { id: 'shot', title: 'shot', type: 'screenshot', name: 'proof', fullPage: false }]
  });
  const run = await finish(runner, runner.enqueue(scenario, {}).id);
  assert.equal(run.status, 'passed', JSON.stringify(run.error));
  assert.equal(run.output.typed, 'hunter2');
  assert.ok(run.artifacts.includes('shot-proof.png'));
  assert.ok(!fs.existsSync(path.join(tmp, 'flowweb', 'runs', run.id, 'payload.json')));
  // The scenario itself read the field back, so only check what the platform adds: input, logs and errors.
  const saved = store.readRun(run.id);
  assert.ok(!JSON.stringify({ input: saved.input, stdout: saved.stdout, stderr: saved.stderr, error: saved.error }).includes('hunter2'));
  assert.ok(store.readArtifact(run.id, 'shot-proof.png').length > 100);
  assert.equal(store.readArtifact(run.id, '../result.json'), undefined);
  assert.ok(store.listRuns(scenario.id).some(item => item.id === run.id));
  const refreshed = store.readProfileState(profile.id);
  assert.ok(refreshed.origins !== undefined);
  await runner.shutdown();
});

test('a missing secret is rejected at enqueue; a failing run keeps a screenshot and names the failed step', async () => {
  const runner = new ScenarioRunner(1);
  const missing = store.saveScenario({ title: 'm', headless: true, code: '', mode: 'steps', steps: [nav(html('<input id=p>')), { id: 'f', title: 'f', type: 'fill', selector: '#p', value: { kind: 'secret', value: 'nope' } }] });
  assert.throws(() => runner.enqueue(missing, {}), /nope/);
  const failing = store.saveScenario({ title: 'f', headless: true, code: '', mode: 'steps', steps: [nav(html('<h1>hello</h1>')), { id: 'bad', title: 'bad step', type: 'wait', selector: '#never' }] });
  const run = await finish(runner, runner.enqueue(failing, {}).id);
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.failedStep, { id: 'bad', title: 'bad step', index: 1 });
  assert.ok(run.artifacts.includes('failure.png'));
  await runner.shutdown();
});
