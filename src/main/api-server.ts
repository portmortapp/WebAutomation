import express from 'express'
import type { Server } from 'node:http'
import crypto from 'node:crypto'
import { getScenario, getScenarios, getSettings, listArtifacts, listRuns, readArtifact } from './store'
import type { ScenarioRunner } from './runner'
import { QueueFullError, ValidationError, validateRunRequest } from '../shared/validation'
import type { ApiCallRequest, ApiCallResult, ApiStatus, ApiTestResult, AppSettings, JsonValue } from '../shared/types'

let server: Server | null = null
let lastError = ''
let listening: { host: string; port: number } | null = null

export const friendlyApiError = (error: unknown) => friendly(error)
const friendly = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'EADDRINUSE') return 'این پورت توسط برنامهٔ دیگری استفاده می‌شود؛ پورت دیگری انتخاب کنید.'
  if (code === 'EACCES') return 'اجازهٔ استفاده از این پورت یا آدرس را ندارید.'
  if (code === 'EADDRNOTAVAIL') return 'این آدرس روی این رایانه وجود ندارد.'
  return (error as Error)?.message ?? String(error)
}

export function getApiStatus(): ApiStatus {
  const settings = getSettings()
  return { enabled: settings.apiEnabled, running: !!server, host: listening?.host ?? settings.host, port: listening?.port ?? settings.port, error: lastError || undefined }
}

const localBase = (settings: AppSettings) => {
  const host = ['0.0.0.0', '::', '::0', ''].includes(settings.host.trim()) ? '127.0.0.1' : settings.host.trim()
  return 'http://' + (host.includes(':') ? '[' + host + ']' : host) + ':' + settings.port
}

// Calls the running API from inside the app, exactly like n8n would (real HTTP, real token).
export async function selfTest(): Promise<ApiTestResult> {
  const settings = getSettings()
  const url = localBase(settings)
  const result: ApiTestResult = { url, health: { ok: false }, auth: { ok: false } }
  if (!server) {
    const reason = lastError || (settings.apiEnabled ? 'سرویس اجرا نشده است.' : 'API غیرفعال است.')
    return { url, health: { ok: false, error: reason }, auth: { ok: false, error: reason } }
  }
  const started = Date.now()
  try {
    const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(4000) })
    result.health = { ok: response.ok, status: response.status, ms: Date.now() - started }
  } catch (error) { result.health = { ok: false, error: friendly(error) }; return result }
  try {
    const response = await fetch(url + '/api/scenarios', { headers: { Authorization: 'Bearer ' + settings.token }, signal: AbortSignal.timeout(4000) })
    const body = await response.json().catch(() => null)
    result.auth = response.ok ? { ok: true, status: response.status, scenarios: Array.isArray(body) ? body.length : undefined } : { ok: false, status: response.status, error: response.status === 401 ? 'توکن پذیرفته نشد.' : 'پاسخ غیرمنتظره: ' + response.status }
  } catch (error) { result.auth = { ok: false, error: friendly(error) } }
  return result
}

export async function apiCall(request: ApiCallRequest): Promise<ApiCallResult> {
  if (!request || !['GET', 'POST'].includes(request.method) || typeof request.path !== 'string' || !/^\/api\/[A-Za-z0-9_\-/?=&.%]{0,300}$/.test(request.path)) throw new Error('درخواست API نامعتبر است.')
  if (!server) throw new Error(lastError || 'سرویس API اجرا نیست.')
  const settings = getSettings()
  const started = Date.now()
  const response = await fetch(localBase(settings) + request.path, {
    method: request.method,
    headers: { Authorization: 'Bearer ' + settings.token, ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    body: request.method === 'POST' ? JSON.stringify(request.body ?? {}) : undefined,
    signal: AbortSignal.timeout(15000)
  })
  const text = await response.text()
  let body: JsonValue | string = text
  try { body = JSON.parse(text) as JsonValue } catch { /* plain text */ }
  return { status: response.status, ms: Date.now() - started, body }
}

function tokenMatches(expected: string, actualHeader: string | undefined) {
  if (!actualHeader?.startsWith('Bearer ')) return false

  const received = actualHeader.slice('Bearer '.length)
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)

  if (expectedBuffer.length !== receivedBuffer.length) return false

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}

export async function startApiServer(runner: ScenarioRunner, settings: AppSettings = getSettings()) {

  lastError = ''
  if (!settings.apiEnabled) { listening = null; return }

  const api = express()

  api.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  // Failed-auth throttle: after 10 wrong tokens within a minute an address is blocked for a minute.
  const failures = new Map<string, { count: number; first: number; blockedUntil: number }>()
  api.use((req, res, next) => {
    const who = req.socket.remoteAddress ?? 'unknown'
    const now = Date.now()
    const entry = failures.get(who)
    if (entry && entry.blockedUntil > now) {
      res.set('Retry-After', String(Math.ceil((entry.blockedUntil - now) / 1000)))
      res.status(429).json({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed attempts. Try again later.' } })
      return
    }
    if (!tokenMatches(settings.token, req.headers.authorization)) {
      const current = entry && now - entry.first < 60000 ? entry : { count: 0, first: now, blockedUntil: 0 }
      current.count += 1
      if (current.count >= 10) current.blockedUntil = now + 60000
      failures.set(who, current)
      if (failures.size > 500) failures.clear()
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      return
    }

    failures.delete(who)
    next()
  })

  api.use(express.json({ limit: '1mb' }))

  api.get('/api/scenarios', (_req, res) => {
    res.json(getScenarios())
  })

  api.get('/api/scenarios/:id', (req, res) => {
    const scenario = getScenario(req.params.id)

    if (!scenario) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scenario not found' } })
      return
    }

    res.json(scenario)
  })

  api.post('/api/scenarios/:id/run', (req, res) => {
    const scenario = getScenario(req.params.id)

    if (!scenario) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scenario not found' } })
      return
    }

    const run = runner.enqueue(scenario, validateRunRequest(req.body))

    res.status(202).json({
      message: 'Run queued',
      run
    })
  })

  api.get('/api/runs', (req, res) => {
    const scenarioId = typeof req.query.scenarioId === 'string' ? req.query.scenarioId : undefined
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30
    if (req.query.limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) throw new ValidationError('limit must be an integer from 1 to 200.')
    res.json(listRuns(scenarioId, limit))
  })

  api.get('/api/runs/:runId/artifacts', (req, res) => {
    if (!runner.getRun(req.params.runId)) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }); return }
    res.json(listArtifacts(req.params.runId))
  })

  api.get('/api/runs/:runId/artifacts/:name', (req, res) => {
    const file = readArtifact(req.params.runId, req.params.name)
    if (!file) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }); return }
    res.type('image/png').send(file)
  })

  api.get('/api/runs/:runId', (req, res) => {
    const run = runner.getRun(req.params.runId)

    if (!run) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } })
      return
    }

    res.json(run)
  })

  api.post('/api/runs/:runId/cancel', (req, res) => {
    const run = runner.cancel(req.params.runId)
    if (!run) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }); return }
    res.json(run)
  })

  api.use((_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }) })
  const handleError: express.ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof QueueFullError) {
      res.status(429).json({ error: { code: 'QUEUE_FULL', message: error.message } })
      return
    }
    const badRequest = error instanceof ValidationError || error.type === 'entity.parse.failed'
    const status = error.type === 'entity.too.large' ? 413 : badRequest ? 400 : 500
    if (status === 500) console.error('API error:', error)
    res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST', message: status === 500 ? 'Could not process request.' : error.message } })
  }
  api.use(handleError)

  await new Promise<void>((resolve, reject) => {
    const nextServer = api.listen(
      settings.port,
      settings.host,
      () => {
        server = nextServer
        listening = { host: settings.host, port: settings.port }
        lastError = ''
        console.log(
          `Automation API listening on http://${settings.host}:${settings.port}`
        )
        resolve()
      }
    )

    nextServer.once('error', error => { lastError = friendly(error); reject(error) })
  })
}

export async function stopApiServer() {
  if (!server) return

  const current = server
  server = null
  listening = null

  await new Promise<void>((resolve) => {
    current.close(() => resolve())
  })
}

export async function restartApiServer(runner: ScenarioRunner, settings?: AppSettings) {
  await stopApiServer()
  await startApiServer(runner, settings)
}
