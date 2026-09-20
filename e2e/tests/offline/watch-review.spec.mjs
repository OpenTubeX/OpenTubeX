import { readFile } from 'node:fs/promises'
import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 0, enableSearchSuggestions: false, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('phone queue previews the next item and opens its panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.$store.commit('addVideoToWatchQueue', {
    video: { videoId: 'next-video1', title: 'Next queued video', author: 'Channel', authorId: 'channel-id', lengthSeconds: 120 }
  }))
  const preview = page.locator('.phoneQueueButton')
  await expect(preview).toContainText('Next queued video')
  await preview.click()
  await expect(page.locator('.dockedSheet[open] .watchVideoQueue')).toBeVisible()
})

test('downloaded playback without metadata hides unavailable channel actions and recommendations', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.localFilePlayback = true
    vm.channelId = ''
    vm.channelName = ''
    vm.recommendedVideos = []
  })
  await expect(page.locator('.watchVideoRecommendations')).toHaveCount(0)
  await expect(page.locator('.watchVideo .ftSubscribeButton')).toHaveCount(0)
})

test('Android native controls leave the actual phone search input and suggestions uncovered', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.navSearchButton').click()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSearchHistoryEntries', ['example one', 'example two', 'example three'].map(query => ({ _id: query, lastUpdatedAt: Date.now() })))
  })
  await page.locator('.searchInput input').fill('example')
  await page.locator('.searchInput input').press('ArrowDown')
  await expect(page.locator('.searchInput .list')).toBeVisible()
  const source = (await readFile(new URL('../../../src/renderer/helpers/player/androidNativeScreen.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace('export function ', 'function ')
  const result = await page.evaluate(async source => {
    // Execute the repository's layout helper against real DOM geometry.
    // eslint-disable-next-line no-new-func
    const create = new Function('createMiniControlsSnapshot', `${source}; return createAndroidNativeScreen`)(
      () => ({ update() {}, invalidate() {}, destroy() {} })
    )
    const layouts = []
    const container = document.querySelector('.ftVideoPlayer')
    const native = create({
      container,
      element: container.querySelector('video'),
      getController: () => ({ show: async () => {}, layout: async value => layouts.push(value) }),
      getLocale: () => 'en-US',
      onError: error => { throw error }
    })
    await native.attach()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const bounds = ['.searchContainer', '.searchInput .list'].map(selector => document.querySelector(selector).getBoundingClientRect().toJSON())
    const menus = layouts.at(-1).menus
    native.destroy()
    return { bounds, menus }
  }, source)
  for (const bounds of result.bounds) {
    expect(bounds.height).toBeGreaterThan(0)
    expect(result.menus.some(menu => Math.abs(menu.x - bounds.x) < 1 && Math.abs(menu.y - bounds.y) < 1 && Math.abs(menu.height - bounds.height) < 1)).toBe(true)
  }
})
