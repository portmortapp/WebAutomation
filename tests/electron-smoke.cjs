// Exercises the built Electron app in an isolated profile, never the user's profile.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

test('built Electron UI: save settings, execute current edits, show JSON, cancel and delete', { timeout: 60000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, '.test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifacts, 'electron-'));
  const data = path.join(profile, 'flowweb');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ apiEnabled: false, host: '127.0.0.1', port: 3434, token: 'isolated-test-token-only', concurrency: 1, runTimeoutMs: 15000 }));
  const entry = path.join(profile, 'entry.cjs');
  fs.writeFileSync(entry, 'const { app } = require("electron"); app.setPath("userData", ' + JSON.stringify(profile) + '); app.setAppPath(' + JSON.stringify(root) + '); require(' + JSON.stringify(path.join(root, 'out/main/index.js')) + ');');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({ args: [entry], env, timeout: 20000 });
  try {
    const page = await electron.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: 'تنظیمات اتصال' }).click();
    await page.getByLabel('Concurrency', { exact: true }).fill('2');
    await page.getByLabel('Default timeout', { exact: true }).fill('12000');
    await page.getByLabel('API token', { exact: true }).fill('updated-isolated-test-token');
    await page.getByRole('button', { name: 'ذخیره تنظیمات سرور' }).click();
    await page.getByRole('status').filter({ hasText: 'تنظیمات ذخیره' }).waitFor();
    const savedSettings = JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
    assert.equal(savedSettings.concurrency, 2);
    assert.equal(savedSettings.runTimeoutMs, 12000);
    assert.equal(savedSettings.token, 'updated-isolated-test-token');
    await page.getByRole('button', { name: 'سناریو جدید' }).click();
    await page.getByRole('button', { name: 'کد پیشرفته', exact: true }).click();
    await page.getByPlaceholder('عنوان سناریو...').fill('UI smoke');
    await page.getByLabel('Playwright Headless').check();
    await page.getByRole('button', { name: 'ورودی اجرا' }).click();
    await page.getByLabel('ورودی JSON').fill('{"from":"UI"}');
    await page.getByRole('button', { name: 'اجرای سناریو' }).click();
    await page.getByText('وضعیت: passed', { exact: false }).waitFor({ timeout: 20000 });
    assert.match(await page.locator('body').innerText(), /Automation ready/);
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    assert.match(await page.locator('body').innerText(), /"from": "UI"/);
    const editor = page.getByPlaceholder('// کد پلی‌رایت خود را بنویسید...');
    await editor.fill("console.log('waiting-for-cancel'); await new Promise(() => {});");
    await page.getByRole('button', { name: 'اجرای سناریو' }).click();
    await page.getByRole('tab', { name: 'لاگ اجرا' }).click();
    await page.locator('pre').filter({ hasText: 'waiting-for-cancel' }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'لغو اجرا', exact: true }).click();
    await page.getByText('وضعیت: cancelled', { exact: false }).waitFor({ timeout: 15000 });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'حذف سناریو', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'سناریو حذف شد' }).waitFor();
    assert.equal(await page.getByText('UI smoke', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await electron.close(); }
});
