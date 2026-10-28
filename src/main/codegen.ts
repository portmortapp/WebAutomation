import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { app } from 'electron'
import { stopProcessTree } from './process-tree'

let current: ChildProcess | null = null
let completion: Promise<string> | null = null

// Await the generated async IIFE so recording and manually authored scenarios share one contract.
export function adaptRecording(code: string): string {
  const wrapper = /\(async\s*\(\)\s*=>\s*\{/
  if (!wrapper.test(code)) throw new Error('Unsupported recording format; expected Playwright JavaScript output.')
  return code.replace(wrapper, 'return await (async () => {')
}

export function recordCodegen(url?: string): Promise<string> {
  if (url !== undefined && url !== '' && (typeof url !== 'string' || !/^(https?:|file:)/i.test(url))) return Promise.reject(new Error('آدرس ضبط باید با http یا https شروع شود.'))
  if (current) return Promise.reject(new Error('A recording is already active. Close its browser first.'))
  const recordingFile = path.join(app.getPath('temp'), 'playwright_rec_' + crypto.randomUUID() + '.js')
  const localRequire = createRequire(path.join(app.getAppPath(), 'package.json'))
  const cli = path.join(path.dirname(localRequire.resolve('playwright/package.json')), 'cli.js')
  const child = spawn(process.execPath, [cli, 'codegen', '--target=javascript', '-o', recordingFile, ...(url ? [url] : [])], {
    cwd: app.getPath('temp'), windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe']
  })
  current = child
  completion = new Promise<string>((resolve, reject) => {
    let stderr = ''
    let spawnError: Error | undefined
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-10_000) })
    child.on('error', error => { spawnError = error })
    child.once('close', code => {
      current = null
      try {
        if (spawnError) throw spawnError
        if (code !== 0) throw new Error(stderr || 'Recording exited with code ' + code)
        if (!fs.existsSync(recordingFile)) throw new Error('No recording was produced.')
        resolve(adaptRecording(fs.readFileSync(recordingFile, 'utf8')))
      } catch (error) { reject(error) }
      finally {
        try { if (fs.existsSync(recordingFile)) fs.unlinkSync(recordingFile) }
        catch (error) { console.error('Recording cleanup failed:', error) }
      }
    })
  })
  return completion
}

export async function stopCodegen() {
  if (current) await stopProcessTree(current)
  await completion?.catch(() => {})
}
