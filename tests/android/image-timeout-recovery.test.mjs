import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Run with a current debug APK on a locked emulator and its WebView forwarded
// to ANDROID_CDP_URL. Native HTTP responses use a deterministic transport fixture.
test('Android stalled avatars use native recovery before the bounded browser retry', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const avatarPattern = 'https://yt3.ggpht.com/opentubex-timeout-avatar*'
  const data = (await readFile(new URL('../../e2e/fixtures/images/opentubex-playlist.jpg', import.meta.url))).toString('base64')
  const pending = []
  const nativeRequests = []
  let nativeOutcome = true
  let finishNative
  let saved
  try {
    await page.locator('.profileTrigger').waitFor()
    await page.route(avatarPattern, async route => {
      pending.push(route)
      if (nativeOutcome === 'delayed' && route.request().url().includes('opentubex_retry=')) await route.abort()
    })
    await page.exposeBinding('__timeoutAvatarRequest', (_source, options) => {
      nativeRequests.push(options)
      if (nativeOutcome === 'stall') return new Promise(() => {})
      if (!nativeOutcome) throw new Error('Native fixture failure')
      const response = { status: 200, headers: { 'content-type': 'image/jpeg' }, data, url: options.url }
      if (nativeOutcome === 'delayed') return new Promise(resolve => { finishNative = () => resolve(response) })
      return response
    })
    saved = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const saved = { settings: { ...store.state.settings }, route: location.hash }
      Object.assign(store.state.settings, {
        currentLocale: 'en-US', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', mainColor: 'Red', secColor: 'Blue'
      })
      window.__timeoutAvatarNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = (plugin, method, options) => (
        plugin === 'CapacitorHttp' && method === 'request' && options.url.startsWith('https://yt3.ggpht.com/opentubex-timeout-avatar')
          ? window.__timeoutAvatarRequest(options)
          : window.__timeoutAvatarNativePromise(plugin, method, options)
      )
      return saved
    })
    await page.clock.install()
    for (const succeeds of [true, false, 'stall', 'delayed']) {
      nativeOutcome = succeeds
      pending.length = 0
      nativeRequests.length = 0
      await page.evaluate(succeeds => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const query = `native-avatar-${succeeds}`
        store.commit('addToSessionSearchHistory', {
          query,
          data: [{ type: 'channel', dataSource: 'local', name: 'Native avatar recovery', id: query, thumbnail: `https://yt3.ggpht.com/opentubex-timeout-avatar?case=${succeeds}` }],
          searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
          nextPageRef: null, hasMoreResults: false, apiUsed: 'local'
        })
        location.hash = `#/search/${query}`
      }, succeeds)
      const avatar = page.locator(`.ft-list-channel .channelThumbnailLink[href$="/channel/native-avatar-${succeeds}"]`)
      const placeholder = avatar.locator('.retryImagePlaceholder')
      const image = avatar.locator('img:not(.retryImagePlaceholder)')
      await expect.poll(() => pending.length).toBe(1)
      await expect(placeholder).toHaveClass(/ft-shimmer/)
      const bounds = await placeholder.boundingBox()
      await page.clock.fastForward(10_001)
      await expect.poll(() => nativeRequests.length).toBe(1)
      assert.equal(nativeRequests[0].responseType, 'blob')
      assert.equal(nativeRequests[0].connectTimeout, 3000)
      assert.equal(nativeRequests[0].readTimeout, 3000)
      if (succeeds === 'delayed') {
        await page.clock.fastForward(4001)
        expect(pending).toHaveLength(1)
        finishNative()
      }
      if (succeeds === true || succeeds === 'delayed') {
        await expect(image).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
        await expect(placeholder).toHaveCount(0)
        await expect(image).toBeVisible()
        const loadedBounds = await image.boundingBox()
        for (const [key, value] of Object.entries(bounds)) expect(loadedBounds[key]).toBeCloseTo(value, 1)
        expect(pending).toHaveLength(1)
        const output = process.env.ANDROID_IMAGE_EVIDENCE_DIR ?? '/tmp/opentubex-native-avatar-evidence'
        await mkdir(output, { recursive: true })
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          await page.clock.runFor(100)
          await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
          await avatar.screenshot({ path: `${output}/native-avatar-${theme}.png` })
        }
      } else {
        await expect(placeholder).not.toHaveClass(/ft-shimmer/)
        if (succeeds === 'stall') {
          await page.clock.fastForward(6001)
          expect(pending).toHaveLength(1)
        }
        await page.clock.fastForward(3001)
        await expect.poll(() => pending.length).toBe(2)
        expect(pending[1].request().url()).toContain('opentubex_retry=')
        await pending[1].abort()
        await page.clock.fastForward(120_000)
        expect(pending).toHaveLength(2)
        expect(nativeRequests).toHaveLength(1)
        await expect(placeholder).not.toHaveClass(/ft-shimmer/)
      }
    }
  } finally {
    if (saved) await page.evaluate(saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      Object.assign(store.state.settings, saved.settings)
      location.hash = saved.route
      window.Capacitor.nativePromise = window.__timeoutAvatarNativePromise
      delete window.__timeoutAvatarNativePromise
      delete window.__timeoutAvatarRequest
    }, saved)
    await page.unroute(avatarPattern)
    await browser.close()
  }
})
