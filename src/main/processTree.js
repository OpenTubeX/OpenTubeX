// @ts-check
import { execFile, execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** Spawn options that give a child its own process group on POSIX, so `signalProcessTree` reaches its children too */
export const PROCESS_TREE_SPAWN_OPTIONS = { detached: process.platform !== 'win32' }

/** @param {number} pid */
function taskkill(pid) {
  return {
    command: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
    args: ['/PID', String(pid), '/T', '/F'],
  }
}

/**
 * taskkill /T finds the tree through the child, and Windows reuses the IDs of
 * exited processes, so only running children are safe to target.
 * @param {import('node:child_process').ChildProcess} child
 */
function isRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

/**
 * Signals a child spawned with `PROCESS_TREE_SPAWN_OPTIONS` and every process it started,
 * such as the FFmpeg processes yt-dlp runs. On Windows, only termination reaches
 * the whole tree; other signals go to the child alone.
 * @param {import('node:child_process').ChildProcess} child
 * @param {NodeJS.Signals} [signal]
 * @returns {boolean} whether the signal was sent
 */
export function signalProcessTree(child, signal = 'SIGTERM') {
  if (child.pid === undefined) return false
  if (process.platform === 'win32') {
    if (!isRunning(child) || (signal !== 'SIGTERM' && signal !== 'SIGKILL')) return child.kill(signal)
    const { command, args } = taskkill(child.pid)
    execFile(command, args, { windowsHide: true }, (error) => {
      if (error) child.kill(signal)
    })
    return true
  }
  try {
    // The group outlives the child while FFmpeg still runs
    process.kill(-child.pid, signal)
    return true
  } catch {
    return child.kill(signal)
  }
}

/**
 * Synchronous best-effort termination of a process tree, for `process.on('exit')`,
 * where asynchronous work no longer runs.
 * @param {import('node:child_process').ChildProcess} child
 */
export function killProcessTreeSync(child) {
  if (child.pid === undefined) return
  try {
    if (process.platform === 'win32') {
      if (!isRunning(child)) return
      const { command, args } = taskkill(child.pid)
      execFileSync(command, args, { windowsHide: true, stdio: 'ignore', timeout: 5000 })
    } else {
      process.kill(-child.pid, 'SIGTERM')
      // A stopped process only acts on SIGTERM once it continues
      process.kill(-child.pid, 'SIGCONT')
    }
  } catch {
    child.kill()
  }
}
