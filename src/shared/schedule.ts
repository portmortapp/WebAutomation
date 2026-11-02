export type ScheduleKind = 'daily' | 'weekly' | 'monthly'

export interface Schedule {
  id: string
  scenarioId: string
  kind: ScheduleKind
  /** 'HH:MM' local time */
  time: string
  /** 0=Sunday..6=Saturday, used by weekly */
  weekdays: number[]
  /** 1..31, used by monthly (clamped to the month length) */
  monthDay: number
  enabled: boolean
  nextRun?: string
  lastRun?: string
  lastRunId?: string
  /** Status of the last run: running, passed, failed, timeout or cancelled */
  lastStatus?: string
}

export type SaveScheduleInput = Omit<Schedule, 'id' | 'nextRun' | 'lastRun' | 'lastRunId' | 'lastStatus'> & { id?: string }

export function parseTime(time: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h < 24 && min < 60 ? [h, min] : null
}

/** First occurrence strictly after `from`, or undefined if the schedule is invalid. */
export function computeNextRun(s: Pick<Schedule, 'kind' | 'time' | 'weekdays' | 'monthDay'>, from: Date): Date | undefined {
  const t = parseTime(s.time)
  if (!t) return undefined
  for (let i = 0; i <= 400; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, t[0], t[1], 0, 0)
    if (d.getTime() <= from.getTime()) continue
    if (s.kind === 'daily') return d
    if (s.kind === 'weekly') { if (s.weekdays.includes(d.getDay())) return d; continue }
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    if (d.getDate() === Math.min(s.monthDay, last)) return d
  }
  return undefined
}

export function validateSchedule(input: SaveScheduleInput): string | null {
  if (!input.scenarioId) return 'سناریو انتخاب نشده است.'
  if (!parseTime(input.time)) return 'ساعت معتبر نیست.'
  if (!['daily', 'weekly', 'monthly'].includes(input.kind)) return 'نوع تکرار معتبر نیست.'
  if (input.kind === 'weekly' && !input.weekdays.length) return 'حداقل یک روز هفته را انتخاب کنید.'
  if (input.kind === 'monthly' && !(input.monthDay >= 1 && input.monthDay <= 31)) return 'روز ماه باید بین ۱ تا ۳۱ باشد.'
  return null
}
