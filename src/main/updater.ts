// Automatic updates via electron-updater (GitHub Releases). Runs only in packaged builds:
// in development there is no signed release feed to check against.
import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

let started = false

export function initAutoUpdate(): void {
  if (started || !app.isPackaged) return
  started = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console
  autoUpdater.on('error', error => console.error('Update check failed:', error))
  autoUpdater.on('update-downloaded', info => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'به‌روزرسانی آماده است',
      message: `نسخه ${info.version} دانلود شد.`,
      detail: 'برای نصب، برنامه را دوباره راه‌اندازی کنید. اگر بعداً بخواهید، با خروج از برنامه هم نصب می‌شود.',
      buttons: ['راه‌اندازی مجدد', 'بعداً'],
      defaultId: 0
    }).then(result => { if (result.response === 0) autoUpdater.quitAndInstall() })
  })
  // First check shortly after start, then every 6 hours.
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 10_000)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), 6 * 3600 * 1000).unref()
}
