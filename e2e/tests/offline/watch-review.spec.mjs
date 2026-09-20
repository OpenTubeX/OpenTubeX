import { readFile } from 'node:fs/promises'
import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 0, useSponsorBlock: true, enableSearchSuggestions: false, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

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

test('offline recommendations hidden by preferences do not leave an empty card', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    await vm.$store.dispatch('updateForbiddenTitles', JSON.stringify(['blocked']))
    vm.localFilePlayback = true
    vm.recommendedVideos = [{ videoId: 'blocked0001', title: 'Blocked video', author: 'Channel', authorId: 'channel-id' }]
  })
  await expect(page.locator('.watchVideoRecommendations')).toHaveCount(0)
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

test('offline watch hides unavailable statistics and network actions even with a saved channel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.resetVideoState({ preserveTitle: true })
    vm.isLoading = false
    vm.localFilePlayback = true
    vm.channelId = 'saved-channel'
    vm.channelName = 'Saved channel'
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  const info = page.locator('.watchVideoInfo')
  await expect.soft(info.locator('.videoViews')).toHaveCount(0)
  await expect.soft(info.locator('.likeBarContainer')).toHaveCount(0)
  await expect.soft(info.locator('.datePublishedAndViewCount')).toBeEmpty()
  await expect.soft(page.locator('.phoneCommentsButton')).toHaveCount(0)
  await expect.soft(info.getByRole('button', { name: 'Download Video', exact: true })).toHaveCount(0)
  await expect.soft(info.getByRole('button', { name: 'Open SponsorBlock info', exact: true })).toHaveCount(0)
})

test('offline format picker keeps local sources and restores network actions on reconnect', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.localFilePlayback = true
    vm.$store.commit('upsertYtDlpDownload', {
      id: 91,
      status: 'completed',
      mode: 'video',
      files: [{ videoId: vm.videoId, path: '/offline-video.mp4' }]
    })
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  const info = page.locator('.watchVideoInfo')
  await info.getByRole('button', { name: 'Change Media Formats', exact: true }).click()
  await expect(page.locator('.formatOption')).toHaveCount(1)
  await expect(page.locator('.formatOption')).toBeEnabled()
  await expect(page.locator('.engineSelector')).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.locator('.formatOption')).toHaveCount(2)
  await expect(info.getByRole('button', { name: 'Download Video', exact: true })).toHaveCount(1)
  await expect(page.locator('.phoneCommentsButton')).toHaveCount(1)
})

test('known zero statistics remain visible without a leading separator when publication data is missing', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.videoPublished = 0
    vm.videoCategory = ''
    vm.videoViewCount = 0
    vm.videoLikeCount = 0
    vm.videoDislikeCount = 0
  })
  const info = page.locator('.watchVideoInfo')
  await expect(info.locator('.videoViews')).toHaveText('0 views')
  await expect(info.locator('.likeCount')).toHaveText('0')
  for (const zoom of [1, 0.95, 1.25]) {
    await info.evaluate((element, zoom) => { element.style.zoom = zoom }, zoom)
    expect(await info.locator('.videoViews').evaluate(element => {
      const before = getComputedStyle(element, '::before')
      return ['none', 'normal'].includes(before.content)
    })).toBe(true)
  }
})

test('custom Shorts hides SponsorBlock offline and restores it on reconnect', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.useCustomShortsPlayerForCurrentVideo = true
    vm.isShort = true
  })
  const sponsorBlock = page.locator('.shortsActionRail').getByRole('button', { name: 'Open SponsorBlock info', exact: true })
  await expect(sponsorBlock).toHaveCount(1)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(sponsorBlock).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(sponsorBlock).toHaveCount(1)
})
