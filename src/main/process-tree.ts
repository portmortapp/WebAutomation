import { execFile, type ChildProcess } from 'node:child_process'

// Each worker owns its process tree. Never terminate unrelated browser processes.
export async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, error => {
        if (error && child.exitCode === null && child.signalCode === null) reject(error)
        else resolve()
      })
    })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}
