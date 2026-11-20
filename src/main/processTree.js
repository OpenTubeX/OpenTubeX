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

// Sends Ctrl+C to every process attached to the console of the process with
// the ID in the first argument. Windows has no signal that a program can catch
// and that another one can send, and only a process attached to the same
// console can raise a console control event, so this runs in its own process.
const WINDOWS_INTERRUPT_SCRIPT = `
Add-Type -Namespace OpenTubeX -Name ConsoleControl -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint processId);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GenerateConsoleCtrlEvent(uint controlEvent, uint processGroupId);
'@
[OpenTubeX.ConsoleControl]::FreeConsole() | Out-Null
if (-not [OpenTubeX.ConsoleControl]::AttachConsole([uint32]$args[0])) { exit 1 }
# Keep this process alive to report the result
[OpenTubeX.ConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (-not [OpenTubeX.ConsoleControl]::GenerateConsoleCtrlEvent(0, 0)) { exit 1 }
exit 0
`

/**
 * Asks a child to stop the way Ctrl+C in a terminal does, which lets yt-dlp keep
 * a live recording. On POSIX, only the child gets SIGINT; yt-dlp then tells FFmpeg
 * to finish the file. On Windows, everything attached to the child's console gets
 * Ctrl+C, which is the child and its FFmpeg processes.
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<boolean>} whether the interrupt was delivered
 */
export function interruptProcess(child) {
  if (child.pid === undefined || !isRunning(child)) return Promise.resolve(false)
  if (process.platform !== 'win32') return Promise.resolve(child.kill('SIGINT'))
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve) => {
    execFile(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', `& { ${WINDOWS_INTERRUPT_SCRIPT} } ${child.pid}`
    ], { windowsHide: true, timeout: 30_000 }, error => resolve(error === null))
  })
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
