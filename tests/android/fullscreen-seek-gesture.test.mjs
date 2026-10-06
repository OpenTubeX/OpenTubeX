import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, forwarding its WebView
// socket and setting ANDROID_SERIAL and ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port>.
const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', ...args], { encoding: 'utf8' }).trim()

test('fullscreen horizontal swipes preview, seek, and cancel without triggering other gestures', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL,
  timeout: 240000,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  let settings
  let watch
  const spritePath = `/tmp/opentubex-seek-sprite-${process.pid}.png`
  const deviceSpritePath = `/data/local/tmp/opentubex-seek-sprite-${process.pid}.png`
  const appSpritePath = `files/fullscreen-seek-fixture-${process.pid}.png`
  const rotation = adb('settings', 'get', 'system', 'user_rotation')
  const automaticRotation = adb('settings', 'get', 'system', 'accelerometer_rotation')
  const originalRoute = await page.evaluate(() => location.hash)
  try {
    await page.reload()
    adb('settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('settings', 'put', 'system', 'user_rotation', '0')
    await page.locator('.profileTrigger').waitFor()
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      const skipTutorial = tutorial.getByRole('button', { name: 'Skip', exact: true })
      if (await skipTutorial.isVisible()) await skipTutorial.click()
      else await tutorial.locator('.tutorialActions').getByRole('button').last().click()
      await expect(tutorial).toBeHidden()
    }
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in', AutoplayVideos: false,
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
        EnableMobileFullscreenSwipe: false, EnableMobileFullscreenSeek: true, EnableVideoZoom: false, HoldToDoublePlaybackSpeed: false, RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false, PlayingInterfaceHideDelay: 5,
        MobileLeftSwipeAction: 'speed', MobileRightSwipeAction: 'speed', IconPack: 'material', SettingsWindowSection: 'playback',
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__fullscreenSeekFetch = window.fetch
      window.fetch = (url, options) => /^(https:\/\/localhost\/|data:|blob:)/.test(String(url))
        ? window.__fullscreenSeekFetch(url, options) : Promise.reject(new Error('Offline fullscreen seek test'))
      const style = document.createElement('style')
      style.id = 'fullscreen-seek-test-style'
      style.textContent = '.tutorialOverlay { display: none !important; }'
      document.head.append(style)
      location.hash = '#/watch/jNQXAC9IVRw'
      return saved
    })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try { return await handle.evaluate(component => !!component && component.proxy.preparingVideoLoadGeneration === null) }
      finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((component, media) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
        isUpcoming: false, isLive: false, localFilePlayback: true, activeFormat: 'legacy',
        videoTitle: 'Fullscreen seek test', videoLengthSeconds: 30, videoStoryboardSrc: '',
        legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
          width: 320, height: 180, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
      })
    }, media)
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    const controls = player.locator('.shaka-controls-container')
    const preview = player.locator('.mobileSeekPreview')
    const seekBar = player.locator('.shaka-seek-bar')
    const seekBarTime = () => seekBar.evaluate(element => Number(element.value))
    await expect.poll(() => video.evaluate(video => ({ ready: video.readyState, source: video.currentSrc.slice(0, 80), error: video.error?.message })), { timeout: 15000 }).toMatchObject({ ready: 4 })
    const touch = (type, points = []) => session.send('Input.dispatchTouchEvent', {
      type, touchPoints: points,
    })
    const resetTime = async (time = 15) => {
      await video.evaluate((video, time) => { video.pause(); video.currentTime = time }, time)
      await expect.poll(() => video.evaluate(video => video.seeking)).toBe(false)
    }
    const beginSeek = async (start, distance) => {
      const bounds = await player.boundingBox()
      const point = { x: bounds.x + bounds.width * start, y: bounds.y + bounds.height * 0.42 }
      await touch('touchStart', [point])
      for (let step = 1; step <= 5; step++) {
        await touch('touchMove', [{ x: point.x + bounds.width * distance * step / 5, y: point.y }])
      }
      return point
    }
    const fullscreenButton = player.locator('.shaka-fullscreen-button')
    await fullscreenButton.click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await expect(player).not.toHaveClass(/videoZoomTouchEnabled/)
    await expect(player).not.toHaveClass(/mobileFullscreenSwipeEnabled/)

    for (const orientation of ['0', '1']) {
      adb('settings', 'put', 'system', 'user_rotation', orientation)
      await page.evaluate(orientation => {
        document.querySelector('#fullscreen-seek-test-style').textContent =
          '.tutorialOverlay { display: none !important; }' + (orientation === '1' ? '.mobileSeekPreview { font-size: 2em !important; }' : '')
      }, orientation)
      await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(orientation === '1')
      // Fullscreen must own horizontal touch even with pinch and vertical
      // fullscreen swipes disabled; pan-x otherwise cancels the pointer stream.
      await expect(player).toHaveCSS('touch-action', 'none')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(async orientation => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateIconPack', orientation === '0' ? 'material' : 'remix')
      }, orientation)
      await resetTime()
      await beginSeek(0.25, 0.2)
      await expect(preview).toHaveText('0:21 (+0:06)')
      await expect.poll(seekBarTime).toBe(21)
      await expect(preview.locator('.mobileSeekThumbnail')).toHaveCount(0)
      const playControls = controls.locator('.shaka-big-buttons-container')
      const previewLayer = Number(await preview.evaluate(element => getComputedStyle(element).zIndex))
      const controlsLayer = Number(await playControls.evaluate(element => getComputedStyle(element).zIndex))
      assert.ok(previewLayer > controlsLayer, 'The central play button must not cover the time preview')
      assert.equal(await video.evaluate(video => video.currentTime), 15, 'Dragging only previews the target')
      assert.equal(await video.evaluate(video => video.playbackRate), 1, 'Horizontal movement must not adjust speed')
      if (process.env.ANDROID_ARTIFACT_DIR) {
        await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/fullscreen-seek-${orientation}.png` })
      }
      await touch('touchEnd')
      await expect(preview).toHaveCount(0)
      await expect.poll(() => video.evaluate(video => video.currentTime)).toBe(21)
      assert.equal(await video.evaluate(video => video.paused), true, 'Paused playback stays paused')

      await resetTime()
      await beginSeek(0.75, -0.2)
      await expect(preview).toHaveText('0:09 (−0:06)')
      await expect.poll(seekBarTime).toBe(9)
      await touch('touchEnd')
      await expect.poll(() => video.evaluate(video => video.currentTime)).toBe(9)

      await resetTime(1)
      await beginSeek(0.75, -0.2)
      await expect(preview).toHaveText('0:00 (−0:01)')
      await touch('touchEnd')
      await expect.poll(() => video.evaluate(video => video.currentTime)).toBe(0)
      await resetTime(29)
      await beginSeek(0.25, 0.2)
      await expect(preview).toHaveText('0:30 (+0:01)')
      await touch('touchEnd')
      await expect.poll(() => video.evaluate(video => video.seeking)).toBe(false)
      await expect.poll(() => video.evaluate(video => video.duration - video.currentTime)).toBeCloseTo(0.1, 4)
      assert.equal(await video.evaluate(video => video.ended), false, 'Seeking to the end leaves the paused video at its last frame')
      assert.equal(await video.evaluate(video => video.paused), true)

      await resetTime()
      await beginSeek(0.25, 0.2)
      await expect(preview).toBeVisible()
      await touch('touchCancel')
      await expect(preview).toHaveCount(0)
      assert.equal(await video.evaluate(video => video.currentTime), 15)
      await expect.poll(seekBarTime).toBe(15)

      await resetTime()
      const point = await beginSeek(0.25, 0.2)
      await touch('touchStart', [{ ...point, id: 0 }, { x: point.x + 50, y: point.y, id: 1 }])
      await expect(preview).toHaveCount(0)
      await touch('touchEnd')
      assert.equal(await video.evaluate(video => video.currentTime), 15, 'A second finger cancels seeking')
      await expect.poll(seekBarTime).toBe(15)
    }

    // Add an actual VTT storyboard to Shaka, with two distinguishable frames.
    const sprite = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 90
      const context = canvas.getContext('2d')
      context.fillStyle = '#ad2942'
      context.fillRect(0, 0, 160, 90)
      context.fillStyle = '#147b62'
      context.fillRect(160, 0, 160, 90)
      context.fillStyle = '#fff'
      context.font = '20px sans-serif'
      context.fillText('Earlier frame', 10, 50)
      context.fillText('Later frame', 170, 50)
      return canvas.toDataURL().split(',')[1]
    })
    await writeFile(spritePath, Buffer.from(sprite, 'base64'))
    execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'push', spritePath, deviceSpritePath], { stdio: 'ignore' })
    adb('run-as', 'org.opentubex.app.dev', 'mkdir', '-p', 'files')
    adb('run-as', 'org.opentubex.app.dev', 'cp', deviceSpritePath, appSpritePath)
    await player.evaluate(async (element, appSpritePath) => {
      const uri = `https://localhost/_capacitor_file_/data/user/0/org.opentubex.app.dev/${appSpritePath}`
      const vtt = `WEBVTT\n\n00:00.000 --> 00:15.000\n${uri}#xywh=0,0,160,90\n\n00:15.000 --> 00:30.100\n${uri}#xywh=160,0,160,90\n`
      const storyboard = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
      window.__fullscreenSeekUrls = [storyboard]
      try { await element.ui.getControls().getPlayer().addThumbnailsTrack(storyboard, 'text/vtt') }
      catch (error) { throw Error(JSON.stringify({ code: error.code, data: error.data, message: error.message })) }
    }, appSpritePath)
    for (const orientation of ['0', '1']) {
      adb('settings', 'put', 'system', 'user_rotation', orientation)
      await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(orientation === '1')
      await resetTime()
      await beginSeek(0.25, 0.2)
      const thumbnail = preview.locator('.mobileSeekThumbnail')
      try { await expect(thumbnail).toBeVisible() }
      catch (error) {
        const state = await player.evaluate(async element => ({ tracks: element.ui.getControls().getPlayer().getImageTracks(), frame: await element.ui.getControls().getPlayer().getThumbnails(null, 21) }))
        throw Error(JSON.stringify(state))
      }
      await expect(thumbnail).toHaveCSS('background-position', '100% 0%')
      await expect(thumbnail).toHaveCSS('background-size', '200% 100%')
      const bounds = await preview.boundingBox()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height)
      if (process.env.ANDROID_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/fullscreen-seek-thumbnail-${orientation}.png` })
      await touch('touchEnd')
      await expect(thumbnail).toHaveCount(0)
      await resetTime()
      await beginSeek(0.75, -0.2)
      await expect(thumbnail).toHaveCSS('background-position', '0% 0%')
      await touch('touchEnd')
    }
    await resetTime()
    await beginSeek(0.25, 0.2)
    await expect(preview).toBeVisible()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setEnableMobileFullscreenSeek', false))
    await expect(preview).toHaveCount(0)
    await touch('touchEnd')
    assert.equal(await video.evaluate(video => video.currentTime), 15, 'Turning off the setting cancels an active seek')
    await expect.poll(seekBarTime).toBe(15)
    await resetTime()
    await beginSeek(0.25, 0.2)
    await expect(preview).toHaveCount(0)
    await touch('touchEnd')
    assert.equal(await video.evaluate(video => video.currentTime), 15, 'Disabling the setting prevents horizontal seeking')
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setEnableMobileFullscreenSeek', true))

    await resetTime()
    await video.evaluate(video => { video.loop = true; return video.play() })
    await expect(controls).not.toHaveAttribute('shown', { timeout: 10000 })
    await beginSeek(0.25, 0.2)
    await expect(preview).toBeVisible()
    await expect(controls).toHaveAttribute('shown')
    const target = await preview.locator('.valueChangeText').textContent()
    const displayedTime = Number(target.match(/^(\d+):/)[1]) * 60 + Number(target.match(/^\d+:(\d+)/)[1])
    await expect.poll(async () => Math.abs(await seekBarTime() - displayedTime)).toBeLessThan(1)
    const previewTime = await seekBarTime()
    // Allow multiple Shaka progress refreshes and video timeupdates while the
    // finger stays down: they must not reset the preview thumb to playback.
    const startingPlaybackTime = await video.evaluate(video => video.currentTime)
    await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThan(startingPlaybackTime + 0.5)
    assert.equal(await seekBarTime(), previewTime)
    // Capture the committed position when seeking starts. Playback can advance
    // between releasing the touch and the next CDP round trip on slow emulators.
    await video.evaluate(video => {
      video.addEventListener('seeking', () => { video.fullscreenSeekCommittedTime = video.currentTime }, { once: true })
    })
    await touch('touchEnd')
    await expect(preview).toHaveCount(0)
    await expect.poll(() => video.evaluate((video, time) => Math.abs(video.fullscreenSeekCommittedTime - time), previewTime)).toBeLessThan(0.5)
    assert.equal(await video.evaluate(video => video.paused), false, 'Playing video continues after seeking')
    await expect(controls).not.toHaveAttribute('shown', { timeout: 10000 })
    assert.equal(await page.evaluate(() => document.fullscreenElement !== null), true)
    await video.evaluate(video => video.pause())
    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await resetTime()
    await beginSeek(0.25, 0.2)
    await touch('touchEnd')
    assert.equal(await video.evaluate(video => video.currentTime), 15, 'Inline swipes must not seek')
    adb('settings', 'put', 'system', 'user_rotation', '0')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSettingsWindowSection', 'playback')
      location.hash = '#/settings'
    })
    const toggle = page.locator('[data-setting-key="enableMobileFullscreenSeek"]')
    await expect(toggle).toBeVisible()
    await expect(toggle.locator('input')).toBeChecked()
    await toggle.locator('label').click()
    await expect(toggle.locator('input')).not.toBeChecked()
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getEnableMobileFullscreenSeek)).toBe(false)
    await toggle.locator('label').click()
    await expect(toggle.locator('input')).toBeChecked()
    if (process.env.ANDROID_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/fullscreen-seek-setting.png` })

  } finally {
    try {
      await page.evaluate(async ({ settings, originalRoute }) => {
        if (document.fullscreenElement) await document.exitFullscreen()
        document.querySelector('.ftVideoPlayer video')?.pause()
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
        if (settings?.IconPack) await store.dispatch('updateIconPack', settings.IconPack)
        if (window.__fullscreenSeekFetch) window.fetch = window.__fullscreenSeekFetch
        delete window.__fullscreenSeekFetch
        for (const uri of window.__fullscreenSeekUrls ?? []) URL.revokeObjectURL(uri)
        delete window.__fullscreenSeekUrls
        document.querySelector('#fullscreen-seek-test-style')?.remove()
        location.hash = originalRoute
      }, { settings, originalRoute })
    } finally {
      if (rotation === 'null') adb('settings', 'delete', 'system', 'user_rotation')
      else adb('settings', 'put', 'system', 'user_rotation', rotation)
      if (automaticRotation === 'null') adb('settings', 'delete', 'system', 'accelerometer_rotation')
      else adb('settings', 'put', 'system', 'accelerometer_rotation', automaticRotation)
      adb('run-as', 'org.opentubex.app.dev', 'rm', '-f', appSpritePath)
      adb('rm', '-f', deviceSpritePath)
      await rm(spritePath, { force: true })
      await watch?.dispose()
      await page.emulateMedia({ reducedMotion: null }).catch(() => {})
      await session.detach().catch(() => {})
      await browser.close()
    }
  }
})
