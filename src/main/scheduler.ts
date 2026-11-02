import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { computeNextRun, validateSchedule, type Schedule, type SaveScheduleInput } from "../shared/schedule"
import type { Scenario, RunRecord, RunRequest } from "../shared/types"

const FILE = () => path.join(app.getPath('userData'), 'flowweb', 'schedules.json')

let schedules: Schedule[] = []
let timer: NodeJS.Timeout | undefined
let deps: Deps | undefined

function load() {
  try { schedules = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Schedule[] } catch { schedules = [] }
}
function persist() {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  const tmp = FILE() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(schedules, null, 2))
  fs.renameSync(tmp, FILE())
}

export function listSchedules(): Schedule[] { return schedules }

export function saveSchedule(input: SaveScheduleInput): Schedule {
  const error = validateSchedule(input)
  if (error) throw new Error(error)
  const existing = input.id ? schedules.find(s => s.id === input.id) : undefined
  const next: Schedule = { ...existing, ...input, id: existing?.id ?? crypto.randomUUID() }
  next.nextRun = next.enabled ? computeNextRun(next, new Date())?.toISOString() : undefined
  schedules = existing ? schedules.map(s => s.id === next.id ? next : s) : [...schedules, next]
  persist()
  return next
}

export function deleteSchedule(id: string): boolean {
  const before = schedules.length
  schedules = schedules.filter(s => s.id !== id)
  persist()
  return schedules.length !== before
}

export function deleteSchedulesFor(scenarioId: string) {
  if (schedules.some(s => s.scenarioId === scenarioId)) { schedules = schedules.filter(s => s.scenarioId !== scenarioId); persist() }
}

interface Deps {
  getScenario: (id: string) => Scenario | undefined
  enqueue: (scenario: Scenario, request?: RunRequest) => RunRecord
}

/** Starts a run for the schedule now and records it as its last run. */
function launch(s: Schedule, scenario: Scenario, now: Date) {
  const run = deps!.enqueue(scenario)
  s.lastRunId = run.id
  s.lastRun = now.toISOString()
  s.lastStatus = run.status
}

/** Runs a schedule immediately without changing its next occurrence. */
export function runScheduleNow(id: string): { ok: boolean; error?: string } {
  const s = schedules.find(x => x.id === id)
  if (!s || !deps) return { ok: false, error: 'زمان‌بندی پیدا نشد.' }
  const scenario = deps.getScenario(s.scenarioId)
  if (!scenario) return { ok: false, error: 'سناریوی این زمان‌بندی پیدا نشد.' }
  try { launch(s, scenario, new Date()); persist(); return { ok: true } }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'اجرا شروع نشد.' } }
}

/** Keeps a scheduled run's record in sync when the runner finishes it or retries it. Returns true for scheduled runs. */
export function handleRunFinished(run: RunRecord): boolean {
  const s = schedules.find(x => x.lastRunId === run.id)
  if (!s) return false
  if (run.status === 'running') return true
  s.lastStatus = run.status
  persist()
  return true
}

export function retargetScheduledRun(oldId: string, newId: string) {
  const s = schedules.find(x => x.lastRunId === oldId)
  if (s) { s.lastRunId = newId; s.lastStatus = 'running'; persist() }
}

function tick() {
  if (!deps) return
  const now = new Date()
  let changed = false
  for (const s of schedules) {
    if (!s.enabled) continue
    if (!s.nextRun) { s.nextRun = computeNextRun(s, now)?.toISOString(); changed = true; continue }
    if (new Date(s.nextRun).getTime() > now.getTime()) continue
    const scenario = deps.getScenario(s.scenarioId)
    if (scenario) {
      try { launch(s, scenario, now) }
      catch (error) { console.error('Scheduled run failed to start:', error) }
    }
    s.nextRun = computeNextRun(s, now)?.toISOString()
    changed = true
  }
  if (changed) persist()
}

export function startScheduler(d: Deps) {
  deps = d
  load()
  tick()
  timer = setInterval(tick, 15_000)
  timer.unref()
}

export function stopScheduler() { if (timer) clearInterval(timer) }
