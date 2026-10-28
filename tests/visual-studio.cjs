const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

test('visual studio end to end: picker, field, table columns, step preview, full JSON and reload', { timeout: 90000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, '.test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifacts, 'visual-'));
  const data = path.join(profile, 'flowweb');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ apiEnabled: false, host: '127.0.0.1', port: 3434, token: 'isolated-test-token-only', concurrency: 1, runTimeoutMs: 20000 }));
  const entry = path.join(profile, 'entry.cjs');
  // Capture only the test app's own inspector browser to drive local fixture clicks.
  fs.writeFileSync(entry, 'const { app } = require("electron"); app.setPath("userData", ' + JSON.stringify(profile) + '); app.setAppPath(' + JSON.stringify(root) + '); const pw = require("playwright"); const launch = pw.chromium.launch.bind(pw.chromium); pw.chromium.launch = async (...args) => { const browser = await launch(...args); global.__testBrowser = browser; return browser; }; require(' + JSON.stringify(path.join(root, 'out/main/index.js')) + ');');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let electron = await _electron.launch({ args: [entry], env, timeout: 20000 });
  const expected = { customerName: 'علی رضایی', items: [{ title: 'چای', quantity: 2, price: 12000 }, { title: 'قهوه', quantity: 3, price: 24500 }] };
  try {
    const page = await electron.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const fixture = '<html dir="rtl"><meta charset="utf-8"><style>body{font:18px Tahoma;padding:50px;background:#f6f8f5}table{border-collapse:collapse;background:white;width:700px}td,th{padding:20px;border:1px solid #ddd}</style><h1 id="customer">علی رضایی</h1><table id="orders"><thead><tr><th>نام</th><th>تعداد</th><th>مبلغ</th></tr></thead><tbody><tr><td>چای</td><td>۲</td><td>۱۲٬۰۰۰</td></tr><tr><td>قهوه</td><td>٣</td><td>۲۴٬۵۰۰</td></tr></tbody></table></html>';
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(fixture);
    await page.getByLabel('عنوان سناریو', { exact: true }).fill('استخراج سفارش مشتری');
    await page.getByLabel('آدرس صفحه', { exact: true }).fill(url);
    await page.getByLabel('آدرس مرورگر آزمایشی', { exact: true }).fill(url);
    await page.getByRole('button', { name: 'بازکردن مرورگر', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'مرورگر آماده است' }).waitFor();
    const add = async type => {
      await page.getByLabel('نوع مرحله جدید').selectOption(type);
      await page.getByRole('button', { name: 'افزودن مرحله' }).click();
    };
    const clickPickedElement = async selector => {
      await electron.evaluate(async (_electron, selector) => {
        const browser = global.__testBrowser;
        const target = browser.contexts()[0].pages()[0];
        await target.locator('[data-automation-picker="banner"]').waitFor();
        await target.locator(selector).click();
      }, selector);
      await page.getByRole('status').filter({ hasText: 'انتخاب انجام شد' }).waitFor();
    };
    await add('field');
    await page.getByLabel('عنوان مرحله', { exact: true }).fill('خواندن نام مشتری');
    await page.getByLabel('نام خروجی', { exact: true }).fill('customerName');
    await page.getByRole('button', { name: 'انتخاب فیلد از صفحه', exact: true }).click();
    await clickPickedElement('#customer');
    assert.equal(await page.getByLabel('انتخابگر فیلد', { exact: true }).inputValue(), '#customer');
    await page.getByRole('button', { name: 'تست این مرحله' }).click();
    await page.getByRole('status').filter({ hasText: 'تست مرحله کامل شد' }).waitFor();
    assert.match(await page.getByRole('region', { name: 'نتیجه استخراج' }).innerText(), /علی رضایی/);
    await add('table');
    await page.getByLabel('عنوان مرحله', { exact: true }).fill('استخراج اقلام سفارش');
    await page.getByRole('button', { name: 'انتخاب ردیف‌ها' }).click();
    await clickPickedElement('#orders tbody tr:first-child td:first-child');
    await page.getByRole('button', { name: 'انتخاب ستون 1 از صفحه', exact: true }).click();
    await clickPickedElement('#orders tbody tr:nth-child(2) td:first-child');
    for (const [index, name] of [[2, 'quantity'], [3, 'price']]) {
      await page.getByRole('button', { name: 'افزودن ستون' }).click();
      await page.getByLabel('نام ستون ' + index, { exact: true }).fill(name);
      await page.getByLabel('نوع داده ستون ' + index, { exact: true }).selectOption('number');
      await page.getByRole('button', { name: 'انتخاب ستون ' + index + ' از صفحه', exact: true }).click();
      await clickPickedElement('#orders tbody tr:nth-child(2) td:nth-child(' + index + ')');
    }
    await page.getByRole('button', { name: 'تست این مرحله' }).click();
    await page.getByRole('status').filter({ hasText: 'تست مرحله کامل شد' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'نتیجه استخراج' }).locator('tbody tr').count(), 2);
    await page.getByRole('button', { name: 'اجرای سناریو' }).click();
    await page.getByText('وضعیت: passed', { exact: false }).waitFor({ timeout: 20000 });
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.getByTestId('json-output').innerText()), expected);
    const stored = JSON.parse(fs.readFileSync(path.join(data, 'scenarios.json'), 'utf8')).items[0];
    assert.equal(stored.mode, 'steps'); assert.equal(stored.steps.length, 3);
    assert.ok(stored.steps[2].columns[1].selector.includes('td'));
    await page.getByRole('tab', { name: 'داده‌ها', exact: true }).click();
    await page.locator('.editor-scroll').evaluate(element => { element.scrollTop = 0 });
    await page.screenshot({ path: path.join(artifacts, 'studio-desktop.png') });
    assert.deepEqual(errors, []);
    await electron.close();
    electron = await _electron.launch({ args: [entry], env, timeout: 20000 });
    const reloaded = await electron.firstWindow();
    await reloaded.getByRole('button', { name: 'استخراج اقلام سفارش', exact: false }).click();
    assert.equal(await reloaded.getByLabel('نام خروجی', { exact: true }).inputValue(), 'items');
    assert.equal(await reloaded.getByLabel('نام ستون 3', { exact: true }).inputValue(), 'price');
    await reloaded.getByRole('button', { name: 'اجرای سناریو' }).click();
    await reloaded.getByText('وضعیت: passed', { exact: false }).waitFor({ timeout: 20000 });
    await reloaded.getByRole('tab', { name: 'JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await reloaded.getByTestId('json-output').innerText()), expected);
  } finally { await electron.close(); }
});
