import type { SaveScenarioInput } from '../shared/types'

export interface Template { icon: string; title: string; description: string; scenario: SaveScenarioInput }
const code = (title: string, body: string): SaveScenarioInput => ({ title, code: body, headless: true, mode: 'code' })

export const templates: Template[] = [
  { icon: '🔎', title: 'خواندن عنوان یک صفحه', description: 'یک آدرس می‌گیرد و عنوان و متن اصلی صفحه را برمی‌گرداند.',
    scenario: code('خواندن عنوان صفحه', "const url = input.url || 'https://example.com';\nawait page.goto(url);\nreturn { title: await page.title(), heading: await page.locator('h1').first().innerText().catch(() => null) };") },
  { icon: '📸', title: 'اسکرین‌شات از سایت', description: 'صفحه را باز می‌کند و اطلاعات پایه را برمی‌گرداند (اسکرین‌شات خطا خودکار ذخیره می‌شود).',
    scenario: code('اسکرین‌شات از سایت', "await page.goto(input.url || 'https://example.com');\nawait page.screenshot({ path: 'page.png', fullPage: true });\nreturn { url: page.url(), title: await page.title() };") },
  { icon: '🔗', title: 'استخراج همهٔ لینک‌ها', description: 'فهرست لینک‌های یک صفحه را به شکل JSON برمی‌گرداند.',
    scenario: code('استخراج لینک‌ها', "await page.goto(input.url || 'https://example.com');\nconst links = await page.$$eval('a[href]', as => as.map(a => ({ text: a.textContent.trim(), href: a.href })));\nreturn { count: links.length, links: links.slice(0, 200) };") },
  { icon: '📋', title: 'استخراج جدول', description: 'اولین جدول صفحه را به آرایه‌ای از ردیف‌ها تبدیل می‌کند.',
    scenario: code('استخراج جدول', "await page.goto(input.url || 'https://example.com');\nconst rows = await page.$$eval('table tr', trs => trs.map(tr => [...tr.children].map(c => c.textContent.trim())));\nreturn { rows };") },
  { icon: '🟢', title: 'بررسی در دسترس بودن سایت', description: 'وضعیت پاسخ و زمان بارگذاری را اندازه می‌گیرد؛ مناسب پایش.',
    scenario: code('پایش سایت', "const start = Date.now();\nconst response = await page.goto(input.url || 'https://example.com');\nif (!response || !response.ok()) throw new Error('سایت پاسخ سالم نداد: ' + (response ? response.status() : 'بدون پاسخ'));\nreturn { status: response.status(), loadMs: Date.now() - start };") },
  { icon: '🔐', title: 'ورود به سایت (فرم ساده)', description: 'نام‌کاربری و رمز را از ورودی می‌خواند؛ سلکتورها را با سایت خودتان تنظیم کنید.',
    scenario: code('ورود به سایت', "await page.goto(input.url);\nawait page.fill('input[type=email], input[name=username]', input.username);\nawait page.fill('input[type=password]', input.password);\nawait page.click('button[type=submit]');\nawait page.waitForLoadState('networkidle');\nreturn { url: page.url() };") }
]
