import { sel, setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { demoPlayerResponse } from '../../helpers/media.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

async function mockTranslatedEndscreen(app, page) {
  await mockPlayableWatchPage(app, page)

  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId, {
      endscreen: {
        endscreenRenderer: {
          elements: [{
            endscreenElementRenderer: {
              style: 'VIDEO',
              title: { simpleText: 'Translated end-screen title' },
              endpoint: { watchEndpoint: { videoId: 'end-screen-video' } },
              image: {
                thumbnails: [{
                  url: 'https://i.ytimg.com/vi/end-screen-video/hqdefault.jpg',
                  width: 480,
                  height: 270
                }]
              },
              left: '0.1',
              top: '0.1',
              width: '0.3',
              aspectRatio: '1.777',
              startMs: '0',
              endMs: '30000',
              id: 'original-title-annotation'
            }
          }],
          startMs: '0'
        }
      }
    })

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateAvoidTranslation', 'watch_only')
  })
}

test.describe('watch page', () => {
  test('does not speculate about live chat while availability loads', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let releaseMetadata
    await page.route(/\/youtubei\/v1\/next/, async (route) => {
      await new Promise(resolve => { releaseMetadata = resolve })
      await route.fallback()
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .sidebarArea > .liveChatSkeleton`)).toHaveCount(0)
    await expect(page.locator(`${activeTab} .sidebarArea > .recommendationsSkeleton`)).toBeVisible()

    await expect.poll(() => typeof releaseMetadata).toBe('function')
    releaseMetadata()
    await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible()
  })

  test('retries failed live chat avatars and preserves the pop-out target', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    let avatarRequests = 0
    await page.route('https://yt3.ggpht.com/e2e-live-chat-avatar*', (route) => {
      avatarRequests++
      return route.fulfill({ status: 500, body: '' })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const listeners = new Map()
      const liveChat = new EventTarget()
      liveChat.is_replay = false
      liveChat.on = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener)
      }
      liveChat.once = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener, { once: true })
      }
      liveChat.off = (_event, listener) => {
        liveChat.removeEventListener(listeners.get(listener), listener)
        listeners.delete(listener)
      }
      liveChat.emit = (event, value) => {
        for (const [listener, listenerEvent] of listeners) {
          if (listenerEvent === event) listener(value)
        }
      }
      liveChat.start = () => {}
      liveChat.stop = () => {}

      view.$store.commit('setHideLiveChat', false)
      view.liveChat = liveChat
      view.liveChatIsReplay = false
      view.liveChatOpen = true
      view.isLive = true
      view.isUpcoming = false
      await view.$nextTick()
    })

    await expect(page.locator(`${activeTab} .liveChatSkeleton`)).toBeVisible()
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateExternalLinkHandling', '')
      window.__e2eOpenedExternalUrl = null
      window.open = (url) => {
        window.__e2eOpenedExternalUrl = String(url)
        return null
      }
    })
    await page.getByRole('link', { name: 'Popout Chat' }).click()
    await expect.poll(() => page.evaluate(() => window.__e2eOpenedExternalUrl))
      .toBe('https://www.youtube.com/live_chat?is_popout=1&v=jNQXAC9IVRw')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await watchView.evaluate((view) => {
      let actionTypeChecks = 0
      view.liveChat.emit('start', {
        actions: [{
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: 'avatar-retry-message',
            timestamp: Date.now(),
            message: { runs: [{ text: 'Avatar retry' }] },
            author: {
              badges: [],
              id: 'avatar-retry-author',
              name: 'Avatar retry author',
              thumbnails: [{ url: 'https://yt3.ggpht.com/e2e-live-chat-avatar' }],
              is_moderator: false
            }
          }
        }]
      })
    })

    const avatar = page.locator(`${activeTab} .liveChatComments .channelThumbnail`).first()
    await expect(avatar).toHaveAttribute('src', /e2e-live-chat-avatar/)
    await expect.poll(() => avatarRequests, { timeout: 6_000 }).toBeGreaterThanOrEqual(2)
    await expect(avatar).toHaveAttribute('src', /opentubex_retry=/)
  })

  test('replay bursts follow and trim', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.locator('video.player').evaluate(element => element.pause())
    const view = await watchViewHandle(page)
    await view.evaluate(async view => {
      const listeners = new Map()
      const chat = new EventTarget()
      chat.is_replay = true
      chat.on = (event, listener) => listeners.set(listener, event)
      chat.once = chat.on
      chat.off = (_event, listener) => listeners.delete(listener)
      chat.stop = () => {}
      chat.pollNext = async () => {}
      chat.seekTo = () => {}
      chat.start = () => {
        for (const [listener, event] of listeners) {
          if (event !== 'start') continue
          listener({
            actions: Array.from({ length: 300 }, (_, id) => ({
              is: type => type.type === 'ReplayChatItemAction',
              video_offset_time_msec: id < 150 ? '1000' : '2000',
              actions: [{
                is: type => type.type === 'AddChatItemAction',
                item: {
                  is: type => type.type === 'LiveChatTextMessage',
                  id: `burst-${id}`,
                  message: { runs: [{ text: `Replay burst message ${id}` }] },
                  author: {
                    id: 'burst-author',
                    name: 'Replay author',
                    badges: [],
                    thumbnails: [{ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }]
                  }
                }
              }]
            }))
          })
        }
      }
      view.$store.commit('setHideLiveChatReplay', false)
      view.currentTime = 0
      view.liveChat = chat
      view.liveChatIsReplay = true
      view.liveChatOpen = true
      view.isLive = false
      view.isUpcoming = false
      await view.$nextTick()
    })
    const chat = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat Replay' })
    await expect(chat.locator('.liveChatMessage')).toBeVisible()
    const scroller = chat.locator('.liveChatComments')
    for (const seconds of [1, 2]) {
      await view.evaluate((view, seconds) => { view.currentTime = seconds }, seconds)
      await expect(scroller.locator('.comment')).toHaveCount(150)
      await expect(scroller.locator('.chatMessage').first()).toHaveText(`Replay burst message ${(seconds - 1) * 150}`)
      await expect.poll(() => scroller.evaluate(element =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
      )).toBeLessThanOrEqual(1)
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
    }
    // Seek clears the full list while playback remains paused.
    await view.evaluate(view => { view.liveChatSeekRequest = { seconds: 0 } })
    await expect(chat.locator('.liveChatMessage')).toBeVisible()
    await expect(chat.locator('.comment')).toHaveCount(0)
    // Empty chat replaces the viewport instead of retaining a zero-range scroller.
    await expect(scroller).toHaveCount(0)
    await expect(chat.locator('.os-scrollbar-vertical')).toHaveCount(0)
    await expect(chat.getByRole('button', { name: 'Scroll to Bottom' })).toHaveCount(0)
  })

  test('keeps replay messages after delayed playback updates and resets on actual seeks', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const video = page.locator('video.player')
    await video.evaluate(element => element.pause())
    const view = await watchViewHandle(page)
    await view.evaluate(async view => {
      const listeners = new Map()
      const chat = new EventTarget()
      chat.is_replay = true
      chat.on = (event, listener) => listeners.set(listener, event)
      chat.once = chat.on
      chat.off = (_event, listener) => listeners.delete(listener)
      chat.stop = () => {}
      chat.pollNext = async () => {}
      chat.seekTo = position => { chat.lastSeek = position }
      chat.start = () => {
        for (const [listener, event] of listeners) {
          if (event === 'start') {
            listener({
              actions: [{
                is: type => type.type === 'AddChatItemAction',
                item: {
                  is: type => type.type === 'LiveChatTextMessage',
                  id: 'delayed-update-message',
                  message: { runs: [{ text: 'Keep this replay message' }] },
                  author: {
                    id: 'replay-author',
                    name: 'Replay author',
                    badges: [],
                    thumbnails: [{ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }]
                  }
                }
              }]
            })
          }
        }
      }
      view.$store.commit('setHideLiveChatReplay', false)
      view.currentTime = 0
      view.liveChat = chat
      view.liveChatIsReplay = true
      view.liveChatOpen = true
      view.isLive = false
      view.isUpcoming = false
      await view.$nextTick()
    })
    const chat = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat Replay' })
    await expect(chat.getByText('Keep this replay message')).toBeVisible()

    // Simulate a throttled timeupdate without a media seek.
    await view.evaluate(async view => {
      view.currentTime = 8
      await view.$nextTick()
    })
    await expect(chat.getByText('Keep this replay message')).toBeVisible()
    await expect(chat.locator('.liveChatMessage')).toHaveCount(0)
    expect(await view.evaluate(view => view.liveChat.lastSeek)).toBeUndefined()

    // Exercise the real media event through the player and Watch into chat.
    await video.evaluate(element => { element.currentTime = 2.25 })
    await expect.poll(() => view.evaluate(view => view.liveChat.lastSeek)).toBe(2250)
    await expect(chat.locator('.liveChatMessage')).toBeVisible()
    await expect(chat.getByText('Keep this replay message')).toHaveCount(0)
  })

  test('keeps live chat and replay visibility independent and restores a closed chat', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const listeners = new Map()
      const liveChat = new EventTarget()
      liveChat.is_replay = true
      liveChat.on = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener)
      }
      liveChat.once = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener, { once: true })
      }
      liveChat.off = (_event, listener) => {
        liveChat.removeEventListener(listeners.get(listener), listener)
        listeners.delete(listener)
      }
      liveChat.emit = (event, value) => {
        for (const [listener, listenerEvent] of listeners) {
          if (listenerEvent === event) {
            listener(value)
          }
        }
      }
      liveChat.start = () => {}
      liveChat.stop = () => {}

      view.$store.commit('setHideLiveChat', true)
      view.$store.commit('setHideLiveChatReplay', false)
      view.liveChat = liveChat
      view.liveChatIsReplay = true
      view.liveChatOpen = true
      view.isLive = false
      view.isUpcoming = false
      await view.$nextTick()
    })

    const replay = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat Replay' })
    await expect(replay).toBeVisible()
    const skeleton = replay.locator('.liveChatSkeleton')
    await expect(skeleton).toBeVisible()
    await expect(skeleton.locator('.liveChatSkeletonMessage')).toHaveCount(24)
    expect(await skeleton.evaluate((element) => {
      const firstMessage = element.querySelector('.liveChatSkeletonMessage')
      const avatar = firstMessage.querySelector('.liveChatSkeletonAvatar')
      const author = firstMessage.querySelector('.liveChatSkeletonAuthor')
      const text = firstMessage.querySelector('.liveChatSkeletonText')
      const skeletonRect = element.getBoundingClientRect()

      return {
        avatarInset: avatar.getBoundingClientRect().top - skeletonRect.top,
        clipsOverflow: element.scrollHeight > element.clientHeight &&
          getComputedStyle(element).overflowY === 'hidden',
        linesAligned: Math.abs(author.getBoundingClientRect().top - text.getBoundingClientRect().top) <= 1
      }
    })).toEqual({
      avatarInset: 5,
      clipsOverflow: true,
      linesAligned: true
    })
    const skeletonLines = skeleton.locator('.liveChatSkeletonContent').first().locator('div')
    await expect(skeletonLines.nth(0)).toHaveCSS('block-size', '10px')
    await expect(skeletonLines.nth(1)).toHaveCSS('block-size', '10px')

    await setPlayerFullscreen(page, true)
    await page.locator('video.player').evaluate(element => element.pause())
    const fullscreenLiveChatToggle = page.locator('.fullscreenLiveChatToggle')
    await fullscreenLiveChatToggle.click({ force: true })
    const fullscreenChat = page.locator('.fullscreenLiveChatOverlay.open')
    const fullscreenSkeleton = fullscreenChat.locator('.liveChatSkeleton')
    await expect(fullscreenSkeleton).toBeVisible()
    const fullscreenSkeletonGeometry = await fullscreenSkeleton.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const firstMessageBounds = element.firstElementChild.getBoundingClientRect()
      const lastMessageBounds = element.lastElementChild.getBoundingClientRect()

      return {
        firstMessageInlineInset: Math.round(firstMessageBounds.left - bounds.left),
        lastMessageBlockInset: Math.round(bounds.bottom - lastMessageBounds.bottom)
      }
    })
    expect(fullscreenSkeletonGeometry.firstMessageInlineInset).toBe(16)
    expect(fullscreenSkeletonGeometry.lastMessageBlockInset).toBeGreaterThanOrEqual(0)
    expect(fullscreenSkeletonGeometry.lastMessageBlockInset).toBeLessThan(30)

    await watchView.evaluate((view) => {
      const actions = Array.from({ length: 60 }, (_, index) => {
        let actionTypeChecks = 0
        return {
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: `mock-live-chat-message-${index}`,
            timestamp: Date.now(),
            message: { runs: [{ text: `Mock live chat message ${index}` }] },
            author: {
              badges: [],
              id: `mock-live-chat-author-${index}`,
              name: `Chat author ${index}`,
              thumbnails: [{ url: '' }],
              is_moderator: false
            }
          }
        }
      })
      view.liveChat.emit('start', { actions })
    })

    const liveChatComments = fullscreenChat.locator('.liveChatComments')
    await expect(liveChatComments).toBeVisible()
    await expect(liveChatComments).toHaveClass(/atLiveEdge/)
    await expect.poll(() => liveChatComments.evaluate(
      element => element.scrollHeight > element.clientHeight
    )).toBe(true)
    await liveChatComments.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => liveChatComments.evaluate(
      element => element.scrollTop
    )).toBeGreaterThan(0)

    const readbackAnchor = liveChatComments.locator('.comment').filter({
      has: page.getByText('Mock live chat message 30', { exact: true })
    })
    await liveChatComments.dispatchEvent('wheel')
    await liveChatComments.evaluate((element) => {
      const anchor = Array.from(element.querySelectorAll('.comment'))
        .find(comment => comment.querySelector('.chatMessage')?.textContent === 'Mock live chat message 30')
      element.scrollTop = anchor.offsetTop
    })
    const anchorTop = await readbackAnchor.evaluate((element) => (
      element.getBoundingClientRect().top - element.closest('.liveChatComments').getBoundingClientRect().top
    ))

    await watchView.evaluate((view) => {
      for (let index = 60; index < 520; index++) {
        let actionTypeChecks = 0
        view.liveChat.emit('chat-update', {
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: `mock-live-chat-message-${index}`,
            timestamp: Date.now(),
            message: { runs: [{ text: `Mock live chat message ${index}` }] },
            author: {
              badges: [],
              id: `mock-live-chat-author-${index}`,
              name: `Chat author ${index}`,
              thumbnails: [{ url: '' }],
              is_moderator: false
            }
          }
        })
      }
    })

    await expect(liveChatComments.locator('.comment')).toHaveCount(500)
    await expect(liveChatComments.locator('.chatMessage').first()).toHaveText('Mock live chat message 20')
    await expect.poll(() => readbackAnchor.evaluate((element) => Math.round(
      element.getBoundingClientRect().top - element.closest('.liveChatComments').getBoundingClientRect().top
    ))).toBe(Math.round(anchorTop))
    expect(await liveChatComments.evaluate((element) => {
      const content = element.querySelector('.liveChatCommentList')
      const maximumScrollTop = Math.max(0, content.offsetTop + content.offsetHeight - element.clientHeight)
      return {
        maximumScrollTop,
        overflowing: maximumScrollTop > 0,
        scrollTop: element.scrollTop,
        withinRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toMatchObject({ overflowing: true, withinRange: true })
    await expect(liveChatComments.locator(':scope > .os-scrollbar-vertical'))
      .not.toHaveClass(/os-scrollbar-unusable/)
    await fullscreenChat.getByRole('button', { name: 'Scroll to Bottom' }).click()

    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
    await expect.poll(() => liveChatComments.evaluate(element =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
    )).toBeLessThanOrEqual(1)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toHaveCount(0)

    await liveChatComments.locator('.comment').evaluateAll((comments) => {
      for (const comment of comments.slice(3)) {
        comment.style.display = 'none'
      }
    })
    await expect.poll(() => liveChatComments.evaluate(element => ({
      fits: element.scrollHeight <= element.clientHeight,
      scrollTop: element.scrollTop
    }))).toEqual({ fits: true, scrollTop: 0 })
    await expect(liveChatComments.locator(':scope > .os-scrollbar-vertical'))
      .toHaveClass(/os-scrollbar-unusable/)

    await page.keyboard.press('Control+t')
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await page.locator('.tabBar .tab').first().click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await expect(page.locator(`${activeTab} .fullscreenLiveChatOverlay`)).toBeHidden()
    await expect(replay).toBeVisible()

    await setPlayerFullscreen(page, true)
    await expect(fullscreenChat).toBeVisible()
    await fullscreenLiveChatToggle.click({ force: true })
    await expect(fullscreenChat).toHaveCount(0)
    await setPlayerFullscreen(page, false)
    await watchView.evaluate((view) => {
      view.liveChat.dispatchEvent(new ErrorEvent('error', { message: 'Unavailable' }))
    })
    await expect(replay.locator('.messageContainer.hasError')).toBeVisible()
    await expect(replay.locator('.titleContainer')).toHaveCSS('margin-block-start', '0px')
    await replay.getByRole('button', { name: 'Close Live Chat Replay' }).click()
    await expect(replay).toHaveCount(0)

    const replayToggle = page.getByTitle('Show Live Chat Replay')
    await expect(replayToggle).toBeVisible()
    await replayToggle.click()
    await expect(replay).toBeVisible()
    await expect(replay.getByRole('button', { name: 'Close Live Chat Replay' })).toBeVisible()

    await watchView.evaluate(async (view) => {
      view.$store.commit('setHideLiveChat', false)
      view.$store.commit('setHideLiveChatReplay', true)
      await view.$nextTick()
    })
    await expect(replay).toHaveCount(0)
    await expect(page.getByTitle('Show Live Chat Replay')).toHaveCount(0)

    await watchView.evaluate(async (view) => {
      view.liveChat.is_replay = false
      view.liveChatIsReplay = false
      view.isLive = true
      await view.$nextTick()
    })
    const activeChat = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat' })
    await expect(activeChat).toBeVisible()
    await activeChat.getByRole('button', { name: 'Close Live Chat' }).click()
    await expect(activeChat).toHaveCount(0)

    const activeChatToggle = page.getByTitle('Show Live Chat')
    await expect(activeChatToggle).toBeVisible()
    await activeChatToggle.click()
    await expect(activeChat).toBeVisible()

    await activeChat.locator('.liveChatSkeleton').evaluate(element => {
      const owner = document.createElement('a')
      owner.className = 'channelName owner'
      owner.textContent = 'Channel owner'
      for (const attribute of element.getAttributeNames()) {
        if (attribute.startsWith('data-v-')) {
          owner.setAttribute(attribute, '')
        }
      }
      element.replaceWith(owner)
    })

    const owner = activeChat.locator('.channelName.owner', { hasText: 'Channel owner' })
    await expect(owner).toHaveCSS('border-radius', '2px')
    await page.locator('body').evaluate(element => {
      element.style.setProperty('--ui-roundness', '2')
    })
    await expect(owner).toHaveCSS('border-radius', '4px')
    await attachScreenshot('rounded live chat owner label')

    await watchView.evaluate(async (view) => {
      view.$store.commit('setHideLiveChat', true)
      await view.$nextTick()
    })
    await expect(activeChat).toHaveCount(0)
  })

  test('transitions a premiere when relative timestamp updates are disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.clock.install({ time: Date.now() })

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.$store.commit('setUpdateRelativeTimestamps', false)
      watchView.isLoading = false
      watchView.errorMessage = ''
      watchView.isUpcoming = true
      watchView.playabilityStatus = 'UNPLAYABLE'
      watchView.upcomingTimestamp = 'August 11 at 5:00 PM'
      watchView.upcomingTimeLeft = 'in less than a minute'
      watchView.premiereDate = new Date(Date.now() + 60_000)
      watchView.scheduleLiveReminderStartInvalidation()
      await watchView.$nextTick()
    })

    await expect(page.locator(`${activeTab} .premiereTextTimeLeft`)).toHaveCount(1)

    await page.clock.fastForward(60_001)

    await expect(page.locator(`${activeTab} .premiereTextTimeLeft`)).toHaveCount(0)
    await expect(page.locator(`${activeTab} .premiereText`)).toHaveText(
      'Starting soon, please refresh the page to check again'
    )
  })

  test('keeps original video titles in end-screen annotations', async ({ app, page }) => {
    await mockTranslatedEndscreen(app, page)
    await page.route(/\/oembed\?/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Original end-screen title' })
    }))

    await openMockedVideo(page)
    await waitForPlayback(page)

    await expect(page.locator(`${activeTab} .annotationTitleText`))
      .toHaveText('Original end-screen title')
  })

  test('does not replace an end-screen title after original text is disabled', async ({ app, page }) => {
    await mockTranslatedEndscreen(app, page)

    let releaseOembed
    let markOembedRequested
    const oembedRequested = new Promise((resolve) => { markOembedRequested = resolve })
    await page.route(/\/oembed\?/, async (route) => {
      markOembedRequested()
      await new Promise((resolve) => { releaseOembed = resolve })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'Original end-screen title' })
      })
    })

    await openMockedVideo(page)
    await waitForPlayback(page)
    await oembedRequested

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateAvoidTranslation', 'disabled')
    })
    const oembedResponse = page.waitForResponse(/\/oembed\?/)
    releaseOembed()
    await oembedResponse
    await page.waitForTimeout(100)

    await expect(page.locator(`${activeTab} .annotationTitleText`))
      .toHaveText('Translated end-screen title')
  })
})
