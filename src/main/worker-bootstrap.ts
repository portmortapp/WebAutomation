// Serialized into a Node worker: all runtime dependencies must stay inside this function.
export function workerBootstrap() {
  const fs = require('node:fs')
  const path = require('node:path')
  const Module = require('node:module')
  process.env.NODE_PATH = [path.join(process.env.AUTOMATION_APP_PATH!, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter)
  Module._initPaths()
  const playwright = require('playwright')
  const browsers = new Set<any>()
  let context: any
  let finished = false
  let saveSession = false
  const send = (message: unknown) => new Promise<void>(resolve => {
    if (process.send && process.connected) process.send(message, () => resolve())
    else resolve()
  })
  const finish = async (message: any) => {
    if (finished) return
    finished = true
    // Keep evidence of the failure: a screenshot of the last open page of the scenario's context.
    if (!message.ok && context) {
      try {
        const open = context.pages().filter((candidate: any) => !candidate.isClosed() && candidate.url() !== 'about:blank')
        if (open.length) await open[open.length - 1].screenshot({ path: 'failure.png', timeout: 5000 })
      } catch { /* the page may already be gone; the error message is still reported */ }
    }
    try {
      if (message.ok && saveSession && context) message = { ...message, storageState: await context.storageState() }
      if (context) await context.close()
      await Promise.all([...browsers].map(browser => browser.close()))
    } catch (error: any) {
      if (message.ok) message = { ok: false, error: { code: 'PROCESS_ERROR', message: error.message || String(error) } }
    }
    await send({ type: 'result', ...message })
    process.exit(message.ok ? 0 : 1)
  }
  for (const name of ['chromium', 'firefox', 'webkit']) {
    const original = playwright[name].launch.bind(playwright[name])
    playwright[name].launch = async (options = {}) => {
      const browser = await original({ ...options, headless: process.env.PW_HEADLESS === 'true' })
      browsers.add(browser)
      return browser
    }
  }
  const fail = (error: any) => void finish({ ok: false, error: { code: 'SCENARIO_ERROR', message: error?.message || String(error), stack: error?.stack, stepId: error?.stepId } })
  process.on('unhandledRejection', fail)
  process.on('uncaughtException', fail)
  const checkJson = (value: any, seen = new Set(), depth = 0): void => {
    if (depth > 100) throw new Error('Output JSON exceeds 100 levels.')
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
    if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Output must be finite, acyclic JSON.')
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Output must contain plain JSON objects.')
    seen.add(value)
    for (const item of Array.isArray(value) ? value : Object.values(value)) checkJson(item, seen, depth + 1)
    seen.delete(value)
  }
  void (async () => {
    const payload = JSON.parse(fs.readFileSync(process.env.PW_PAYLOAD_FILE!, 'utf8'))
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const fn = new AsyncFunction('input', 'page', 'context', 'browser', 'playwright', 'require', 'secrets', payload.code)
    saveSession = payload.saveSession === true
    const browser = await playwright.chromium.launch()
    context = await browser.newContext(payload.storageState ? { storageState: payload.storageState } : {})
    const page = await context.newPage()
    let result = await fn(payload.input, page, context, browser, playwright, require, payload.secrets || {})
    try {
      if (result === undefined) result = null
      checkJson(result)
      const encoded = JSON.stringify(result)
      if (encoded.length > 1_000_000) throw new Error('Output exceeds 1000000 characters.')
      result = JSON.parse(encoded)
    } catch (error: any) {
      await finish({ ok: false, error: { code: 'INVALID_OUTPUT', message: error.message } })
      return
    }
    await finish({ ok: true, output: result })
  })().catch(fail)
}
