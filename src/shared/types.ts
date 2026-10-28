export interface Scenario {
  id: string
  title: string
  code: string
  headless: boolean
  createdAt: string
  updatedAt?: string
  mode?: 'code' | 'steps'
  steps?: ScenarioStep[]
  profileId?: string
  saveSession?: boolean
  autoSync?: boolean
}

export interface SaveScenarioInput {
  id?: string
  title: string
  code: string
  headless: boolean
  mode?: 'code' | 'steps'
  steps?: ScenarioStep[]
  profileId?: string
  saveSession?: boolean
  autoSync?: boolean
}

export interface ValueSource { kind: 'literal' | 'input' | 'secret'; value: string }
export interface Extraction {
  selector: string
  read: 'text' | 'value' | 'attribute'
  attribute: string
  dataType: 'text' | 'number' | 'boolean'
  normalizeDigits: boolean
  removeSeparators: boolean
  missing: 'error' | 'null'
}
export interface FormField { id: string; selector: string; action: 'fill' | 'select' | 'check' | 'uncheck'; value: ValueSource; by?: 'value' | 'label' }
export interface TableColumn extends Extraction { id: string; name: string }
export type ScenarioStep = { id: string; title: string; retries?: number; retryDelaySec?: number; continueOnError?: boolean } & (
  | { type: 'navigate'; url: ValueSource }
  | { type: 'fill'; selector: string; value: ValueSource; typing?: boolean }
  | { type: 'click'; selector: string; button?: 'left' | 'right' | 'middle'; double?: boolean; opensTab?: boolean }
  | { type: 'tab'; action: 'switch' | 'close'; index: number }
  | { type: 'dialog'; action: 'accept' | 'dismiss' }
  | { type: 'wait'; selector: string }
  | { type: 'form'; fields: FormField[] }
  | { type: 'waitPage'; mode: 'load' | 'domcontentloaded' | 'networkidle' | 'url'; url: string }
  | { type: 'history'; action: 'reload' | 'back' | 'forward' }
  | { type: 'code'; code: string }
  | { type: 'pause'; seconds: number }
  | { type: 'hover'; selector: string }
  | { type: 'select'; selector: string; value: ValueSource; by: 'value' | 'label' }
  | { type: 'check'; selector: string; checked: boolean }
  | { type: 'press'; selector: string; key: string }
  | { type: 'scroll'; to: 'top' | 'bottom' | 'element'; selector: string }
  | { type: 'screenshot'; name: string; fullPage: boolean }
  | { type: 'field'; name: string; extraction: Extraction }
  | { type: 'table'; name: string; rowSelector: string; columns: TableColumn[]; empty: 'error' | 'allow'; maxRows: number }
)
export interface StepResult {
  id: string
  title: string
  status: 'running' | 'passed' | 'failed'
  output?: JsonValue
  rowCount?: number
  durationMs?: number
  error?: string
  attempts?: number
  continued?: boolean
}
export interface PickRequest { kind: 'element' | 'rows' | 'column'; rowSelector?: string }
export interface PickResult { selector: string; text: string; count: number }
export interface StepPreview { output: JsonValue; results: StepResult[] }

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface RunRequest {
  input?: JsonValue
  timeoutMs?: number
}

export type RunStatus = 'queued' | 'running' | 'cancelling' | 'passed' | 'failed' | 'timeout' | 'cancelled'

export interface RunError {
  code: 'SCENARIO_ERROR' | 'INVALID_OUTPUT' | 'PROCESS_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'INTERRUPTED' | 'INTERNAL_ERROR'
  message: string
  stack?: string
  stepId?: string
}

export function isTerminalStatus(status: RunStatus): boolean {
  return ['passed', 'failed', 'timeout', 'cancelled'].includes(status)
}

export interface RunRecord {
  id: string
  scenarioId: string
  title: string
  status: RunStatus
  headless: boolean
  createdAt: string
  startedAt?: string
  endedAt?: string
  exitCode?: number | null
  durationMs?: number
  timeoutMs: number
  input: JsonValue
  output: JsonValue
  stdout: string
  stderr: string
  error?: RunError
  stepResults?: StepResult[]
  failedStep?: { id: string; title: string; index: number }
  artifacts?: string[]
  profileId?: string
}

export interface RunSummary {
  id: string
  scenarioId: string
  title: string
  status: RunStatus
  createdAt: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  error?: RunError
  failedStep?: { id: string; title: string; index: number }
  artifacts?: string[]
}

export interface ProfileInfo { id: string; name: string; createdAt: string; updatedAt: string }
export interface SecretInfo { name: string; updatedAt: string }

export interface ElectronAPI {
  getScenarios(): Promise<Scenario[]>
  saveScenario(input: SaveScenarioInput): Promise<Scenario>
  deleteScenario(id: string): Promise<boolean>
  enqueueRun(id: string, request?: RunRequest): Promise<RunRecord>
  getRun(id: string): Promise<RunRecord | undefined>
  cancelRun(id: string): Promise<RunRecord | undefined>
  getSettings(): Promise<AppSettings>
  saveSettings(input: AppSettings): Promise<AppSettings>
  apiStatus(): Promise<ApiStatus>
  apiTest(): Promise<ApiTestResult>
  apiCall(request: ApiCallRequest): Promise<ApiCallResult>
  recordCodegen(url?: string): Promise<string>
  openInspector(url: string, profileId?: string): Promise<void>
  openDeveloper(): Promise<void>
  openDonate(): Promise<void>
  dbGet(): Promise<{ config: DbConfig; status: DbStatus }>
  dbTest(config: DbConfig): Promise<{ ok: boolean; error?: string; ms?: number }>
  dbSave(config: DbConfig): Promise<DbStatus>
  closeInspector(): Promise<void>
  pickElement(request: PickRequest): Promise<PickResult | null>
  cancelPick(): Promise<void>
  previewStep(steps: ScenarioStep | ScenarioStep[], input: JsonValue): Promise<StepPreview>
  onPreviewProgress(callback: (result: StepResult) => void): () => void
  listRuns(scenarioId?: string, limit?: number): Promise<RunSummary[]>
  getArtifact(runId: string, name: string): Promise<string | null>
  listProfiles(): Promise<ProfileInfo[]>
  deleteProfile(id: string): Promise<boolean>
  captureProfile(name: string, existingId?: string): Promise<ProfileInfo>
  listSecrets(): Promise<SecretInfo[]>
  saveSecret(name: string, value: string): Promise<SecretInfo[]>
  deleteSecret(name: string): Promise<SecretInfo[]>
}

export interface ApiStatus { enabled: boolean; running: boolean; host: string; port: number; error?: string }
export interface ApiTestResult {
  url: string
  health: { ok: boolean; status?: number; ms?: number; error?: string }
  auth: { ok: boolean; status?: number; scenarios?: number; error?: string }
}
export interface ApiCallRequest { method: 'GET' | 'POST'; path: string; body?: JsonValue }
export interface ApiCallResult { status: number; ms: number; body: JsonValue | string }

export interface AppSettings {
  apiEnabled: boolean
  host: string
  port: number
  token: string
  concurrency: number
  runTimeoutMs: number
  retryCount?: number
  notifyOnFailure?: boolean
}

export type DbType = 'postgres' | 'mssql' | 'mysql'
export interface DbConfig { enabled: boolean; type: DbType; host: string; port: number; database: string; user: string; password: string; ssl: boolean }
export interface DbStatus { state: 'off' | 'connecting' | 'connected' | 'error'; type: DbType; pending: number; lastSync?: string; error?: string; migrated?: number; source?: 'database' | 'local' }
