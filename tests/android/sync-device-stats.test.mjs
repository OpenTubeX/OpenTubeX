import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goToSettingsSection } from '../../e2e/helpers/app.mjs'
import { decryptSyncDocument, encryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'

// Run against a current debug APK on a locked emulator with its WebView forwarded.
// Only the native HTTP transport is replaced; pairing, encryption and the UI are real.
test('Android repairs duplicate stats and reuses its identity when creating another pairing code', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const currentId = Buffer.alloc(16, 3).toString('base64url')
  const oldId = Buffer.alloc(16, 4).toString('base64url')
  let saved
  let seededStats = false
  let revision = 1
  let payload
  let pairing
  const pairingRequests = []
  try {
    await page.locator('.profileTrigger').waitFor()
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('stopSyncServerAutoSync')
      await store.dispatch('grabWatchStats')
      return JSON.parse(JSON.stringify({ settings: store.state.settings, watchStats: store.state.watchStats, route: location.hash }))
    })
    if (Object.keys(saved.watchStats.watchSecondsByDate).length === 0) {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
        .dispatch('recordWatchTime', { date: '2026-10-08', seconds: 3600 }))
      seededStats = true
    }
    const local = await page.evaluate(() => ({ ...document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchSecondsByDate }))
    const oldDays = Object.fromEntries(Object.entries(local).map(([date, seconds]) => [date, seconds / 2]))
    oldDays['2020-01-01'] = (local['2020-01-01'] ?? 0) + 1800
    payload = await encryptSyncDocument([{ deviceId: oldId, deviceName: 'Pixel (old)', platform: 'android', days: oldDays }], key, salt)
    await page.exposeBinding('__statsRepairNativeRequest', async (_source, options) => {
      const pathname = new URL(options.url).pathname
      const method = options.method ?? 'GET'
      let data
      if (pathname === '/health') data = { capabilities: { encrypted_sync: 1, live_sync: 1, key_pairing: 1, watch_stats: 1 } }
      else if (pathname === '/v1/encrypted_sync') data = { collections: [{ collection: 'watchStats', revision }], legacy_data: false }
      else if (pathname === '/v1/account/sessions') data = { sessions: [] }
      else if (pathname === '/v1/encrypted_sync/events') data = []
      else if (pathname === '/v1/encrypted_sync/watchStats') {
        if (method === 'PUT') {
          const body = typeof options.data === 'string' ? JSON.parse(options.data) : options.data
          assert.equal(body.revision, revision)
          payload = body.payload
          revision++
        }
        data = { revision, payload }
      } else if (pathname === '/v1/pairing' && method === 'POST') {
        const body = typeof options.data === 'string' ? JSON.parse(options.data) : options.data
        pairingRequests.push(body)
        pairing = { version: 1, id: body.id, account_id: null, recipient_public_key: body.recipient_public_key,
          recipient_device_id: body.recipient_device_id, recipient_device_name: body.recipient_device_name,
          approving_device_id: null, expires_at: Date.now() + 120000, approved: false }
        data = pairing
      } else if (pathname.startsWith('/v1/pairing/')) data = pairing
      else throw new Error(`Unexpected native sync fixture request: ${method} ${pathname}`)
      return { status: 200, headers: { 'content-type': 'application/json' }, data: JSON.stringify(data), url: options.url }
    })
    await page.evaluate(async ({ key, salt, currentId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__statsRepairNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = (plugin, method, options) => (
        plugin === 'CapacitorHttp' && method === 'request' && options.url.startsWith('https://sync.example/')
          ? window.__statsRepairNativeRequest(options)
          : window.__statsRepairNativePromise(plugin, method, options)
      )
      Object.assign(store.state.settings, {
        currentLocale: 'en-US', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light',
        mainColor: 'Red', secColor: 'Blue', rememberHistory: true, enableWatchStats: true,
        syncServerEnabled: true, syncServerAutoSync: false, syncServerUrl: 'https://sync.example',
        syncServerUsername: 'test', syncServerToken: 'test-token', syncServerPrivacyMode: 'enhanced',
        syncServerPrivacyKey: key, syncServerPrivacySalt: salt, syncServerDeviceId: currentId,
        syncServerDeviceName: 'Pixel', syncServerWatchStatsReset: null,
        syncServerSyncWatchStats: true, syncServerSyncSubscriptions: false, syncServerSyncPlaylists: false,
        syncServerSyncHistory: false, syncServerSyncProfiles: false, syncServerSyncSessions: false,
        syncServerSyncSettings: false, syncServerSyncLiveReminders: false,
      })
      await store.dispatch('syncWithSyncServer')
      location.hash = '#/stats'
    }, { key, salt, currentId })
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      const back = tutorial.getByRole('button', { name: 'Back', exact: true })
      while (await back.isVisible()) await back.click()
      const skip = tutorial.getByRole('button', { name: 'Skip', exact: true })
      if (await skip.isVisible()) await skip.click()
      else await tutorial.locator('.tutorialActions').getByRole('button').last().click()
      await expect(tutorial).toBeHidden()
    }
    const picker = page.getByRole('group', { name: 'Devices' })
    await expect(picker.getByRole('button')).toHaveCount(3)
    await picker.getByRole('button', { name: 'Pixel (old)', exact: true }).click()
    await page.getByRole('button', { name: 'Replace old device', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Replace old device' })
    await expect(dialog.getByRole('button', { name: 'Replace old device' })).toBeDisabled()
    await dialog.getByRole('radio', { name: /Keep larger daily total/ }).check()
    await expect(dialog.locator('.repairResult')).not.toContainText('—')
    const scroller = dialog.locator('.promptContentScroller')
    await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    const footer = await dialog.locator('.promptFixedFooter').boundingBox()
    assert.ok(footer.y + footer.height <= (await page.evaluate(() => innerHeight)) + 1)
    if (process.env.ANDROID_STATS_SCREENSHOT) await page.screenshot({ path: process.env.ANDROID_STATS_SCREENSHOT })
    if (process.env.ANDROID_STATS_RECORDING) await page.waitForTimeout(1500)
    await dialog.getByRole('button', { name: 'Replace old device', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(picker.getByRole('button')).toHaveCount(2)
    await picker.scrollIntoViewIfNeeded()
    if (process.env.ANDROID_STATS_RECORDING) await page.waitForTimeout(1500)
    const repaired = await decryptSyncDocument(payload, key)
    assert.equal(repaired.length, 1)
    assert.deepEqual(repaired[0].replacedDevices[0].days, oldDays)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer'))
    await expect(picker.getByRole('button')).toHaveCount(2)
    // Reset only statistics seeded by this test; never erase an existing profile.
    if (seededStats) {
      await page.locator('.resetStatsButton').click()
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      const total = page.locator('.summaryCard').filter({ hasText: 'Total watch time' })
      await expect(total).toContainText('0 min')
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer'))
      await expect(total).toContainText('0 min')
      const cleared = await decryptSyncDocument(payload, key)
      assert.deepEqual(cleared[0].days, {})
      assert.deepEqual(cleared[0].reset.baselines[oldId], oldDays)
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('recordWatchTime', { date: '2026-10-08', seconds: 60 })
        await store.dispatch('syncWithSyncServer')
      })
      await expect(total).toContainText('1 min')
    }

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSyncServerToken', '')
    })
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow'))
    await expect(page.locator('.settingsWindow')).toBeVisible()
    if (!await page.locator('.settingsMenu').isVisible()) await page.locator('.settingsBackButton').click()
    const sync = await goToSettingsSection(page, 'sync')
    for (let attempt = 0; attempt < 2; attempt++) {
      await sync.getByRole('button', { name: 'Pair with an existing device' }).click()
      const receiver = page.getByRole('dialog', { name: 'Pair with an existing device' })
      await receiver.getByRole('button', { name: 'Create pairing code' }).click()
      await expect(receiver.locator('.pairingQr')).toBeVisible()
      assert.equal(pairingRequests[attempt].recipient_device_id, currentId)
      await receiver.press('Escape')
      await expect(receiver).toBeHidden()
    }
    assert.notEqual(pairingRequests[0].id, pairingRequests[1].id)
    assert.notEqual(pairingRequests[0].recipient_public_key, pairingRequests[1].recipient_public_key)
  } finally {
    await page.evaluate(async ({ saved, seededStats }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('stopSyncServerAutoSync')
      window.Capacitor.nativePromise = window.__statsRepairNativePromise ?? window.Capacitor.nativePromise
      delete window.__statsRepairNativePromise
      if (saved) {
        if (seededStats) await store.dispatch('clearWatchStats')
        Object.assign(store.state.settings, saved.settings)
        Object.assign(store.state.watchStats, saved.watchStats)
        await store.dispatch('updateSyncServerSnapshot', saved.settings.syncServerSnapshot)
        await store.dispatch('updateSyncServerLastSyncAt', saved.settings.syncServerLastSyncAt)
        await store.dispatch('updateSyncServerWatchStatsReset', saved.settings.syncServerWatchStatsReset)
        store.commit('setSettingsWindowOpen', false)
        location.hash = saved.route
      }
    }, { saved, seededStats }).catch(() => {})
    await browser.close()
  }
})
