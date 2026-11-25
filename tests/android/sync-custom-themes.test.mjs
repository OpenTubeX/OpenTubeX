import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { verifyCustomThemeSync } from '../../e2e/helpers/sync-custom-themes.mjs'
import { appPage } from '../helpers/android-app-page.mjs'

test('Android custom themes settle without echoing default colors and real edits still sync', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  try {
    const page = appPage(browser)
    await page.locator('.profileTrigger').waitFor()
    await verifyCustomThemeSync(page, { phone: true })
  } finally {
    await browser.close()
  }
})
