import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator with its WebView
// socket forwarded to ANDROID_CDP_URL.
test('Android swaps cached recommendations for saved thumbnails on disconnect and restores them on reconnect', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const ids = [Date.now(), Date.now() + 1]
  let saved
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) await tutorial.locator('.tutorialActions').getByRole('button').last().click()
    saved = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { VideoPlaybackEngine: 'built-in', AutoplayVideos: false, UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false, HideRecommendedVideos: false, CapacitorLayoutMode: 'phone',
        ThumbnailPreference: '', BlurThumbnails: false }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      const downloads = structuredClone(Object.values(store.getters.getYtDlpDownloads).map(download => JSON.parse(JSON.stringify(download))))
      const queue = JSON.parse(JSON.stringify(store.getters.getWatchQueue))
      window.__offlineRecommendationsOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine')
      window.__offlineRecommendationsFetch = window.fetch
      return { route: location.hash, settings, downloads, queue, values }
    })
    await page.evaluate(({ downloads, values }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('clearWatchQueue')
      for (const download of downloads) store.commit('removeYtDlpDownload', download.id)
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__offlineRecommendationsFetch(url, options) : Promise.reject(new Error('Offline recommendations test'))
      location.hash = '#/watch/jNQXAC9IVRw'
    }, saved)
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try {
        return await handle.evaluate(component => !!component && component.proxy.onMountedRun &&
          component.proxy.preparingVideoLoadGeneration === null && component.proxy.isCurrentlyPresented())
      } finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const thumbnail = `data:image/svg+xml;base64,${(await readFile(new URL('../../e2e/fixtures/media/video-thumbnail.svg', import.meta.url))).toString('base64')}`
    await watch.evaluate((component, { ids, thumbnail }) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, { isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
        isOffline: false, localFilePlayback: false, isUpcoming: false, isLive: false,
        videoTitle: 'Offline recommendations regression', channelName: 'Test channel',
        recommendedVideos: [{ videoId: 'online00001', title: 'Online recommendation', author: 'Online channel',
          authorId: 'UC-online', lengthSeconds: 60, viewCount: 123, published: Date.now(), type: 'video' }] })
      for (const [index, id] of ids.entries()) watch.$store.commit('upsertYtDlpDownload', {
        id, videoId: index === 1 ? '' : `saved00000${index}`, title: `Saved audio ${index + 1}`, author: 'Offline channel',
        ...(index === 1 ? { retryPayload: { externalUrl: 'https://example.com/video' } } : {}),
        status: 'completed', mode: 'audio', thumbnail,
        files: [{ videoId: `saved00000${index}`, ...(index === 1 ? { title: 'Saved audio 2' } : {}), path: '/test.mp3', extension: 'mp3', available: true }],
      })
    }, { ids, thumbnail })
    const recommendations = page.locator('.watchVideoRecommendations')
    await expect(recommendations.getByRole('heading', { name: 'Up Next', exact: true })).toBeVisible()
    await recommendations.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(recommendations.getByRole('heading', { name: 'Available offline', exact: true })).toBeVisible()
    await expect(recommendations.locator('.offlineDownloadTitle')).toHaveText(['Saved audio 2', 'Saved audio 1'])
    for (const image of await recommendations.locator('img').all()) await expect(image).toHaveAttribute('src', thumbnail)
    await expect.poll(() => recommendations.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    assert.equal(await watch.evaluate(component => component.proxy.fullscreenRecommendationsAvailable), true)
    if (process.env.ANDROID_RECOMMENDATIONS_SCREENSHOT) await recommendations.screenshot({ path: process.env.ANDROID_RECOMMENDATIONS_SCREENSHOT })
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setThumbnailPreference', 'hidden'))
    await expect.poll(() => recommendations.locator('img').evaluateAll(images => images.length === 2 && images.every(image => image.src.includes('thumbnail_placeholder.svg')))).toBe(true)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setThumbnailPreference', '')
      store.commit('setBlurThumbnails', true)
    })
    await expect.poll(() => recommendations.locator('img').evaluateAll(images => images.length === 2 && images.every(image => getComputedStyle(image).filter.includes('blur(')))).toBe(true)
    await page.evaluate(() => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setBlurThumbnails', false)
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(recommendations.getByRole('heading', { name: 'Up Next', exact: true })).toBeVisible()
    await expect(recommendations.locator('.h3Title')).toHaveText(['Online recommendation'])
  } finally {
    await watch?.dispose()
    if (saved) await page.evaluate(({ saved, ids }) => {
      document.querySelector('video')?.pause()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const id of ids) store.commit('removeYtDlpDownload', id)
      for (const download of saved.downloads) store.commit('upsertYtDlpDownload', download)
      store.state.watchQueue.items.splice(0, store.state.watchQueue.items.length, ...saved.queue)
      for (const [key, value] of Object.entries(saved.settings)) store.commit('set' + key, value)
      if (window.__offlineRecommendationsOnline) Object.defineProperty(navigator, 'onLine', window.__offlineRecommendationsOnline)
      else delete navigator.onLine
      window.fetch = window.__offlineRecommendationsFetch
      delete window.__offlineRecommendationsOnline
      delete window.__offlineRecommendationsFetch
      window.dispatchEvent(new Event(navigator.onLine ? 'online' : 'offline'))
      location.hash = saved.route
    }, { saved, ids })
    await browser.close()
  }
})
