const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.test-artifacts'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(root, '.test-artifacts', 'hardening-'));
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'electron') return { app: { getPath: () => tmp, getAppPath: () => root } };
  return originalLoad.call(this, id, ...args);
};
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { executeSteps, compileSteps } = require('../src/main/step-engine.ts');
const store = require('../src/main/store.ts');
const { chromium } = require('playwright');
const dd = path.join(tmp, 'flowweb');
const finished = (id, endedAt) => ({ id, scenarioId: 'x', title: 't', status: 'passed', headless: true, createdAt: endedAt, endedAt, timeoutMs: 1000, input: {}, output: null, stdout: '', stderr: '' });

test('corrupt or invalid state files are quarantined instead of blocking startup', () => {
  fs.mkdirSync(dd, { recursive: true });
  fs.writeFileSync(path.join(dd, 'settings.json'), '{broken');
  assert.equal(store.getSettings().host, '127.0.0.1');
  fs.writeFileSync(path.join(dd, 'settings.json'), JSON.stringify({ token: 'short' }));
  assert.ok(store.getSettings().token.length >= 16);
  fs.writeFileSync(path.join(dd, 'scenarios.json'), 'oops');
  assert.deepEqual(store.getScenarios(), []);
  assert.equal(fs.readdirSync(dd).filter(name => name.includes('.corrupt-')).length, 3);
});

test('old finished runs are pruned and recent ones kept', () => {
  store.writeRun(finished('run_aaaa', '2020-01-01T00:00:00Z'));
  store.writeRun(finished('run_bbbb', new Date().toISOString()));
  store.pruneRuns();
  assert.ok(!fs.existsSync(path.join(dd, 'runs', 'run_aaaa')));
  assert.ok(fs.existsSync(path.join(dd, 'runs', 'run_bbbb')));
});

test('table extraction reads all rows in one pass and keeps per-cell semantics', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<table id=o><tbody>' + Array.from({ length: 300 }, (_, i) => `<tr><td>${i}</td><td>${'۱٬۲۳'}${i}</td><td><a href="/x${i}">l</a></td><td><input value="v${i}"></td></tr>`).join('') + '</tbody></table>');
    const col = (name, selector, extra = {}) => ({ id: name, name, selector, read: 'text', attribute: 'href', dataType: 'text', normalizeDigits: true, removeSeparators: true, missing: 'error', ...extra });
    const step = { id: 't', title: 't', type: 'table', name: 'items', rowSelector: '#o tbody tr', empty: 'error', maxRows: 5000,
      columns: [col('a', 'td:nth-of-type(1)', { dataType: 'number' }), col('b', 'td:nth-of-type(2)', { dataType: 'number' }), col('c', 'a', { read: 'attribute' }), col('d', 'input', { read: 'value' }), col('e', 'td.none', { missing: 'null' })] };
    const out = await executeSteps(page, [step], {});
    assert.equal(out.items.length, 300);
    assert.deepEqual(out.items[5], { a: 5, b: 1235, c: '/x5', d: 'v5', e: null });
    await assert.rejects(() => executeSteps(page, [{ ...step, columns: [col('z', 'span')] }], {}), /ردیف 1، ستون z/);
    await assert.rejects(() => executeSteps(page, [{ ...step, columns: [col('z', 'td')] }], {}), /تعداد فعلی/);
  } finally { await browser.close(); }
});

test('URLs supplied through input cannot open local files; compiled steps stay self-contained', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await assert.rejects(() => executeSteps(page, [{ id: 'n', title: 'n', type: 'navigate', url: { kind: 'input', value: 'u' } }], { u: 'file:///etc/passwd' }), /HTTP یا HTTPS/);
    await executeSteps(page, [{ id: 'n', title: 'n', type: 'navigate', url: { kind: 'literal', value: 'data:text/html,<p>hi</p>' } }], {});
  } finally { await browser.close(); }
  assert.ok(compileSteps([{ id: 'n', title: 'n', type: 'navigate', url: { kind: 'literal', value: 'https://example.com' } }]).includes('evaluateAll'));
});

test('pause step stays on the page for the configured time, then continues', async () => {
  const { validateSteps, createStep } = require('../src/shared/steps.ts');
  assert.throws(() => validateSteps([{ id: 'p', title: 'p', type: 'pause', seconds: 0 }]), /ثانیه/);
  assert.throws(() => validateSteps([{ id: 'p', title: 'p', type: 'pause', seconds: 3601 }]), /ثانیه/);
  validateSteps([createStep('pause')]);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const started = Date.now();
    const statuses = [];
    await executeSteps(page, [{ id: 'n', title: 'n', type: 'navigate', url: { kind: 'literal', value: 'data:text/html,<p>hi</p>' } }, { id: 'p', title: 'p', type: 'pause', seconds: 1.5 }], {}, async r => { statuses.push(r.id + ':' + r.status); });
    assert.ok(Date.now() - started >= 1450);
    assert.deepEqual(statuses.slice(-2), ['p:running', 'p:passed']);
  } finally { await browser.close(); }
});
