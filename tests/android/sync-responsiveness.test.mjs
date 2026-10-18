import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { encryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'

const key = Buffer.alloc(32, 1).toString('base64')
const salt = Buffer.alloc(16, 2).toString('base64')
const count = 20000
const remoteHistory = Array.from({ length: count }, (_, index) => ({
  video: {
    id: `sync-responsiveness-${index}`,
    title: `Video ${index}`,
    duration: 120,
    upload_date: 100,
    uploader: { id: 'UCtest', name: 'Channel' },
  },
  metadata: { added_date: index + 1, watched_state: 'watching', position_millis: 15000 },
}))

// Run against a current debug APK on a locked emulator with its WebView forwarded.
// Only the native HTTP transport is replaced; decryption, merging and storage are real.
test('Android keeps the UI thread responsive while syncing a large encrypted history', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const payload = await encryptSyncDocument(remoteHistory, key, salt)
  let saved
  try {
    await page.locator('.profileTrigger').waitFor()
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('stopSyncServerAutoSync')
      // Measure the sync alone, not a feed refresh started with the app.
      while (store.getters.getSubscriptionFeedRefreshInProgress) await new Promise(resolve => setTimeout(resolve, 100))
      return JSON.parse(JSON.stringify({ settings: store.state.settings, history: store.getters.getHistoryCacheSorted }))
    })
    await page.exposeBinding('__syncResponsivenessRequest', (_source, options) => {
      const { pathname } = new URL(options.url)
      let data
      if (pathname === '/health') data = { capabilities: { encrypted_sync: 1, live_sync: 1 } }
      else if (pathname === '/v1/encrypted_sync') data = { collections: [{ collection: 'history', revision: 1 }], legacy_data: false }
      else if (pathname === '/v1/encrypted_sync/history') data = { revision: 1, payload }
      else if (pathname === '/v1/account/sessions') data = { sessions: [] }
      else if (pathname === '/v1/encrypted_sync/events') data = []
      else data = { revision: 0, payload: null }
      return { status: 200, headers: { 'content-type': 'application/json' }, data: JSON.stringify(data), url: options.url }
    })
    const metrics = await page.evaluate(async ({ key, salt }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__syncResponsivenessNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = (plugin, method, options) => (
        plugin === 'CapacitorHttp' && method === 'request' && options.url.startsWith('https://sync-responsiveness.example/')
          ? window.__syncResponsivenessRequest(options)
          : window.__syncResponsivenessNativePromise(plugin, method, options)
      )
      Object.assign(store.state.settings, {
        syncServerEnabled: true, syncServerAutoSync: false, syncServerUrl: 'https://sync-responsiveness.example',
        syncServerUsername: 'test', syncServerToken: 'test-token', syncServerPrivacyMode: 'enhanced',
        syncServerPrivacyKey: key, syncServerPrivacySalt: salt, syncServerSnapshot: '',
        syncServerSyncHistory: true, syncServerSyncSubscriptions: false, syncServerSyncPlaylists: false,
        syncServerSyncProfiles: false, syncServerSyncSettings: false, syncServerSyncWatchStats: false,
        syncServerSyncLiveReminders: false, syncServerSyncSessions: false, historyRetentionDays: '0',
      })
      const durations = []
      const observer = new PerformanceObserver(list => durations.push(...list.getEntries().map(entry => entry.duration)))
      observer.observe({ type: 'longtask' })
      const startedAt = performance.now()
      try {
        await store.dispatch('syncWithSyncServer')
        await new Promise(resolve => setTimeout(resolve, 50))
        return {
          elapsed: Math.round(performance.now() - startedAt),
          longest: Math.round(Math.max(0, ...durations)),
          blocked: Math.round(durations.reduce((sum, duration) => sum + duration, 0)),
          status: store.getters.getSyncServerStatus,
          synced: store.getters.getSyncServerLastResult?.history,
          watchProgress: store.state.history.historyCacheById['sync-responsiveness-0']?.watchProgress,
        }
      } finally {
        observer.disconnect()
      }
    }, { key, salt })
    console.log(JSON.stringify(metrics))
    assert.equal(metrics.status, 'success')
    assert.equal(metrics.synced, count + saved.history.length)
    assert.equal(metrics.watchProgress, 15)
    // Gross hang bound only; the emulator's wall-clock timing is noisy.
    assert.ok(metrics.longest < 500, JSON.stringify(metrics))
  } finally {
    await page.evaluate(async ({ saved }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.Capacitor.nativePromise = window.__syncResponsivenessNativePromise ?? window.Capacitor.nativePromise
      delete window.__syncResponsivenessNativePromise
      if (!saved) return
      await store.dispatch('overwriteHistory', saved.history.map(record => [record.videoId, record]))
      Object.assign(store.state.settings, saved.settings)
      await store.dispatch('updateSyncServerSnapshot', saved.settings.syncServerSnapshot)
      await store.dispatch('updateSyncServerLastSyncAt', saved.settings.syncServerLastSyncAt)
    }, { saved })
    await browser.close()
  }
})
