import { useEffect, useState } from 'react'
import type { DbConfig, DbStatus, DbType } from '../shared/types'

const ports: Record<DbType, number> = { postgres: 5432, mssql: 1433, mysql: 3306 }
const names: Record<DbType, string> = { postgres: 'PostgreSQL', mssql: 'SQL Server', mysql: 'MySQL / MariaDB' }
const stateText = { off: 'غیرفعال (ذخیره در فایل محلی)', connecting: 'در حال اتصال…', connected: 'متصل', error: 'خطا در اتصال (فایل محلی فعال است)' }

export function DatabaseConnection() {
  const [cfg, setCfg] = useState<DbConfig | null>(null)
  const [status, setStatus] = useState<DbStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [guide, setGuide] = useState<DbType>('postgres')

  useEffect(() => { window.electronAPI.dbGet?.()?.then(r => { setCfg(r.config); setStatus(r.status); setGuide(r.config.type) }).catch(() => undefined) }, [])
  useEffect(() => {
    const timer = setInterval(() => { window.electronAPI.dbGet?.()?.then(r => setStatus(r.status)).catch(() => undefined) }, 5000)
    return () => clearInterval(timer)
  }, [])
  if (!cfg) return <div className="settings-card"><p className="muted">در حال بارگذاری…</p></div>

  const set = (patch: Partial<DbConfig>) => setCfg({ ...cfg, ...patch })
  const test = async () => {
    setBusy(true); setMsg(null)
    try { const r = await window.electronAPI.dbTest(cfg); setMsg({ ok: r.ok, text: r.ok ? `اتصال موفق بود (${r.ms} ms)` : `ناموفق: ${r.error}` }) }
    catch (error) { setMsg({ ok: false, text: String(error) }) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const s = await window.electronAPI.dbSave(cfg); setStatus(s)
      setCfg({ ...cfg, password: '' })
      setMsg(s.state === 'error' ? { ok: false, text: s.error ?? 'خطا' } : s.state === 'connected'
        ? { ok: true, text: `متصل شد. ${s.migrated ?? 0} مایگریشن اجرا شد؛ ${s.source === 'database' ? 'داده‌ها از پایگاه داده خوانده شد.' : 'داده‌های محلی به پایگاه داده منتقل شد.'}` }
        : { ok: true, text: 'ذخیره شد؛ پایگاه داده غیرفعال است و داده‌ها در فایل محلی می‌مانند.' })
    } catch (error) { setMsg({ ok: false, text: String((error as Error).message ?? error) }) } finally { setBusy(false) }
  }
  const state = status?.state ?? 'off'

  return <div className="db-connection">
    <section className={'status-card ' + (state === 'connected' ? 'on' : state === 'error' ? 'error' : 'off')} aria-live="polite">
      <div className="status-main">
        <span className={'status-lamp ' + (state === 'connected' ? 'on' : state === 'error' ? 'error' : 'off')} aria-hidden="true" />
        <div><strong>{stateText[state]}</strong>
          <p className="muted">{status?.error ? status.error : state === 'connected' ? `${names[status!.type]} · در صف همگام‌سازی: ${status!.pending}` : 'بدون پایگاه داده، همه‌چیز در فایل‌های محلی ذخیره می‌شود.'}</p></div>
      </div>
    </section>

    <fieldset disabled={busy} className="settings-card">
      <div className="settings-card-header"><h2>اتصال به پایگاه داده</h2></div>
      <label className="switch"><input type="checkbox" checked={cfg.enabled} onChange={e => set({ enabled: e.target.checked })} /><span>ذخیرهٔ سناریوها و نتایج اجرا در پایگاه داده</span></label>
      <div className="form-grid">
        <label>نوع پایگاه داده<select value={cfg.type} onChange={e => { const type = e.target.value as DbType; set({ type, port: ports[type] }); setGuide(type) }}>{(Object.keys(names) as DbType[]).map(t => <option key={t} value={t}>{names[t]}</option>)}</select></label>
        <label>پورت<input dir="ltr" type="number" min={1} max={65535} value={cfg.port} onChange={e => set({ port: Number(e.target.value) })} /></label>
        <label>آدرس سرور<input dir="ltr" value={cfg.host} onChange={e => set({ host: e.target.value })} /></label>
        <label>نام پایگاه داده<input dir="ltr" value={cfg.database} onChange={e => set({ database: e.target.value })} /></label>
        <label>نام کاربری<input dir="ltr" autoComplete="off" value={cfg.user} onChange={e => set({ user: e.target.value })} /></label>
        <label>رمز عبور<input dir="ltr" type="password" autoComplete="new-password" placeholder="خالی = بدون تغییر" value={cfg.password} onChange={e => set({ password: e.target.value })} /></label>
        <label className="switch span-all"><input type="checkbox" checked={cfg.ssl} onChange={e => set({ ssl: e.target.checked })} /><span>اتصال رمزنگاری‌شده (SSL/TLS)</span></label>
      </div>
      {msg && <p className={msg.ok ? 'notice ok-note' : 'notice'} role="status">{msg.text}</p>}
      <div className="db-actions"><button type="button" onClick={test}>⚡ تست اتصال</button><button type="button" className="primary" onClick={save}>ذخیره و اتصال</button></div>
      <p className="muted">رمز عبور فقط روی همین رایانه (رمزنگاری‌شده با سیستم‌عامل) نگهداری می‌شود. توکن API، رمزها و پروفایل‌های ورود در پایگاه داده ذخیره <b>نمی‌شوند</b>.</p>
    </fieldset>

    <section className="settings-card db-guide">
      <div className="settings-card-header"><h2>آموزش اتصال</h2></div>
      <div className="segmented small" role="tablist">{(Object.keys(names) as DbType[]).map(t => <button key={t} role="tab" aria-selected={guide === t} className={guide === t ? 'active' : ''} onClick={() => setGuide(t)}>{names[t]}</button>)}</div>
      <ol>
        <li>یک پایگاه داده خالی بسازید (مثلاً <code>flowweb</code>) و کاربری با دسترسی ساخت جدول (CREATE TABLE) و خواندن/نوشتن به آن بدهید.</li>
        {guide === 'postgres' && <li><code>CREATE DATABASE flowweb; CREATE USER flow WITH PASSWORD '…'; GRANT ALL ON DATABASE flowweb TO flow;</code> برای PostgreSQL 15 به بعد: <code>GRANT ALL ON SCHEMA public TO flow;</code></li>}
        {guide === 'mysql' && <li><code>CREATE DATABASE flowweb; CREATE USER 'flow'@'%' IDENTIFIED BY '…'; GRANT ALL ON flowweb.* TO 'flow'@'%';</code></li>}
        {guide === 'mssql' && <li>در SSMS: پایگاه داده و Login بسازید، سپس کاربر را <code>db_owner</code> کنید. TCP/IP را در SQL Server Configuration Manager فعال و سرویس را ری‌استارت کنید.</li>}
        <li>آدرس سرور و پورت ({ports[guide]}) را وارد کنید؛ فایروال باید اجازهٔ اتصال بدهد.</li>
        <li>«تست اتصال» را بزنید، سپس «ذخیره و اتصال». برنامه جدول‌های <code>flowweb_migrations</code> و <code>flowweb_documents</code> را خودکار می‌سازد (مایگریشن).</li>
        <li>اگر پایگاه داده از قبل داده دارد، همان خوانده می‌شود؛ اگر خالی است، سناریوهای محلی شما به آن منتقل می‌شوند.</li>
        <li>اگر سرور در دسترس نباشد، برنامه بدون وقفه با فایل‌های محلی کار می‌کند.</li>
      </ol>
    </section>
  </div>
}
