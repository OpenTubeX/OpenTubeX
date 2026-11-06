import { expect } from '@playwright/test'
import { DEFAULT_CUSTOM_THEME, normalizeCustomThemes } from '../../src/customTheme.js'
import { decryptSyncDocument, encryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'

export async function verifyCustomThemeSync(page, { phone = false } = {}) {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const themes = normalizeCustomThemes([
    { ...DEFAULT_CUSTOM_THEME, id: 'youtube', name: 'YouTube Web Dark' },
    { ...DEFAULT_CUSTOM_THEME, id: 'd3sox', name: 'D3SOX' },
  ])
  const receivedThemes = structuredClone(themes)
  for (const theme of receivedThemes) delete theme.colors.watchedThumbnailOverlay
  const received = { key: 'customThemes', value: receivedThemes, updatedAt: 10 }
  let remote = [received]
  let revision = 1
  const uploads = []
  const respond = async (url, method, body) => {
    const pathname = new URL(url).pathname
    if (pathname === '/health') return { capabilities: { encrypted_sync: 1, live_sync: 1 } }
    if (pathname === '/v1/encrypted_sync') return { collections: [{ collection: 'settings', revision }], legacy_data: false }
    if (pathname === '/v1/encrypted_sync/settings') {
      if (method === 'PUT') {
        expect(body.revision).toBe(revision)
        remote = await decryptSyncDocument(body.payload, key)
        uploads.push(structuredClone(remote))
        revision++
        return { revision }
      }
      return { revision, payload: await encryptSyncDocument(remote, key, salt) }
    }
    return []
  }
  const routeHandler = async route => route.fulfill({
    json: await respond(
      route.request().url(), route.request().method(), route.request().method() === 'PUT' ? route.request().postDataJSON() : null
    )
  })
  await page.route('https://theme-sync.example/**', routeHandler)
  if (phone) {
    await page.exposeBinding('__themeSyncRequest', async (_source, options) => ({
      status: 200,
      headers: {},
      url: options.url,
      data: JSON.stringify(await respond(options.url, options.method, options.data ? JSON.parse(options.data) : null)),
    }))
    await page.evaluate(() => {
      window.__themeSyncNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = (plugin, method, options) => (
        plugin === 'CapacitorHttp' && options.url.startsWith('https://theme-sync.example/')
          ? window.__themeSyncRequest(options)
          : window.__themeSyncNativePromise(plugin, method, options)
      )
    })
  }
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return JSON.parse(JSON.stringify({ settings: store.state.settings, sync: store.state.syncServer, themes: store.state.utils.customThemes }))
  })
  try {
    await page.evaluate(async ({ key, salt, received, themes }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('stopSyncServerAutoSync')
      const settings = {
        SyncServerEnabled: true,
        SyncServerAutoSync: false,
        SyncServerUrl: 'https://theme-sync.example',
        SyncServerToken: 'fixture-token',
        SyncServerPrivacyMode: 'enhanced',
        SyncServerPrivacyKey: key,
        SyncServerPrivacySalt: salt,
        SyncServerSyncSettings: true,
        SyncServerSyncSubscriptions: false,
        SyncServerSyncPlaylists: false,
        SyncServerSyncProfiles: false,
        SyncServerSyncHistory: false,
        SyncServerSyncWatchStats: false,
        SyncServerSyncLiveReminders: false,
        SyncServerSyncSessions: false,
        SyncServerSnapshot: JSON.stringify({ settings: { customThemes: received } }),
        SyncServerSettingUpdatedAt: { customThemes: 20 },
      }
      for (const [name, value] of Object.entries(settings)) store.commit(`set${name}`, value)
      // Electron loads themes sorted by name; mobile keeps the received order.
      const local = window.ftElectron
        ? await window.ftElectron.replaceCustomThemes(themes)
        : themes
      store.commit('setCustomThemes', local)
      await store.dispatch('syncWithSyncServer')
    }, { key, salt, received, themes })
    expect(remote.find(entry => entry.key === 'customThemes')).toEqual(received)
    // The first sync fills in other settings. Subsequent periodic merges must settle.
    uploads.length = 0
    // A peer may have saved these same themes with defaults and another order
    // at the same edit time. Adopt its representation rather than echoing ours.
    remote = remote.map(entry => entry.key === 'customThemes'
      ? { ...entry, value: [...themes].reverse() }
      : entry)
    revision++
    const peerEntry = structuredClone(remote.find(entry => entry.key === 'customThemes'))
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer'))
    }
    expect(uploads).toEqual([])
    expect(remote.find(entry => entry.key === 'customThemes')).toEqual(peerEntry)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const edited = JSON.parse(JSON.stringify(store.state.utils.customThemes))
      edited.find(theme => theme.id === 'd3sox').colors.primaryText = '#abcdef'
      await store.dispatch('updateCustomThemes', edited)
      await store.dispatch('syncWithSyncServer')
    })
    expect(uploads).toHaveLength(1)
    expect(remote.find(entry => entry.key === 'customThemes').value.find(theme => theme.id === 'd3sox').colors.primaryText).toBe('#abcdef')
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer'))
    expect(uploads).toHaveLength(1)
  } finally {
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('stopSyncServerAutoSync')
      if (window.ftElectron) await window.ftElectron.replaceCustomThemes(saved.themes)
      store.commit('setCustomThemes', saved.themes)
      Object.assign(store.state.settings, saved.settings)
      Object.assign(store.state.syncServer, saved.sync)
      await store.dispatch('updateSyncServerSnapshot', saved.settings.syncServerSnapshot)
      await store.dispatch('updateSyncServerSettingUpdatedAt', saved.settings.syncServerSettingUpdatedAt)
      if (window.__themeSyncNativePromise) {
        window.Capacitor.nativePromise = window.__themeSyncNativePromise
        delete window.__themeSyncNativePromise
      }
      if (saved.settings.syncServerAutoSync) {
        await store.dispatch('startSyncServerAutoSync')
      }
    }, saved)
    await page.unroute('https://theme-sync.example/**', routeHandler)
  }
}
