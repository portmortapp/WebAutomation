import { useState } from 'react'

type Tab = 'start' | 'n8n' | 'endpoints' | 'response'

// Connection guide: ready-to-copy commands built from the current port, token and scenario.
export function ApiGuide({ port, token, scenarioId }: { port: number; token: string; scenarioId?: string }) {
  const [tab, setTab] = useState<Tab>('start')
  const [real, setReal] = useState(false)
  const [copied, setCopied] = useState('')
  const key = real && token ? token : 'YOUR_TOKEN'
  const id = scenarioId || 'SCENARIO_ID'
  const local = 'http://127.0.0.1:' + port
  const docker = 'http://host.docker.internal:' + port

  const copy = async (name: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(name); setTimeout(() => setCopied(''), 1500) } catch { setCopied('') }
  }
  const Block = ({ name, text }: { name: string; text: string }) => <div className="code-block"><button className="copy" onClick={() => copy(name, text)}>{copied === name ? 'کپی شد ✓' : 'کپی'}</button><pre dir="ltr">{text}</pre></div>

  const curlRun = `curl -X POST ${local}/api/scenarios/${id}/run \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"input": {"orderId": "123"}}'`
  const curlStatus = `curl ${local}/api/runs/RUN_ID \\\n  -H "Authorization: Bearer ${key}"`
  const curlList = `curl ${local}/api/scenarios \\\n  -H "Authorization: Bearer ${key}"`
  const winCurl = `curl.exe -X POST ${local}/api/scenarios/${id}/run -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d "{\\"input\\":{}}"`
  const response = `// پاسخ ۲۰۲ بعد از شروع اجرا\n{\n  "message": "Run queued",\n  "run": { "id": "run_…", "status": "queued", … }\n}\n\n// پاسخ GET /api/runs/RUN_ID بعد از پایان\n{\n  "id": "run_…",\n  "status": "passed",\n  "output": { "field": "263,860,000" },\n  "stepResults": [ … ],\n  "failedStep": null,\n  "artifacts": ["failure.png"]\n}`

  return <div className="api-guide">
    <div className="api-guide-head"><h3>راهنمای اتصال و استفاده از API</h3><label className="check"><input type="checkbox" checked={real} onChange={e => setReal(e.target.checked)} />نمایش توکن واقعی در دستورها</label></div>
    <div className="segmented small" role="tablist">
      {([['start', 'شروع سریع'], ['n8n', 'اتصال n8n'], ['endpoints', 'لیست endpointها'], ['response', 'پاسخ و خطاها']] as [Tab, string][]).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}
    </div>

    {tab === 'start' && <div className="guide-body">
      <ol>
        <li>مطمئن شوید API فعال است: «تنظیمات ← اتصال API» وضعیت سرویس را نشان می‌دهد و دکمهٔ «تست اتصال» دارد.</li>
        <li>شناسه سناریو را از لیست سناریوها بردارید{scenarioId ? ' (شناسه سناریوی فعلی در دستورها گذاشته شد)' : ''}.</li>
        <li>اجرا را شروع کنید؛ پاسخ شامل <code>run.id</code> است.</li>
        <li>با همان شناسه وضعیت را تا <code>passed</code> یا <code>failed</code> بپرسید؛ داده‌ها در <code>output</code> هستند.</li>
      </ol>
      <h4>۱) لیست سناریوها</h4><Block name="list" text={curlList} />
      <h4>۲) اجرای سناریو</h4><Block name="run" text={curlRun} />
      <h4>۳) گرفتن وضعیت و خروجی</h4><Block name="status" text={curlStatus} />
      <p className="hint">در ویندوز (PowerShell) از <code>curl.exe</code> استفاده کنید:</p>
      <Block name="win" text={winCurl} />
      <p className="hint">فیلد <code>input</code> اختیاری است و مقدارهایش در مرحله‌هایی که «ورودی» انتخاب شده استفاده می‌شوند. برای مهلت اختصاصی می‌توانید <code>"timeoutMs": 60000</code> هم بدهید.</p>
    </div>}

    {tab === 'n8n' && <div className="guide-body">
      <h4>آدرس</h4>
      <p>اگر n8n داخل Docker است: <code dir="ltr">{docker}</code> — اگر مستقیم روی همین رایانه است: <code dir="ltr">{local}</code></p>
      <p className="hint">برای دسترسی از Docker، میزبان را در تنظیمات بالا روی <code>0.0.0.0</code> بگذارید، فقط در شبکهٔ قابل‌اعتماد و با توکن قوی. در لینوکس ممکن است لازم باشد <code>--add-host=host.docker.internal:host-gateway</code> به کانتینر بدهید.</p>
      <h4>گره HTTP Request برای شروع اجرا</h4>
      <ul>
        <li>Method: <code>POST</code> — URL: <code dir="ltr">{docker}/api/scenarios/{id}/run</code></li>
        <li>Authentication: Generic Credential Type ← Header Auth؛ Name: <code>Authorization</code>، Value: <code dir="ltr">Bearer {key}</code></li>
        <li>Send Body: JSON — مثال: <code dir="ltr">{'{ "input": { "orderId": "123" } }'}</code></li>
      </ul>
      <h4>گرفتن نتیجه</h4>
      <ul>
        <li>یک گره <b>Wait</b> (مثلاً ۵ ثانیه) بگذارید.</li>
        <li>گره HTTP Request دوم: <code>GET</code> روی <code dir="ltr">{docker}/api/runs/{'{{ $json.run.id }}'}</code> با همان Header.</li>
        <li>گره <b>IF</b>: اگر <code dir="ltr">{'{{ $json.status }}'}</code> برابر <code>passed</code> نبود و هنوز <code>queued</code>/<code>running</code> بود، به Wait برگردید (حلقه).</li>
        <li>خروجی در <code dir="ltr">{'{{ $json.output.field }}'}</code> است.</li>
      </ul>
      <p className="hint">آزمایش اتصال بدون توکن: <code>GET /api/health</code> باید <code>{'{"ok":true}'}</code> برگرداند.</p>
    </div>}

    {tab === 'endpoints' && <div className="guide-body">
      <p className="hint">همهٔ مسیرها (به جز health) هدر <code>Authorization: Bearer TOKEN</code> می‌خواهند.</p>
      <table className="api-table" dir="ltr"><tbody>
        {[
          ['GET', '/api/health', 'بررسی زنده بودن سرویس (بدون توکن)'],
          ['GET', '/api/scenarios', 'لیست سناریوها'],
          ['GET', '/api/scenarios/:id', 'جزئیات یک سناریو'],
          ['POST', '/api/scenarios/:id/run', 'شروع اجرا (202) — بدنه: input, timeoutMs'],
          ['GET', '/api/runs?scenarioId=&limit=', 'تاریخچهٔ اجراها (limit تا ۲۰۰)'],
          ['GET', '/api/runs/:runId', 'وضعیت، خروجی و نتیجهٔ مرحله‌ها'],
          ['POST', '/api/runs/:runId/cancel', 'لغو اجرا'],
          ['GET', '/api/runs/:runId/artifacts', 'لیست تصاویر اجرا'],
          ['GET', '/api/runs/:runId/artifacts/:name', 'دریافت تصویر (مثل failure.png)']
        ].map(([method, path, note]) => <tr key={path}><td><span className={'verb ' + method.toLowerCase()}>{method}</span></td><td><code>{path}</code></td><td dir="rtl">{note}</td></tr>)}
      </tbody></table>
    </div>}

    {tab === 'response' && <div className="guide-body">
      <Block name="resp" text={response} />
      <h4>وضعیت‌های اجرا</h4>
      <p><code>queued</code> در صف · <code>running</code> در حال اجرا · <code>passed</code> موفق · <code>failed</code> ناموفق (<code>failedStep</code> و <code>failure.png</code> را ببینید) · <code>cancelled</code> لغو شده · <code>timeout</code> مهلت تمام شد · <code>cancelling</code> در حال لغو</p>
      <h4>کدهای HTTP</h4>
      <ul>
        <li><code>202</code> اجرا در صف قرار گرفت</li>
        <li><code>400</code> ورودی نامعتبر</li>
        <li><code>401</code> توکن اشتباه یا ارسال نشده</li>
        <li><code>404</code> سناریو یا اجرا پیدا نشد</li>
        <li><code>429</code> صف پر است؛ کمی بعد دوباره تلاش کنید</li>
      </ul>
      <p className="hint">پاسخ خطا همیشه به شکل <code dir="ltr">{'{ "error": { "code", "message" } }'}</code> است.</p>
    </div>}
  </div>
}
