import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { validateSettings, ValidationError } from '../shared/validation'
import { secretNamePattern, validateSteps } from '../shared/steps'
import { isTerminalStatus } from '../shared/types'
import { mirror, mirrorDelete } from './db-sync'
import { compileSteps } from './step-engine'
import type {
  AppSettings,
  ProfileInfo,
  RunRecord,
  RunSummary,
  ScenarioStep,
  SecretInfo,
  SaveScenarioInput,
  Scenario
} from '../shared/types'

const DATA_DIR = path.join(
  app.getPath('userData'),
  'flowweb'
)

const SCENARIOS_FILE = path.join(DATA_DIR, 'scenarios.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const RUNS_DIR = path.join(DATA_DIR, 'runs')
const PROFILES_DIR = path.join(DATA_DIR, 'profiles')
const PROFILES_INDEX = path.join(DATA_DIR, 'profiles.json')
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json')

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(RUNS_DIR, { recursive: true })
  fs.mkdirSync(PROFILES_DIR, { recursive: true })
}

function atomicWriteJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`
  // Mode 0600 keeps the token and run data private on POSIX; Windows uses the user profile ACLs.
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tempPath, filePath)
  try { mirror(filePath, value) } catch (error) { console.error('DB mirror failed:', error) }
}

// A corrupt state file must not keep the app from starting: keep it for inspection and continue.
function quarantine(filePath: string, reason: unknown) {
  const backup = `${filePath}.corrupt-${Date.now()}`
  try { fs.renameSync(filePath, backup) } catch (error) { console.error('Could not back up corrupt file:', error) }
  console.error('Invalid state file ' + filePath + ' moved to ' + backup + ': ' + String(reason))
}

function readStateJson<T>(filePath: string, fallback: T): T {
  try { return readJson<T>(filePath, fallback) } catch (error) {
    quarantine(filePath, error)
    return fallback
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch (error) {
    throw new Error('Could not read JSON file ' + filePath + ': ' + String(error))
  }
}

function defaultSettings(): AppSettings {
  return {
    apiEnabled: true,
    host: '127.0.0.1',
    port: 3434,
    token: crypto.randomBytes(32).toString('hex'),
    concurrency: 2,
    runTimeoutMs: 300_000,
    retryCount: 1,
    notifyOnFailure: true
  }
}

export function getSettings(): AppSettings {
  ensureDirectories()

  const defaults = defaultSettings()
  const saved = readStateJson<Partial<AppSettings> & { apiToken?: string; concurrencyLimit?: number; timeoutMs?: number }>(SETTINGS_FILE, {})
  let settings: AppSettings
  try {
    settings = validateSettings({ ...defaults, ...saved,
      token: saved.token ?? saved.apiToken ?? defaults.token,
      concurrency: saved.concurrency ?? saved.concurrencyLimit ?? defaults.concurrency,
      runTimeoutMs: saved.runTimeoutMs ?? saved.timeoutMs ?? defaults.runTimeoutMs
    })
  } catch (error) {
    // Invalid saved values (for example a too-short token) fall back to safe defaults.
    quarantine(SETTINGS_FILE, error)
    settings = validateSettings(defaults)
  }
  if (!fs.existsSync(SETTINGS_FILE) || JSON.stringify(settings) !== JSON.stringify(saved)) atomicWriteJson(SETTINGS_FILE, settings)
  return settings
}

export function saveSettings(input: AppSettings): AppSettings {
  ensureDirectories()
  const settings = validateSettings(input)
  atomicWriteJson(SETTINGS_FILE, settings)
  return settings
}

export function getScenarios(): Scenario[] {
  ensureDirectories()

  const data = readStateJson<{ version: number; items: Scenario[] }>(
    SCENARIOS_FILE,
    { version: 1, items: [] }
  )

  return Array.isArray(data.items) ? data.items : []
}

export function getScenario(id: string): Scenario | undefined {
  return getScenarios().find((scenario) => scenario.id === id)
}

export function saveScenario(input: SaveScenarioInput): Scenario {
  ensureDirectories()

  if (!input || typeof input.title !== 'string' || typeof input.headless !== 'boolean') throw new ValidationError('Invalid scenario.')
  if (input.id !== undefined && (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id))) throw new ValidationError('Invalid scenario ID.')
  if (input.profileId !== undefined && input.profileId !== '' && !profilePattern.test(input.profileId)) throw new ValidationError('شناسه پروفایل نامعتبر است.')
  const title = input.title.trim()
  if (input.mode !== undefined && !['code', 'steps'].includes(input.mode)) throw new ValidationError('نوع سناریو نامعتبر است.')
  const code = input.mode === 'steps' ? compileSteps(input.steps!) : input.code
  let keptSteps: ScenarioStep[] | undefined
  if (input.mode === 'steps') keptSteps = structuredClone(input.steps)
  else if (Array.isArray(input.steps) && input.steps.length) {
    try { validateSteps(input.steps); keptSteps = structuredClone(input.steps) } catch { keptSteps = undefined }
  }

  if (!title) throw new Error('عنوان سناریو را وارد کن.')
  if (title.length > 120) throw new Error('عنوان بیش از حد طولانی است.')
  if (typeof code !== 'string' || !code.trim() || code.length > 1_000_000) {
    throw new Error('کد سناریو نامعتبر است یا بیش از حد طولانی است.')
  }

  const items = getScenarios()
  const existing = input.id
    ? items.find((scenario) => scenario.id === input.id)
    : undefined

  const now = new Date().toISOString()

  const scenario: Scenario = {
    id: existing?.id ?? input.id ?? `scn_${crypto.randomUUID()}`,
    title,
    code,
    mode: input.mode ?? 'code',
    // Steps are kept in code mode too, so the visual nodes survive a trip through the code editor.
    steps: keptSteps,
    autoSync: input.autoSync !== false,
    headless: Boolean(input.headless),
    profileId: input.profileId || undefined,
    saveSession: input.profileId ? Boolean(input.saveSession) : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }

  const index = items.findIndex((item) => item.id === scenario.id)

  if (index >= 0) {
    items[index] = scenario
  } else {
    items.push(scenario)
  }

  atomicWriteJson(SCENARIOS_FILE, {
    version: 1,
    items
  })

  return scenario
}

export function writeRun(run: RunRecord) {
  ensureDirectories()

  const runDir = path.join(RUNS_DIR, run.id)
  fs.mkdirSync(runDir, { recursive: true })

  atomicWriteJson(path.join(runDir, 'result.json'), run)
}

export function readRun(id: string): RunRecord | undefined {
  if (!/^run_[a-f0-9-]+$/i.test(id)) return undefined

  const filePath = path.join(RUNS_DIR, id, 'result.json')
  if (!fs.existsSync(filePath)) return undefined

  return readJson<RunRecord | undefined>(filePath, undefined)
}

export function getRunDirectory(id: string): string {
  return path.join(RUNS_DIR, id)
}

export function deleteScenario(id: string): boolean {
  const items = getScenarios()
  const remaining = items.filter(item => item.id !== id)
  if (remaining.length === items.length) return false
  atomicWriteJson(SCENARIOS_FILE, { version: 1, items: remaining })
  return true
}

// Never replay interrupted browser actions automatically: they may have side effects.
export function recoverInterruptedRuns() {
  ensureDirectories()
  for (const id of fs.readdirSync(RUNS_DIR)) {
    let run: RunRecord | undefined
    try { run = readRun(id) } catch (error) { console.error('Skipping unreadable run ' + id + ':', error); continue }
    if (!run || isTerminalStatus(run.status)) continue
    // The payload may hold secrets and session data; an interrupted run is never replayed.
    try { fs.rmSync(path.join(RUNS_DIR, id, 'payload.json'), { force: true }) } catch (error) { console.error('Could not remove stale payload:', error) }
    run.status = 'failed'
    run.endedAt = new Date().toISOString()
    run.durationMs = run.startedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : 0
    run.output = null
    run.error = { code: 'INTERRUPTED', message: 'Application stopped before this run completed. Submit a new run explicitly.' }
    writeRun(run)
  }
}

export const RUN_RETENTION_MS = 30 * 24 * 3600 * 1000
export const RUN_RETENTION_COUNT = 1000

// Removes finished runs that are old or beyond the newest RUN_RETENTION_COUNT. Active runs are never touched.
export function pruneRuns(activeIds: ReadonlySet<string> = new Set(), now = Date.now()) {
  ensureDirectories()
  const finished: { id: string; at: number }[] = []
  for (const id of fs.readdirSync(RUNS_DIR)) {
    if (activeIds.has(id)) continue
    let run: RunRecord | undefined
    try { run = readRun(id) } catch { run = undefined }
    if (!run) {
      // Directory without a readable result (for example a failed enqueue): remove it once it is a day old.
      try {
        const dir = path.join(RUNS_DIR, id)
        if (/^run_[a-f0-9-]+$/i.test(id) && now - fs.statSync(dir).mtimeMs > 24 * 3600 * 1000) { fs.rmSync(dir, { recursive: true, force: true }); mirrorDelete(dir) }
      } catch (error) { console.error('Run cleanup failed:', error) }
      continue
    }
    if (!isTerminalStatus(run.status)) continue
    finished.push({ id, at: Date.parse(run.endedAt ?? run.createdAt) || 0 })
  }
  finished.sort((a, b) => b.at - a.at)
  finished.forEach((item, index) => {
    if (index < RUN_RETENTION_COUNT && now - item.at <= RUN_RETENTION_MS) return
    try { const dir = path.join(RUNS_DIR, item.id); fs.rmSync(dir, { recursive: true, force: true }); mirrorDelete(dir) }
    catch (error) { console.error('Run cleanup failed:', error) }
  })
}

// ---------- encrypted private files (session profiles and secrets) ----------
const profilePattern = /^prf_[a-f0-9-]{36}$/

// Uses the OS keychain (DPAPI on Windows) when Electron offers it; otherwise falls back to a 0600 file.
function writePrivate(filePath: string, value: unknown) {
  const plain = JSON.stringify(value)
  const encrypted = safeStorage?.isEncryptionAvailable?.() === true
  const data = encrypted ? safeStorage.encryptString(plain).toString('base64') : plain
  atomicWriteJson(filePath, { v: 1, enc: encrypted, data })
}

function readPrivate<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback
  try {
    const wrapper = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { enc: boolean; data: string }
    const plain = wrapper.enc ? safeStorage.decryptString(Buffer.from(wrapper.data, 'base64')) : wrapper.data
    return JSON.parse(plain) as T
  } catch (error) {
    quarantine(filePath, error)
    return fallback
  }
}

// ---------- session profiles ----------
export function listProfiles(): ProfileInfo[] {
  ensureDirectories()
  const data = readStateJson<{ version: number; items: ProfileInfo[] }>(PROFILES_INDEX, { version: 1, items: [] })
  return Array.isArray(data.items) ? data.items : []
}

export function readProfileState(id: string): unknown | undefined {
  if (!profilePattern.test(id) || !listProfiles().some(item => item.id === id)) return undefined
  return readPrivate<unknown | undefined>(path.join(PROFILES_DIR, id + '.json'), undefined)
}

export function saveProfileState(name: string, state: unknown, existingId?: string): ProfileInfo {
  ensureDirectories()
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new ValidationError('نام پروفایل را وارد کنید (حداکثر ۸۰ کاراکتر).')
  const encoded = JSON.stringify(state)
  if (!state || typeof state !== 'object' || encoded.length > 5_000_000) throw new ValidationError('وضعیت نشست نامعتبر یا بیش از حد بزرگ است.')
  const items = listProfiles()
  const existing = existingId ? items.find(item => item.id === existingId) : undefined
  if (existingId && !existing) throw new ValidationError('پروفایل پیدا نشد.')
  const now = new Date().toISOString()
  const info: ProfileInfo = existing ? { ...existing, updatedAt: now } : { id: 'prf_' + crypto.randomUUID(), name: name.trim(), createdAt: now, updatedAt: now }
  if (existing && name.trim() !== existing.name && name.trim()) info.name = name.trim()
  writePrivate(path.join(PROFILES_DIR, info.id + '.json'), state)
  atomicWriteJson(PROFILES_INDEX, { version: 1, items: existing ? items.map(item => item.id === info.id ? info : item) : [...items, info] })
  return info
}

export function deleteProfile(id: string): boolean {
  if (!profilePattern.test(id)) return false
  const items = listProfiles()
  if (!items.some(item => item.id === id)) return false
  atomicWriteJson(PROFILES_INDEX, { version: 1, items: items.filter(item => item.id !== id) })
  fs.rmSync(path.join(PROFILES_DIR, id + '.json'), { force: true })
  // Scenarios that used this profile run without a session instead of failing.
  const scenarios = getScenarios()
  if (scenarios.some(item => item.profileId === id)) {
    atomicWriteJson(SCENARIOS_FILE, { version: 1, items: scenarios.map(item => item.profileId === id ? { ...item, profileId: undefined, saveSession: undefined } : item) })
  }
  return true
}

// ---------- secrets (values never leave the main process except into a run's payload file) ----------
type SecretMap = Record<string, { value: string; updatedAt: string }>
const readSecrets = () => readPrivate<SecretMap>(SECRETS_FILE, {})

export function listSecrets(): SecretInfo[] {
  ensureDirectories()
  return Object.entries(readSecrets()).map(([name, item]) => ({ name, updatedAt: item.updatedAt })).sort((a, b) => a.name.localeCompare(b.name))
}

export function saveSecret(name: string, value: string): SecretInfo[] {
  ensureDirectories()
  if (typeof name !== 'string' || !secretNamePattern.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new ValidationError('نام رمز نامعتبر است؛ فقط حروف انگلیسی، عدد، _ و - تا ۶۰ کاراکتر.')
  if (typeof value !== 'string' || !value.length || value.length > 10_000) throw new ValidationError('مقدار رمز را وارد کنید (حداکثر ۱۰٬۰۰۰ کاراکتر).')
  const secrets = readSecrets()
  secrets[name] = { value, updatedAt: new Date().toISOString() }
  writePrivate(SECRETS_FILE, secrets)
  return listSecrets()
}

export function deleteSecret(name: string): SecretInfo[] {
  const secrets = readSecrets()
  if (Object.prototype.hasOwnProperty.call(secrets, name)) { delete secrets[name]; writePrivate(SECRETS_FILE, secrets) }
  return listSecrets()
}

export function secretNamesInSteps(steps: ScenarioStep[] | undefined): string[] {
  const names = new Set<string>()
  for (const step of steps ?? []) {
    if (step.type === 'navigate' && step.url.kind === 'secret') names.add(step.url.value)
    if ('value' in step && step.value && typeof step.value === 'object' && step.value.kind === 'secret') names.add(step.value.value)
    if (step.type === 'form') for (const field of step.fields) if (field.value.kind === 'secret') names.add(field.value.value)
    if (step.type === 'code') for (const match of step.code.matchAll(/\bsecrets(?:\.([A-Za-z_]\w*)|\[\s*(?:"([^"]+)"|'([^']+)')\s*\])/g)) { const name = match[1] ?? match[2] ?? match[3]; if (secretNamePattern.test(name)) names.add(name) }
  }
  return [...names]
}

export function getSecretValues(names: string[]): Record<string, string> {
  if (!names.length) return {}
  const secrets = readSecrets()
  const missing = names.filter(name => !Object.prototype.hasOwnProperty.call(secrets, name))
  if (missing.length) throw new ValidationError('رمزهای ذخیره‌نشده: ' + missing.join('، '))
  return Object.fromEntries(names.map(name => [name, secrets[name].value]))
}

// ---------- run history and artifacts ----------
const artifactPattern = /^(failure|shot-[a-zA-Z0-9_-]{1,60})\.png$/

export function listArtifacts(runId: string): string[] {
  if (!/^run_[a-f0-9-]+$/i.test(runId)) return []
  try { return fs.readdirSync(path.join(RUNS_DIR, runId)).filter(name => artifactPattern.test(name)).sort() } catch { return [] }
}

export function readArtifact(runId: string, name: string): Buffer | undefined {
  if (!/^run_[a-f0-9-]+$/i.test(runId) || !artifactPattern.test(name)) return undefined
  const file = path.join(RUNS_DIR, runId, name)
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size > 15_000_000) return undefined
    return fs.readFileSync(file)
  } catch { return undefined }
}

export function listRuns(scenarioId?: string, limit = 30): RunSummary[] {
  ensureDirectories()
  const max = Math.min(Math.max(Math.trunc(limit) || 30, 1), 200)
  const dirs = fs.readdirSync(RUNS_DIR)
    .filter(id => /^run_[a-f0-9-]+$/i.test(id))
    .map(id => { try { return { id, at: fs.statSync(path.join(RUNS_DIR, id)).mtimeMs } } catch { return { id, at: 0 } } })
    .sort((a, b) => b.at - a.at)
  const result: RunSummary[] = []
  for (const dir of dirs.slice(0, 1000)) {
    let run: RunRecord | undefined
    try { run = readRun(dir.id) } catch { continue }
    if (!run || (scenarioId && run.scenarioId !== scenarioId)) continue
    result.push({ id: run.id, scenarioId: run.scenarioId, title: run.title, status: run.status, createdAt: run.createdAt, startedAt: run.startedAt, endedAt: run.endedAt, durationMs: run.durationMs, error: run.error && { code: run.error.code, message: run.error.message }, failedStep: run.failedStep, artifacts: listArtifacts(run.id) })
    if (result.length >= max) break
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
