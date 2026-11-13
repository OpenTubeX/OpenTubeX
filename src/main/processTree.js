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
 * @param {import('node:child_process').ChildProcess} child
 * @returns {boolean} whether the child and, on POSIX, every process in its group has exited
 */
function isProcessTreeGone(child) {
  if (child.pid === undefined || process.platform === 'win32') return !isRunning(child)
  try {
    process.kill(-child.pid, 0)
    return false
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'ESRCH'
  }
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} waitMs
 */
async function waitForProcessTreeExit(child, waitMs) {
  const deadline = Date.now() + waitMs
  while (!isProcessTreeGone(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return isProcessTreeGone(child)
}

/**
 * Terminates a child spawned with `PROCESS_TREE_SPAWN_OPTIONS` and every process it
 * started, killing what is left after `waitMs`, and resolves once they have exited,
 * or after waiting `waitMs` again for processes that cannot be stopped.
 * On Windows, only the child's own exit can be observed.
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [waitMs]
 * @returns {Promise<boolean>} whether the tree has exited
 */
export async function stopProcessTree(child, waitMs = 5000) {
  signalProcessTree(child, 'SIGTERM')
  if (await waitForProcessTreeExit(child, waitMs)) return true
  signalProcessTree(child, 'SIGKILL')
  return await waitForProcessTreeExit(child, waitMs)
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
