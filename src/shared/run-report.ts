import type { RunStatus, RunSummary } from './types'

export interface RunQuery {
  scenarioId?: string
  status?: 'all' | 'passed' | 'failed' | 'cancelled'
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export interface RunPage {
  items: RunSummary[]
  total: number
  page: number
  pageSize: number
  source: 'database' | 'local'
}

export interface DayStat { day: string; passed: number; failed: number; cancelled: number; avgMs: number }

export interface ScenarioStats {
  scenarioId: string
  total: number
  passed: number
  failed: number
  cancelled: number
  avgMs: number
  lastStatus?: RunStatus
  lastAt?: string
  days: DayStat[]
}

export interface LightRun { scenarioId: string; status: RunStatus; createdAt: string; durationMs?: number }

export const MAX_PAGE_SIZE = 5000
export const isFailure = (s: string) => s === 'failed' || s === 'timeout'

const dayKey = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

// Pure aggregation: shared by the SQL and the local-file source so both give identical numbers.
export function computeStats(rows: LightRun[], days: number, now = new Date()): ScenarioStats[] {
  const span = Math.min(Math.max(Math.trunc(days) || 14, 1), 90)
  const keys: string[] = []
  for (let i = span - 1; i >= 0; i--) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); keys.push(dayKey(d)) }
  const by = new Map<string, { s: ScenarioStats; ms: number; msN: number; perDay: Map<string, { ms: number; n: number }> }>()
  for (const r of rows) {
    if (r.status === 'queued' || r.status === 'running' || r.status === 'cancelling') continue
    let e = by.get(r.scenarioId)
    if (!e) {
      e = { s: { scenarioId: r.scenarioId, total: 0, passed: 0, failed: 0, cancelled: 0, avgMs: 0, days: keys.map(day => ({ day, passed: 0, failed: 0, cancelled: 0, avgMs: 0 })) }, ms: 0, msN: 0, perDay: new Map() }
      by.set(r.scenarioId, e)
    }
    const s = e.s
    s.total++
    if (r.status === 'passed') s.passed++; else if (isFailure(r.status)) s.failed++; else s.cancelled++
    if (!s.lastAt || r.createdAt > s.lastAt) { s.lastAt = r.createdAt; s.lastStatus = r.status }
    if (r.durationMs != null) { e.ms += r.durationMs; e.msN++ }
    const slot = s.days.find(d => d.day === dayKey(new Date(r.createdAt)))
    if (slot) {
      if (r.status === 'passed') slot.passed++; else if (isFailure(r.status)) slot.failed++; else slot.cancelled++
      if (r.durationMs != null) { const p = e.perDay.get(slot.day) ?? { ms: 0, n: 0 }; p.ms += r.durationMs; p.n++; e.perDay.set(slot.day, p) }
    }
  }
  return [...by.values()].map(e => {
    e.s.avgMs = e.msN ? Math.round(e.ms / e.msN) : 0
    for (const d of e.s.days) { const p = e.perDay.get(d.day); d.avgMs = p ? Math.round(p.ms / p.n) : 0 }
    return e.s
  })
}
