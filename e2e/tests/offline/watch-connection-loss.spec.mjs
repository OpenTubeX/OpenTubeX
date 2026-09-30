import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      generalAutoLoadMorePaginatedItemsEnabled: false,
      animationSpeed: 0,
      useSponsorBlock: true,
    }
  }
})

for (const width of [1600, 480]) {
  test(`keeps loaded watch content after losing connectivity at ${width}px`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'], commentTimestamp: true })
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{ UUID: 'loaded-sponsor', actionType: 'skip', category: 'sponsor', segment: [15, 20], videoDuration: 30, votes: 1 }]
      }])
    }))
    await openMockedVideo(page)
    await page.locator('video.player').evaluate(video => video.pause())
    const watch = await watchViewHandle(page)
    await page.getByText('Click to View Comments', { exact: true }).click()
    const comments = page.locator('.commentThread')
    await expect(comments.first()).toBeVisible()
    const loadedComments = await comments.allTextContents()
    const recommendations = page.locator('.watchVideoRecommendations .h3Title')
    await expect(recommendations.first()).toBeVisible()
    const loadedRecommendations = await recommendations.allTextContents()
    await page.getByRole('button', { name: 'Open SponsorBlock info', exact: true }).first().click()
    const sponsorSegments = page.locator('.sponsorBlockSegment')
    await expect(sponsorSegments.first()).toBeVisible()
    const loadedSponsorSegments = await sponsorSegments.allTextContents()
    await watch.evaluate(vm => { vm.showTranscript = true })
    await expect(page.locator('.transcriptSegment').first()).toBeVisible()

    if (width === 480) {
      await setWindowSize(app, page, { width, height: 800 })
      await watch.evaluate(vm => { vm.mobilePanel = 'comments' })
      await expect(page.locator('.dockedSheet[open] .commentThread').first()).toBeVisible()
    }
    const disconnectRequests = route => route.abort('internetdisconnected')
    await page.route(/^https?:\/\//, disconnectRequests)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await expect.poll(() => comments.allTextContents()).toEqual(loadedComments)
    await expect.poll(() => recommendations.allTextContents()).toEqual(loadedRecommendations)
    await expect.poll(() => sponsorSegments.allTextContents()).toEqual(loadedSponsorSegments)
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Refresh SponsorBlock information', exact: true })).toBeDisabled()
    await expect(page.locator('.transcriptSegment')).not.toHaveCount(0)
    if (width === 480) {
      await expect(page.locator('.dockedSheet[open] .commentThread').first()).toBeVisible()
    }
    await page.unroute(/^https?:\/\//, disconnectRequests)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
    })
    await expect.poll(() => watch.evaluate(vm => vm.isOffline)).toBe(false)
    await expect.poll(() => comments.allTextContents()).toEqual(loadedComments)
    await expect.poll(() => recommendations.allTextContents()).toEqual(loadedRecommendations)
    await expect(page.getByRole('button', { name: 'Refresh SponsorBlock information', exact: true })).toBeEnabled()
    await watch.dispose()
  })
}

test('keeps loaded live chat messages and its session after losing connectivity', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    const listeners = new Map()
    vm.liveChat = {
      is_replay: false,
      stopped: false,
      on: (event, listener) => listeners.set(listener, event),
      once: (event, listener) => listeners.set(listener, event),
      off: (_event, listener) => listeners.delete(listener),
      emitError(error) {
        for (const [listener, event] of listeners) {
          if (event === 'error') listener(error)
        }
      },
      stop() { this.stopped = true },
      start() {
        for (const [listener, event] of listeners) {
          if (event !== 'start') continue
          listener({
            actions: [{
              is: type => type.type === 'AddChatItemAction',
              item: {
                is: type => type.type === 'LiveChatTextMessage',
                id: 'loaded-chat-message',
                message: { runs: [{ text: 'Already loaded chat message' }] },
                author: {
                  id: 'chat-author',
                  name: 'Chat author',
                  badges: [],
                  thumbnails: [{ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }]
                }
              }
            }]
          })
        }
      }
    }
    vm.isLive = true
    vm.liveChatOpen = true
    await vm.$nextTick()
  })
  const message = page.locator('.chatMessage')
  await expect(message).toHaveText('Already loaded chat message')
  await page.route(/^https?:\/\//, route => route.abort('internetdisconnected'))
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.locator('.connectionStatus')).toHaveText('Offline')
  await watch.evaluate(vm => vm.liveChat.emitError(new TypeError('Failed to fetch')))
  await expect(message).toHaveText('Already loaded chat message')
  expect(await watch.evaluate(vm => vm.liveChat.stopped)).toBe(false)
  await watch.dispose()
})
