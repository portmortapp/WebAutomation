import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { RunSummary } from '../shared/types'
import type { Schedule } from '../shared/schedule'
import type { RunPage, ScenarioStats } from '../shared/run-report'

interface Props {
  scenarios: { id: string; title: string }[]
  onBack: () => void
}

const statusLabel: Record<string, string> = { queued: 'در صف', running: 'در حال اجرا', cancelling: 'در حال لغو', passed: 'موفق', failed: 'ناموفق', timeout: 'پایان زمان', cancelled: 'لغو شده' }
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const dur = (ms?: number) => ms == null ? '—' : ms < 1000 ? '<۱ ثانیه' : Math.round(ms / 1000).toLocaleString('fa-IR') + ' ثانیه'
const num = (n: number) => n.toLocaleString('fa-IR')
const PAGE_SIZE = 10

// Token-based cancellation: every request gets a token; only the latest token may write state.
function useToken() {
  const ref = useRef(0)
  return { next: () => ++ref.current, isCurrent: (t: number) => t === ref.current, cancel: () => { ref.current++ } }
}

const MonitorCharts = lazy(() => import('./MonitorCharts'))

function Chart({ stats }: { stats?: ScenarioStats }) {
  if (!stats || !stats.total) return <p className="muted">برای این بازه داده‌ای ثبت نشده است.</p>
  return <Suspense fallback={<span className="sk-block" />}><MonitorCharts stats={stats} /></Suspense>
}

const Skeleton = ({ rows = 4 }: { rows?: number }) => <div className="schedule-list" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="settings-card monitor-row skeleton"><span className="sk-line" /><span className="sk-pill" /></div>)}</div>

export function MonitorPage({ scenarios, onBack }: Props) {
  const [scenarioId, setScenarioId] = useState<string>('')
  const [days, setDays] = useState(14)
  const [status, setStatus] = useState<'all' | 'passed' | 'failed' | 'cancelled'>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<RunPage | null>(null)
  const [stats, setStats] = useState<ScenarioStats[] | null>(null)
  const [active, setActive] = useState<RunSummary[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const listTok = useToken(), statTok = useToken()
  const title = (id: string) => scenarios.find(s => s.id === id)?.title ?? 'سناریوی حذف‌شده'

  useEffect(() => { setPage(1) }, [scenarioId, status])

  // History page (paginated) — re-fetched on filter/page change and when active runs finish.
  const activeKey = active.map(r => r.id).join(',')
  useEffect(() => {
    const t = listTok.next()
    setData(null)
    window.electronAPI.queryRuns({ scenarioId: scenarioId || undefined, status, page, pageSize: PAGE_SIZE })
      .then(r => { if (listTok.isCurrent(t)) { setData(r); setError('') } })
      .catch(e => { if (listTok.isCurrent(t)) setError(String(e?.message ?? e)) })
    return () => listTok.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId, status, page, activeKey ? 0 : 1])

  useEffect(() => {
    const t = statTok.next()
    setStats(null)
    window.electronAPI.runStats(days, scenarioId || undefined)
      .then(r => { if (statTok.isCurrent(t)) setStats(r.stats) })
      .catch(() => { if (statTok.isCurrent(t)) setStats([]) })
    return () => statTok.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId, days, activeKey ? 0 : 1])

  // Live part only: active runs + schedules.
  useEffect(() => {
    let alive = true
    const load = () => Promise.all([window.electronAPI.listRuns(scenarioId || undefined, 50), window.electronAPI.listSchedules()])
      .then(([r, s]) => { if (alive) { setActive(r.filter(x => x.status === 'queued' || x.status === 'running' || x.status === 'cancelling')); setSchedules(s) } }).catch(() => undefined)
    void load()
    const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [scenarioId])

  const pages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1
  const upcoming = schedules.filter(s => s.enabled && s.nextRun && (!scenarioId || s.scenarioId === scenarioId)).sort((a, b) => a.nextRun!.localeCompare(b.nextRun!))
  const one = stats?.[0]

  const row = (r: RunSummary, live = false) => {
    const failed = r.status === 'failed' || r.status === 'timeout'
    return <div key={r.id} className="settings-card monitor-run">
      <div className="monitor-row" style={{ padding: 0 }}>
        <div className="schedule-info"><strong>{r.title || title(r.scenarioId)}</strong>
          <small>شروع: {fmt(r.startedAt ?? r.createdAt)} · مدت: {dur(r.durationMs)}</small></div>
        <span className="monitor-actions">
          <span className={'monitor-badge ' + r.status}>{statusLabel[r.status] ?? r.status}</span>
          {live && <button className="danger" onClick={() => void window.electronAPI.cancelRun(r.id)}>لغو</button>}
          {failed && <button onClick={() => setOpenId(openId === r.id ? null : r.id)}>{openId === r.id ? 'بستن' : 'علت خطا'}</button>}
        </span>
      </div>
      {failed && openId === r.id && <div className="error-box">
        {r.failedStep && <div>مرحله {num(r.failedStep.index + 1)}: {r.failedStep.title}</div>}
        <div>{r.error?.message ?? 'علت خطا ثبت نشده است.'}</div>
        {r.error?.code && <code>{r.error.code}</code>}
      </div>}
    </div>
  }

  // Export the current filter (max 5000 rows). CSV gets a UTF-8 BOM so Excel reads Persian text.
  const [exporting, setExporting] = useState(false)
  const exportRuns = async (kind: 'csv' | 'json') => {
    setExporting(true)
    try {
      const r = await window.electronAPI.queryRuns({ scenarioId: scenarioId || undefined, status, page: 1, pageSize: 5000 })
      let body: string
      if (kind === 'json') body = JSON.stringify(r.items, null, 2)
      else {
        const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
        const head = ['id', 'scenarioId', 'title', 'status', 'createdAt', 'startedAt', 'endedAt', 'durationMs', 'errorCode', 'errorMessage', 'failedStep']
        body = [head.join(','), ...r.items.map(i => [i.id, i.scenarioId, i.title, i.status, i.createdAt, i.startedAt, i.endedAt, i.durationMs, i.error?.code, i.error?.message, i.failedStep?.title].map(q).join(','))].join('\r\n')
      }
      const blob = new Blob(['\uFEFF' + body], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'runs-' + new Date().toISOString().slice(0, 10) + '.' + kind
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) { setError(String((e as Error)?.message ?? e)) } finally { setExporting(false) }
  }

  return <div className="settings-page monitor-page">
    <button onClick={onBack}>← بازگشت</button>
    <h2>مانیتور اجراها</h2>

    <div className="monitor-filters">
      <label>سناریو<select value={scenarioId} onChange={e => setScenarioId(e.target.value)}>
        <option value="">همه سناریوها</option>{scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <label>بازه نمودار<select value={days} onChange={e => setDays(Number(e.target.value))}>
        <option value={7}>۷ روز</option><option value={14}>۱۴ روز</option><option value={30}>۳۰ روز</option><option value={90}>۹۰ روز</option></select></label>
      <label>وضعیت<select value={status} onChange={e => setStatus(e.target.value as typeof status)}>
        <option value="all">همه</option><option value="passed">موفق</option><option value="failed">ناموفق</option><option value="cancelled">لغو شده</option></select></label>
    </div>

    <div className="settings-card monitor-chart-card">
      <strong>{scenarioId ? title(scenarioId) : 'همه سناریوها'}</strong>
      {stats === null ? <span className="sk-block" /> : <Chart stats={scenarioId ? one : mergeAll(stats, days)} />}
    </div>

    <h3>در حال اجرا / در صف ({num(active.length)})</h3>
    <div className="schedule-list">{active.map(r => row(r, true))}{!active.length && <p className="muted">اجرای فعالی وجود ندارد.</p>}</div>

    <h3>اجراهای بعدی زمان‌بندی‌شده</h3>
    <div className="schedule-list">
      {upcoming.map(s => <div key={s.id} className="settings-card monitor-row"><div className="schedule-info"><strong>{title(s.scenarioId)}</strong></div><span>{fmt(s.nextRun)}</span></div>)}
      {!upcoming.length && <p className="muted">زمان‌بندی فعالی وجود ندارد.</p>}
    </div>

    <h3>تاریخچه {data ? `(${num(data.total)})` : ''}</h3>
    {error && <div className="error-box">{error}</div>}
    {data === null ? <Skeleton /> : <div className="schedule-list">{data.items.map(r => row(r))}{!data.items.length && <p className="muted">اجرایی یافت نشد.</p>}</div>}
    <div className="monitor-pager">
      <button disabled={exporting} onClick={() => void exportRuns('csv')}>خروجی CSV</button>
      <button disabled={exporting} onClick={() => void exportRuns('json')}>خروجی JSON</button>
      <button disabled={page <= 1 || data === null} onClick={() => setPage(p => p - 1)}>قبلی</button>
      <span>صفحه {num(page)} از {num(pages)}</span>
      <button disabled={page >= pages || data === null} onClick={() => setPage(p => p + 1)}>بعدی</button>
    </div>
  </div>
}

// Combine per-scenario stats into one series for the "all scenarios" view.
function mergeAll(list: ScenarioStats[], _days: number): ScenarioStats | undefined {
  if (!list.length) return undefined
  const base: ScenarioStats = { ...list[0], scenarioId: '', total: 0, passed: 0, failed: 0, cancelled: 0, avgMs: 0, days: list[0].days.map(d => ({ ...d, passed: 0, failed: 0, cancelled: 0, avgMs: 0 })) }
  let ms = 0
  for (const s of list) {
    base.total += s.total; base.passed += s.passed; base.failed += s.failed; base.cancelled += s.cancelled; ms += s.avgMs * s.total
    s.days.forEach((d, i) => { base.days[i].passed += d.passed; base.days[i].failed += d.failed; base.days[i].cancelled += d.cancelled })
  }
  base.avgMs = base.total ? Math.round(ms / base.total) : 0
  return base
}
