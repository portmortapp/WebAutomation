// src/main/index.ts
import { app, BrowserWindow, Notification, ipcMain, Menu, Tray, nativeImage, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { configureBrowserPath, warnIfChromiumMissing } from './browser-setup'

configureBrowserPath()
import {
  deleteScenario,
  recoverInterruptedRuns,
  getScenario,
  getScenarios,
  getSettings,
  saveScenario,
  saveSettings,
  listRuns,
  readArtifact,
  listProfiles,
  deleteProfile,
  saveProfileState,
  readProfileState,
  listSecrets,
  saveSecret,
  deleteSecret,
  getSecretValues,
  secretNamesInSteps
} from './store'
import { ScenarioRunner } from './runner'
import {
  apiCall,
  friendlyApiError,
  getApiStatus,
  restartApiServer,
  selfTest,
  startApiServer,
  stopApiServer
} from './api-server'
import { recordCodegen, stopCodegen } from './codegen'
import { validateSettings } from '../shared/validation'
import { initDb, closeDb, publicConfig, getDbStatus, testDb, saveDb } from './db-sync'
import { Inspector } from './inspector'
import type { AppSettings, SaveScenarioInput, RunRequest, ScenarioStep, JsonValue, PickRequest } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let runner: ScenarioRunner
let pruneTimer: ReturnType<typeof setInterval> | undefined
const inspector = new Inspector()

let tray: Tray | null = null
let quitting = false
const DEVELOPER_URL = 'https://github.com/RasolAlibakhshi'
const DONATE_URL = 'https://daramet.com/PortMort'
const startHidden = process.argv.includes('--hidden')

function showWindow() {
  if (!mainWindow) { createWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function autoStartEnabled() {
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'نمایش webautomation', click: showWindow },
    { label: 'اجرا همراه ویندوز', type: 'checkbox', checked: autoStartEnabled(), click: item => {
      app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
      tray?.setContextMenu(buildTrayMenu())
    } },
    { type: 'separator' },
    { label: 'خروج', click: () => { quitting = true; app.quit() } }
  ])
}

function resourceFile(name: string) {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), name)
}

function createTray() {
  const file = resourceFile(process.platform === 'win32' ? 'tray.ico' : 'tray.png')
  const image = nativeImage.createFromPath(file)
  tray = new Tray(process.platform === 'win32' ? image : image.resize({ width: 22, height: 22 }))
  tray.setToolTip('webautomation - در حال اجرا در پس‌زمینه')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'webautomation',
    show: !startHidden,
    icon: resourceFile(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // The renderer only ever shows the bundled UI: refuse popups and any navigation away from it.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => {
    const target = event.url
    const allowed = process.env.ELECTRON_RENDERER_URL ? target.startsWith(process.env.ELECTRON_RENDERER_URL) : target.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(
      path.join(app.getAppPath(), 'out', 'renderer', 'index.html')
    )
  }

  mainWindow.on('close', event => {
    if (quitting || !tray) return
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Only the main window's own UI may call privileged handlers.
function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Unauthorized IPC sender.')
    return listener(event, ...args)
  })
}

function registerIpc() {
  handle('scenarios:list', () => getScenarios())

  handle('scenarios:save', (_event, input: SaveScenarioInput) => {
    return saveScenario(input)
  })

  handle('scenarios:delete', (_event, id: string) => deleteScenario(id))
  handle('runs:cancel', (_event, id: string) => runner.cancel(id))

  handle('scenarios:enqueue', (_event, id: string, request?: RunRequest) => {
    const scenario = getScenario(id)
    if (!scenario) throw new Error('سناریو پیدا نشد.')
    return runner.enqueue(scenario, request)
  })

  handle('runs:get', (_event, id: string) => {
    return runner.getRun(id)
  })

  handle('db:get', () => ({ config: publicConfig(), status: getDbStatus() }))
  handle('db:test', (_event, input) => testDb(input))
  handle('db:save', (_event, input) => saveDb(input))
  handle('settings:get', () => getSettings())
  handle('api:status', () => getApiStatus())
  handle('api:test', () => selfTest())
  handle('api:call', (_event, request) => apiCall(request))

  let savingSettings = false
  handle('settings:save', async (_event, input: AppSettings) => {
    if (savingSettings) throw new Error('Settings are already being saved.')
    savingSettings = true
    try {
      const settings = validateSettings(input)
      const previous = getSettings()
      try {
        await restartApiServer(runner, settings)
        saveSettings(settings)
      } catch (error) {
        await restartApiServer(runner, previous).catch(() => undefined)
        throw new Error(friendlyApiError(error))
      }
      runner.setTimeoutMs(settings.runTimeoutMs)
    const attempts = new Map<string, { root: string; n: number }>()
    runner.onFinished = run => {
      const info = attempts.get(run.id) ?? { root: run.id, n: 0 }
      attempts.delete(run.id)
      if (run.status === 'passed' || run.status === 'cancelled') return
      const current = getSettings()
      const scenario = getScenario(run.scenarioId)
      const retryable = run.status === 'failed' && scenario && info.n < (current.retryCount ?? 0)
      if (retryable) {
        setTimeout(() => {
          try { const next = runner.enqueue(scenario, { input: run.input }); attempts.set(next.id, { root: info.root, n: info.n + 1 }) }
          catch (error) { console.error('Retry failed:', error) }
        }, 5000).unref()
        return
      }
      if (current.notifyOnFailure !== false && Notification.isSupported()) {
        const reason = run.failedStep ? `در مرحلهٔ «${run.failedStep.title}»` : (run.error?.message ?? '').slice(0, 120)
        const n = new Notification({ title: `اجرای «${run.title}» ناموفق بود`, body: (info.n ? `پس از ${info.n} تلاش مجدد. ` : '') + reason })
        n.on('click', showWindow)
        n.show()
      }
    }
      runner.setConcurrency(settings.concurrency)
      return settings
    } finally { savingSettings = false }
  })

  handle('codegen:record', (_event, url?: string) => recordCodegen(url))
  handle('inspector:open', (_event, url: string, profileId?: string) => {
    const state = profileId ? readProfileState(profileId) : undefined
    return inspector.open(url, state, state ? profileId : '')
  })
  handle('inspector:close', () => inspector.close())
  handle('inspector:pick', async (_event, request: PickRequest) => {
    try { return await inspector.pick(request) } finally { mainWindow?.focus() }
  })
  handle('inspector:cancel-pick', () => inspector.cancelPick())
  handle('inspector:preview', (event, stepOrSteps: ScenarioStep | ScenarioStep[], input: JsonValue) => {
    const list = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps]
    return inspector.preview(stepOrSteps, input, getSecretValues(secretNamesInSteps(list)), result => { if (!event.sender.isDestroyed()) event.sender.send('inspector:progress', result) })
  })

  handle('runs:list', (_event, scenarioId?: string, limit?: number) => listRuns(typeof scenarioId === 'string' ? scenarioId : undefined, limit))
  handle('runs:artifact', (_event, runId: string, name: string) => {
    const file = readArtifact(runId, name)
    return file ? 'data:image/png;base64,' + file.toString('base64') : null
  })
  handle('profiles:list', () => listProfiles())
  handle('profiles:delete', (_event, id: string) => deleteProfile(id))
  handle('profiles:capture', async (_event, name: string, existingId?: string) => saveProfileState(name, await inspector.captureSession(), existingId))
  handle('app:open-developer', () => shell.openExternal(DEVELOPER_URL))
  handle('app:open-donate', () => shell.openExternal(DONATE_URL))
  handle('secrets:list', () => listSecrets())
  handle('secrets:save', (_event, name: string, value: string) => saveSecret(name, value))
  handle('secrets:delete', (_event, name: string) => deleteSecret(name))

}

// A single owner prevents two instances from racing over the same queue and files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus() })
  app.whenReady().then(async () => {
    if (app.isPackaged) warnIfChromiumMissing()
    await initDb()
    const settings = getSettings()
    recoverInterruptedRuns()
    runner = new ScenarioRunner(settings.concurrency)
    runner.setTimeoutMs(settings.runTimeoutMs)
    runner.prune()
    pruneTimer = setInterval(() => runner.prune(), 6 * 3600 * 1000)
    pruneTimer.unref()
    registerIpc()
    try { await startApiServer(runner) }
    catch (error) { console.error('Could not start API server:', error) }
    createTray()
    createWindow()
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  }).catch(error => { console.error('Startup failed:', error); app.quit() })
}

let shutdownComplete = false
let shuttingDown = false
app.on('before-quit', event => {
  quitting = true
  if (shutdownComplete) return
  event.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  if (pruneTimer) clearInterval(pruneTimer)
  void closeDb().catch(() => undefined)
  void Promise.all([stopApiServer(), runner?.shutdown(), stopCodegen(), inspector.close()]).then(() => {
    shutdownComplete = true
    app.quit()
  }).catch(error => { console.error('Shutdown failed:', error); shuttingDown = false })
})

app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') app.quit()
})
