import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { verifySyncDeviceRemoval } from '../../e2e/helpers/sync-device-removal.mjs'

for (const otherLogin of [false, true]) {
  test(`Android device removal ${otherLogin ? 'preserves tabs used by another login' : 'cleans up synced tabs'} and orphaned sets can be deleted`, {
    skip: !process.env.ANDROID_CDP_URL,
  }, async () => {
    const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    const keepAlive = setTimeout(() => {}, 120_000)
    try {
      const page = browser.contexts()[0].pages()[0]
      await page.reload()
      const skip = page.getByRole('button', { name: 'Skip', exact: true })
      if (await skip.isVisible()) await skip.click()
      await verifySyncDeviceRemoval(page, { phone: true, otherLogin })
    } finally {
      clearTimeout(keepAlive)
      await browser.close()
    }
  })
}
