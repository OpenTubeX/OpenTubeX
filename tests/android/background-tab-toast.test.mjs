import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { SWIPE_VIDEO } from '../../e2e/helpers/thumbnail-swipe.mjs'
import { fulfillVisualFixture } from '../../e2e/helpers/visual-fixtures.mjs'

// Install the current debug APK on a locked emulator and forward its WebView
// socket before setting ANDROID_CDP_URL.
test('Android confirms opening a background tab while keeping the current page', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  const keepAlive = setTimeout(() => {}, 120_000)
  const thumbnailRoute = '**/vi/jNQXAC9IVRw/*'
  const serveThumbnail = route => fulfillVisualFixture(route, 'video-thumbnail')
  let saved
  let originalTabs
  try {
    await context.route(thumbnailRoute, serveThumbnail)
    await page.locator('.profileTrigger').waitFor()
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if (await skip.isVisible()) await skip.click()
    saved = await page.evaluate(async video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { CurrentLocale: 'en-US', EnableMobileTabs: true, CapacitorLayoutMode: 'phone', ListType: 'grid', ThumbnailPreference: '', BackendPreference: 'local' }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      const history = JSON.parse(JSON.stringify(store.getters.getHistoryCacheSorted))
      const route = location.hash
      for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
      store.commit('setHistoryCacheSorted', [video])
      store.commit('setHistoryCacheById', { [video.videoId]: video })
      location.hash = '#/history'
      return { settings, history, route }
    }, { ...SWIPE_VIDEO, title: 'Me at the zoo', author: 'jawed' })
    const tabState = () => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return { ids: store.getters.getTabs.map(tab => tab.id), presented: store.getters.getPresentedTabId }
    })
    const before = await tabState()
    originalTabs = before.ids
    const thumbnail = page.locator('.ft-list-video:visible .videoThumbnail').first()
    await thumbnail.scrollIntoViewIfNeeded()
    const box = await thumbnail.boundingBox()
    assert.ok(box)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]
    })
    await expect(page.locator('.mobileLinkActions')).toBeVisible()
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.getByRole('menuitem', { name: 'Open in a Background Tab', exact: true }).click()
    const toast = page.locator('.toast[role="status"]').filter({ hasText: 'Opened in a background tab' })
    await expect(toast).toBeVisible()
    await expect(toast).toHaveCount(1)
    await expect(toast.locator('img')).toBeVisible()
    await expect.poll(() => toast.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect.poll(async () => (await tabState()).ids.length).toBe(before.ids.length + 1)
    assert.equal((await tabState()).presented, before.presented)
    await expect(page).toHaveURL(/#\/history/)
    await expect(page.locator('.mobileLinkActions')).toHaveCount(0)
    if (process.env.ANDROID_EVIDENCE_DIR) {
      await mkdir(process.env.ANDROID_EVIDENCE_DIR, { recursive: true })
      await page.screenshot({ path: `${process.env.ANDROID_EVIDENCE_DIR}/background-tab-toast.png` })
    }
    await expect(toast).toHaveCount(0, { timeout: 10_000 })
  } finally {
    if (originalTabs) {
      await page.evaluate(async originalTabs => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const created = store.getters.getTabs.filter(tab => !originalTabs.includes(tab.id))
        for (const tab of created) await store.dispatch('closeTab', tab.id)
      }, originalTabs)
    }
    if (saved) {
      await page.evaluate(async saved => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
        store.commit('setHistoryCacheSorted', saved.history)
        store.commit('setHistoryCacheById', Object.fromEntries(saved.history.map(item => [item.videoId, item])))
        location.hash = saved.route
      }, saved)
    }
    clearTimeout(keepAlive)
    await session.detach()
    await context.unroute(thumbnailRoute, serveThumbnail)
    await browser.close()
  }
})
