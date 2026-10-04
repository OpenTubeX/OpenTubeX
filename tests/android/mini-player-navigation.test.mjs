import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run on a locked emulator with a current debug APK, ANDROID_SERIAL, and
// ANDROID_CDP_URL pointing to its forwarded WebView socket.
const skip = !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL
const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', ...args], { encoding: 'utf8' }).trim()

async function withMobileVideo(run) {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const session = await page.context().newCDPSession(page)
  const tap = async (locator, position = null) => {
    const box = await locator.boundingBox()
    assert.ok(box, 'Touch target must have a visible bounding box')
    const point = { x: box.x + (position?.x ?? box.width / 2), y: box.y + (position?.y ?? box.height / 2) }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const originalRoute = await page.evaluate(() => location.hash)
  const rotation = adb('settings', 'get', 'system', 'user_rotation')
  const automaticRotation = adb('settings', 'get', 'system', 'accelerometer_rotation')
  let settings
  let watch
  try {
    adb('settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('settings', 'put', 'system', 'user_rotation', '0')
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in', AutoplayVideos: false,
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
        KeepPlayingOnNavigation: true, ScrollMiniPlayerEnabled: true,
        CapacitorLayoutMode: 'phone', UiScale: 100, HideComments: false,
        BackendPreference: 'invidious', BackendFallback: false,
        RotateFullscreenToLandscape: false, EnterFullscreenOnDisplayRotate: false,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__miniNavigationFetch = window.fetch
      window.fetch = (url, options) => {
        if (String(url).includes('/api/v1/comments/')) {
          return Promise.resolve(new Response(JSON.stringify({
            commentCount: 1, comments: [{
              commentId: 'test-comment', author: 'Test commenter', authorId: 'UC-test-commenter',
              authorThumbnails: [], content: 'Test comment', contentHtml: 'Test comment',
              likeCount: 0, published: 1700000000,
            }],
          }), { headers: { 'Content-Type': 'application/json' } }))
        }
        return String(url).startsWith('https://localhost/')
          ? window.__miniNavigationFetch(url, options) : Promise.reject(new Error('Offline navigation test'))
      }
      const style = document.createElement('style')
      style.id = 'mini-navigation-test-style'
      style.textContent = '.tutorialOverlay { display: none !important; }'
      document.head.append(style)
      location.hash = '#/watch/jNQXAC9IVRw'
      return saved
    })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try { return await handle.evaluate(component => !!component && component.proxy.onMountedRun && component.proxy.preparingVideoLoadGeneration === null) }
      finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((component, media) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
        isUpcoming: false, isLive: false, localFilePlayback: false, activeFormat: 'legacy',
        isOffline: false, channelId: 'UC-test-channel', channelName: 'Test channel',
        videoTitle: 'Mini-player navigation test', videoLengthSeconds: 60,
        legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
          width: 320, height: 180, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
      })
    }, media)
    const player = page.locator('.ftVideoPlayer')
    await expect.poll(() => player.locator('video').evaluate(video => video.readyState)).toBe(4)
    await player.locator('video').evaluate(video => { video.loop = true; return video.play() })
    await run({ page, player, watch, tap })
  } finally {
    try {
      await page.evaluate(async ({ settings, originalRoute }) => {
        if (document.fullscreenElement) await document.exitFullscreen()
        document.querySelector('.ftVideoPlayer video')?.pause()
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setKeepPlayingOnNavigation', false)
        location.hash = originalRoute
        for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
        if (window.__miniNavigationFetch) window.fetch = window.__miniNavigationFetch
        delete window.__miniNavigationFetch
        document.querySelector('#mini-navigation-test-style')?.remove()
      }, { settings, originalRoute })
    } finally {
      try {
        adb('settings', 'put', 'system', 'user_rotation', rotation)
        adb('settings', 'put', 'system', 'accelerometer_rotation', automaticRotation)
      } finally {
        try {
          await watch?.dispose()
        } finally {
          try {
            await session.detach()
          } finally {
            await browser.close()
          }
        }
      }
    }
  }
}

test('fullscreen comment avatar navigation opens the channel and docks the same playing video', { skip }, () => withMobileVideo(async ({ page, player, watch, tap }) => {
  const original = await player.locator('video').elementHandle()
  await player.evaluate(element => element.requestFullscreen())
  await watch.evaluate(component => component.proxy.$refs.player.$.setupState.setFullscreenComments(true))
  const avatar = player.locator('.fullscreenCommentCard a[tabindex="-1"]').first().locator('.commentThumbnail, .commentThumbnailHidden').first()
  await expect(avatar).toBeVisible()
  await tap(avatar)
  await expect(page).toHaveURL(/#\/channel\/UC-test-commenter/)
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(player).not.toHaveClass(/fullWindow/)
  await expect(player).toHaveClass(/mobileMiniBar/)
  await expect(player).toBeVisible()
  assert.equal(await original.evaluate(video => video.isConnected && !video.paused), true)
  await expect.poll(() => player.evaluate(element => element.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true)
  await tap(player.locator('.mobileMiniBarReturn'), { x: 60, y: 30 })
  await expect(page).toHaveURL(/#\/watch\//)
  await expect(player).not.toHaveClass(/scrollMiniPlayer/)
  await original.dispose()
}))

test('landscape mini-player clears the sidebar after rotation and UI scaling', { skip }, () => withMobileVideo(async ({ page, player, watch }) => {
  await watch.evaluate(component => component.proxy.tabRouter.push('/subscriptions'))
  await expect(player).toHaveClass(/mobileMiniBar/)
  for (const scale of [100, 125]) {
    await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale), scale)
    for (const rotation of ['1', '0', '1']) {
      adb('settings', 'put', 'system', 'user_rotation', rotation)
      await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(rotation === '1')
      await expect.poll(() => player.evaluate(element => {
        const bar = element.getBoundingClientRect()
        const nav = document.querySelector('.app > .sideNav').getBoundingClientRect()
        const tolerance = 2 / devicePixelRatio
        return window.innerWidth <= 680 ? bar.bottom <= nav.top + tolerance : bar.left >= nav.right - tolerance
      })).toBe(true)
    }
  }
}))
