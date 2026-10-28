const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { codeToSteps, stepsToCode } = require('../src/shared/convert.ts');
const { validateSteps, createStep } = require('../src/shared/steps.ts');
const { executeSteps } = require('../src/main/step-engine.ts');
const { chromium } = require('playwright');
const page_html = 'data:text/html,' + encodeURIComponent('<meta charset=utf-8><title>t</title><label>Email <input id=e placeholder="Your email"></label><button>Send now</button><select id=s><option value=a>Alpha</option><option value=b>Beta</option></select><input type=checkbox id=c aria-label="Agree"><table id=t><tr><td class=n>۱٬۲۰۰</td><td class=l><a href="/a">A</a></td></tr><tr><td class=n>۲٬۵۰۰</td><td class=l><a href="/b">B</a></td></tr></table><p id=r>۱۲۳</p><script>document.querySelector("button").onclick=()=>{document.title="clicked"}</script>');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const recorded = `const { chromium } = require('playwright');
return await (async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(${JSON.stringify(page_html)});
  await page.getByPlaceholder('Your email').click();
  await page.getByPlaceholder('Your email').fill('me@example.com');
  await page.getByPlaceholder('Your email').press('Tab');
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.locator('#s').selectOption('b');
  await page.getByLabel('Agree').check();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /send/i }).first().hover();
  await page.mouse.wheel(0, 100);
  await page.getByText('x').dblclick();
  // ---------------------
  await context.close();
  await browser.close();
})();`;

test('recorded Playwright code becomes working visual steps, and unsupported lines are reported', async () => {
  const { steps: all, skipped, exact, custom } = codeToSteps(recorded);
  // Every statement is kept: unknown ones (mouse.wheel) become a custom-code node, dblclick a double-click node.
  assert.equal(exact, true);
  assert.equal(skipped.length, 0);
  assert.equal(custom, 1);
  assert.deepEqual(all.map(s => s.type), ['navigate', 'click', 'fill', 'press', 'click', 'select', 'check', 'pause', 'hover', 'code', 'click']);
  assert.equal(all[10].double, true);
  assert.match(all[9].code, /mouse\.wheel/);
  const steps = all.slice(0, 9);
  validateSteps(all);
  const page = await browser.newPage();
  await executeSteps(page, steps, {});
  assert.equal(await page.title(), 'clicked');
  assert.equal(await page.locator('#e').inputValue(), 'me@example.com');
  assert.equal(await page.locator('#s').inputValue(), 'b');
  assert.equal(await page.locator('#c').isChecked(), true);
  await page.close();
});

test('steps become readable code that runs and round-trips without loss', async () => {
  const field = { ...createStep('field'), name: 'amount', extraction: { ...createStep('field').extraction, selector: '#r', dataType: 'number' } };
  const table = { ...createStep('table'), name: 'rows', rowSelector: '#t tr', columns: [
    { ...createStep('table').columns[0], id: 'c1', name: 'price', selector: '.n', dataType: 'number' },
    { ...createStep('table').columns[0], id: 'c2', name: 'link', selector: 'a', read: 'attribute', attribute: 'href' }] };
  const steps = [{ ...createStep('navigate'), url: { kind: 'literal', value: page_html } }, { ...createStep('fill'), selector: '#e', value: { kind: 'input', value: 'user.email' } }, field, table, { ...createStep('click'), selector: 'button', retries: 1, continueOnError: true }];
  validateSteps(steps);
  const code = stepsToCode(steps);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const page = await browser.newPage();
  const result = await new AsyncFunction('input', 'page', 'secrets', code)({ user: { email: 'a@b.c' } }, page, {});
  assert.equal(result.amount, 123);
  assert.deepEqual(result.rows, [{ price: 1200, link: '/a' }, { price: 2500, link: '/b' }]);
  assert.equal(await page.locator('#e').inputValue(), 'a@b.c');
  const same = await executeSteps(page, steps, { user: { email: 'a@b.c' } });
  assert.deepEqual(same, result);
  const back = codeToSteps(code);
  assert.deepEqual(back.steps.map(step => step.type), ['navigate', 'fill', 'field', 'table', 'click']);
  assert.deepEqual(back.steps[1].value, { kind: 'input', value: 'user.email' });
  assert.equal(back.steps[2].name, 'amount');
  assert.equal(back.steps[3].columns.length, 2);
  assert.equal(back.steps[4].retries, 1);
  assert.equal(back.steps[4].continueOnError, true);
  assert.equal(back.exact, true);
  assert.equal(back.custom, 0);
  // Edited extraction code is no longer the generated block, so it is kept as custom code instead of being lost.
  const edited = codeToSteps(code.replace("output.amount = toNumber(digits(raw))", "output.amount = toNumber(digits(raw)) + 1"));
  assert.ok(edited.steps.some(step => step.type === 'code' && /output\.amount/.test(step.code)));
  await page.close();
});

const userCode = require('node:fs').readFileSync(path.join(__dirname, 'fixtures', 'popup-iframe.txt'), 'utf8');

test('a recorded session with a popup tab, iframe and dialog converts completely', () => {
  const { steps, skipped, exact, custom } = codeToSteps(userCode);
  assert.equal(exact, true); assert.equal(skipped.length, 0); assert.equal(custom, 0);
  validateSteps(steps);
  assert.equal(steps.filter(s => s.type === 'click' && s.opensTab).length, 1);
  assert.deepEqual(steps.slice(-3).map(s => s.type), ['click', 'tab', 'tab']);
  assert.ok(steps.some(s => s.type === 'dialog' && s.action === 'dismiss'));
  assert.ok(steps.some(s => s.type === 'click' && s.selector.includes('internal:control=enter-frame')));
  assert.equal(steps.filter(s => s.type === 'fill').length, 2);
  // and back to code and nodes again without changing anything
  const again = codeToSteps(stepsToCode(steps));
  assert.deepEqual(again.steps.map(s => s.type), steps.map(s => s.type));
  assert.equal(again.custom, 0);
});

const tabsPage = 'data:text/html,' + encodeURIComponent('<meta charset=utf-8><title>main</title><input id=n><select id=s><option value=a>Alpha</option><option value=b>Beta</option></select><input type=checkbox id=c><button id=open onclick="window.open(\'about:blank\')">open</button><button id=ask onclick="document.title = confirm(\'sure?\') ? \'yes\' : \'no\'">ask</button>');

test('form, popup tab, tab switching, dialog and custom-code nodes run', async () => {
  const page = await browser.newPage();
  const steps = [
    { ...createStep('navigate'), url: { kind: 'literal', value: tabsPage } },
    { ...createStep('form'), fields: [
      { id: 'f1', selector: '#n', action: 'fill', value: { kind: 'input', value: 'name' } },
      { id: 'f2', selector: '#s', action: 'select', by: 'label', value: { kind: 'literal', value: 'Beta' } },
      { id: 'f3', selector: '#c', action: 'check', value: { kind: 'literal', value: '' } }] },
    { ...createStep('dialog'), action: 'dismiss' },
    { ...createStep('click'), selector: '#ask' },
    { ...createStep('click'), selector: '#open', opensTab: true },
    { ...createStep('code'), code: "await page.setContent('<p id=m>popup</p>'); output.inPopup = await page.locator('#m').innerText()" },
    { ...createStep('tab'), action: 'close', index: 1 },
    { ...createStep('tab'), action: 'switch', index: 0 }
  ];
  validateSteps(steps);
  const out = await executeSteps(page, steps, { name: 'Sara' });
  assert.equal(out.inPopup, 'popup');
  assert.equal(await page.locator('#n').inputValue(), 'Sara');
  assert.equal(await page.locator('#s').inputValue(), 'b');
  assert.equal(await page.locator('#c').isChecked(), true);
  assert.equal(await page.title(), 'no');
  assert.equal(page.context().pages().filter(p => !p.isClosed()).length, 1);
  // the generated code behaves the same
  const page2 = await browser.newPage();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const result = await new AsyncFunction('input', 'page', 'secrets', stepsToCode(steps))({ name: 'Sara' }, page2, {});
  assert.equal(result.inPopup, 'popup');
  await page.close();
});

test('statements that cannot become a plain node are kept as runnable custom code, not rejected', () => {
  const { steps, skipped, custom } = codeToSteps("await page.goto('https://example.com');\nconst items = await page.locator('li').allInnerTexts();\nfor (const t of items) { output[t] = true }\nawait page.locator('#f').setInputFiles('a.txt');\nawait page.keyboard.type('hi');\nawait page.getByRole('button', { name: 'Go' }).click({ force: true });");
  assert.deepEqual(steps.map(s => s.type), ['navigate', 'code']);
  assert.equal(custom, 1); assert.equal(skipped.length, 0);
  assert.ok(steps[1].code.includes('allInnerTexts') && steps[1].code.includes('setInputFiles') && steps[1].code.includes('force: true'));
});
