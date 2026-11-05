import { listAllRuns } from './store'
import { dbQueryRuns, dbRunRows } from './db-sync'
import { computeStats, MAX_PAGE_SIZE, type RunPage, type RunQuery, type ScenarioStats } from '../shared/run-report'

// Source: local runs/*/result.json (the working copy; the DB mirror receives the same files).
export async function queryRuns(q: RunQuery): Promise<RunPage> {
  return (await dbQueryRuns(q)) ?? queryLocal(q)
}

function queryLocal(q: RunQuery): RunPage {
  const pageSize = Math.min(Math.max(Math.trunc(q.pageSize ?? 20) || 20, 1), MAX_PAGE_SIZE)
  const from = q.from ? Date.parse(q.from) : NaN
  const to = q.to ? Date.parse(q.to) : NaN
  const rows = listAllRuns().filter(r => {
    if (q.scenarioId && r.scenarioId !== q.scenarioId) return false
    if (q.status === 'passed' && r.status !== 'passed') return false
    if (q.status === 'failed' && r.status !== 'failed' && r.status !== 'timeout') return false
    if (q.status === 'cancelled' && r.status !== 'cancelled') return false
    const t = Date.parse(r.createdAt)
    if (!Number.isNaN(from) && t < from) return false
    if (!Number.isNaN(to) && t > to) return false
    return true
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const pages = Math.max(Math.ceil(rows.length / pageSize), 1)
  const page = Math.min(Math.max(Math.trunc(q.page ?? 1) || 1, 1), pages)
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, source: 'local' }
}

export async function runStats(days: number, scenarioId?: string): Promise<{ stats: ScenarioStats[]; source: 'database' | 'local' }> {
  const dbRows = await dbRunRows(days, scenarioId)
  if (dbRows) return { stats: computeStats(dbRows, days), source: 'database' }
  return statsLocal(days, scenarioId)
}

function statsLocal(days: number, scenarioId?: string): { stats: ScenarioStats[]; source: 'local' } {
  const rows = listAllRuns().filter(r => !scenarioId || r.scenarioId === scenarioId)
  return { stats: computeStats(rows, days), source: 'local' }
}
