import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goTo } from '../../e2e/helpers/app.mjs'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Use a current debug APK on a locked emulator with its WebView forwarded.
test('Android hides and reorders the compact control bar buttons', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  try {
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        CurrentLocale: 'en-US', VideoPlaybackEngine: 'built-in', AutoplayVideos: false,
        RotateFullscreenToLandscape: false, EnterFullscreenOnDisplayRotate: false,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      saved.ControlBarButtons = structuredClone(store.getters.getControlBarButtons)
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__controlBarFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__controlBarFetch(url, options) : Promise.reject(new Error('Offline control bar test'))
      document.querySelector('.tutorialOverlay')?.remove()
      return saved
    })
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateControlBarButtons', ['captions', 'pictureInPicture', 'menu', 'fullscreen'])
    })

    if (await page.locator('.settingsWindow').isVisible()) await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')
    while (!await page.locator('.settingsMenu').isVisible()) await page.locator('.settingsBackButton').click()
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await page.getByRole('button', { name: 'Customize interface', exact: true }).click()
    await page.locator('[data-settings-subpage-tab="controlBar"]').click()
    const rows = page.locator('.selectedAction')
    const ids = () => rows.evaluateAll(elements => elements.map(element => element.dataset.controlBarButtonId))
    // The mobile list only offers the buttons of the compact control bar.
    await expect.poll(ids).toEqual(['captions', 'pictureInPicture', 'menu', 'fullscreen'])
    await expect(page.getByRole('button', { name: 'Add button', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Remove Captions', exact: true }).click()
    await page.getByRole('button', { name: 'Remove Fullscreen', exact: true }).click()
    await page.getByRole('button', { name: 'Move Player menu up', exact: true }).click()
    await expect.poll(ids).toEqual(['menu', 'pictureInPicture'])
    await page.locator('.settingsCloseButton').click()

    await page.evaluate(() => { location.hash = '#/watch/jNQXAC9IVRw' })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try { return await handle.evaluate(component => !!component && component.proxy.preparingVideoLoadGeneration === null) }
      finally { await handle.dispose() }
    }).toBe(true)
    const watch = await page.evaluateHandle(findWatchComponent)
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((component, media) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
        isUpcoming: false, isLive: false, localFilePlayback: true, activeFormat: 'legacy',
        videoTitle: 'Control bar test', videoLengthSeconds: 30,
        legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
          width: 640, height: 360, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
      })
    }, media)
    await watch.dispose()
    const player = page.locator('.ftVideoPlayer')
    await expect.poll(() => player.locator('video').evaluate(element => element.readyState), { timeout: 30_000 }).toBe(4)
    await expect.poll(() => player.locator('.shaka-controls-button-panel > button').evaluateAll(elements => elements
      .map(element => ['shaka-overflow-menu-button', 'shaka-pip-button', 'caption-toggle-button', 'shaka-fullscreen-button']
        .find(className => element.classList.contains(className)))
      .filter(className => className != null)))
      .toEqual(['shaka-overflow-menu-button', 'shaka-pip-button'])

    // Captions stay available from the player menu.
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    await player.locator('.shaka-controls-button-panel > .shaka-overflow-menu-button').click()
    await expect(page.locator('.phonePlayerOptions[open] .shaka-caption-button')).toBeVisible()
  } finally {
    await page.evaluate(({ settings, originalRoute }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      if (window.__controlBarFetch) window.fetch = window.__controlBarFetch
      delete window.__controlBarFetch
      if (settings) {
        const { ControlBarButtons, ...values } = settings
        for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
        store.dispatch('updateControlBarButtons', ControlBarButtons)
      }
      location.hash = originalRoute
    }, { settings, originalRoute }).catch(() => {})
    await browser.close()
  }
})
