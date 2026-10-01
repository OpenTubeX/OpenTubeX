import { rm } from 'node:fs/promises'
import { test, expect, createUserDataDir, launchApp, sel } from '../../helpers/app.mjs'

test('rejects renderer errors reported before app readiness', async () => {
  const userDataDir = await createUserDataDir()
  let startedApp
  try {
    await expect(launchApp(userDataDir, [], {
      onPhase: async (phase, page) => {
        if (phase !== 'windowCreated') return
        await Promise.all([
          page.waitForEvent('pageerror'),
          page.evaluate(() => {
            setTimeout(() => { throw new Error('Injected startup error') }, 0)
          })
        ])
      }
    }).then(app => { startedApp = app })).rejects.toThrow('Injected startup error')
  } finally {
    await startedApp?.electronApp.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test.describe('startup arguments', () => {
  test.use({ launchArgs: ['not-a-url.txt', '--unknown-option'] })

  test('ignores non-URL startup arguments', async ({ page }) => {
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator('.topNav')).toBeVisible()
    await expect(page.locator('.sideNav')).toBeVisible()
    await expect(page.locator(sel.searchInput)).toBeVisible()
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect(page.locator(sel.activeTab)).toHaveCount(1)
  })
})
