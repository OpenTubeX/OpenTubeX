import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'
import { mockWatchPage } from '../../e2e/helpers/watch.mjs'

// Run with a current debug APK on an exclusively locked emulator, forwarding
// its WebView socket to ANDROID_CDP_URL.
test('restored Android Watch tabs retain comment previews and both panel entry points', {
  skip: !process.env.ANDROID_CDP_URL,
  timeout: 180_000,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const errors = []
  const recordError = message => {
    if (message.type() === 'error' && message.text().includes('failed to render')) errors.push(message.text())
  }
  let saved
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { StartupBehavior: 'loadLastActiveTab', VideoPlaybackEngine: 'built-in', AutoplayVideos: false,
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false, HideComments: false, HideVideoDescription: false,
        GeneralAutoLoadMorePaginatedItemsEnabled: true, FullscreenActions: ['comments'],
        PlayingInterfaceHideDelay: 30, RotateFullscreenToLandscape: false }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, JSON.parse(JSON.stringify(store.getters['get' + key]))]))
      for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
      return { settings, route: location.hash }
    })
    await mockWatchPage({ electronApp: { evaluate: async () => {} } }, page, { playable: true })
    await page.route('https://localhost/**', route => route.continue())
    // Route native HTTP through the same recorded responses as Electron tests.
    // Reinstall after reload, before the restored tab starts fetching metadata.
    function mockNativeRequests() {
      const original = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = async function(plugin, method, options, ...rest) {
        if (plugin === 'PoToken' && method === 'generate') return { token: 'test-po-token' }
        if (plugin === 'CapacitorHttp' && method === 'request') {
          const response = await fetch(options.url, { method: options.method, headers: options.headers, body: options.data })
          return { status: response.status, headers: Object.fromEntries(response.headers), data: await response.text(), url: options.url }
        }
        return original.call(this, plugin, method, options, ...rest)
      }
    }
    await page.evaluate(mockNativeRequests)
    const initScript = await page.context().newCDPSession(page)
    const { identifier } = await initScript.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `document.addEventListener('DOMContentLoaded', ${mockNativeRequests.toString()}, { once: true })`
    })
    try {
      await page.evaluate(() => { location.hash = '#/watch/jNQXAC9IVRw' })
      await expect(page.locator('.phoneCommentsOpen')).toBeVisible({ timeout: 60_000 })
      page.on('console', recordError)
      await page.reload()
      await expect(page.locator('.phoneCommentDot')).toHaveCount(5, { timeout: 60_000 })
      assert.deepEqual(errors, [], 'Restoring the video must mount every phone panel without Vue render errors')
      await page.locator('.phoneCommentsOpen').click()
      await expect(page.locator('.mobileSheet[open] .comment').first()).toBeVisible()
      if (process.env.ANDROID_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/restored-comments.png` })
      await page.locator('.mobileSheet[open]').getByRole('button', { name: 'Close', exact: true }).click()
      await page.locator('.phoneDescriptionPreview').click()
      await expect(page.locator('.mobileSheet[open] .videoDescription')).toBeVisible()
      if (process.env.ANDROID_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/restored-description.png` })
      await page.locator('.mobileSheet[open]').getByRole('button', { name: 'Close', exact: true }).click()
      watch = await page.evaluateHandle(findWatchComponent)
      await page.locator('.ftVideoPlayer').evaluate(element => element.requestFullscreen())
      await page.locator('.fullscreenCommentsToggle').click()
      await expect(page.locator('.fullscreenCommentCard .comment').first()).toBeVisible()
      await watch.evaluate(component => component.proxy.$refs.player.setFullscreenMetadata(true))
      await expect(page.locator('.fullscreenMetadataTarget .videoDescription')).toBeVisible()
      assert.deepEqual(errors, [])
    } finally {
      await initScript.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
      await initScript.detach()
    }
  } finally {
    page.off('console', recordError)
    if (saved) await page.evaluate(async ({ settings, route }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      document.querySelectorAll('video').forEach(video => video.pause())
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings)) await store.dispatch('update' + key, value)
      location.hash = route
    }, saved)
    await page.unrouteAll({ behavior: 'wait' })
    await page.reload()
    await watch?.dispose()
    await browser.close()
  }
})
