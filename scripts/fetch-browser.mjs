// Puts the Chromium build Playwright needs into ./browsers so electron-builder can bundle it
// inside the installer. It first reuses a copy already installed on this machine (Playwright's
// cache); only if none is found does it try to download. Runs on the build machine only.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const pwDir = path.dirname(require.resolve('playwright/package.json'))
const target = path.join(root, 'browsers')

// browsers.json isn't in playwright-core's exports map, so locate it via package.json
const coreDir = path.dirname(createRequire(path.join(pwDir, 'package.json')).resolve('playwright-core/package.json'))
const info = JSON.parse(fs.readFileSync(path.join(coreDir, 'browsers.json'), 'utf8'))
const rev = (name) => info.browsers.find((b) => b.name === name)?.revision
const wanted = [
  ['chromium', 'chromium'],
  ['chromium-headless-shell', 'chromium_headless_shell'],
  ['ffmpeg', 'ffmpeg']
].map(([name, dir]) => `${dir}-${rev(name)}`).filter((d) => !d.endsWith('undefined'))

const caches = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  process.platform === 'win32' && path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
  process.platform === 'darwin' && path.join(os.homedir(), 'Library/Caches/ms-playwright'),
  path.join(os.homedir(), '.cache/ms-playwright')
].filter((p) => p && p !== '0' && fs.existsSync(p))

fs.mkdirSync(target, { recursive: true })
const missing = []
for (const dir of wanted) {
  const have = path.join(target, dir)
  if (fs.existsSync(have)) continue
  const src = caches.map((c) => path.join(c, dir)).find((p) => fs.existsSync(p))
  if (src) {
    console.log('Copying', src)
    fs.cpSync(src, have, { recursive: true })
  } else missing.push(dir)
}

// chromium is mandatory; headless shell / ffmpeg are optional extras
if (missing.some((d) => d.startsWith('chromium-'))) {
  console.log('Not found locally, downloading:', missing.join(', '))
  const result = spawnSync(process.execPath, [path.join(pwDir, 'cli.js'), 'install', 'chromium'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: target }
  })
  if (result.status !== 0) {
    console.error(`Chromium download failed. Needed folders: ${wanted.join(', ')}\nCopy them from another machine into ${target} and re-run.`)
    process.exit(result.status ?? 1)
  }
}
console.log('Chromium bundled in', target)
