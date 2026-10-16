import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { decryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'

function findWatchComponent() {
  const find = vnode => {
    const component = vnode?.component
    if (component?.type?.name === 'Watch' && component.proxy.tabId === document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTabId) return component
    const nested = component?.subTree && find(component.subTree)
    if (nested) return nested
    if (Array.isArray(vnode?.children)) {
      for (const child of vnode.children) {
        const result = find(child)
        if (result) return result
      }
    }
    return null
  }
  return find(document.querySelector('#app').__vue_app__._container._vnode)
}

// Run on a locked emulator with a current debug APK and a forwarded WebView.
// Playback uses local media; the encrypted device request crosses a fixture transport.
test('Android sends live tab progress and receives it ahead of stale history', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  page.setDefaultTimeout(15000)
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
  const eventId = `handoff-${Date.now()}`
  let sent
  let saved
  try {
    await page.getByRole('button', { name: 'Quick settings', exact: true }).waitFor()
    const organizer = page.locator('#capacitor-phone-tab-dialog')
    if (await organizer.isVisible()) await organizer.getByRole('button', { name: 'Close', exact: true }).click()
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if (await skip.isVisible()) await skip.click()
    saved = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(JSON.stringify({
        settings: store.state.settings, route: location.hash,
        tabIds: store.getters.getTabs.map(tab => tab.id), activeTabId: store.getters.getActiveTabId,
        history: store.getters.getHistoryCacheSorted, sync: store.state.syncServer,
      }))
    })
    await page.exposeBinding('__handoffRequest', async (_source, options) => {
      const method = options.method ?? 'GET'
      let data = []
      if (method === 'POST') {
        sent = typeof options.data === 'string' ? JSON.parse(options.data) : options.data
        data = { id: eventId }
      } else if (method === 'GET' && sent) {
        data = [{ id: eventId, recipient: 'laptop', payload: sent.payload, created_at: Date.now(), expires_at: Date.now() + 60000 }]
      }
      return { status: 200, headers: { 'content-type': 'application/json' }, data: JSON.stringify(data), url: options.url }
    })
    await page.evaluate(({ key, salt }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__handoffNative = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = function(plugin, method, options, ...rest) {
        if (plugin === 'CapacitorHttp' && method === 'request') {
          return options.url.startsWith('https://sync.example/')
            ? window.__handoffRequest(options) : Promise.reject(new Error('Local media fixture'))
        }
        return window.__handoffNative.call(this, plugin, method, options, ...rest)
      }
      window.__handoffFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__handoffFetch(url, options) : Promise.reject(new Error('Local media fixture'))
      Object.assign(store.state.settings, {
        currentLocale: 'en-US', videoPlaybackEngine: 'built-in', autoplayVideos: false,
        useSponsorBlock: false, useReturnYouTubeDislikes: false, rememberHistory: false,
        syncServerEnabled: true, syncServerAutoSync: false, syncServerUrl: 'https://sync.example',
        syncServerUsername: 'fixture', syncServerToken: 'fixture', syncServerPrivacyKey: key,
        syncServerPrivacySalt: salt, syncServerDeviceId: 'phone', enableMobileTabs: true,
      })
      store.commit('setSyncServerLiveSupported', true)
      store.commit('setSyncServerDevices', { laptop: { name: 'Test laptop', platform: 'linux' } })
      location.hash = '#/watch/jNQXAC9IVRw'
    }, { key, salt })
    const preparePlayer = async () => {
      await expect.poll(async () => {
        const handle = await page.evaluateHandle(findWatchComponent)
        try { return await handle.evaluate(component => !!component?.proxy.onMountedRun && component.proxy.preparingVideoLoadGeneration === null) }
        finally { await handle.dispose() }
      }, { timeout: 20000 }).toBe(true)
      const watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate((component, media) => {
        const watch = component.proxy
        watch.videoLoadGeneration++
        Object.assign(watch, {
          isLoading: false, ytDlpStreamsPending: false, errorMessage: null, isUpcoming: false,
          isLive: false, localFilePlayback: true, activeFormat: 'legacy',
          videoTitle: 'Device handoff fixture', videoLengthSeconds: 60,
          legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm', width: 320,
            height: 180, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
        })
      }, media)
      await watch.dispose()
      const tabId = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTabId)
      const video = page.locator(`.tabContent[data-tab-id="${tabId}"] .ftVideoPlayer video`)
      await expect.poll(() => video.evaluate(element => element.readyState)).toBe(4)
      return video
    }
    const video = await preparePlayer()
    await video.evaluate(element => { element.pause(); element.currentTime = 4.75 })
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getCurrentWatchTimestamp)).toBe(4.75)
    await page.getByRole('button', { name: /^Tab Organizer:/ }).click()
    await page.getByRole('tablist', { name: 'Tab Organizer', exact: true }).getByRole('tab', { selected: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open on another device', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Test laptop', exact: true }).click()
    await expect.poll(() => !!sent).toBe(true)
    const request = await decryptSyncDocument(sent.payload, key)
    assert.equal(request.position, 4.75)
    assert.equal(request.videoId, 'jNQXAC9IVRw')
    const received = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.state.settings.syncServerDeviceId = 'laptop'
      store.commit('upsertToHistoryCache', { videoId: 'jNQXAC9IVRw', watchProgress: 1 })
      const tabIds = store.getters.getTabs.map(tab => tab.id)
      await store.dispatch('refreshSyncServerEvents')
      return store.getters.getTabs.find(tab => !tabIds.includes(tab.id))
    })
    assert.match(received.route.fullPath, /timestamp=4(?:&|$)/)
    await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${received.id}"]`).click()
    const resumed = await preparePlayer()
    await expect.poll(() => resumed.evaluate(element => Math.floor(element.currentTime))).toBe(4)
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTab.route.query.timestamp)).toBeUndefined()
    // Reuse this tab for a new video whose player has not loaded yet.
    const previousPayload = sent.payload
    await page.evaluate(() => { location.hash = '#/watch/aqz-KE-bpKQ' })
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTab.route.path)).toBe('/watch/aqz-KE-bpKQ')
    await page.evaluate(() => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings.syncServerDeviceId = 'phone'
    })
    await page.getByRole('button', { name: /^Tab Organizer:/ }).click()
    await page.getByRole('tablist', { name: 'Tab Organizer', exact: true }).getByRole('tab', { selected: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open on another device', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Test laptop', exact: true }).click()
    await expect.poll(() => sent.payload !== previousPayload).toBe(true)
    const nextVideo = await decryptSyncDocument(sent.payload, key)
    assert.equal(nextVideo.videoId, 'aqz-KE-bpKQ')
    assert.equal(nextVideo.position, 0)
    await organizer.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.state.settings.rememberHistory = true
      store.commit('upsertToHistoryCache', { videoId: 'aqz-KE-bpKQ', watchProgress: 30 })
      location.hash = '#/watch/aqz-KE-bpKQ?timestamp=0'
    })
    const restarted = await preparePlayer()
    await expect.poll(() => restarted.evaluate(element => element.currentTime)).toBe(0)
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTab.route.query.timestamp)).toBeUndefined()
    const restartedWatch = await page.evaluateHandle(findWatchComponent)
    try {
      await expect.poll(() => restartedWatch.evaluate(component => component.proxy.historyEntry.watchProgress)).toBe(0)
      assert.equal(await restartedWatch.evaluate(component => component.proxy.startTimeSeconds), null)
    } finally {
      await restartedWatch.dispose()
    }
  } finally {
    if (saved) {
      const organizer = page.locator('#capacitor-phone-tab-dialog')
      if (!await organizer.isVisible()) await page.getByRole('button', { name: /^Tab Organizer:/ }).click()
      const addedIds = await page.evaluate(ids => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getTabs
        .filter(tab => !ids.includes(tab.id)).map(tab => tab.id), saved.tabIds)
      for (const id of addedIds) {
        await page.locator('.capacitorPhoneTabRow').filter({ has: page.locator(`[data-tab-id="${id}"]`) }).locator('.capacitorPhoneTabClose').click()
      }
      await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${saved.activeTabId}"]`).click()
      await page.evaluate(saved => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        Object.assign(store.state.settings, saved.settings)
        Object.assign(store.state.syncServer, saved.sync)
        store.commit('setHistoryCacheSorted', saved.history)
        store.commit('setHistoryCacheById', Object.fromEntries(saved.history.map(entry => [entry.videoId, entry])))
        window.Capacitor.nativePromise = window.__handoffNative
        window.fetch = window.__handoffFetch
        location.hash = saved.route
      }, saved)
    }
    await browser.close()
  }
})
