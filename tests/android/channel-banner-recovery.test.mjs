import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Run against a current debug APK on a locked emulator with its WebView socket
// forwarded to ANDROID_CDP_URL. Only the native transport response is mocked.
test('Android Invidious banners recover through the selected proxy after WebView failure', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const instance = 'https://invidious.test'
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const bannerUrl = `${instance}/ggpht/banner`
  const data = (await readFile(new URL('../../e2e/fixtures/images/opentubex-playlist.jpg', import.meta.url))).toString('base64')
  const nativeRequests = []
  let browserRequests = 0
  let saved
  try {
    await page.locator('.profileTrigger').waitFor()
    await page.route(`${instance}/api/v1/channels/**`, route => route.fulfill({ json: {
      author: 'Banner channel', authorId: channelId, authorThumbnails: [],
      authorBanners: [{ url: 'https://yt3.ggpht.com/banner' }], description: '',
      subCount: 10, totalViews: 0, joined: 0, tabs: ['videos'],
      relatedChannels: [], videos: [], latestVideos: []
    } }))
    await page.route(`${bannerUrl}*`, route => {
      browserRequests++
      return route.abort()
    })
    await page.exposeBinding('__bannerNativeRequest', (_source, options) => {
      nativeRequests.push(options)
      return { status: 200, url: options.url, headers: { 'content-type': 'image/jpeg' }, data }
    })
    saved = await page.evaluate(instance => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const saved = { settings: { ...store.state.settings }, instance: store.getters.getCurrentInvidiousInstance, route: location.hash }
      Object.assign(store.state.settings, { backendPreference: 'invidious', backendFallback: false, currentLocale: 'en-US' })
      store.commit('setCurrentInvidiousInstance', instance)
      window.__bannerNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = (plugin, method, options) => (
        plugin === 'CapacitorHttp' && method === 'request' && options.url === `${instance}/ggpht/banner`
          ? window.__bannerNativeRequest(options)
          : window.__bannerNativePromise(plugin, method, options)
      )
      return saved
    }, instance)
    await page.evaluate(channelId => { location.hash = `#/channel/${channelId}` }, channelId)
    await expect(page.locator('.channelDetails:visible .name')).toHaveText('Banner channel')
    await expect.poll(() => nativeRequests.length).toBe(1)
    assert.equal(nativeRequests[0].url, bannerUrl)
    assert.equal(nativeRequests[0].disableRedirects, true)
    assert.equal(nativeRequests[0].responseType, 'blob')
    const image = page.locator('.bannerContainer:visible img').first()
    await expect(image).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
    await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect(image).toBeVisible()
    assert.equal(browserRequests, 1, 'native success must not retry the blocked WebView request')
    await expect(page.locator('.bannerContainer:visible')).not.toHaveClass(/default/)
  } finally {
    if (saved) await page.evaluate(saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      Object.assign(store.state.settings, saved.settings)
      store.commit('setCurrentInvidiousInstance', saved.instance)
      location.hash = saved.route
      window.Capacitor.nativePromise = window.__bannerNativePromise
      delete window.__bannerNativePromise
    }, saved)
    await page.unroute(`${instance}/api/v1/channels/**`)
    await page.unroute(`${bannerUrl}*`)
    await browser.close()
  }
})
