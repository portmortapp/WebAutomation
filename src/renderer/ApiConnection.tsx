import { useCallback, useEffect, useState } from 'react'
import type { ApiStatus, ApiTestResult, AppSettings } from '../shared/types'

const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('')
const hostMode = (host: string) => ['127.0.0.1', 'localhost', '::1'].includes(host.trim()) ? 'local' : host.trim() === '0.0.0.0' ? 'network' : 'custom'

interface Props { settings: AppSettings; saved: AppSettings | null; setSettings: (settings: AppSettings) => void; busy: boolean; refreshKey: number; onSave: () => void }

// Server status, connection test and the (few) settings most people need.
export function ApiConnection({ settings, saved, setSettings, busy, refreshKey, onSave }: Props) {
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [test, setTest] = useState<ApiTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState('')
  const mode = hostMode(settings.host)
  const [customHost, setCustomHost] = useState(mode === 'custom')

  const refresh = useCallback(() => { window.electronAPI.apiStatus().then(setStatus).catch(() => setStatus(null)) }, [])
  useEffect(() => { refresh(); setTest(null) }, [refresh, refreshKey])
  useEffect(() => { const timer = setInterval(refresh, 5000); return () => clearInterval(timer) }, [refresh])

  const copy = async (name: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(name); setTimeout(() => setCopied(''), 1400) } catch { setCopied('') }
  }
  const runTest = async () => {
    setTesting(true); setTest(null)
    try { setTest(await window.electronAPI.apiTest()) } catch (error) { setTest({ url: '', health: { ok: false, error: String(error) }, auth: { ok: false } }) }
    finally { setTesting(false); refresh() }
  }
  const address = status ? 'http://' + (status.host === '0.0.0.0' ? '127.0.0.1' : status.host) + ':' + status.port : 'http://127.0.0.1:' + settings.port
  const dockerAddress = 'http://host.docker.internal:' + settings.port
  const dirty = !!saved && JSON.stringify(saved) !== JSON.stringify(settings)
  const state = !status ? 'unknown' : !status.enabled ? 'off' : status.running ? 'on' : 'error'

  return <div className="api-connection">
    <section className={'status-card ' + state} aria-live="polite">
      <div className="status-main">
        <span className={'status-lamp ' + state} aria-hidden="true" />
        <div>
          <strong>{state === 'on' ? 'سرویس API در حال اجراست' : state === 'off' ? 'API غیرفعال است' : state === 'error' ? 'سرویس اجرا نشده' : 'در حال بررسی…'}</strong>
          {state === 'on' && <div className="address" dir="ltr"><code>{address}</code><button type="button" className="text-button" onClick={() => copy('addr', address)}>{copied === 'addr' ? 'کپی شد ✓' : 'کپی'}</button></div>}
          {state === 'error' && <p className="hint warn">{status?.error ?? 'پس از ذخیرهٔ تنظیمات دوباره بررسی می‌شود.'}</p>}
          {state === 'off' && <p className="hint">برای اتصال n8n، «فعال‌سازی API» را روشن و ذخیره کنید.</p>}
        </div>
      </div>
      <div className="status-actions">
        <label className="switch"><input type="checkbox" checked={settings.apiEnabled} disabled={busy} onChange={e => setSettings({ ...settings, apiEnabled: e.target.checked })} /><span>فعال</span></label>
        <button type="button" disabled={testing || state !== 'on'} onClick={runTest}>{testing ? 'در حال تست…' : '⚡ تست اتصال'}</button>
      </div>
      {test && <ul className="test-result" role="status">
        <li className={test.health.ok ? 'ok' : 'bad'}>{test.health.ok ? '✓ سرویس پاسخ می‌دهد (' + (test.health.ms ?? 0) + ' ms)' : '✕ سرویس پاسخ نمی‌دهد' + (test.health.error ? ' — ' + test.health.error : '')}</li>
        {test.health.ok && <li className={test.auth.ok ? 'ok' : 'bad'}>{test.auth.ok ? '✓ توکن درست است' + (test.auth.scenarios !== undefined ? ' · ' + test.auth.scenarios + ' سناریو قابل اجرا' : '') : '✕ ' + (test.auth.error ?? 'توکن پذیرفته نشد')}</li>}
        {test.health.ok && test.auth.ok && <li className="hint">برای n8n در Docker از <code dir="ltr">{dockerAddress}</code> استفاده کنید.</li>}
      </ul>}
    </section>

    <fieldset disabled={busy} className="settings-card">
      <div className="settings-card-header"><h2>چه کسی می‌تواند وصل شود؟</h2></div>
      <div className="choice-cards" role="radiogroup" aria-label="دسترسی به API">
        <label className={'choice ' + (mode === 'local' && !customHost ? 'selected' : '')}><input type="radio" name="host-mode" checked={mode === 'local' && !customHost} onChange={() => { setCustomHost(false); setSettings({ ...settings, host: '127.0.0.1' }) }} /><strong>فقط همین رایانه</strong><span>امن‌ترین حالت. مناسب n8n که مستقیم روی همین سیستم نصب است.</span></label>
        <label className={'choice ' + (mode === 'network' && !customHost ? 'selected' : '')}><input type="radio" name="host-mode" checked={mode === 'network' && !customHost} onChange={() => { setCustomHost(false); setSettings({ ...settings, host: '0.0.0.0' }) }} /><strong>n8n داخل Docker یا شبکه</strong><span>برای دسترسی از کانتینر یا رایانه‌های دیگر. فقط در شبکهٔ قابل‌اعتماد.</span></label>
        <label className={'choice ' + (customHost ? 'selected' : '')}><input type="radio" name="host-mode" checked={customHost} onChange={() => setCustomHost(true)} /><strong>آدرس دلخواه</strong><span>یک IP مشخص از همین رایانه.</span></label>
      </div>
      {customHost && <label>آدرس میزبان<input aria-label="API host" dir="ltr" value={settings.host} onChange={e => setSettings({ ...settings, host: e.target.value })} /></label>}
      {mode !== 'local' && <p className="notice" role="alert">هشدار: هر دستگاهی در شبکه که توکن را داشته باشد می‌تواند روی این رایانه سناریو (و کد سفارشی) اجرا کند و ارتباط HTTP رمزنگاری نمی‌شود. توکن را محرمانه نگه دارید.</p>}
      <div className="form-grid">
        <label>پورت<input aria-label="API port" dir="ltr" type="number" min={1} max={65535} value={settings.port} onChange={e => setSettings({ ...settings, port: Number(e.target.value) })} /></label>
        <label className="span-all">توکن اتصال<div className="input-action token-row">
          <input aria-label="API token" dir="ltr" type={showToken ? 'text' : 'password'} autoComplete="off" value={settings.token} onChange={e => setSettings({ ...settings, token: e.target.value })} />
          <button type="button" onClick={() => setShowToken(!showToken)}>{showToken ? 'پنهان' : 'نمایش'}</button>
          <button type="button" onClick={() => copy('token', settings.token)}>{copied === 'token' ? 'کپی شد ✓' : 'کپی'}</button>
          <button type="button" onClick={() => { if (confirm('توکن جدید ساخته شود؟ n8n و هر برنامهٔ دیگری که توکن قبلی را دارد تا تغییر توکن کار نمی‌کند.')) setSettings({ ...settings, token: newToken() }) }}>ساخت توکن جدید</button>
        </div></label>
      </div>
      <details className="advanced-options"><summary>تنظیمات پیشرفتهٔ اجرا</summary><div className="form-grid">
        <label>حداکثر اجرای هم‌زمان<input aria-label="Concurrency" type="number" min={1} max={20} value={settings.concurrency} onChange={e => setSettings({ ...settings, concurrency: Number(e.target.value) })} /></label>
        <label>تعداد تلاش مجدد خودکار پس از خطا (۰ تا ۵)<input aria-label="Retry count" type="number" min={0} max={5} value={settings.retryCount ?? 1} onChange={e => setSettings({ ...settings, retryCount: Number(e.target.value) })} /></label>
        <label className="check-row"><input type="checkbox" checked={settings.notifyOnFailure !== false} onChange={e => setSettings({ ...settings, notifyOnFailure: e.target.checked })} /> اعلان دسکتاپ هنگام شکست اجرا</label>
        <label>مهلت پیش‌فرض اجرا (میلی‌ثانیه)<input aria-label="Default timeout" type="number" min={1000} value={settings.runTimeoutMs} onChange={e => setSettings({ ...settings, runTimeoutMs: Number(e.target.value) })} /></label>
      </div></details>
    </fieldset>
    {dirty && <div className="save-bar" role="region" aria-label="ذخیرهٔ تنظیمات"><span>تغییرات هنوز اعمال نشده‌اند</span><div><button type="button" className="text-button" onClick={() => saved && setSettings(saved)}>لغو تغییرات</button><button type="button" className="primary" disabled={busy} onClick={onSave}>{busy ? 'در حال اعمال…' : 'ذخیره و اعمال'}</button></div></div>}
  </div>
}
