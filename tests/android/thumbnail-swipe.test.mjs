import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goTo } from '../../e2e/helpers/app.mjs'
import { SWIPE_VIDEO, verifyThumbnailSwipes, verifyPlaylistSwipeRemoval, verifyCopySwipe, verifySwipeDownloadAvailability } from '../../e2e/helpers/thumbnail-swipe.mjs'

// Acquire the emulator's lab lock, install a current debug APK, forward its
// WebView socket, and set ANDROID_CDP_URL to run this acceptance test.
test('Android thumbnail swipes use video actions and preserve mobile navigation', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  let saved
  let clipboard
  try {
    await page.locator('.profileTrigger').waitFor()
    clipboard = await page.evaluate(() => window.Capacitor.Plugins.Clipboard.read().catch(() => null))
    saved = await page.evaluate(async video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        ThumbnailLeftSwipeAction: 'disabled',
        ThumbnailRightSwipeAction: 'disabled',
        CapacitorLayoutMode: 'phone',
        CurrentLocale: 'en-US',
        HidePlaylists: false,
        KeepPlayingOnNavigation: false,
        ListType: 'grid',
        EnableDownloads: true,
        ReducedMotion: 'off',
        BackendFallback: true,
      }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      const history = JSON.parse(JSON.stringify(store.getters.getHistoryCacheSorted))
      const queue = JSON.parse(JSON.stringify(store.getters.getWatchQueue))
      const route = location.hash
      for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
      store.commit('setHistoryCacheSorted', [video])
      store.commit('setHistoryCacheById', { [video.videoId]: video })
      store.commit('clearWatchQueue')
      location.hash = '#/history'
      return { settings, history, queue, route }
    }, SWIPE_VIDEO)
    await expect(page.locator('.ft-list-video .title').first()).toContainText(SWIPE_VIDEO.title)
    await verifyCopySwipe(page, session, () => page.evaluate(async () => (await window.Capacitor.Plugins.Clipboard.read()).value))
    await mkdir('/tmp/opentubex-swipe-evidence', { recursive: true })
    await verifyThumbnailSwipes(page, session, name => page.screenshot({ path: `/tmp/opentubex-swipe-evidence/android-${name.replaceAll(' ', '-')}.png` }))
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'on'))
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'reduce')
    await verifyThumbnailSwipes(page, session, name => page.screenshot({ path: `/tmp/opentubex-swipe-evidence/android-reduced-motion-${name.replaceAll(' ', '-')}.png` }))

    await goTo(page, 'settings')
    const left = page.getByRole('combobox', { name: 'Swipe left on thumbnails', exact: true })
    const right = page.getByRole('combobox', { name: 'Swipe right on thumbnails', exact: true })
    if (!await left.isVisible()) await page.locator('.settingsMenu [data-section="general"]').click()
    await left.scrollIntoViewIfNeeded()
    await expect(left).toBeVisible()
    await verifySwipeDownloadAvailability(page)
    await left.click()
    await expect(page.getByRole('option', { name: 'Share Link', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Download Video', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'Mark As Watched', exact: true }).click()
    await right.click()
    await page.getByRole('option', { name: 'Disabled', exact: true }).click()
    await expect(left.locator('..').locator('select')).toHaveValue('history')
    await expect(right.locator('..').locator('select')).toHaveValue('disabled')
    await page.screenshot({ path: '/tmp/opentubex-swipe-evidence/android-settings.png' })
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toHaveCount(0)
    await expect(page).toHaveURL(/#\/history/)
    await verifyPlaylistSwipeRemoval(page, session, name => page.screenshot({ path: `/tmp/opentubex-swipe-evidence/android-${name.replaceAll(' ', '-')}.png` }))
  } finally {
    if (saved) {
      await page.evaluate(async saved => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
        store.commit('setHistoryCacheSorted', saved.history)
        store.commit('setHistoryCacheById', Object.fromEntries(saved.history.map(item => [item.videoId, item])))
        store.commit('clearWatchQueue')
        for (const video of saved.queue) store.commit('addVideoToWatchQueue', { video })
        location.hash = saved.route
      }, saved)
    }
    if (clipboard !== undefined) {
      await page.evaluate(clipboard => {
        const plugin = window.Capacitor.Plugins.Clipboard
        if (!clipboard) return plugin.write({ text: '' })
        const key = clipboard.type === 'HTML' ? 'html' : clipboard.type === 'IMAGE' ? 'image' : clipboard.type === 'URL' ? 'url' : 'text'
        return plugin.write({ [key]: clipboard.value })
      }, clipboard)
    }
    await session.detach()
    await browser.close()
  }
})
