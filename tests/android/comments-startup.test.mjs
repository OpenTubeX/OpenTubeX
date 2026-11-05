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
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false, HideComments: false, VideoDescriptionMode: 'collapsed', BackendFallback: false,
        GeneralAutoLoadMorePaginatedItemsEnabled: true, FullscreenActions: ['comments'],
        PlayingInterfaceHideDelay: 30, RotateFullscreenToLandscape: false, EnterFullscreenOnDisplayRotate: false,
        ShowPlayerControlsWhenPaused: true, ShowFullscreenActionsWhenPaused: true }
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
        if ((plugin === 'CapacitorHttp' || plugin === 'AndroidHttp') && method === 'request') {
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
      await page.evaluate(mockNativeRequests)
      await expect(page.locator('.phoneCommentDot')).toHaveCount(5, { timeout: 60_000 })
      assert.deepEqual(errors, [], 'Restoring the video must mount every phone panel without Vue render errors')
      await page.locator('.phoneCommentsOpen').click()
      await expect(page.locator('.mobileSheet[open] .comment').first()).toBeVisible()
      const sheet = page.locator('.mobileSheet[open]')
      const reload = sheet.getByRole('button', { name: 'Reload Comments', exact: true })
      await expect(reload).toHaveCount(1)
      let responseMode = 'incomplete'
      const nextRequest = /\/youtubei\/v1\/next/
      await page.route(nextRequest, (route, request) => {
        if (!JSON.parse(request.postData() ?? '{}').continuation || responseMode === 'loaded') return route.fallback()
        const data = responseMode === 'incomplete' ? {} : {
          onResponseReceivedEndpoints: [
            { reloadContinuationItemsCommand: { targetId: 'comments-section', continuationItems: [
              { commentsHeaderRenderer: { countText: { simpleText: '0 Comments' } } }
            ] } },
            { reloadContinuationItemsCommand: { targetId: 'comments-section', continuationItems: [] } }
          ]
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      })
      await reload.click()
      await expect(sheet.locator('.getCommentsTitle')).toBeVisible({ timeout: 30_000 })
      await expect(sheet.locator('.noCommentMsg')).toHaveCount(0)
      responseMode = 'empty'
      await sheet.locator('.getCommentsTitle').click()
      await expect(sheet.locator('.noCommentMsg')).toHaveText('There are no comments available for this video', { timeout: 30_000 })
      await expect(reload).toHaveCount(1)
      await expect(sheet.getByRole('button', { name: /^sort by$/i })).toHaveCount(1)
      await expect(sheet.locator('.noCommentActions')).toHaveCount(0)
      if (process.env.ANDROID_ARTIFACT_DIR) await sheet.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/empty-comments.png` })
      responseMode = 'loaded'
      await reload.click()
      await expect(sheet.locator('.comment').first()).toBeVisible({ timeout: 30_000 })
      await page.unroute(nextRequest)
      if (process.env.ANDROID_ARTIFACT_DIR) await sheet.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/restored-comments.png` })
      await page.locator('.mobileSheet[open]').getByRole('button', { name: 'Close', exact: true }).click()
      await page.locator('.phoneDescriptionPreview').click()
      await expect(page.locator('.mobileSheet[open] .videoDescription')).toBeVisible()
      if (process.env.ANDROID_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/restored-description.png` })
      await page.locator('.mobileSheet[open]').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.locator('.mobileSheet[open]')).toHaveCount(0)
      const miniPlayerReturn = page.locator('.mobileMiniBarReturn')
      if (await miniPlayerReturn.isVisible()) await miniPlayerReturn.click()
      await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/mobileMiniBar/)
      watch = await page.evaluateHandle(findWatchComponent)
      await page.locator('.ftVideoPlayer').evaluate(element => element.requestFullscreen())
      await expect.poll(() => page.locator('.ftVideoPlayer').evaluate(element => document.fullscreenElement === element)).toBe(true)
      await page.mouse.move(0, 0)
      const controls = page.locator('.shaka-controls-container')
      if (await controls.getAttribute('shown') !== 'true') {
        const playerBounds = await page.locator('.ftVideoPlayer').boundingBox()
        await initScript.send('Input.dispatchTouchEvent', {
          type: 'touchStart', touchPoints: [{ x: playerBounds.x + playerBounds.width / 2, y: playerBounds.y + playerBounds.height * 0.35 }]
        })
        await initScript.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }
      await expect(controls).toHaveAttribute('shown', 'true')
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
