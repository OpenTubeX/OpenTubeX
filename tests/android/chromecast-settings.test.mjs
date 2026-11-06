import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goToSettingsSection } from '../../e2e/helpers/app.mjs'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, with its WebView forwarded.
test('Android enables Google Cast from settings and opens the native device menu', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        CurrentLocale: 'en-US',
        BaseTheme: 'system',
        SystemDarkTheme: 'dark',
        SystemLightTheme: 'light',
        MainColor: 'Red',
        SecColor: 'Blue',
        ShowChromecastButton: false,
        ShowDlnaCastButton: false,
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__castSettingsFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__castSettingsFetch(url, options)
        : Promise.reject(new Error('Offline Cast settings test'))
      return saved
    })
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      const back = tutorial.getByRole('button', { name: 'Back', exact: true })
      while (await back.isVisible()) await back.click()
      const skip = tutorial.getByRole('button', { name: 'Skip', exact: true })
      if (await skip.isVisible()) await skip.click()
      else await tutorial.locator('.tutorialActions').getByRole('button').last().click()
      await expect(tutorial).toBeHidden()
    }
    if (await page.locator('.settingsWindow').isVisible()) {
      while (!await page.locator('.settingsMenu').isVisible()) await page.locator('.settingsBackButton').click()
    }
    await goToSettingsSection(page, 'player')
    const toggle = page.locator('[data-setting-key="showChromecastButton"]')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveText('Enable Google Cast')
    await expect(toggle.locator('input')).not.toBeChecked()
    await toggle.locator('label').click()
    await expect(toggle.locator('input')).toBeChecked()
    if (process.env.ANDROID_CAST_SCREENSHOT) {
      for (const scheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: scheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
        await toggle.screenshot({ path: process.env.ANDROID_CAST_SCREENSHOT.replace(/\.png$/, `-${scheme}.png`) })
      }
      await page.emulateMedia({ colorScheme: null })
    }
    assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getShowChromecastButton), true)
    await page.locator('.settingsCloseButton').click()
    await page.evaluate(() => { location.hash = '#/watch/jNQXAC9IVRw' })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try { return await handle.evaluate(component => !!component && component.proxy.preparingVideoLoadGeneration === null) } finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
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
    await expect(page.getByRole('option', { name: 'Loading…', exact: true })).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('option', { name: 'No compatible stream for Google Cast', exact: true })).toHaveCount(0)
    const refresh = page.getByRole('option', { name: 'Refresh', exact: true })
    await expect(refresh).toBeVisible({ timeout: 15_000 })
    await expect(refresh).toHaveAttribute('aria-disabled', 'false', { timeout: 15_000 })
    await button.press('Escape')
    await watch.evaluate(component => component.proxy.$store.commit('setShowChromecastButton', false))
    await expect(button).toHaveCount(0)
  } finally {
    await watch?.evaluate(component => component?.proxy.$refs.player?.pause()).catch(() => {})
    await watch?.dispose()
    await page.evaluate(async ({ settings, originalRoute }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) await store.dispatch('update' + key, value)
      window.fetch = window.__castSettingsFetch ?? window.fetch
      delete window.__castSettingsFetch
      location.hash = originalRoute
    }, { settings, originalRoute }).catch(() => {})
    await browser.close()
  }
})
