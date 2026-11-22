import { test, expect } from '../../helpers/app.mjs'

test('reloads the window after its renderer process crashes', async ({ app, page }) => {
  await expect(page.locator('.topNav')).toBeVisible()
  const crashedPid = await app.electronApp.evaluate(({ BrowserWindow }) => {
    const { webContents } = BrowserWindow.getAllWindows()[0]
    const pid = webContents.getOSProcessId()
    webContents.forcefullyCrashRenderer()
    return pid
  })

  // Playwright keeps treating the crashed page as dead, so check the reload
  // from the main process: the window must get a fresh renderer process.
  await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }, crashedPid) => {
    const { webContents } = BrowserWindow.getAllWindows()[0]
    return !webContents.isCrashed() && webContents.getOSProcessId() !== crashedPid
  }, crashedPid)).toBe(true)
})
