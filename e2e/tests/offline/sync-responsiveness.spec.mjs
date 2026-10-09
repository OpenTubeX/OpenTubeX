import { test, expect, abortUnmockedRequest, goToSettingsSection } from '../../helpers/app.mjs'
import { encryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

const key = Buffer.alloc(32, 1).toString('base64')
const salt = Buffer.alloc(16, 2).toString('base64')
const count = 20_000
const history = Array.from({ length: count }, (_, index) => ({
  videoId: `video-${index}`,
  title: `Video ${index}`,
  authorId: 'UCtest',
  author: 'Channel',
  lengthSeconds: 120,
  published: 100,
  timeWatched: index + 1,
  watchProgress: 15,
  isWatched: false,
  type: 'video',
}))
const remoteHistory = history.map(record => ({
  video: {
    id: record.videoId,
    title: record.title,
    duration: record.lengthSeconds,
    upload_date: record.published,
    uploader: { id: record.authorId, name: record.author },
  },
  metadata: { added_date: record.timeWatched, watched_state: 'watching', position_millis: 15_000 },
}))
const payload = await encryptSyncDocument(remoteHistory, key, salt)

test.use({
  seed: {
    settings: {
      syncServerEnabled: false,
      syncServerAutoSync: false,
      syncServerUrl: 'https://sync-responsiveness.example',
      syncServerToken: 'test-token',
      syncServerPrivacyMode: 'enhanced',
      syncServerPrivacyKey: key,
      syncServerPrivacySalt: salt,
      syncServerSyncHistory: true,
      syncServerSyncSubscriptions: false,
      syncServerSyncPlaylists: false,
      syncServerSyncProfiles: false,
      syncServerSyncSettings: false,
      syncServerSyncWatchStats: false,
      syncServerSyncLiveReminders: false,
      syncServerSyncSessions: false,
      historyRetentionDays: '0',
      uiScale: 95,
      baseTheme: 'dark',
    },
    history,
  }
})

test('large encrypted history sync keeps renderer input responsive', async ({ page }, testInfo) => {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://sync-responsiveness.example/**', route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/health') return route.fulfill({ json: { capabilities: { encrypted_sync: 1, live_sync: 1 } } })
    if (pathname.endsWith('/encrypted_sync')) {
      return route.fulfill({ json: { collections: [{ collection: 'history', revision: 1 }], legacy_data: false } })
    }
    if (pathname.endsWith('/encrypted_sync/history')) return route.fulfill({ json: { revision: 1, payload } })
    if (pathname.endsWith('/encrypted_sync/events')) return route.fulfill({ json: [] })
    if (pathname.endsWith('/account/sessions')) return route.fulfill({ json: { sessions: [] } })
    return route.fulfill({ json: { revision: 0, payload: null } })
  })
  await goToSettingsSection(page, 'sync')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  if (process.env.OPENTUBEX_SYNC_CPU_PROFILE) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
  }
  const metrics = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const durations = []
    let inputTurns = 0
    const observer = new PerformanceObserver(list => durations.push(...list.getEntries().map(entry => entry.duration)))
    observer.observe({ type: 'longtask' })
    const interval = setInterval(() => { inputTurns++ }, 10)
    try {
      store.commit('setSyncServerEnabled', true)
      await store.dispatch('syncWithSyncServer')
      // Let the observer deliver the final task as well.
      await new Promise(resolve => setTimeout(resolve, 20))
      const record = store.state.history.historyCacheById['video-0']
      return {
        inputTurns,
        durations,
        status: store.getters.getSyncServerStatus,
        result: store.getters.getSyncServerLastResult,
        watchProgress: record?.watchProgress,
        duration: record?.lengthSeconds,
      }
    } finally {
      clearInterval(interval)
      observer.disconnect()
    }
  })
  if (process.env.OPENTUBEX_SYNC_CPU_PROFILE) {
    const { profile } = await cdp.send('Profiler.stop')
    await testInfo.attach('sync CPU profile', { body: JSON.stringify(profile), contentType: 'application/json' })
  }
  await cdp.detach()
  await testInfo.attach('sync responsiveness', { body: JSON.stringify(metrics), contentType: 'application/json' })
  expect(metrics.status).toBe('success')
  expect(metrics.result.history).toBe(count)
  expect(metrics.watchProgress).toBe(15)
  expect(metrics.duration).toBe(120)
  expect(metrics.inputTurns).toBeGreaterThan(10)
  expect(Math.max(0, ...metrics.durations), JSON.stringify(metrics)).toBeLessThan(250)
})
