import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { verifyCustomThemeSync } from '../../e2e/helpers/sync-custom-themes.mjs'

test('Android custom themes settle without echoing default colors and real edits still sync', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  try {
    const page = browser.contexts()[0].pages()[0]
    await page.locator('.profileTrigger').waitFor()
    await verifyCustomThemeSync(page, { phone: true })
  } finally {
    await browser.close()
  }
})
