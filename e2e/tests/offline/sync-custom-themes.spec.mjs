import { test, expect } from '../../helpers/app.mjs'
import { verifyCustomThemeSync } from '../../helpers/sync-custom-themes.mjs'
import { AUTO_SYNC_INTERVAL_MS } from '../../../src/renderer/helpers/sync-server-scheduling.js'

test('custom themes settle across different storage orders and default colors', async ({ page }) => {
  await verifyCustomThemeSync(page)
})

for (const automatic of [true, false]) {
  test(`custom theme test restores ${automatic ? 'enabled' : 'disabled'} automatic sync`, async ({ page }) => {
    await page.clock.install()
    await page.route('https://theme-sync-restoration.example/**', route => route.fulfill({
      status: 503, body: 'Offline restoration fixture'
    }))
    await page.evaluate(async automatic => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('stopSyncServerAutoSync')
      const settings = {
        SyncServerEnabled: true,
        SyncServerAutoSync: automatic,
        SyncServerToken: 'restoration-token',
        SyncServerUrl: 'https://theme-sync-restoration.example',
        // Exercise the periodic fallback without starting a live connection.
        SyncServerPrivacyKey: '',
        SyncServerPrivacyMode: 'enhanced',
        SyncServerSyncSettings: true,
      }
      for (const [name, value] of Object.entries(settings)) store.commit(`set${name}`, value)
      window.__themeAutoSyncAttempts = 0
      window.__themeAutoSyncUnsubscribe = store.subscribeAction(({ type, payload }) => {
        if (type === 'syncWithSyncServer' && payload?.automatic) window.__themeAutoSyncAttempts++
      })
    }, automatic)
    try {
      await verifyCustomThemeSync(page)
      await page.clock.runFor(AUTO_SYNC_INTERVAL_MS)
      await expect.poll(() => page.evaluate(() => window.__themeAutoSyncAttempts)).toBe(automatic ? 1 : 0)
    } finally {
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('stopSyncServerAutoSync')
        window.__themeAutoSyncUnsubscribe()
        delete window.__themeAutoSyncUnsubscribe
        delete window.__themeAutoSyncAttempts
      })
    }
  })
}
