import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { isTerminalStatus, type RunRecord, type RunRequest, type Scenario, type RunError, type JsonValue, type StepResult } from '../shared/types'
import { assertJson, QueueFullError, validateRunRequest, validateTimeout } from '../shared/validation'
import { getRunDirectory, getSecretValues, listArtifacts, listProfiles, pruneRuns, readProfileState, readRun, saveProfileState, secretNamesInSteps, writeRun } from './store'
import { workerBootstrap } from './worker-bootstrap'
import { stopProcessTree } from './process-tree'

type WorkerResult = { type: 'result'; ok: boolean; output?: JsonValue; error?: RunError; storageState?: unknown }
type ActiveRun = { child: ChildProcess; reason?: 'cancelled' | 'timeout'; done: Promise<void>; terminate?: Promise<void> }

export const MAX_QUEUED_RUNS = 100
const MAX_RETAINED_FAILED_RECORDS = 50

export class ScenarioRunner {
  private pending: string[] = []
  private records = new Map<string, RunRecord>()
  private workers = new Map<string, ActiveRun>()
  private stopped = false
  private timeoutMs = 300_000
  onFinished?: (run: RunRecord) => void

  constructor(private concurrency: number) {}

  setConcurrency(value: number) {
    this.concurrency = value
    this.pump()
  }

  setTimeoutMs(value: number) {
    validateTimeout(value)
    this.timeoutMs = value
  }

  enqueue(scenario: Scenario, request: RunRequest = {}): RunRecord {
    if (this.stopped) throw new Error('Runner is shutting down.')
    const validated = validateRunRequest(request)
    if (this.pending.length >= MAX_QUEUED_RUNS) throw new QueueFullError('Run queue is full (' + MAX_QUEUED_RUNS + ' waiting runs). Try again later.')
    // Resolve secrets and the saved session now, so a missing secret is a 400 instead of a failed run.
    const secrets = getSecretValues(secretNamesInSteps(scenario.steps))
    const profile = scenario.profileId ? listProfiles().find(item => item.id === scenario.profileId) : undefined
    const storageState = profile ? readProfileState(profile.id) : undefined
    const id = 'run_' + crypto.randomUUID()
    const runDir = getRunDirectory(id)
    const run: RunRecord = {
      id, scenarioId: scenario.id, title: scenario.title, status: 'queued', headless: scenario.headless,
      createdAt: new Date().toISOString(), stdout: '', stderr: '', input: validated.input!, output: null,
      timeoutMs: validated.timeoutMs ?? this.timeoutMs, profileId: profile?.id
    }
    fs.mkdirSync(runDir, { recursive: true })
    // payload.json holds secrets and session cookies: private file, deleted as soon as the worker exits.
    fs.writeFileSync(path.join(runDir, 'payload.json'), JSON.stringify({ code: scenario.code, input: run.input, secrets, storageState, saveSession: !!profile && scenario.saveSession === true }), { encoding: 'utf8', mode: 0o600 })
    writeRun(run)
    this.records.set(id, run)
    this.pending.push(id)
    this.pump()
    return structuredClone(run)
  }

  getRun(id: string): RunRecord | undefined {
    const run = this.records.get(id) ?? readRun(id)
    return run && structuredClone(run)
  }

  cancel(id: string): RunRecord | undefined {
    const run = this.records.get(id) ?? readRun(id)
    if (!run || isTerminalStatus(run.status)) return run && structuredClone(run)
    if (run.status === 'queued') {
      this.pending = this.pending.filter(pendingId => pendingId !== id)
      run.status = 'cancelled'
      run.endedAt = new Date().toISOString()
      run.durationMs = 0
      run.error = { code: 'CANCELLED', message: 'Run cancelled before execution.' }
      this.removePayload(run)
      if (this.persist(run)) this.records.delete(id)
    } else {
      const worker = this.workers.get(id)
      if (worker && !worker.reason) {
        worker.reason = 'cancelled'
        run.status = 'cancelling'
        this.persist(run)
        this.terminate(run, worker)
      }
    }
    return structuredClone(run)
  }

  async shutdown() {
    this.stopped = true
    for (const id of [...this.pending, ...this.workers.keys()]) this.cancel(id)
    await Promise.all([...this.workers.values()].map(worker => worker.done))
  }

  // Remove old finished runs from disk; called by the app at startup and periodically.
  prune() {
    try { pruneRuns(new Set([...this.pending, ...this.workers.keys()])) }
    catch (error) { console.error('Run pruning failed:', error) }
  }

  // Records whose result could not be written stay readable from memory, but only a bounded number of them.
  private trimUnpersisted() {
    const stuck = [...this.records.values()].filter(run => isTerminalStatus(run.status) && !this.workers.has(run.id))
    for (const run of stuck.slice(0, Math.max(0, stuck.length - MAX_RETAINED_FAILED_RECORDS))) this.records.delete(run.id)
  }

  private removePayload(run: RunRecord) {
    // payload.json holds the scenario code and the caller's input; it is not needed once the worker has exited.
    try { fs.rmSync(path.join(getRunDirectory(run.id), 'payload.json'), { force: true }) }
    catch (error) { console.error('Could not remove run payload:', error) }
  }

  private persist(run: RunRecord) {
    try { writeRun(run); return true } catch (error) {
      if (isTerminalStatus(run.status)) { run.status = 'failed'; run.output = null }
      run.error = { code: 'INTERNAL_ERROR', message: 'Could not persist run: ' + String(error) }
      console.error(run.error.message)
      return false
    }
  }

  private terminate(run: RunRecord, worker: ActiveRun) {
    worker.terminate = stopProcessTree(worker.child).catch(error => {
      run.stderr = (run.stderr + '\nProcess cleanup failed: ' + String(error)).slice(-500_000)
      worker.child.kill('SIGKILL')
    })
  }

  private pump() {
    while (!this.stopped && this.workers.size < this.concurrency && this.pending.length) {
      const run = this.records.get(this.pending.shift()!)!
      try { this.start(run) } catch (error) {
        run.status = 'failed'
        run.endedAt = new Date().toISOString()
        run.error = { code: 'INTERNAL_ERROR', message: String(error) }
        this.removePayload(run)
        if (this.persist(run)) this.records.delete(run.id)
        else this.trimUnpersisted()
      }
    }
  }

  private start(run: RunRecord) {
    run.status = 'running'
    run.startedAt = new Date().toISOString()
    writeRun(run)
    const child = spawn(process.execPath, ['-e', '(' + workerBootstrap.toString() + ')()'], {
      cwd: getRunDirectory(run.id), windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AUTOMATION_APP_PATH: app.getAppPath(),
        PW_PAYLOAD_FILE: path.join(getRunDirectory(run.id), 'payload.json'), PW_HEADLESS: String(run.headless) }
    })
    let complete!: () => void
    const worker: ActiveRun = { child, done: new Promise(resolve => { complete = resolve }) }
    this.workers.set(run.id, worker)
    let result: WorkerResult | undefined
    let processError: string | undefined
    const timer = setTimeout(() => {
      if (worker.reason) return
      worker.reason = 'timeout'
      this.terminate(run, worker)
    }, run.timeoutMs)
    child.stdout?.on('data', chunk => { run.stdout = (run.stdout + chunk.toString('utf8')).slice(-500_000) })
    child.stderr?.on('data', chunk => { run.stderr = (run.stderr + chunk.toString('utf8')).slice(-500_000) })
    child.on('message', message => {
      const progress = message as { type: string; step: StepResult }
      if (progress?.type === 'step' && progress.step && typeof progress.step.id === 'string') {
        run.stepResults ??= []
        const index = run.stepResults.findIndex(step => step.id === progress.step.id)
        if (index >= 0) run.stepResults[index] = progress.step
        else if (run.stepResults.length < 100) run.stepResults.push(progress.step)
        return
      }
      const candidate = message as WorkerResult
      if (candidate?.type !== 'result' || result) return
      try {
        if (candidate.ok) assertJson(candidate.output)
        else if (!candidate.error || typeof candidate.error.message !== 'string') return
        result = candidate
      } catch { processError = 'Invalid worker response.' }
    })
    child.on('error', error => { processError = error.message })
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      void (async () => {
        await worker.terminate
        run.exitCode = exitCode
        run.endedAt = new Date().toISOString()
        run.durationMs = Date.parse(run.endedAt) - Date.parse(run.startedAt!)
        if (worker.reason) {
          run.status = worker.reason
          run.error = { code: worker.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED', message: worker.reason === 'timeout' ? 'Execution exceeded ' + run.timeoutMs + ' ms.' : 'Run cancelled.' }
          for (const step of run.stepResults ?? []) {
            if (step.status === 'running') { step.status = 'failed'; step.error = run.error.message }
          }
        } else if (processError || !result || exitCode !== 0 || !result.ok) {
          run.status = 'failed'
          run.error = result?.error ?? { code: 'PROCESS_ERROR', message: processError ?? 'Worker exited with code ' + exitCode + ' without a successful result.' }
        } else {
          run.status = 'passed'
          run.output = result.output ?? null
          delete run.error
          if (result.storageState && run.profileId) {
            // Refresh the saved login so later runs keep a valid session.
            try { const info = listProfiles().find(item => item.id === run.profileId); if (info) saveProfileState(info.name, result.storageState, info.id) }
            catch (error) { run.stderr = (run.stderr + '\nCould not save session: ' + String(error)).slice(-500_000) }
          }
        }
        run.artifacts = listArtifacts(run.id)
        if (run.status !== 'passed') {
          const failedIndex = (run.stepResults ?? []).findIndex(step => step.status === 'failed' && !step.continued)
          const failed = failedIndex >= 0 ? run.stepResults![failedIndex] : undefined
          if (failed) run.failedStep = { id: failed.id, title: failed.title, index: failedIndex }
        }
        this.persist(run)
        this.removePayload(run)
        try { this.onFinished?.(structuredClone(run)) } catch (error) { console.error('onFinished failed:', error) }
        this.workers.delete(run.id)
        if (run.error?.code !== 'INTERNAL_ERROR') this.records.delete(run.id)
        else this.trimUnpersisted()
        complete()
        this.pump()
      })()
    })
  }
}
