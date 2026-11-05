import { useEffect, useState } from 'react'
import type { AppSettings, RunSummary } from '../shared/types'

interface Props {
  settings: AppSettings
  saved: AppSettings | null
  setSettings: (settings: AppSettings) => void
  busy: boolean
  onSave: () => void
}

const label: Record<string, string> = { queued: 'در صف', running: 'در حال اجرا', cancelling: 'در حال لغو' }

// Concurrency limit plus live view of running/queued runs with cancel.
export function RunsManager({ settings, saved, setSettings, busy, onSave }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const dirty = !!saved && saved.concurrency !== settings.concurrency
  const valid = Number.isInteger(settings.concurrency) && settings.concurrency >= 1 && settings.concurrency <= 20

  useEffect(() => {
    let alive = true
    const load = () => window.electronAPI.listRuns(undefined, 100).then(r => { if (alive) setRuns(r.filter(x => x.status === 'queued' || x.status === 'running' || x.status === 'cancelling')) }).catch(() => undefined)
    void load()
    const t = setInterval(load, 1500)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const running = runs.filter(r => r.status !== 'queued').length
  return <div className="settings-card">
    <div className="settings-card-header"><h2>اجرای هم‌زمان</h2><span className="count">{running}/{saved?.concurrency ?? settings.concurrency}</span></div>
    <p className="hint">تعداد سناریوهایی که هم‌زمان اجرا می‌شوند. بقیه در صف می‌مانند (حداکثر ۱۰۰ مورد). هر اجرا یک مرورگر جدا باز می‌کند، پس عدد بالا رم و پردازنده زیاد مصرف می‌کند.</p>
    <div className="input-action">
      <label style={{ flex: 1 }}>حداکثر اجرای هم‌زمان (۱ تا ۲۰)<input aria-label="Concurrency" type="number" min={1} max={20} value={settings.concurrency} onChange={e => setSettings({ ...settings, concurrency: Number(e.target.value) })} /></label>
      <button className="primary" disabled={!dirty || !valid || busy} onClick={onSave}>{busy ? 'در حال اعمال…' : 'اعمال'}</button>
    </div>
    {!valid && <p className="error-text">عدد باید صحیح و بین ۱ تا ۲۰ باشد.</p>}
    <h3>اجراهای فعال و در صف ({runs.length.toLocaleString('fa-IR')})</h3>
    {runs.length === 0 && <p className="muted">اجرای فعالی وجود ندارد.</p>}
    {runs.map(r => <div className="list-row" key={r.id}>
      <strong>{r.title}</strong>
      <span className="muted">{label[r.status] ?? r.status}</span>
      <button className="danger" disabled={r.status === 'cancelling'} onClick={() => void window.electronAPI.cancelRun(r.id)}>لغو</button>
    </div>)}
  </div>
}
