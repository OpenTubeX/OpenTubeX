import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent, mobileMiniPlayerRegions, mobileMiniPlayerReturnPoint } from '../../e2e/helpers/player.mjs'
import { mobileMiniPlayerBackdrop, resetMiniPlayerWork, stopTrackingMiniPlayerWork, trackMiniPlayerWork } from '../../e2e/helpers/mini-player-performance.mjs'

// Run against a current debug APK on a locked emulator, forwarding its WebView
// socket and setting ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port>.
for (const navigationOnly of [true, false]) {
  test(navigationOnly
    ? 'mobile mini-player preserves bottom navigation during swipes'
    : 'mobile mini-player restores from the whole bar, swipes down to close, and keeps controls separate', {
    skip: !process.env.ANDROID_CDP_URL,
  }, t => testMobileMiniPlayer(t, navigationOnly))
}

test('mobile mini-player dismissal animates swipes and the close button without reappearing', {
  skip: !process.env.ANDROID_CDP_URL,
}, t => testMobileMiniPlayer(t, false, { dismissalOnly: true }))

test('mobile mini-player animates an opaque backdrop in both directions without background work', {
  skip: !process.env.ANDROID_CDP_URL,
}, t => testMobileMiniPlayer(t, false, { animationOnly: true }))

test('mobile audio artwork stays visible during mini-player swipes and native picture-in-picture', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL,
}, t => testMobileMiniPlayer(t, false, { audioOnly: true }))

// Runs in the WebView for both browser screenshots and native PiP captures.
async function sampleAudioArtwork({ png, cropToSurface }) {
  const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const surface = document.querySelector('.ftVideoPlayer .musicAudioSurface')
  const rect = surface.getBoundingClientRect()
  const scale = devicePixelRatio * visualViewport.scale
  const pixels = cropToSurface
    ? context.getImageData(Math.round(rect.x * scale), Math.round(rect.y * scale),
      Math.max(1, Math.round(rect.width * scale)), Math.max(1, Math.round(rect.height * scale))).data
    : context.getImageData(0, 0, canvas.width, canvas.height).data
  let green = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] < 20 && pixels[i + 1] > 220 && pixels[i + 2] < 20) green++
  }
  return { green, rect: rect.toJSON(), scale, viewport: [innerWidth, innerHeight],
    artwork: surface.querySelector('.musicAudioArtwork').getBoundingClientRect().toJSON(),
    player: surface.parentElement.className }
}


test('ended mobile posters stay visible and 4:3 video restores without changing fit', {
  skip: !process.env.ANDROID_CDP_URL,
}, t => testMobileMiniPlayer(t, false, { posterOnly: true }))

for (const audioOnly of [false, true]) {
  for (const landscape of [false, true]) {
    test(`mobile ${audioOnly ? 'music artwork' : '4:3 video'} fills the mini thumbnail and restores its inline layout in ${landscape ? 'landscape' : 'portrait'}`, {
      skip: !process.env.ANDROID_CDP_URL || (landscape && !process.env.ANDROID_SERIAL),
    }, t => testMobileMiniPlayer(t, false, { audioOnly, posterOnly: !audioOnly, geometryOnly: true, landscape }))
  }
}

test('mobile music artwork placeholder fills the thumbnail and restores its inline layout', {
  skip: !process.env.ANDROID_CDP_URL,
}, t => testMobileMiniPlayer(t, false, { audioOnly: true, geometryOnly: true, artworkUnavailable: true }))

async function testMobileMiniPlayer(t, navigationOnly, { dismissalOnly = false, animationOnly = false, audioOnly = false, posterOnly = false, geometryOnly = false, landscape = false, artworkUnavailable = false } = {}) {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  let settings
  let watch
  const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', ...args], { encoding: 'utf8' }).trim()
  const rotation = landscape ? adb('settings', 'get', 'system', 'user_rotation') : null
  const automaticRotation = landscape ? adb('settings', 'get', 'system', 'accelerometer_rotation') : null
  const originalRoute = await page.evaluate(() => location.hash)
  try {
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(dismissalOnly => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in', AutoplayVideos: false, PlayNextVideo: false,
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
        KeepPlayingOnNavigation: true, ScrollMiniPlayerEnabled: true, CapacitorLayoutMode: 'phone',
        UiScale: dismissalOnly ? 125 : 100, ReducedMotion: 'off', AnimationSpeed: 100, EnableMobileFullscreenSwipe: false, RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false, PlayingInterfaceHideDelay: 5,
        MobileLeftSwipeAction: 'disabled', MobileRightSwipeAction: 'disabled',
        AmbientMode: true, AlwaysShowNavigationBar: false,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      store.dispatch('updateReducedMotion', 'off')
      window.__miniPlayerFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__miniPlayerFetch(url, options) : Promise.reject(new Error('Offline mini-player test'))
      const style = document.createElement('style')
      style.id = 'mini-player-test-style'
      style.textContent = '.tutorialOverlay { display: none !important; }'
      document.head.append(style)
      location.hash = '#/watch/jNQXAC9IVRw'
      return saved
    }, dismissalOnly)
    const media = (await readFile(new URL(posterOnly
      ? '../../e2e/fixtures/media/aspect-ratio-demo.webm'
      : '../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    const loadTestVideo = async () => {
      const previous = watch ? await watch.evaluate(component => ({
        uid: component.uid, generation: component.proxy.videoLoadGeneration,
      })) : null
      await page.evaluate(() => { location.hash = '#/watch/jNQXAC9IVRw' })
      await expect.poll(async () => {
        const handle = await page.evaluateHandle(findWatchComponent)
        try {
          return await handle.evaluate((component, previous) => !!component && component.proxy.onMountedRun && !component.proxy.isLoading &&
            component.proxy.preparingVideoLoadGeneration === null && component.proxy.isCurrentlyPresented() &&
            (!previous || component.uid !== previous.uid || component.proxy.videoLoadGeneration > previous.generation), previous)
        }
        finally { await handle.dispose() }
      }).toBe(true)
      await watch?.dispose()
      watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate((component, { media, audioOnly, posterOnly, artworkUnavailable }) => {
        const watch = component.proxy
        watch.videoLoadGeneration++
        Object.assign(watch, {
          isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
          isUpcoming: false, isLive: false, localFilePlayback: true, activeFormat: 'legacy',
          videoTitle: 'A long mini-player title with more room after removing the expand arrow', videoLengthSeconds: 60,
          musicMediaType: audioOnly ? 'audioTrack' : 'unknown',
          thumbnail: artworkUnavailable ? 'data:image/png;base64,broken' : audioOnly
            ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Cpath fill='lime' d='M0 0h320v180H0z'/%3E%3C/svg%3E"
            : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#326b8a"/></svg>'),
          legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
            width: 320, height: posterOnly ? 240 : 180, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
        })
      }, { media, audioOnly, posterOnly, artworkUnavailable })
      await expect(player).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect.poll(() => video.evaluate(video => video.readyState), { timeout: 15000 }).toBe(4)
      await watch.evaluate(component => { component.proxy.channelName = 'Mini-player test channel' })
      await video.evaluate(video => { video.loop = true; return video.play() })
    }
    await loadTestVideo()
    if (landscape) {
      adb('settings', 'put', 'system', 'accelerometer_rotation', '0')
      adb('settings', 'put', 'system', 'user_rotation', '1')
      await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(true)
    }
    const originalVideo = await video.elementHandle()
    const touch = (type, point) => session.send('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [point] : [],
    })
    if (geometryOnly) {
      const media = audioOnly ? player.locator(artworkUnavailable
        ? 'img.musicAudioArtwork.retryImagePlaceholder' : 'img.musicAudioArtwork:not(.retryImagePlaceholder)') : video
      const capture = async name => {
        if (process.env.ANDROID_ARTIFACT_DIR) {
          await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/${audioOnly ? 'music' : 'video'}-${landscape ? 'landscape' : 'portrait'}-${name}.png` })
        }
      }
      const settle = async () => {
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        await expect.poll(() => player.evaluate(element => element.getAnimations()
          .every(animation => animation.effect.getTiming().iterations === Infinity || animation.playState !== 'running'))).toBe(true)
      }
      for (const scale of [100, 125]) {
        await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale), scale)
        await settle()
        const inline = await media.boundingBox()
        const full = await player.boundingBox()
        await capture(`inline-${scale}`)
        const down = { x: full.x + 12, y: full.y + 12 }
        await touch('touchStart', down)
        for (const distance of [30, 80, 140]) await touch('touchMove', { ...down, y: down.y + distance })
        await touch('touchEnd')
        await expect(player).toHaveClass(/mobileMiniBar/)
        await settle()
        await capture(`mini-${scale}`)
        await t.test(`thumbnail fills its slot at ${scale}%`, async () => {
          const slot = await (audioOnly ? player.locator('.musicAudioSurface') : video).boundingBox()
          const thumbnail = await media.boundingBox()
          for (const side of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(thumbnail[side] - slot[side]) < 1, `thumbnail ${side}: ${thumbnail[side]} must match slot ${slot[side]}`)
          }
          await expect(media).toHaveCSS('object-fit', 'cover')
        })
        const bar = await player.locator('.mobileMiniBarReturn').boundingBox()
        const up = { x: bar.x + bar.width / 2, y: bar.y + 15 }
        await touch('touchStart', up)
        await touch('touchMove', { ...up, y: up.y - 30 })
        await touch('touchMove', { ...up, y: up.y - Math.abs(bar.y - full.y) })
        await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
        await capture(`restoring-${scale}`)
        await t.test(`restore reaches the inline media layout before release at ${scale}%`, async () => {
          const moving = await media.boundingBox()
          const movingPlayer = await player.boundingBox()
          for (const side of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(movingPlayer[side] - full[side]) < 1,
              `restore endpoint ${side}: ${JSON.stringify({ movingPlayer, full })}`)
          }
          for (const side of ['width', 'height']) {
            assert.ok(Math.abs(moving[side] / movingPlayer.width - inline[side] / full.width) < 0.02,
              `restoring ${side} must follow the inline media layout: ${JSON.stringify({ moving, movingPlayer, inline, full })}`)
          }
          for (const side of ['x', 'y']) {
            assert.ok(Math.abs((moving[side] - movingPlayer[side]) / movingPlayer.width -
              (inline[side] - full[side]) / full.width) < 0.02, `restoring ${side} must match the inline media position`)
          }
        })
        await touch('touchEnd')
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await settle()
        const restored = await media.boundingBox()
        for (const side of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(restored[side] - inline[side]) < 1, `restored ${side}: ${JSON.stringify({ restored, inline })}`)
        }
      }
      if (artworkUnavailable) {
        await t.test('artwork loading during a held swipe keeps the animated geometry', async () => {
          const full = await player.boundingBox()
          const down = { x: full.x + 12, y: full.y + 12 }
          await touch('touchStart', down)
          try {
            await touch('touchMove', { ...down, y: down.y + 80 })
            await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
            const fallback = await media.boundingBox()
            await watch.evaluate(component => {
              component.proxy.thumbnail = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="lime"/></svg>')
            })
            const loaded = player.locator('img.musicAudioArtwork:not(.retryImagePlaceholder)')
            await expect(media).toHaveCount(0)
            // No additional touch event: loading itself must repaint the morph.
            await expect.poll(() => loaded.evaluate(image => image.style.transform)).not.toBe('')
            const bounds = await loaded.boundingBox()
            for (const side of ['x', 'y', 'width', 'height']) {
              assert.ok(Math.abs(bounds[side] - fallback[side]) < 1, `loaded artwork preserves ${side} during the held swipe`)
            }
          } finally { await touch('touchEnd') }
          await settle()
        })
      }
      return
    }
    if (posterOnly) {
      const endVideo = async () => {
        await video.evaluate(element => { element.loop = false; element.currentTime = element.duration - 0.1; return element.play() })
        await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
      }
      const poster = player.locator('.endedPoster')
      for (const endBeforeMinimize of [true, false]) {
        if (endBeforeMinimize) await endVideo()
        const full = await player.boundingBox()
        const inlineVideo = await video.boundingBox()
        const down = { x: full.x + full.width / 2, y: full.y + 40 }
        await touch('touchStart', down)
        await touch('touchMove', { ...down, y: down.y + 100 })
        await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
        if (endBeforeMinimize) {
          await expect(poster).toBeVisible()
          // This 16:9 poster already fills the inline player and thumbnail;
          // inheriting the 4:3 video's cover scale would crop it on release.
          await expect(poster).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
        }
        await touch('touchEnd')
        await expect(player).toHaveClass(/mobileMiniBar/)
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        if (!endBeforeMinimize) await endVideo()
        await expect(poster).toBeVisible()
        await expect(poster.locator('img:not(.retryImagePlaceholder)')).toHaveCSS('opacity', '0.35')
        const bar = await player.locator('.mobileMiniBarReturn').boundingBox()
        const up = { x: bar.x + 40, y: bar.y + 30 }
        await touch('touchStart', up)
        await touch('touchMove', { ...up, y: up.y - 30 })
        await touch('touchMove', { ...up, y: up.y - Math.abs(bar.y - full.y) * 0.8 })
        await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
        await expect(poster).toBeVisible()
        await expect(video).toHaveCSS('object-fit', 'contain')
        const expandedVideo = await video.boundingBox()
        assert.ok(Math.abs(expandedVideo.width / expandedVideo.height - inlineVideo.width / inlineVideo.height) < 0.02)
        const posterBox = await poster.boundingBox()
        await expect(poster).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
        assert.ok(Math.abs(posterBox.x + posterBox.width / 2 - expandedVideo.x - expandedVideo.width / 2) < 2)
        assert.ok(Math.abs(posterBox.y + posterBox.height / 2 - expandedVideo.y - expandedVideo.height / 2) < 2)
        await touch('touchEnd')
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await expect(poster).toBeVisible()
        await video.evaluate(element => { element.loop = true; element.currentTime = 0; return element.play() })
        await expect(poster).toHaveCount(0)
      }
      return
    }
    const returnPoint = async region => {
      await expect.poll(() => player.evaluate(element =>
        element.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true)
      return player.evaluate(mobileMiniPlayerReturnPoint, region)
    }
    if (audioOnly) {
      const surface = player.locator('.musicAudioSurface')
      const artwork = surface.locator('img.musicAudioArtwork:not(.retryImagePlaceholder)')
      const assertArtwork = async () => {
        await expect(artwork).toBeVisible()
        const png = await page.screenshot()
        const painted = await page.evaluate(sampleAudioArtwork, { png: png.toString('base64'), cropToSurface: true })
        if (painted.green <= 10 && process.env.ANDROID_ARTIFACT_DIR) {
          await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/audio-artwork-failure.png` })
        }
        assert.ok(painted.green > 10, `the artwork must paint above the browsing page: ${JSON.stringify(painted)}`)
      }
      for (const scale of [100, 125]) {
        await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale), scale)
        for (const restoring of [false, true]) {
          const box = await (restoring ? player.locator('.mobileMiniBarReturn') : player).boundingBox()
          const point = restoring
            ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            : { x: box.x + 12, y: box.y + 12 }
          const direction = restoring ? -1 : 1
          await touch('touchStart', point)
          try {
            for (const distance of [30, 80, 120]) {
              await touch('touchMove', { ...point, y: point.y + direction * distance })
              await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
              await assertArtwork()
            }
          } finally { await touch('touchEnd') }
          await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
          await assertArtwork()
        }
      }
      // The native window crops the actual WebView; a DOM visibility assertion
      // alone cannot prove that Android painted the artwork on the launcher.
      await player.locator('.shaka-pip-button').first().evaluate(button => button.click())
      await expect(page.locator('body')).toHaveClass(/androidPictureInPicture/)
      try {
        await expect.poll(() => {
          const tasks = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', 'dumpsys', 'activity', 'activities'], { encoding: 'utf8' })
          return /mInPictureInPictureMode=true|mWindowingMode=pinned|Stack #4:\s+mFullscreen=false/.test(tasks)
        }).toBe(true)
        await expect(artwork).toBeVisible()
        await expect.poll(async () => {
          const png = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 * 1024 * 1024 })
          const painted = await page.evaluate(sampleAudioArtwork, { png: png.toString('base64'), cropToSurface: false })
          return painted.green
        }, { timeout: 10000 }).toBeGreaterThan(100)
      } finally {
        execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity'])
        await expect(page.locator('body')).not.toHaveClass(/androidPictureInPicture(?:\s|$)/)
      }
      return
    }
    if (navigationOnly) {
      const nav = page.locator('.app > .sideNav')
      const settle = async () => {
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        await expect.poll(() => player.evaluate(element =>
          element.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true)
      }
      // Keep both routes scrollable so returning restores an actual browsing offset.
      await page.evaluate(() => {
        const spacer = document.createElement('div')
        spacer.id = 'mini-player-test-spacer'
        spacer.style.height = '2000px'
        document.body.append(spacer)
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAlwaysShowNavigationBar', false)
      })
      for (const { scale, reducedMotion } of [
        { scale: 100, reducedMotion: 'off' },
        { scale: 125, reducedMotion: 'off' },
        { scale: 125, reducedMotion: 'on' },
      ]) {
        const motionLabel = reducedMotion === 'on' ? 'reduced motion' : 'animated'
        await page.evaluate(async ({ scale, reducedMotion }) => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('setUiScale', scale)
          await store.dispatch('updateReducedMotion', reducedMotion)
        }, { scale, reducedMotion })
        for (const hidden of [false, true]) {
          await t.test(`minimize preserves ${hidden ? 'hidden' : 'visible'} Watch navigation without an endpoint jump at ${scale}% (${motionLabel})`, async () => {
            await page.evaluate(() => { location.hash = '#/subscriptions' })
            await expect(player).toHaveClass(/mobileMiniBar/)
            await settle()
            await page.evaluate(() => window.scrollTo(0, 1000))
            await expect(nav).toHaveClass(/scrollHidden/)
            await player.locator('.mobileMiniBarReturn').click()
            await expect(page).toHaveURL(/#\/watch\//)
            await expect(player).not.toHaveClass(/scrollMiniPlayer/)
            await settle()
            await expect(nav).not.toHaveClass(/scrollHidden/)
            if (hidden) {
              await page.evaluate(() => window.scrollTo(0, 40))
              await expect(nav).toHaveClass(/scrollHidden/)
            }
            // Let the nav's own reveal/hide transition finish before sampling geometry.
            await expect.poll(() => nav.evaluate(element => element.getAnimations().length)).toBe(0)
            const box = await player.boundingBox()
            const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            await touch('touchStart', point)
            await touch('touchMove', { ...point, y: point.y + 30 })
            await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
            await page.evaluate(() => window.dispatchEvent(new Event('resize')))
            if (hidden) await expect(nav).toHaveClass(/scrollHidden/)
            else await expect(nav).not.toHaveClass(/scrollHidden/)
            // The overlay is laid out at the final morph endpoint throughout the drag.
            const endpoint = await page.locator('#cross-tab-mini-player-layer > .mobileMiniBarOverlay').boundingBox()
            for (const distance of [60, 100, 160]) await touch('touchMove', { ...point, y: point.y + distance })
            await touch('touchEnd')
            await expect(page).toHaveURL(/#\/subscriptions/)
            await expect(player).toHaveClass(/mobileMiniBar/)
            await settle()
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(900)
            const settled = await player.boundingBox()
            console.log('Navigation endpoint:', { hidden, endpoint, settled, navHidden: await nav.evaluate(el => el.classList.contains('scrollHidden')) })
            if (hidden) await expect(nav).toHaveClass(/scrollHidden/)
            else await expect(nav).not.toHaveClass(/scrollHidden/)
            assert.ok(Math.abs(endpoint.y - settled.y) < 1, 'morph must reach the settled bar without a position jump')
          })
          // Restore even when the subtest failed, keeping subsequent cases independent.
          if (!/watch/.test(await page.evaluate(() => location.hash))) {
            await player.locator('.mobileMiniBarReturn').click()
            await expect(player).not.toHaveClass(/scrollMiniPlayer/)
            await settle()
          }
        }
        await t.test(`downward dismissal paints underneath the bottom navigation at ${scale}% (${motionLabel})`, async () => {
          await page.evaluate(() => { location.hash = '#/subscriptions' })
          await expect(player).toHaveClass(/mobileMiniBar/)
          await page.evaluate(() => window.scrollTo(0, 0))
          await expect(nav).not.toHaveClass(/scrollHidden/)
          await settle()
          await expect.poll(() => nav.evaluate(element => element.getAnimations().length)).toBe(0)
          const box = await player.boundingBox()
          const navBox = await nav.boundingBox()
          const point = { x: box.x + box.width / 2, y: box.y + 8 }
          try {
            await touch('touchStart', point)
            await touch('touchMove', { ...point, y: point.y + 40 })
            await expect.poll(() => player.evaluate(element => Number.parseFloat(element.style.getPropertyValue('--mobile-mini-dismiss-offset')))).toBeCloseTo(40, 2)
            assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.sideNav'), {
              x: point.x, y: navBox.y + 12,
            }), true, 'navigation must paint over the dragged mini player')
          } finally {
            await touch('touchCancel')
            await page.waitForTimeout(400)
          }
        })
        await player.locator('.mobileMiniBarReturn').click()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await settle()
      }
      await t.test('hidden navigation over an unscrollable browsing page can be restored with the player', async () => {
        await page.evaluate(async () => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('setUiScale', 100)
          await store.dispatch('updateReducedMotion', 'off')
          window.scrollTo(0, 40)
        })
        await expect(nav).toHaveClass(/scrollHidden/)
        const box = await player.boundingBox()
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await touch('touchStart', point)
        await touch('touchMove', { ...point, y: point.y + 30 })
        await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
        // The browsing route has no content to scroll once this fixture is gone.
        await page.evaluate(() => document.querySelector('#mini-player-test-spacer')?.remove())
        for (const distance of [60, 100, 160]) await touch('touchMove', { ...point, y: point.y + distance })
        await touch('touchEnd')
        await expect(page).toHaveURL(/#\/subscriptions/)
        await expect(player).toHaveClass(/mobileMiniBar/)
        await settle()
        await expect.poll(() => page.evaluate(() => {
          const root = document.scrollingElement
          return root.scrollHeight <= root.clientHeight
        })).toBe(true)
        await expect(nav).toHaveClass(/scrollHidden/)
        await page.waitForTimeout(400)
        await player.locator('.mobileMiniBarReturn').click()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await settle()
        await expect(nav).not.toHaveClass(/scrollHidden/)
      })
      await page.evaluate(() => document.querySelector('#mini-player-test-spacer')?.remove())
      return
    }
    await trackMiniPlayerWork(page)
    try {
      await expect.poll(() => page.evaluate(() => window.__miniPlayerWork.ambientDraws)).toBeGreaterThan(0)
      for (const restoring of [false, true]) {
        const box = await (restoring ? player.locator('.mobileMiniBarReturn') : player).boundingBox()
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const direction = restoring ? -1 : 1
        await touch('touchStart', point)
        await touch('touchMove', { ...point, y: point.y + direction * 30 })
        await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
        await resetMiniPlayerWork(page)
        for (const distance of [40, 60, 80, 100]) {
          await touch('touchMove', { ...point, y: point.y + direction * distance })
          await page.waitForTimeout(30)
        }
        await page.waitForTimeout(350)
        const work = await page.evaluate(() => window.__miniPlayerWork)
        const backdrop = await mobileMiniPlayerBackdrop(page)
        console.log(`Android ${restoring ? 'restore' : 'minimize'} swipe work:`, work)
        if (animationOnly) {
          const endpoint = await page.locator(restoring ? '.scrollMiniPlaceholder' : '.mobileMiniBarMorphOverlay').boundingBox()
          await touch('touchMove', { ...point, y: point.y + direction * Math.abs(endpoint.y - box.y) * 0.8 })
          const overlay = page.locator('.mobileMiniBarMorphOverlay')
          await expect(overlay).toHaveCSS('opacity', restoring ? '0' : '1')
          if (!restoring) {
            const close = overlay.locator('.mobileMiniBarDismiss')
            await expect(close, 'the close button fades in before minimization finishes').toBeVisible()
            await expect(close).toBeDisabled()
            await expect(close).toHaveCSS('pointer-events', 'none')
          }
          assert.ok(await overlay.evaluate(element => Number(getComputedStyle(element).zIndex)) <
            await player.evaluate(element => Number(getComputedStyle(element).zIndex)), 'the moving video must paint above the backdrop')
        }
        await touch('touchEnd')
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        assert.deepEqual(work, { ambientDraws: 0, controlClones: 0 })
        assert.equal(backdrop.left, '0px', 'the backdrop must cover the thumbnail side during the morph')
        assert.equal(backdrop.right, '0px')
        assert.equal(backdrop.image, 'none')
        assert.equal(backdrop.color, backdrop.cardColor)
        assert.equal(await originalVideo.evaluate(element => element === document.querySelector('.ftVideoPlayer video') && !element.paused), true)
      }
      await resetMiniPlayerWork(page)
      await expect.poll(() => page.evaluate(() => window.__miniPlayerWork.ambientDraws)).toBeGreaterThan(0)
    } finally {
      await stopTrackingMiniPlayerWork(page)
    }
    if (animationOnly) return
    for (const scale of dismissalOnly ? [] : [100, 125]) {
      await page.evaluate(scale => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setUiScale', scale)
        store.dispatch('updateReducedMotion', scale === 125 ? 'on' : 'off')
      }, scale)
      await page.evaluate(() => {
        const spacer = document.createElement('div')
        spacer.id = 'mini-player-test-spacer'
        spacer.style.height = '2000px'
        document.body.append(spacer)
      })
      for (const region of mobileMiniPlayerRegions) {
        await page.evaluate(() => window.scrollTo(0, 1200))
        await expect(player).toHaveClass(/mobileMiniBar/)
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        await expect(player.locator('.mobileMiniBarDismiss')).toHaveCount(0)
        let point = await returnPoint(region)
        await touch('touchStart', point)
        for (const distance of [20, 40, 80]) await touch('touchMove', { ...point, y: point.y + distance })
        await touch('touchEnd')
        await expect(player, 'same-page scroll mini-player cannot close').toHaveClass(/scrollMiniPlayer/)
        await expect(page).toHaveURL(/#\/watch\//)
        // Native scrolling can hide the navigation bar and move the mini player.
        point = await returnPoint(region)
        await touch('touchStart', point)
        for (const distance of [20, 40, 80, 100]) await touch('touchMove', { ...point, y: point.y - distance })
        await touch('touchEnd')
        await expect(player, `same-page swipe on ${region} at ${scale}%`).not.toHaveClass(/scrollMiniPlayer/)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
        await page.waitForTimeout(400)
        await expect(page).toHaveURL(/#\/watch\//)
      }
      await page.evaluate(() => document.querySelector('#mini-player-test-spacer')?.remove())
      for (const swipe of [false, true]) {
        for (const region of mobileMiniPlayerRegions) {
          // Navigate away while playback continues, retaining the actual player.
          await page.evaluate(() => { location.hash = '#/subscriptions' })
          await expect(player).toHaveClass(/mobileMiniBar/)
          await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
          if (scale === 125) assert.equal(await player.evaluate(element => getComputedStyle(element).transitionDuration), '0s')
          const returnButton = player.locator('.mobileMiniBarReturn')
          await expect(returnButton).toBeEnabled()
          await expect(returnButton.locator('svg')).toHaveCount(0)
          let point = await returnPoint(region)
          await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('mobileMiniBarReturn'), point), { message: region }).toBe(true)
          if (swipe) {
            const top = await player.locator('.mobileMiniBarReturn').boundingBox()
            // Start near the top so downward samples stay inside the WebView.
            const down = { ...point, y: top.y + 8 }
            for (const canceled of [false, true]) {
              const before = await player.boundingBox()
              await touch('touchStart', down)
              await touch('touchMove', { ...down, y: down.y + (canceled ? 70 : 24) })
              await expect.poll(() => player.evaluate(element => Number.parseFloat(element.style.getPropertyValue('--mobile-mini-dismiss-offset')))).toBeCloseTo(canceled ? 70 : 24, 2)
              await expect.poll(async () => (await player.boundingBox()).y - before.y).toBeCloseTo(canceled ? 70 : 24, 0)
              await touch(canceled ? 'touchCancel' : 'touchEnd')
              await expect.poll(() => player.evaluate(element => element.style.getPropertyValue('--mobile-mini-dismiss-offset'))).toBe('')
              await expect(player, 'short and canceled downward swipes keep playback').toHaveClass(/scrollMiniPlayer/)
              await expect(page).toHaveURL(/#\/subscriptions/)
              assert.equal(await originalVideo.evaluate(video => !video.paused), true)
            }
          }
          point = await returnPoint(region)
          await touch('touchStart', point)
          if (swipe) {
            for (const distance of [20, 40, 80, 100]) await touch('touchMove', { ...point, y: point.y - distance })
          }
          await touch('touchEnd')
          await expect(page, `${swipe ? 'swipe' : 'tap'} on ${region} at ${scale}%`).toHaveURL(/#\/watch\//)
          await expect(player).not.toHaveClass(/scrollMiniPlayer/)
          await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
          assert.equal(await originalVideo.evaluate(video => video === document.querySelector('.ftVideoPlayer video') && !video.paused), true)
          await page.waitForTimeout(400)
          await expect(page, 'Compatibility clicks must not activate the restored page').toHaveURL(/#\/watch\//)
        }
      }
    }
    await page.evaluate(() => { location.hash = '#/subscriptions' })
    const close = player.locator('.mobileMiniBarDismiss')
    await expect(close).toBeEnabled()
    const box = await close.boundingBox()
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.mobileMiniBarDismiss')), point), true)
    // A swipe beginning on close must never restore the Watch view.
    await touch('touchStart', point)
    for (const distance of [20, 40, 80, 100]) await touch('touchMove', { ...point, y: point.y - distance })
    await touch('touchCancel')
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(close).toBeEnabled()
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateReducedMotion', 'off')
      await store.dispatch('updateAnimationSpeed', 25)
    })
    const trackDismissal = async () => {
      // Make the asynchronous teardown long enough to expose a one-frame
      // return to the dock after the swipe transform is cleared.
      await watch.evaluate(component => {
        const original = component.proxy.handleRouteChange
        component.proxy.handleRouteChange = async (...args) => {
          await new Promise(resolve => setTimeout(resolve, 200))
          return original(...args)
        }
      })
      await player.evaluate(element => {
        const initialTop = element.getBoundingClientRect().top
        let furthestTop = initialTop
        const result = window.__miniDismissFrames = { movedDown: false, reappeared: false }
        const sample = () => {
          if (!element.isConnected) return
          const top = element.getBoundingClientRect().top
          if (Number.parseFloat(getComputedStyle(element).opacity) > 0) {
            if (top > initialTop + 1) result.movedDown = true
            if (top < furthestTop - 1) result.reappeared = true
            furthestTop = Math.max(furthestTop, top)
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
    }
    await trackDismissal()
    // Cover closing by a downward swipe after verifying the close control.
    const returnBox = await player.locator('.mobileMiniBarReturn').boundingBox()
    const down = { x: returnBox.x + returnBox.width / 2, y: returnBox.y + 8 }
    await player.evaluate(element => {
      window.__miniDismissRegression = {}
      const recordTransition = event => {
        if (event.propertyName !== 'transform') return
        element.removeEventListener('transitionrun', recordTransition)
        queueMicrotask(() => {
          const animation = element.getAnimations().find(animation => animation.transitionProperty === 'transform')
          if (animation) animation.ready.then(() => {
            window.__miniDismissRegression.transition = {
              duration: animation.effect.getTiming().duration, rate: animation.playbackRate,
            }
          })
        })
      }
      element.addEventListener('transitionrun', recordTransition)
      window.__miniDismissPointerUp = () => setTimeout(() => {
        const button = element.querySelector('.mobileMiniBarReturn')
        window.__miniDismissRegression.controlsDisabled = button?.disabled
        // Exercise input after the normal 350ms compatibility-click suppression.
        element.dispatchEvent(new PointerEvent('pointerdown', {
          pointerType: 'touch', pointerId: 2, isPrimary: false, button: 0, bubbles: true,
        }))
        button?.click()
      }, 400)
      window.addEventListener('pointerup', window.__miniDismissPointerUp, { capture: true, once: true })
    })
    await touch('touchStart', down)
    for (const distance of [20, 40, 64, 80]) await touch('touchMove', { ...down, y: down.y + distance })
    await touch('touchEnd')
    await expect(page.locator('.mobileMiniBarOverlay')).toHaveCount(0)
    assert.deepEqual(await page.evaluate(() => window.__miniDismissRegression), {
      transition: { duration: 140, rate: 0.25 }, controlsDisabled: true,
    })
    await expect(player).toHaveCount(0)
    await expect.poll(() => watch.evaluate(component => component.isUnmounted)).toBe(true)
    assert.deepEqual(await page.evaluate(() => window.__miniDismissFrames), { movedDown: true, reappeared: false })
    await expect(page).toHaveURL(/#\/subscriptions/)
    assert.equal(await originalVideo.evaluate(video => video.paused && !video.isConnected), true)
    await originalVideo.dispose()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateAnimationSpeed', 100))
    await loadTestVideo()
    await page.evaluate(() => { location.hash = '#/subscriptions' })
    await expect(close).toBeEnabled()
    await trackDismissal()
    const closeBox = await close.boundingBox()
    await touch('touchStart', { x: closeBox.x + closeBox.width / 2, y: closeBox.y + closeBox.height / 2 })
    await touch('touchEnd')
    await expect(page.locator('.mobileMiniBarOverlay')).toHaveCount(0)
    await expect(player).toHaveCount(0)
    await expect.poll(() => watch.evaluate(component => component.isUnmounted)).toBe(true)
    assert.deepEqual(await page.evaluate(() => window.__miniDismissFrames), { movedDown: true, reappeared: false })
    await expect(page).toHaveURL(/#\/subscriptions/)
  } finally {
    if (landscape) {
      for (const [key, value] of [['user_rotation', rotation], ['accelerometer_rotation', automaticRotation]]) {
        if (value === 'null') adb('settings', 'delete', 'system', key)
        else adb('settings', 'put', 'system', key, value)
      }
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
    await page.evaluate(({ settings, originalRoute }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      document.querySelector('.ftVideoPlayer video')?.pause()
      store.commit('setKeepPlayingOnNavigation', false)
      location.hash = originalRoute
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (settings) store.dispatch('updateReducedMotion', settings.ReducedMotion)
      if (settings) store.dispatch('updateAnimationSpeed', settings.AnimationSpeed)
      if (window.__miniPlayerFetch) window.fetch = window.__miniPlayerFetch
      delete window.__miniPlayerFetch
      window.removeEventListener('pointerup', window.__miniDismissPointerUp, true)
      delete window.__miniDismissPointerUp
      delete window.__miniDismissRegression
      delete window.__miniDismissFrames
      document.querySelector('#mini-player-test-style')?.remove()
      document.querySelector('#mini-player-test-spacer')?.remove()
    }, { settings, originalRoute })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
}
