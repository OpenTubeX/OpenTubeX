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

test('disconnecting removes cached end-screen recommendations and their autoplay countdown', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.recommendedVideos = [{ videoId: 'recommended1', title: 'Online recommendation' }]
    vm.autoplayCountdown = { remainingSeconds: 10, video: vm.recommendedVideos[0] }
  })
  await expect.poll(() => watch.evaluate(vm => vm.endScreenRecommendations.length)).toBe(1)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect.poll(() => watch.evaluate(vm => ({
    endScreenCount: vm.endScreenRecommendations.length,
    hasNextRecommendation: !!vm.nextRecommendedVideo,
    countdown: vm.autoplayCountdown,
  }))).toEqual({ endScreenCount: 0, hasNextRecommendation: false, countdown: null })
})

test('disconnecting closes a format picker that has no local sources', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.locator('.watchVideoInfo').getByRole('button', { name: 'Change Media Formats', exact: true }).click()
  await expect(page.locator('.formatPrompt')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.locator('.formatPrompt')).toHaveCount(0)
})
