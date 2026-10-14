import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

import { test, expect, repoRoot } from '../../helpers/app.mjs'

for (const [format, portableExecutable] of [
  ['ordinary', null],
  ['Windows portable', 'C:\\Apps\\OpenTubeX Portable.exe']
]) {
  test(`reopening during shutdown queues one relaunch for ${format} executables`, async ({ app }) => {
    const executablePath = await app.electronApp.evaluate(() => process.execPath)
    await app.electronApp.evaluate(({ app }, portableExecutable) => {
      if (portableExecutable) process.env.PORTABLE_EXECUTABLE_FILE = portableExecutable
      else delete process.env.PORTABLE_EXECUTABLE_FILE
      // Keep the real shutdown sequence alive after its windows close.
      globalThis.holdQuitForRelaunchTest = event => event.preventDefault()
      app.on('will-quit', globalThis.holdQuitForRelaunchTest)
      globalThis.relaunchRequests = []
      app.relaunch = options => globalThis.relaunchRequests.push(options)
      app.quit()
    }, portableExecutable)

    try {
      await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows().length
      ))).toBe(0)

      const args = [path.join(repoRoot, 'dist-e2e', 'main.js'), '--new-window', 'opentubex://https://www.youtube.com/watch?v=test']
      for (let attempt = 0; attempt < 2; attempt++) {
        const env = { ...process.env, OPENTUBEX_E2E_USER_DATA_DIR: app.userDataDir }
        delete env.ELECTRON_RUN_AS_NODE
        delete env.WAYLAND_DISPLAY
        const child = spawn(app.electronApp.process().spawnfile, [...args, '--ozone-platform=x11'], {
          env,
          stdio: 'ignore'
        })
        try {
          const [exitCode] = await once(child, 'exit')
          expect(exitCode).toBe(0)
        } finally {
          if (child.exitCode === null) child.kill()
        }
      }

      await expect.poll(() => app.electronApp.evaluate(() => globalThis.relaunchRequests.length)).toBe(1)
      expect(await app.electronApp.evaluate(() => globalThis.relaunchRequests[0])).toEqual({
        args: expect.arrayContaining(args),
        execPath: portableExecutable || executablePath
      })
      expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
    } finally {
      await app.electronApp.evaluate(({ app }) => {
        app.removeListener('will-quit', globalThis.holdQuitForRelaunchTest)
      })
    }
  })
}
