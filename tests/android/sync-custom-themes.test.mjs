import { test } from 'node:test'
import { verifyCustomThemeSync } from '../../e2e/helpers/sync-custom-themes.mjs'
import { connectAndroidApp } from '../helpers/android-webview.mjs'

test('Android custom themes settle without echoing default colors and real edits still sync', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const { browser, page } = await connectAndroidApp()
  try {
    await page.locator('.profileTrigger').waitFor()
    await verifyCustomThemeSync(page, { phone: true })
  } finally {
    await browser.close()
  }
})
