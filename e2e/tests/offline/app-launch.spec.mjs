import { rm } from 'node:fs/promises'
import { test, expect, createUserDataDir, launchApp, sel } from '../../helpers/app.mjs'

for (const blockReadiness of [false, true]) {
  const title = blockReadiness
    ? 'reports renderer errors when app readiness times out'
    : 'rejects renderer errors reported before app readiness'
  test(title, async () => {
    const userDataDir = await createUserDataDir()
    let startedApp
    try {
      await expect(launchApp(userDataDir, [], {
        onPhase: async (phase, page) => {
          if (phase !== (blockReadiness ? 'routeCommitted' : 'windowCreated')) return
          if (blockReadiness) {
            await page.addStyleTag({ content: '.topNav { visibility: hidden !important; }' })
          }
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
}

test.describe('startup arguments', () => {
  test.use({ launchArgs: ['not-a-url.txt', '--unknown-option'] })

  test('ignores non-URL startup arguments', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))

    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator('.topNav')).toBeVisible()
    await expect(page.locator('.sideNav')).toBeVisible()
    await expect(page.locator(sel.searchInput)).toBeVisible()
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect(page.locator(sel.activeTab)).toHaveCount(1)

    // Keep coverage for async startup work that finishes after readiness.
    await page.waitForTimeout(3000)
    expect(errors).toEqual([])
  })
})
