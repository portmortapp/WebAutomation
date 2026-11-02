import { useEffect, useState } from 'react'
import type { Schedule, ScheduleKind } from '../shared/schedule'
import { computeNextRun, validateSchedule } from '../shared/schedule'

interface Props {
  scenarios: { id: string; title: string }[]
  onBack: () => void
  onMessage: (text: string) => void
}

const days = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
// Display order starting from Saturday (Persian week); values are JS getDay() numbers.
const weekOrder = [6, 0, 1, 2, 3, 4, 5]
const kinds: [ScheduleKind, string][] = [['daily', 'روزانه'], ['weekly', 'هفتگی'], ['monthly', 'ماهانه']]
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

const blank = (scenarioId: string) => ({ scenarioId, kind: 'daily' as ScheduleKind, time: '09:00', weekdays: [6], monthDay: 1, enabled: true })

export function SchedulePage({ scenarios, onBack, onMessage }: Props) {
  const [items, setItems] = useState<Schedule[]>([])
  const [form, setForm] = useState<(ReturnType<typeof blank> & { id?: string }) | null>(null)
  const title = (id: string) => scenarios.find(s => s.id === id)?.title ?? 'سناریوی حذف‌شده'
  const refresh = () => window.electronAPI.listSchedules().then(setItems).catch(() => undefined)
  useEffect(() => { void refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t) }, [])

  const save = async (input: NonNullable<typeof form>) => {
    const error = validateSchedule(input)
    if (error) return onMessage(error)
    try { await window.electronAPI.saveSchedule(input); setForm(null); await refresh(); onMessage('زمان‌بندی ذخیره شد.') }
    catch (e) { onMessage(e instanceof Error ? e.message : 'ذخیره نشد.') }
  }
  const toggle = (s: Schedule) => save({ ...s, enabled: !s.enabled })
  const remove = async (s: Schedule) => { await window.electronAPI.deleteSchedule(s.id); await refresh() }
  const runNow = async (s: Schedule) => {
    const r = await window.electronAPI.runSchedule(s.id)
    onMessage(r.ok ? 'اجرا شروع شد.' : r.error ?? 'اجرا شروع نشد.')
    await refresh()
  }
  const statusLabel: Record<string, string> = { running: 'در حال اجرا', passed: 'موفق', failed: 'ناموفق', timeout: 'زمان‌تمام', cancelled: 'لغو شده' }
  const describe = (s: Schedule) => s.kind === 'daily' ? `هر روز ساعت ${s.time}` : s.kind === 'weekly' ? `هر هفته ${weekOrder.filter(d => s.weekdays.includes(d)).map(d => days[d]).join('، ')} ساعت ${s.time}` : `روز ${s.monthDay} هر ماه ساعت ${s.time}`
  const preview = form ? computeNextRun(form, new Date()) : undefined

  return <div className="settings-page schedule-page">
    <button className="text-button" onClick={onBack}>→ بازگشت به سناریو</button>
    <span className="eyebrow">SCHEDULES</span><h1>زمان‌بندی اجرا</h1>
    <p className="muted">سناریوها را به‌صورت روزانه، هفتگی یا ماهانه خودکار اجرا کنید. برنامه باید باز (یا در سینی سیستم) باشد.</p>
    {!form && <button className="primary" disabled={!scenarios.length} onClick={() => setForm(blank(scenarios[0]?.id ?? ''))}>+ زمان‌بندی جدید</button>}
    {!scenarios.length && <p className="hint warn">ابتدا یک سناریو بسازید و ذخیره کنید.</p>}

    {form && <div className="settings-card schedule-form">
      <label>سناریو<select value={form.scenarioId} onChange={e => setForm({ ...form, scenarioId: e.target.value })}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <div className="segmented" role="tablist" aria-label="نوع تکرار">{kinds.map(([k, l]) => <button key={k} className={form.kind === k ? 'active' : ''} onClick={() => setForm({ ...form, kind: k })}>{l}</button>)}</div>
      <label>ساعت اجرا<input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></label>
      {form.kind === 'weekly' && <div className="weekdays" role="group" aria-label="روزهای هفته">{weekOrder.map(d => <button key={d} className={form.weekdays.includes(d) ? 'chip active' : 'chip'} onClick={() => setForm({ ...form, weekdays: form.weekdays.includes(d) ? form.weekdays.filter(x => x !== d) : [...form.weekdays, d] })}>{days[d]}</button>)}</div>}
      {form.kind === 'monthly' && <label>روز ماه<input type="number" min={1} max={31} value={form.monthDay} onChange={e => setForm({ ...form, monthDay: Number(e.target.value) })} /><small>اگر ماه آن روز را نداشته باشد، در آخرین روز ماه اجرا می‌شود.</small></label>}
      <div className="hint">اجرای بعدی: {preview ? fmt(preview.toISOString()) : '—'}</div>
      <div className="schedule-actions"><button className="primary" onClick={() => save(form)}>ذخیره</button><button onClick={() => setForm(null)}>انصراف</button></div>
    </div>}

    <div className="schedule-list">
      {items.map(s => <div key={s.id} className={'settings-card schedule-item' + (s.enabled ? '' : ' off')}>
        <div className="schedule-info"><strong>{title(s.scenarioId)}</strong><span>{describe(s)}</span>
          <small>اجرای بعدی: {s.enabled ? fmt(s.nextRun) : 'غیرفعال'} · آخرین اجرا: {fmt(s.lastRun)}{s.lastStatus ? ` (${statusLabel[s.lastStatus] ?? s.lastStatus})` : ''}</small></div>
        <div className="schedule-actions">
          <label className="check"><input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} />فعال</label>
          <button onClick={() => runNow(s)}>اجرای الان</button>
          <button onClick={() => setForm({ ...s })}>ویرایش</button>
          <button className="danger" onClick={() => remove(s)}>حذف</button>
        </div>
      </div>)}
      {!items.length && !form && <p className="muted">هنوز زمان‌بندی‌ای ندارید.</p>}
    </div>
  </div>
}
