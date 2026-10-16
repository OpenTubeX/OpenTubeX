import { rm } from 'node:fs/promises'
import { _electron as electron } from '@playwright/test'
// The shared test starts the worker's private display before these raw launches.
import { createUserDataDir, expect, launchApp, test } from '../../helpers/app.mjs'

for (const [persistent, terminatedBySignal] of [[false, false], [true, false], [false, true]]) {
  test(terminatedBySignal ? 'recovers after a timed-out process is terminated by a signal' : persistent ? 'fails after bounded first-window retries and closes every process' : 'recovers from a first-window timeout and closes the abandoned process', async () => {
    const userDataDir = await createUserDataDir()
    const originalLaunch = electron.launch
    const applications = []
    const processes = []
    electron.launch = async function (options) {
      const application = await originalLaunch.call(this, options)
      applications.push(application)
      processes.push(application.process())
      if (persistent || applications.length === 1) {
        application.firstWindow = async () => {
          if (terminatedBySignal) application.process().kill('SIGKILL')
          const error = new Error('electronApplication.firstWindow: Timeout 30000ms exceeded while waiting for event "window"')
          error.name = 'TimeoutError'
          throw error
        }
      }
      return application
    }
    try {
      if (persistent) {
        await expect(launchApp(userDataDir)).rejects.toThrow('electronApplication.firstWindow')
        expect(applications).toHaveLength(3)
        for (const process of processes) expect(process.exitCode ?? process.signalCode).not.toBeNull()
      } else {
        const { electronApp, page } = await launchApp(userDataDir)
        expect(applications).toHaveLength(2)
        expect(processes[0].exitCode ?? processes[0].signalCode).not.toBeNull()
        await expect(page.locator('.topNav')).toBeVisible()
        await electronApp.close()
      }
    } finally {
      electron.launch = originalLaunch
      for (const application of applications) await application.close().catch(() => {})
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
}
