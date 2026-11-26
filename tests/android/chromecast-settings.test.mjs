import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { expect } from '@playwright/test'
import { goToSettingsSection } from '../../e2e/helpers/app.mjs'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'
import { blockAppNetwork, connectAndroidApp } from '../helpers/android-webview.mjs'
import { rethrowWithAndroidState } from '../helpers/android-failure.mjs'

// Run against a current debug APK on a locked emulator, with its WebView forwarded.
test('Android enables Google Cast from settings and opens the native device menu', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const { browser, page } = await connectAndroidApp()
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    await blockAppNetwork(page)
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        CurrentLocale: 'en-US',
        BaseTheme: 'system',
        SystemDarkTheme: 'dark',
        SystemLightTheme: 'light',
        MainColor: 'Red',
        SecColor: 'Blue',
        CastProtocols: [],
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, JSON.parse(JSON.stringify(store.getters['get' + key]))]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      return saved
    })
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      await tutorial.locator('.tutorialSkip button').click()
      await expect(tutorial).toBeHidden()
    }
    if (await page.locator('.settingsWindow').isVisible()) {
      while (!await page.locator('.settingsMenu').isVisible()) await page.locator('.settingsBackButton').click()
    }
    await goToSettingsSection(page, 'player')
    const toggle = page.locator('[data-setting-key="castProtocols"]')
    await expect(toggle).toBeVisible()
    await toggle.getByRole('combobox', { name: 'Cast To' }).click()
    const googleCast = page.getByRole('option', { name: 'Google Cast', exact: true })
    await expect(googleCast).toHaveAttribute('aria-selected', 'false')
    await googleCast.click()
    // The setting reaches the list after the app stores it, which a busy phone delays.
    await expect(googleCast).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
    if (process.env.ANDROID_CAST_SCREENSHOT) {
      for (const scheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: scheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
        await page.locator('.settingsWindow').screenshot({ path: process.env.ANDROID_CAST_SCREENSHOT.replace(/\.png$/, `-${scheme}.png`) })
      }
      await page.emulateMedia({ colorScheme: null })
    }
    await page.keyboard.press('Escape')
    assert.deepEqual(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getCastProtocols), ['googleCast'])
    await page.locator('.settingsCloseButton').click()
    await page.evaluate(() => { location.hash = '#/watch/jNQXAC9IVRw' })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try { return await handle.evaluate(component => !!component && component.proxy.preparingVideoLoadGeneration === null) } finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    // Records when the Cast button and the Watch state that shows it change,
    // for the failure report.
    await watch.evaluate(component => {
      const events = window.__castTestEvents = []
      const record = (type, value) => {
        events.push({ t: Math.round(performance.now()), type, value })
        if (events.length > 100) events.shift()
      }
      const watch = component.proxy
      watch.$watch(() => ({
        errorMessage: watch.errorMessage,
        isLoading: watch.isLoading,
        playerReady: watch.playerReady,
        playerStreamsPending: watch.playerStreamsPending,
        ytDlpStreamsPending: watch.ytDlpStreamsPending,
        playbackEngineFallbackTarget: watch.playbackEngineFallbackTarget,
        activeFormat: watch.activeFormat,
        localFilePlayback: watch.localFilePlayback,
        isUpcoming: watch.isUpcoming,
        videoLoadGeneration: watch.videoLoadGeneration,
        preparingVideoLoadGeneration: watch.preparingVideoLoadGeneration,
        legacyFormats: watch.legacyFormats.length,
        videoId: watch.videoId,
      }), value => record('watch', value), { immediate: true })
      let shown = null
      window.__castTestObserver = new MutationObserver(() => {
        const button = document.querySelector('.chromecastControl > button')
        if (shown === button) return
        shown = button
        record('castButton', button ? 'attached' : 'missing')
      })
      window.__castTestObserver.observe(document.body, { childList: true, subtree: true })
    })
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((component, media) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false,
        ytDlpStreamsPending: false,
        errorMessage: null,
        manifestSrc: null,
        manifestMimeType: null,
        isUpcoming: false,
        isLive: false,
        localFilePlayback: false,
        activeFormat: 'legacy',
        videoTitle: 'Android Cast test',
        videoLengthSeconds: 30,
        author: 'Test channel',
        legacyFormats: [{
          itag: 0,
          qualityLabel: 'Test',
          mimeType: 'video/webm',
          width: 640,
          height: 360,
          bitrate: 0,
          localFile: true,
          url: `data:video/webm;base64,${media}`
        }],
      })
    }, media)
    const button = page.locator('.chromecastControl > button')
    await expect(button).toBeVisible()
    await expect(page.locator('.ftVideoPlayer video')).toBeVisible()
    await watch.evaluate(component => {
      component.proxy.legacyFormats = [...component.proxy.legacyFormats,
        { mimeType: 'video/mp4; codecs="avc1, mp4a.40.2"', url: 'https://cast-media.test/video.mp4', height: 720 }]
    })
    await button.click()
    // This uses the actual Android NSD backend; no Electron bridge is injected.
    await expect(page.getByRole('menuitem', { name: 'Loading…', exact: true })).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('menuitem', { name: 'No compatible stream for Google Cast', exact: true })).toHaveCount(0)
    const refresh = page.getByRole('menuitem', { name: 'Refresh', exact: true })
    await expect(refresh).toBeVisible({ timeout: 15_000 })
    await expect(refresh).toBeEnabled({ timeout: 15_000 })
    await button.press('Escape')
    await watch.evaluate(component => component.proxy.$store.commit('setCastProtocols', []))
    await expect(button).toHaveCount(0)
  } catch (error) {
    await rethrowWithAndroidState(error, page, 'chromecast-settings', () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return {
        now: Math.round(performance.now()),
        hash: location.hash,
        castProtocols: store.getters.getCastProtocols,
        castControls: [...document.querySelectorAll('.castControl')].map(element => element.className),
        player: document.querySelector('.ftVideoPlayer')?.className ?? null,
        events: window.__castTestEvents ?? null,
      }
    })
  } finally {
    await page.evaluate(() => window.__castTestObserver?.disconnect()).catch(() => {})
    await watch?.evaluate(component => component?.proxy.$refs.player?.pause()).catch(() => {})
    await watch?.dispose()
    await page.evaluate(async ({ settings, originalRoute }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) await store.dispatch('update' + key, value)
      window.__androidTestNetwork?.restore()
      location.hash = originalRoute
    }, { settings, originalRoute }).catch(() => {})
    await browser.close()
  }
})
