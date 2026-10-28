import { useState } from 'react'
import type { AppSettings, ProfileInfo, SecretInfo } from '../shared/types'
import { ApiConnection } from './ApiConnection'
import { DatabaseConnection } from './DatabaseConnection'
import { ApiGuide } from './ApiGuide'
import { ApiTester } from './ApiTester'

type Tab = 'api' | 'database' | 'secrets' | 'profiles' | 'about'

interface Props {
  settings: AppSettings | null
  savedSettings: AppSettings | null
  settingsVersion: number
  setSettings: (settings: AppSettings) => void
  secrets: SecretInfo[]
  profiles: ProfileInfo[]
  scenarios: { id: string; title: string }[]
  secretName: string
  secretValue: string
  setSecretName: (value: string) => void
  setSecretValue: (value: string) => void
  addSecret: () => void
  removeSecret: (name: string) => void
  removeProfile: (id: string) => void
  scenarioId?: string
  busy: boolean
  onSave: () => void
  onBack: () => void
}

// Connection (API) with status and tests, stored secrets, and saved login profiles, one topic per tab.
export function SettingsPage({ settings, savedSettings, settingsVersion, setSettings, secrets, profiles, scenarios, secretName, secretValue, setSecretName, setSecretValue, addSecret, removeSecret, removeProfile, scenarioId, busy, onSave, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('api')
  const tabs: [Tab, string, number | null][] = [['api', 'اتصال API', null], ['database', 'پایگاه داده', null], ['secrets', 'رمزها', secrets.length], ['profiles', 'پروفایل‌های ورود', profiles.length], ['about', 'درباره', null]]
  return <div className="settings-page">
    <button className="text-button" onClick={onBack}>→ بازگشت به سناریو</button>
    <span className="eyebrow">SETTINGS</span><h1>تنظیمات</h1>
    <div className="segmented tabs" role="tablist" aria-label="بخش‌های تنظیمات">{tabs.map(([value, label, count]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}{count !== null && <span className="count">{count}</span>}</button>)}</div>

    {tab === 'api' && (settings ? <>
      <p className="muted">برای وصل کردن n8n یا هر برنامهٔ دیگر به سناریوها. اول وضعیت سرویس را ببینید، بعد در صورت نیاز تنظیمات را عوض کنید.</p>
      <ApiConnection settings={settings} saved={savedSettings} setSettings={setSettings} busy={busy} refreshKey={settingsVersion} onSave={onSave} />
      <div className="settings-card"><ApiGuide port={settings.port} token={settings.token} scenarioId={scenarioId} /></div>
      {scenarios.length > 0 && <div className="settings-card"><ApiTester scenarios={scenarios} scenarioId={scenarioId} /></div>}
    </> : <p>در حال دریافت تنظیمات…</p>)}

    {tab === 'database' && <DatabaseConnection />}
    {tab === 'about' && <div className="settings-card about-card"><img src="./icon.png" alt="FlowWeb" className="about-logo" /><h2>FlowWeb</h2><p className="muted">powered by portmort</p><div className="dev-card"><span>توسعه‌دهنده</span><strong>Rasol Alibakhshi</strong><button className="primary" onClick={() => void window.electronAPI.openDeveloper?.()}>GitHub ↗</button><code>github.com/RasolAlibakhshi</code></div><div className="donate-card"><span>❤ حمایت از پروژه</span><p>اگر FlowWeb برایتان مفید بود، با دونیت از توسعه آن حمایت کنید.</p><button className="primary" onClick={() => void window.electronAPI.openDonate?.()}>حمایت مالی (دونیت) ↗</button><code>daramet.com/PortMort</code></div></div>}
    {tab === 'secrets' && <div className="settings-card"><div className="settings-card-header"><h2>رمزها</h2><span className="count">{secrets.length}</span></div>
      <p className="hint">رمز و مقدارهای حساس را اینجا ذخیره کنید و در مرحله‌ها «رمز ذخیره‌شده» را انتخاب کنید. مقدار با امکانات امنیتی سیستم‌عامل رمزنگاری می‌شود، هرگز نمایش داده نمی‌شود و از طریق API یا لاگ خارج نمی‌شود.</p>
      {secrets.length === 0 && <p className="muted">هنوز رمزی ذخیره نشده است.</p>}
      {secrets.map(item => <div className="list-row" key={item.name}><code dir="ltr">{item.name}</code><span className="muted">{new Date(item.updatedAt).toLocaleDateString('fa-IR')}</span><button className="icon-button danger" aria-label={'حذف رمز ' + item.name} onClick={() => removeSecret(item.name)}>×</button></div>)}
      <div className="form-grid"><label>نام رمز<input dir="ltr" aria-label="نام رمز جدید" placeholder="site_password" value={secretName} onChange={e => setSecretName(e.target.value)} /></label><label>مقدار<input dir="ltr" type="password" autoComplete="off" aria-label="مقدار رمز جدید" value={secretValue} onChange={e => setSecretValue(e.target.value)} /></label></div>
      <button className="primary" disabled={!secretName.trim() || !secretValue} onClick={addSecret}>ذخیره رمز</button>
    </div>}

    {tab === 'profiles' && <div className="settings-card"><div className="settings-card-header"><h2>پروفایل‌های ورود (نشست)</h2><span className="count">{profiles.length}</span></div>
      <p className="hint">برای ساخت پروفایل: در طراحی سناریو مرورگر آزمایشی را باز کنید، دستی وارد سایت شوید و «ذخیره نشست مرورگر» را بزنید. سناریو بعد از آن بدون لاگین مجدد اجرا می‌شود. کوکی‌ها مثل رمز رمزنگاری می‌شوند.</p>
      {profiles.length === 0 && <p className="muted">هنوز پروفایلی ذخیره نشده است.</p>}
      {profiles.map(item => <div className="list-row" key={item.id}><strong>{item.name}</strong><span className="muted">{new Date(item.updatedAt).toLocaleDateString('fa-IR')}</span><button className="icon-button danger" aria-label={'حذف پروفایل ' + item.name} onClick={() => removeProfile(item.id)}>×</button></div>)}
    </div>}
  </div>
}
