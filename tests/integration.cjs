const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const net = require('node:net');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, '.test-artifacts');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'integration-'));
const originalLoad = Module._load;
const handlers = new Map();
let exposed;
Module._load = function(id, parent, isMain) {
  if (id === 'electron') return {
    app: { getPath: () => temp, getAppPath: () => root },
    contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value } },
    ipcRenderer: { invoke: (channel, ...args) => Promise.resolve().then(() => handlers.get(channel)(...args)) }
  };
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  module._compile(result.outputText, filename);
};
const { ScenarioRunner } = require('../src/main/runner.ts');
const store = require('../src/main/store.ts');
const { startApiServer, stopApiServer } = require('../src/main/api-server.ts');
const { adaptRecording } = require('../src/main/codegen.ts');
const { validateRunRequest } = require('../src/shared/validation.ts');
const { Inspector } = require('../src/main/inspector.ts');
const { validateSteps } = require('../src/shared/steps.ts');
const { executeSteps } = require('../src/main/step-engine.ts');
const { chromium } = require('playwright');
const terminal = r => ['passed', 'failed', 'timeout', 'cancelled'].includes(r.status);
let runner;
let base;
let settings;
async function waitFor(id, predicate = terminal, limit = 20000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const run = runner.getRun(id);
    if (predicate(run)) return run;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Unexpected run state: ' + JSON.stringify(runner.getRun(id)));
}
const scenario = code => store.saveScenario({ title: 'Integration', code, headless: true });
async function request(url, method = 'GET', body) {
  return fetch(base + url, { method, headers: { Authorization: 'Bearer ' + settings.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
before(async () => {
  runner = new ScenarioRunner(1);
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  settings = store.saveSettings({ ...store.getSettings(), host: '127.0.0.1', port });
  base = 'http://127.0.0.1:' + port;
  await startApiServer(runner);
  handlers.set('scenarios:save', store.saveScenario);
  handlers.set('scenarios:list', store.getScenarios);
  handlers.set('scenarios:delete', store.deleteScenario);
  handlers.set('scenarios:enqueue', (id, options) => runner.enqueue(store.getScenario(id), options));
  handlers.set('runs:get', id => runner.getRun(id));
  handlers.set('runs:cancel', id => runner.cancel(id));
  handlers.set('settings:get', store.getSettings);
  handlers.set('settings:save', store.saveSettings);
  require('../src/preload/index.ts');
});
after(async () => {
  await stopApiServer();
  await runner.shutdown();
  Module._load = originalLoad;
});

test('preload: save, run real browser, poll JSON output, delete', async () => {
  const saved = await exposed.saveScenario({ title: 'UI contract', headless: true, code: "await page.setContent('<title>Ready</title>'); console.log('hello'); return {title: await page.title(), received: input};" });
  const queued = await exposed.enqueueRun(saved.id, { input: { name: 'رسول', count: 2 } });
  const result = await waitFor(queued.id);
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.deepEqual(result.output, { title: 'Ready', received: { name: 'رسول', count: 2 } });
  assert.match(result.stdout, /hello/);
  assert.ok(result.durationMs >= 0);
  assert.deepEqual(await exposed.getRun(queued.id), result);
  assert.equal(await exposed.deleteScenario(saved.id), true);
  assert.equal(store.getScenario(saved.id), undefined);
});

test('API rejects unauthorized, malformed JSON and invalid timeout', async () => {
  assert.equal((await fetch(base + '/api/scenarios')).status, 401);
  const saved = scenario('return input;');
  let response = await request('/api/scenarios/' + saved.id + '/run', 'POST', { input: {}, timeoutMs: -1 });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  response = await fetch(base + '/api/scenarios/' + saved.id + '/run', { method: 'POST', headers: { Authorization: 'Bearer ' + settings.token, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
  assert.equal((await request('/api/runs/not-real')).status, 404);
  assert.throws(() => validateRunRequest({ input: { invalid: NaN } }));
});

test('API passes input and false output separately from logs', async () => {
  const saved = scenario("console.log('a log'); return input.flag;");
  const response = await request('/api/scenarios/' + saved.id + '/run', 'POST', { input: { flag: false }, timeoutMs: 15000 });
  assert.equal(response.status, 202);
  const queued = (await response.json()).run;
  await waitFor(queued.id);
  const result = await (await request('/api/runs/' + queued.id)).json();
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.output, false);
  assert.equal(result.timeoutMs, 15000);
});

test('scenario exceptions become structured errors', async () => {
  const result = await waitFor(runner.enqueue(scenario("throw new Error('intentional failure');")).id);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'SCENARIO_ERROR');
  assert.equal(result.error.message, 'intentional failure');
});

test('invalid output is rejected instead of silently losing fields', async () => {
  const result = await waitFor(runner.enqueue(scenario('return { value: undefined };')).id);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'INVALID_OUTPUT');
});

test('timeout kills a worker and releases its queue slot', async () => {
  const run = runner.enqueue(scenario('await new Promise(() => {});'), { timeoutMs: 1000 });
  const next = runner.enqueue(scenario('return 42;'));
  const result = await waitFor(run.id);
  assert.equal(result.status, 'timeout', JSON.stringify(result));
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal((await waitFor(next.id)).output, 42);
});

test('queued cancellation never starts; active cancellation kills descendants and is idempotent', async () => {
  const active = runner.enqueue(scenario("const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {windowsHide: true, stdio: 'ignore'}); console.log('descendant:' + child.pid); console.log('ready-to-cancel'); await new Promise(() => {});"));
  const queued = runner.enqueue(scenario("throw new Error('should never execute');"));
  const cancelled = await exposed.cancelRun(queued.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.startedAt, undefined);
  const running = await waitFor(active.id, r => r.stdout.includes('ready-to-cancel'));
  const descendant = Number(running.stdout.match(/descendant:(\d+)/)[1]);
  assert.equal((await request('/api/runs/' + active.id + '/cancel', 'POST', {})).status, 200);
  const result = await waitFor(active.id);
  assert.equal(result.status, 'cancelled', JSON.stringify(result));
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
  const repeated = await (await request('/api/runs/' + active.id + '/cancel', 'POST', {})).json();
  assert.equal(repeated.endedAt, result.endedAt);
});

test('recording is awaited under the same input/output contract', async () => {
  const recorded = "const { chromium } = require('playwright');\n(async () => { const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage(); await page.setContent('<title>Recorded</title>'); const title = await page.title(); await context.close(); await browser.close(); return { title, input }; })();";
  const result = await waitFor(runner.enqueue(scenario(adaptRecording(recorded)), { input: 'recorded-input' }).id);
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.deepEqual(result.output, { title: 'Recorded', input: 'recorded-input' });
});

test('canonical settings persist and interrupted runs are not replayed', () => {
  store.saveSettings({ ...settings, concurrency: 3, runTimeoutMs: 12000 });
  assert.equal(store.getSettings().concurrency, 3);
  assert.equal(store.getSettings().runTimeoutMs, 12000);
  const id = 'run_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  store.writeRun({ id, scenarioId: 'interrupted', title: 'Old', status: 'running', headless: true, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), input: {}, output: null, timeoutMs: 5000, stdout: '', stderr: '' });
  store.recoverInterruptedRuns();
  assert.equal(store.readRun(id).status, 'failed');
  assert.equal(store.readRun(id).error.code, 'INTERRUPTED');
});

test('shutdown cancels active and queued runs and rejects new work', async () => {
  const local = new ScenarioRunner(1);
  const active = local.enqueue(scenario('await new Promise(() => {});'));
  const queued = local.enqueue(scenario('return 1;'));
  await local.shutdown();
  assert.equal(local.getRun(active.id).status, 'cancelled');
  assert.equal(local.getRun(queued.id).status, 'cancelled');
  assert.throws(() => local.enqueue(scenario('return 2;')), /shutting down/);
});

const extraction = (selector, dataType = 'text') => ({ selector, dataType, read: 'text', attribute: 'href', missing: 'error', normalizeDigits: true, removeSeparators: true });
const fixture = '<html><body><h1 id="customer">علی رضایی</h1><input id="order"><input id="amount" value="۱٬۲۳۴٫۵۰"><button id="go" onclick="document.querySelector(\'#customer\').textContent=\'ثبت شد\'">Submit</button><table id="orders"><thead><tr><th>نام</th><th>تعداد</th><th>مبلغ</th></tr></thead><tbody><tr><td>چای</td><td>۲</td><td>۱۲٬۰۰۰</td></tr><tr><td>قهوه</td><td>٣</td><td>۲۴٬۵۰۰</td></tr></tbody></table></body></html>';
const fixtureUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fixture);
const field = (id, name, config) => ({ id, title: name, type: 'field', name, extraction: config });
const table = { id: 'table', title: 'اقلام', type: 'table', name: 'items', rowSelector: '#orders tbody tr', empty: 'error', maxRows: 100, columns: [
  { id: 'c1', name: 'title', ...extraction('td:nth-child(1)') },
  { id: 'c2', name: 'quantity', ...extraction('td:nth-child(2)', 'number') },
  { id: 'c3', name: 'price', ...extraction('td:nth-child(3)', 'number') }
] };

test('visual steps compile and run through API with Persian table numbers and input binding', async () => {
  const steps = [
    { id: 'nav', title: 'Open', type: 'navigate', url: { kind: 'literal', value: fixtureUrl } },
    { id: 'fill', title: 'Order input', type: 'fill', selector: '#order', value: { kind: 'input', value: 'order.id' } },
    { id: 'wait', title: 'Wait', type: 'wait', selector: '#customer' },
    field('name', 'customerName', extraction('#customer')),
    field('amount', 'total', { ...extraction('#amount', 'number'), read: 'value' }),
    field('order', 'orderId', { ...extraction('#order'), read: 'value' }), table
  ];
  const saved = store.saveScenario({ title: 'Visual extraction', mode: 'steps', code: 'ignored', headless: true, steps });
  assert.equal(store.getScenario(saved.id).steps.length, 7);
  const response = await request('/api/scenarios/' + saved.id + '/run', 'POST', { input: { order: { id: 'ORD-17' } } });
  assert.equal(response.status, 202);
  const result = await waitFor((await response.json()).run.id);
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.deepEqual(result.output, { customerName: 'علی رضایی', total: 1234.5, orderId: 'ORD-17', items: [ { title: 'چای', quantity: 2, price: 12000 }, { title: 'قهوه', quantity: 3, price: 24500 } ] });
  assert.equal(result.stepResults.length, 7);
  assert.ok(result.stepResults.every(step => step.status === 'passed'));
});

test('visual step errors identify the step, row and column', async () => {
  const saved = store.saveScenario({ title: 'Invalid number', mode: 'steps', code: '', headless: true, steps: [
    { id: 'nav', title: 'Open', type: 'navigate', url: { kind: 'literal', value: fixtureUrl } },
    { ...table, columns: [{ ...table.columns[0], dataType: 'number' }] }
  ] });
  const result = await waitFor(runner.enqueue(saved).id);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.stepId, 'table');
  assert.match(result.error.message, /ردیف 1، ستون title/);
  assert.equal(result.stepResults.at(-1).status, 'failed');
  assert.equal(result.output, null);
});

test('step schema rejects duplicate names and unsafe output keys', () => {
  assert.throws(() => validateSteps([field('a', '__proto__', extraction('h1'))]));
  assert.throws(() => validateSteps([field('a', 'value', extraction('h1')), field('b', 'value', extraction('h1'))]));
  assert.throws(() => validateSteps([{ ...table, columns: [table.columns[0], table.columns[0]] }]));
});

test('extraction handles null, empty tables, ambiguity and zero/false deliberately', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<span class="many">one</span><span class="many">two</span><b id="zero">۰</b><b id="no">خیر</b>');
    const output = await executeSteps(page, [
      field('null', 'optional', { ...extraction('#missing'), missing: 'null' }),
      field('zero', 'zero', extraction('#zero', 'number')),
      field('no', 'no', extraction('#no', 'boolean')),
      { ...table, empty: 'allow' }
    ], {});
    assert.deepEqual(output, { optional: null, zero: 0, no: false, items: [] });
    await assert.rejects(executeSteps(page, [field('ambiguous', 'value', extraction('.many'))], {}), /دقیقاً یک عنصر/);
    await assert.rejects(executeSteps(page, [table], {}), /جدول خالی مجاز نیست/);
    await page.goto(fixtureUrl);
    await assert.rejects(executeSteps(page, [{ ...table, maxRows: 1 }], {}), /داده ناقص برگردانده نشد/);
    await executeSteps(page, [{ id: 'click', title: 'Click', type: 'click', selector: '#go' }], {});
    assert.equal(await page.locator('#customer').innerText(), 'ثبت شد');
  } finally { await browser.close(); }
});

test('real inspector picks a field, row group and relative column without triggering clicks', async () => {
  const inspector = new Inspector();
  try {
    await inspector.open(fixtureUrl);
    const page = inspector.page;
    let pending = inspector.pick({ kind: 'element' });
    await page.locator('[data-automation-picker="banner"]').waitFor();
    await page.locator('#go').click();
    const picked = await pending;
    assert.equal(picked.selector, '#go');
    assert.equal(await page.locator('#customer').innerText(), 'علی رضایی');
    pending = inspector.pick({ kind: 'rows' });
    await page.locator('[data-automation-picker="banner"]').waitFor();
    await page.locator('#orders tbody tr').first().locator('td').first().click();
    const rows = await pending;
    assert.equal(rows.count, 2);
    pending = inspector.pick({ kind: 'column', rowSelector: rows.selector });
    await page.locator('[data-automation-picker="banner"]').waitFor();
    await page.locator('#orders tbody tr').nth(1).locator('td').nth(1).click();
    const column = await pending;
    assert.equal(await page.locator(rows.selector).first().locator(column.selector).innerText(), '۲');
    const preview = await inspector.preview({ ...table, rowSelector: rows.selector }, {});
    assert.equal(preview.output.items.length, 2);
    pending = inspector.pick({ kind: 'element' });
    await page.locator('[data-automation-picker="banner"]').waitFor();
    await inspector.cancelPick();
    assert.equal(await pending, null);
    assert.equal(await page.locator('[data-automation-picker]').count(), 0);
  } finally { await inspector.close(); }
});
