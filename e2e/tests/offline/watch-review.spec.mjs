import path from 'node:path'
import { test, expect, repoRoot, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function expectWatchScrollRange(page) {
  await expect.poll(() => page.evaluate(() => {
    const layout = document.querySelector('.videoLayout')
    const renderedEnd = layout.getBoundingClientRect().bottom + window.scrollY
    const maximum = Math.max(0, renderedEnd - window.innerHeight)
    const documentMaximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
    const track = scrollbar?.querySelector('.os-scrollbar-track')?.getBoundingClientRect()
    const handle = scrollbar?.querySelector('.os-scrollbar-handle')?.getBoundingClientRect()
    const scrollbarMatches = documentMaximum <= 1
      ? scrollbar?.classList.contains('os-scrollbar-unusable')
      : track && handle && scrollbar.classList.contains('os-scrollbar-visible') &&
        Math.abs(handle.top - track.top - window.scrollY / documentMaximum * (track.height - handle.height)) <= 2
    return {
      rangeMatches: Math.abs(documentMaximum - maximum) <= 2,
      withinRange: window.scrollY <= maximum + 2,
      scrollbarMatches: Boolean(scrollbarMatches),
    }
  })).toEqual({ rangeMatches: true, withinRange: true, scrollbarMatches: true })
}

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

test.describe('download opened without a connection', () => {
  test.use({
    seed: {
      settings: { animationSpeed: 0, enableDownloads: true, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true },
      downloads: [
        {
          id: 91,
          videoId: 'jNQXAC9IVRw',
          title: 'Offline download',
          status: 'completed',
          mode: 'video',
          percent: 100,
          destination: path.join(repoRoot, 'e2e/fixtures/media/demo.webm'),
          files: [{ videoId: 'jNQXAC9IVRw', path: path.join(repoRoot, 'e2e/fixtures/media/demo.webm'), extension: 'webm' }]
        },
        {
          id: 92,
          videoId: 'otherVideo1',
          title: 'Other saved video',
          status: 'completed',
          mode: 'video',
          percent: 100,
          destination: path.join(repoRoot, 'e2e/fixtures/media/demo.webm'),
          files: [{ videoId: 'otherVideo1', path: path.join(repoRoot, 'e2e/fixtures/media/demo.webm'), extension: 'webm' }]
        }
      ]
    }
  })

  test('collapses the offline page and restores metadata after reconnecting', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'Downloads' }).click()
    await page.locator('.downloadRow').filter({ hasText: 'Offline download' }).getByRole('button', { name: 'Play download', exact: true }).click()
    await expect(page.locator('.ftVideoPlayer')).toBeVisible()
    const video = await page.locator('.ftVideoPlayer video').elementHandle()
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Other saved video')
    await expect(page.locator('.watchVideoRecommendations a[href*="downloadId=92"]')).toBeVisible()
    for (const scale of [1, 0.95, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      await expect.poll(() => page.evaluate(() => {
        const contentEnd = document.querySelector('.watchVideoRecommendations').getBoundingClientRect().bottom + window.scrollY
        return document.documentElement.scrollHeight - Math.max(window.innerHeight, contentEnd)
      })).toBeLessThan(48)
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const watch = await watchViewHandle(page)
    await watch.evaluate(vm => vm.$store.dispatch('updateForbiddenTitles', JSON.stringify(['Other saved'])))
    await expect(page.locator('.watchVideoRecommendations')).toHaveCount(0)
    await expectWatchScrollRange(page)
    await watch.evaluate(vm => vm.$store.dispatch('updateForbiddenTitles', '[]'))
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Other saved video')

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await watch.evaluate(vm => vm.$store.dispatch('updateHideRecommendedVideos', true))
    await expect(page.locator('.watchVideoRecommendations')).toHaveCount(0)
    await expectWatchScrollRange(page)
    await watch.evaluate(vm => vm.$store.dispatch('updateHideRecommendedVideos', false))
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Other saved video')

    const otherDownload = await watch.evaluate(vm => vm.$store.getters.getYtDlpDownloads[92])
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await watch.evaluate(vm => vm.$store.commit('removeYtDlpDownload', 92))
    await expect(page.locator('.watchVideoRecommendations')).toHaveCount(0)
    await expectWatchScrollRange(page)
    await watch.evaluate((vm, download) => vm.$store.commit('upsertYtDlpDownload', download), otherDownload)
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Other saved video')

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Back online')
    await expect(page.locator('.watchVideoRecommendations')).toBeVisible()
    await expect(page.locator('.watchVideoRecommendations')).not.toContainText('Other saved video')
    await expect(page.locator('.watchVideoInfo').getByRole('button', { name: /transcript/i })).toBeVisible()
    await expect(page.locator('.ftVideoPlayer')).toBeVisible()
    expect(await video.evaluate(element => element.isConnected)).toBe(true)
    await expectWatchScrollRange(page)
  })

  test('lists downloads beyond the first twelve', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'Downloads' }).click()
    await page.locator('.downloadRow').filter({ hasText: 'Offline download' }).getByRole('button', { name: 'Play download', exact: true }).click()
    await expect(page.locator('.ftVideoPlayer')).toBeVisible()
    const watch = await watchViewHandle(page)
    await watch.evaluate((vm, mediaPath) => {
      for (let index = 0; index < 13; index++) {
        vm.$store.commit('upsertYtDlpDownload', {
          id: 100 + index,
          videoId: `moreVideo${index}`,
          title: `Saved video ${index}`,
          status: 'completed',
          mode: 'video',
          files: [{ videoId: `moreVideo${index}`, path: mediaPath, extension: 'webm' }]
        })
      }
    }, path.join(repoRoot, 'e2e/fixtures/media/demo.webm'))
    await expect(page.locator('.watchVideoRecommendations a')).toHaveCount(14)
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Saved video 0')
  })

  test('restores Invidious recommendations and transcript without replacing the saved player', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://invidious.test/api/v1/videos/**', route => route.fulfill({
      json: {
        title: 'Restored Invidious video',
        viewCount: 1,
        paid: false,
        subCountText: '1',
        likeCount: 1,
        dislikeCount: 0,
        author: 'Test Channel',
        authorId: 'UC-test-channel-id',
        authorThumbnails: [],
        description: '',
        descriptionHtml: '',
        published: 1_700_000_000,
        recommendedVideos: [{ videoId: 'onlineVideo1', title: 'Online suggestion', author: 'Test Channel', authorId: 'UC-test-channel-id' }],
        liveNow: false,
        premiereTimestamp: 0,
        isFamilyFriendly: true,
        isPostLiveDvr: false,
        isListed: true,
        captions: [{ url: '/api/v1/captions/jNQXAC9IVRw?label=English', label: 'English', language_code: 'en' }],
        lengthSeconds: 10,
        formatStreams: [],
        adaptiveFormats: [],
        videoThumbnails: [{ url: '/vi/jNQXAC9IVRw/hqdefault.jpg', width: 480, height: 360 }],
      }
    }))
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await Promise.all([
        store.dispatch('updateBackendPreference', 'invidious'),
        store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test'),
        store.dispatch('updateHideChapters', true),
      ])
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'Downloads' }).click()
    await page.locator('.downloadRow').filter({ hasText: 'Offline download' }).getByRole('button', { name: 'Play download', exact: true }).click()
    const video = await page.locator('.ftVideoPlayer video').elementHandle()
    const source = await video.evaluate(element => element.currentSrc)
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Other saved video')

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Online suggestion')
    await expect(page.locator('.watchVideoInfo').getByRole('button', { name: /transcript/i })).toBeVisible()
    expect(await video.evaluate((element, expectedSource) => element.isConnected && element.currentSrc === expectedSource, source)).toBe(true)
  })

  test('falls back to Local metadata when Invidious fails after reconnecting', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
    await page.route('https://invidious.test/api/v1/videos/**', route => route.fulfill({
      status: 503,
      json: { error: 'Instance unavailable' }
    }))
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await Promise.all([
        store.dispatch('updateBackendPreference', 'invidious'),
        store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test'),
        store.dispatch('updateBackendFallback', true),
      ])
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'Downloads' }).click()
    await page.locator('.downloadRow').filter({ hasText: 'Offline download' }).getByRole('button', { name: 'Play download', exact: true }).click()
    const video = await page.locator('.ftVideoPlayer video').elementHandle()
    const source = await video.evaluate(element => element.currentSrc)
    await expect(page.locator('.watchVideoRecommendations')).toContainText('Other saved video')

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(page.locator('.watchVideoRecommendations')).not.toContainText('Other saved video')
    await expect(page.locator('.watchVideoInfo').getByRole('button', { name: /transcript/i })).toBeVisible()
    expect(await video.evaluate((element, expectedSource) => element.isConnected && element.currentSrc === expectedSource, source)).toBe(true)
  })

  test('an offline suggestion opens its saved file', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'Downloads' }).click()
    await page.locator('.downloadRow').filter({ hasText: 'Offline download' }).getByRole('button', { name: 'Play download', exact: true }).click()
    await page.locator('.watchVideoRecommendations a[href*="downloadId=92"]').first().click()
    await expect(page).toHaveURL(/#\/watch\/otherVideo1\?downloadId=92/)
    await expect(page.locator('.ftVideoPlayer')).toBeVisible()
    await expect(page.locator('.videoTitle')).toContainText('Other saved video')
  })
})
