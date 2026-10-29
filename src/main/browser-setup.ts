// src/main/browser-setup.ts
// The installed app ships its own Chromium (extraResources/browsers), so nothing is downloaded at runtime.
import { app, Notification } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

export function configureBrowserPath(): void {
  if (app.isPackaged && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'browsers')
  }
}

export function chromiumReady(): boolean {
  try { return existsSync(chromium.executablePath()) } catch { return false }
}

export function warnIfChromiumMissing(): void {
  if (chromiumReady()) return
  console.error('Bundled Chromium is missing:', chromium.executablePath())
  new Notification({ title: 'webautomation', body: 'مرورگر همراه برنامه پیدا نشد. برنامه را دوباره نصب کنید.' }).show()
}
