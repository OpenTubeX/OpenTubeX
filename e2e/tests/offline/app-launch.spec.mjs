import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test, expect, sel } from '../../helpers/app.mjs'

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

test.describe('spellchecker', () => {
  const netLogPath = path.join(tmpdir(), `opentubex-e2e-net-log-${randomUUID()}.json`)
  test.use({ launchArgs: [`--log-net-log=${netLogPath}`] })

  test('does not download spellchecker dictionaries from Google', async ({ app }) => {
    await expect(app.page.locator('.topNav')).toBeVisible()
    // Closing the app completes its network log. The dictionary download starts
    // as soon as the session exists, well before the window is ready.
    await app.electronApp.close()
    try {
      const log = await readFile(netLogPath, 'utf8')
      expect(log.match(/https?:\/\/[^"]*\/edgedl\/chrome\/dict\/[^"]*/g) ?? []).toEqual([])
    } finally {
      await rm(netLogPath, { force: true })
    }
  })
})
