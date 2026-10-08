import { test, expect, setWindowSize, sel } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
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

for (const action of ['open', 'reload']) {
  test(`resumes a watch page ${action} started offline after reconnecting`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    if (action === 'reload') await openMockedVideo(page)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')

    if (action === 'open') {
      await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator(sel.searchInput).press('Enter')
    } else {
      const watch = await watchViewHandle(page)
      await watch.evaluate(vm => { vm.reloadView() })
      await watch.dispose()
    }
    const skeleton = page.locator('.videoPlayerPlaceholder.ft-shimmer')
    await expect(skeleton).toBeVisible()
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(skeleton).toHaveCount(0)
    await waitForPlayback(page)
    await expect(page.locator('.videoTitle')).toContainText('Me at the zoo')
  })
}

test('resumes watch metadata interrupted by a brief disconnect', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  let interrupted = false
  await page.route('https://www.youtube.com/watch?**', async route => {
    if (interrupted) return route.fallback()
    interrupted = true
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await route.abort('internetdisconnected')
  })
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator('.connectionStatus')).toHaveText('Offline')
  const skeleton = page.locator('.videoPlayerPlaceholder.ft-shimmer')
  await expect(skeleton).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(skeleton).toHaveCount(0)
  await waitForPlayback(page)
  await expect(page.locator('.videoTitle')).toContainText('Me at the zoo')
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
    // Lazy emoji images can become their alt text after losing connectivity.
    // Compare the same readable content in either rendering.
    const commentTexts = () => comments.evaluateAll(elements => elements.map(element => {
      const copy = element.cloneNode(true)
      copy.querySelectorAll('img[alt]').forEach(image => image.replaceWith(image.alt))
      return copy.textContent
    }))
    const loadedComments = await commentTexts()
    const recommendations = page.locator('.watchVideoRecommendations .h3Title')
    await expect(recommendations.first()).toBeVisible()
    const loadedRecommendations = await recommendations.allTextContents()
    await page.getByRole('button', { name: 'Open SponsorBlock info', exact: true }).first().click()
    const sponsorSegments = page.locator('.sponsorBlockSegment')
    await expect(sponsorSegments.first()).toBeVisible()
    const loadedSponsorSegments = await sponsorSegments.allTextContents()
    await watch.evaluate(vm => {
      vm.captions = [...vm.captions, { ...vm.captions[0], label: 'Other language' }]
      vm.showTranscript = true
    })
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
    await expect.poll(commentTexts).toEqual(loadedComments)
    await expect.poll(() => recommendations.allTextContents()).toEqual(loadedRecommendations)
    await expect.poll(() => sponsorSegments.allTextContents()).toEqual(loadedSponsorSegments)
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Reload Comments', exact: true }).first()).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Refresh SponsorBlock information', exact: true })).toBeDisabled()
    await expect(page.locator('.transcriptSegment')).not.toHaveCount(0)
    const transcriptLanguage = 'Transcript language'
    await expect(page.locator(`.transcriptHeaderAction[aria-label="${transcriptLanguage}"]`)).toBeDisabled()
    await watch.evaluate(vm => vm.closeTranscript())
    expect(await watch.evaluate(vm => vm.transcriptAvailable)).toBe(true)
    await watch.evaluate(vm => { vm.showTranscript = true })
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
    await expect.poll(commentTexts).toEqual(loadedComments)
    await expect.poll(() => recommendations.allTextContents()).toEqual(loadedRecommendations)
    await expect(page.getByRole('button', { name: 'Refresh SponsorBlock information', exact: true })).toBeEnabled()
    if (width === 480) {
      // A closed mobile sheet excludes its controls from role locators.
      await watch.evaluate(vm => { vm.openPhonePanel('comments') })
      await expect(page.locator('.dockedSheet[open] .commentThread').first()).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Reload Comments', exact: true }).first()).toBeEnabled()
    await watch.dispose()
  })
}

for (const isReplay of [false, true]) {
  test(`keeps loaded ${isReplay ? 'chat replay' : 'live chat'} messages and its session after losing connectivity`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watch = await watchViewHandle(page)
    await watch.evaluate(async (vm, replay) => {
      const listeners = new Map()
      vm.liveChat = {
        is_replay: replay,
        seeks: [],
        seekTo(seconds) { this.seeks.push(seconds) },
        async pollNext() {},
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
      vm.isLive = !replay
      vm.liveChatIsReplay = replay
      vm.liveChatOpen = true
      await vm.$nextTick()
    }, isReplay)
    const message = page.locator('.chatMessage')
    await expect(message).toHaveText('Already loaded chat message')
    await page.route(/^https?:\/\//, route => route.abort('internetdisconnected'))
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await watch.evaluate(vm => vm.liveChat.emitError(new TypeError('Failed to fetch')))
    if (isReplay) {
      const previousSeeks = await watch.evaluate(vm => vm.liveChat.seeks.length)
      await watch.evaluate(vm => {
        vm.liveChatSeekRequest = { seconds: 12 }
        vm.currentTime = 15
      })
      expect(await watch.evaluate(vm => vm.liveChat.seeks.length)).toBe(previousSeeks)
    }
    await expect(message).toHaveText('Already loaded chat message')
    expect(await watch.evaluate(vm => vm.liveChat.stopped)).toBe(false)
    await watch.evaluate(vm => vm.closeLiveChat())
    expect(await watch.evaluate(vm => vm.liveChatAvailable)).toBe(true)
    await watch.evaluate(vm => { vm.liveChatOpen = true })
    await expect(message).toHaveText('Already loaded chat message')
    expect(await watch.evaluate(vm => vm.liveChat.stopped)).toBe(false)
    await watch.dispose()
  })
}

test('does not expose unloaded comments or live chat after losing connectivity', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await expect(page.getByText('Click to View Comments', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.locator('.connectionStatus')).toHaveText('Offline')
  await expect(page.getByText('Click to View Comments', { exact: true })).toHaveCount(0)
  await watch.evaluate(vm => { vm.isLive = true })
  expect(await watch.evaluate(vm => vm.liveChatAvailable)).toBe(false)
  await expect(page.locator('.chatMessage')).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.dispatchEvent(new Event('online'))
  })
  await watch.evaluate(vm => { vm.isLive = false })
  await expect(page.getByText('Click to View Comments', { exact: true })).toBeVisible()
  await watch.dispose()
})

test('does not expose an unloaded transcript after losing connectivity', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  expect(await watch.evaluate(vm => vm.transcriptAvailable)).toBe(true)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.locator('.connectionStatus')).toHaveText('Offline')
  expect(await watch.evaluate(vm => vm.transcriptAvailable)).toBe(false)
  await watch.dispose()
})
