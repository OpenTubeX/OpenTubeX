import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'
import { blockAppNetwork, connectAndroidApp } from '../helpers/android-webview.mjs'

// Run with a current debug APK on a locked emulator and its WebView socket
// forwarded to ANDROID_CDP_URL. The Pixel also exposed this on WebView 155.
test('Android excludes the hidden browsing page from the watch scroll range', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const { browser, page } = await connectAndroidApp()
  let saved
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
    await blockAppNetwork(page)
    saved = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false,
        HideRecommendedVideos: true,
        KeepPlayingOnNavigation: true,
        CapacitorLayoutMode: 'phone',
        UiScale: 100,
        AiVideoSummaryMode: 'expanded',
      }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      const route = location.hash
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      location.hash = '#/history'
      return { route, settings }
    })
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
    // Model a long feed without changing the device's saved history.
    await page.evaluate(() => {
      const content = document.createElement('div')
      content.id = 'watch-scroll-history-fixture'
      content.style.height = '4000px'
      // The page that Back returns to stays mounted before the current one.
      document.querySelector('.tabContent[aria-hidden="false"] > .routerView:not(.retainedPage)').append(content)
      scrollTo(0, document.scrollingElement.scrollHeight)
      location.hash = '#/watch/jNQXAC9IVRw'
    })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try {
        return await handle.evaluate(component => !!component && component.proxy.onMountedRun &&
          component.proxy.preparingVideoLoadGeneration === null && component.proxy.isCurrentlyPresented())
      } finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((component, media) => {
      const view = component.proxy
      view.videoLoadGeneration++
      Object.assign(view, {
        isLoading: false,
        ytDlpStreamsPending: false,
        errorMessage: null,
        isUpcoming: false,
        isLive: false,
        localFilePlayback: true,
        activeFormat: 'legacy',
        videoTitle: 'Watch page scroll regression',
        channelName: 'Test channel',
        videoLengthSeconds: 60,
        videoDescription: 'The page ends after this video’s details.',
        videoSummary: ['A detailed summary of the video. '.repeat(18)],
        legacyFormats: [{
          itag: 0,
          mimeType: 'video/webm',
          qualityLabel: 'Test',
          localFile: true,
          width: 320,
          height: 180,
          bitrate: 0,
          url: `data:video/webm;base64,${media}`
        }],
      })
    }, media)
    const video = page.locator('.ftVideoPlayer video')
    await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 15000 }).toBe(4)
    await video.evaluate(element => { element.loop = true; return element.play() })
    await expect(page.locator('.browsingBehindWatch #watch-scroll-history-fixture')).toHaveCount(1)
    for (const offline of [false, true]) {
      await watch.evaluate((component, offline) => { component.proxy.isOffline = offline }, offline)
      await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight))
      await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollHeight - Math.max(
        innerHeight, document.querySelector('.app').getBoundingClientRect().bottom + scrollY
      ))).toBeLessThanOrEqual(1)
      await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/scrollMiniPlayerAnimating/)
    }
    if (process.env.ANDROID_WATCH_SCROLL_SCREENSHOT) {
      await page.screenshot({ path: process.env.ANDROID_WATCH_SCROLL_SCREENSHOT })
    }
  } finally {
    if (saved) {
      await page.evaluate(({ settings, route }) => {
        document.querySelector('video')?.pause()
        document.querySelector('#watch-scroll-history-fixture')?.remove()
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (const [key, value] of Object.entries(settings)) store.commit('set' + key, value)
        window.__androidTestNetwork?.restore()
        location.hash = route
      }, saved)
    }
    await watch?.dispose()
    await browser.close()
  }
})
