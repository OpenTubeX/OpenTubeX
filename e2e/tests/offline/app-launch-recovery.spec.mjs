import { rm } from 'node:fs/promises'
import { test, expect, _electron as electron } from '@playwright/test'
import { createUserDataDir, launchApp } from '../../helpers/app.mjs'

for (const persistent of [false, true]) {
  test(persistent ? 'fails after bounded first-window retries and closes every process' : 'recovers from a first-window timeout and closes the abandoned process', async () => {
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
        for (const process of processes) expect(process.exitCode).not.toBeNull()
      } else {
        const { electronApp, page } = await launchApp(userDataDir)
        expect(applications).toHaveLength(2)
        expect(processes[0].exitCode).not.toBeNull()
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
