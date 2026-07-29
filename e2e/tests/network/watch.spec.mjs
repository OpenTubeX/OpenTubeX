import { sel } from '../../helpers/app.mjs'
import { test, expect, setPlayerFullscreen } from '../../helpers/innertube.mjs'
import { waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const CAPTIONED_VIDEO = {
  id: 'Xf-uUy5pdUI',
  title: 'What’s It Like to Be Killed by Nature’s Most Brutal Predator',
  url: 'https://www.youtube.com/watch?v=Xf-uUy5pdUI'
}

function longTranscript() {
  const timestamp = (seconds) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds % 3600 / 60)
    const remainingSeconds = seconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.000`
  }

  return `WEBVTT\n\n${Array.from({ length: 5000 }, (_, index) => (
    `${timestamp(index)} --> ${timestamp(index + 1)}\nTranscript line ${index}.`
  )).join('\n\n')}\n`
}

async function openVideo(page, video = { id: 'jNQXAC9IVRw', title: 'Me at the zoo', url: VIDEO_URL }) {
  await page.locator(sel.searchInput).fill(video.url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${video.id}`))
  await expect(page.locator('.videoTitle')).toContainText(video.title, { timeout: 30_000 })

  const player = page.locator('.ftVideoPlayer')
  const errorMessage = page.locator('.errorMessage')
  await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })

  const errorText = await errorMessage.isVisible()
    ? (await errorMessage.textContent())?.trim() ?? ''
    : ''
  test.skip(
    /blocked your IP|Ratelimited|IP block/i.test(errorText),
    `watch page unavailable from the live API: ${errorText}`
  )
}

async function openCaptionedVideoOrSkip(page) {
  await page.locator(sel.searchInput).fill(CAPTIONED_VIDEO.url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_VIDEO.id}`))

  const title = page.locator('.videoTitle')
  const errorMessage = page.locator('.errorMessage')
  try {
    await expect(title).toContainText(CAPTIONED_VIDEO.title, { timeout: 30_000 })
  } catch (error) {
    const unavailable = await errorMessage.isVisible() || (await title.textContent())?.trim() === ''
    test.skip(unavailable, 'captioned test video did not hydrate from the live API')
    throw error
  }
}

async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

test.describe('background watch tab', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: true
      }
    }
  })

  test('auto-loads comments for a video opened in the background', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.evaluate((route) => window.ftElectron.tabs.create({
      route,
      makeActive: false
    }), '/watch/jNQXAC9IVRw')

    const backgroundTab = page.locator(sel.tabs).nth(1)
    const backgroundContent = page.locator('.tabContent[aria-hidden="true"]').nth(0)
    await expect(backgroundContent.locator('.videoTitle')).toContainText('Me at the zoo', { timeout: 30_000 })
    await expect(backgroundContent.locator('.commentsTitle')).toHaveCount(1, { timeout: 30_000 })
    await expect(backgroundContent.locator('.comment')).not.toHaveCount(0, { timeout: 30_000 })

    await backgroundTab.click()
    await expect(page.locator('.commentsTitle')).toBeVisible()
  })
})

test.describe('watch page', () => {
  test('shows video metadata', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await expect(page.getByText('jawed').first()).toBeVisible()
    await expect(page.locator(sel.activeTab).locator('.tabAvatar')).toBeVisible()
  })

  test('the sidebar panels use overlay scrollbars', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    // Whether these overflow depends on the video, so assert that the directive
    // took hold rather than measuring widths: the panel stays the scrolling
    // element and gets its own overlay scrollbars.
    for (const selector of ['.descriptionScroll', '.commentsContentWrapper']) {
      await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator(`${selector}[data-overlayscrollbars-viewport]`)).toHaveCount(1)
      await expect(page.locator(`${selector} > .os-scrollbar-vertical`)).toHaveCount(1)
    }
  })

  test('playback starts', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)
    await expect
      .poll(async () => await video.evaluate((el) => el.currentTime), { timeout: 30_000 })
      .toBeGreaterThan(1)
  })

  test('keeps the context menu open when the pointer leaves a playing video', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    await waitForPlaybackOrSkip(test, page)
    await page.locator('.ftVideoPlayer').click({ button: 'right' })

    const contextMenu = page.locator('.shaka-context-menu')
    await expect(contextMenu).toBeVisible()

    await page.mouse.move(0, 0)
    await page.waitForTimeout(3500)
    await expect(contextMenu).toBeVisible()
  })

  // Regression: playback speed controls stopped working (1c958d468)
  test('keyboard shortcuts change the playback rate', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)

    await page.locator('body').press('p')
    await expect.poll(async () => await video.evaluate((el) => el.playbackRate)).toBeGreaterThan(1)
    const raisedRate = await video.evaluate((el) => el.playbackRate)

    await page.locator('body').press('o')
    await expect.poll(async () => await video.evaluate((el) => el.playbackRate)).toBeLessThan(raisedRate)
  })

  test('long transcripts quickly align with the current cue', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.route(/\/api\/timedtext/, route => route.fulfill({
      body: longTranscript(),
      contentType: 'text/vtt'
    }))
    await openCaptionedVideoOrSkip(page)
    await waitForPlaybackOrSkip(test, page)

    const video = page.locator('video.player')
    const targetTime = await video.evaluate((element) => {
      element.pause()
      const time = Math.min(3600, Math.floor(element.duration / 2))
      element.currentTime = time
      element.dispatchEvent(new Event('timeupdate'))
      return time
    })
    expect(targetTime).toBeGreaterThan(100)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(100)
    await page.evaluate(() => {
      const nativeScrollTo = Element.prototype.scrollTo
      window.transcriptScrollCalls = []
      Element.prototype.scrollTo = function (...args) {
        if (this.classList.contains('transcriptSegments')) {
          window.transcriptScrollCalls.push({
            behavior: args[0]?.behavior,
            distance: Math.abs(args[0]?.top - this.scrollTop),
            clientHeight: this.clientHeight
          })
        }
        return nativeScrollTo.apply(this, args)
      }
    })

    await page.getByRole('button', { name: 'Show transcript' }).click()
    const activeSegment = page.locator('.transcriptSegment[aria-current="true"]')
    await expect(activeSegment).toBeVisible({ timeout: 30_000 })
    expect(Number(await activeSegment.getAttribute('data-segment-index'))).toBeGreaterThan(100)
    await expect.poll(() => page.evaluate(() => window.transcriptScrollCalls[0])).toBeTruthy()
    const scrollCall = await page.evaluate(() => window.transcriptScrollCalls[0])
    expect(scrollCall.behavior).toBe('smooth')
    expect(scrollCall.distance).toBeLessThanOrEqual(scrollCall.clientHeight)
  })

  test('closing the only sidebar chapter panel keeps it beside the description', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    await page.evaluate(async () => {
      const layout = document.querySelector('.videoLayout')
      const app = document.querySelector('#app')?.__vue_app__
      const findWatchView = (vnode) => {
        if (vnode?.component?.refs?.videoLayout === layout) {
          return vnode.component.proxy
        }
        if (vnode?.component?.subTree) {
          const match = findWatchView(vnode.component.subTree)
          if (match) {
            return match
          }
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = findWatchView(child)
            if (match) {
              return match
            }
          }
        }
        return null
      }
      const watchView = findWatchView(app?._container?._vnode)
      if (!watchView) {
        throw new Error('Unable to access the watch view')
      }

      await watchView.$store.dispatch('updateHideRecommendedVideos', true)
      watchView.useTheatreMode = true
      watchView.videoChapters = Array.from({ length: 6 }, (_, index) => ({
        title: `Test chapter ${index + 1}`,
        timestamp: `${index}:00`,
        startSeconds: index * 60
      }))
      watchView.videoCurrentChapterIndex = 5
      watchView.showSidebarChapters = true
      await watchView.$nextTick()
    })

    const layout = page.locator('.videoLayout')
    const panel = page.locator('.watchVideoChaptersPanel')
    await expect(layout).toHaveClass(/useTheatreMode/)
    await expect(panel).toBeVisible()
    await expect(panel).not.toHaveClass(/chapters-panel-enter-active/)
    await expect.poll(() => panel.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const scrollbar = container?.querySelector(':scope > .os-scrollbar-vertical')
      return container && {
        hasVisibleScrollbar: scrollbar?.classList.contains('os-scrollbar-visible'),
        scrollTop: container.scrollTop,
      }
    })).toEqual({
      hasVisibleScrollbar: false,
      scrollTop: 0,
    })
    await expect.poll(() => panel.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const currentChapter = container?.querySelector('.chapter.current')
      const containerBounds = container?.getBoundingClientRect()
      const chapterBounds = currentChapter?.getBoundingClientRect()
      return Boolean(
        containerBounds &&
        chapterBounds &&
        chapterBounds.top >= containerBounds.top &&
        chapterBounds.bottom <= containerBounds.bottom
      )
    })).toBe(true)

    await panel.getByRole('button', { name: 'Close Chapters' }).click()
    await expect(panel).toHaveClass(/chapters-panel-leave-active/)
    const leavingScrollbar = await panel.evaluate((element) => {
      const viewport = element.querySelector('.chaptersWrapper')
      return viewport && {
        initializing: viewport.hasAttribute('data-overlayscrollbars-initialize'),
        nativeScrollbarWidth: getComputedStyle(viewport).scrollbarWidth
      }
    })
    expect(leavingScrollbar).toEqual({
      initializing: true,
      nativeScrollbarWidth: 'none'
    })

    const leavingLayout = await page.evaluate(() => {
      const layoutElement = document.querySelector('.videoLayout')
      const infoElement = document.querySelector('.infoArea')
      const panelElement = document.querySelector('.watchVideoChaptersPanel')
      const infoBounds = infoElement.getBoundingClientRect()
      const panelBounds = panelElement.getBoundingClientRect()

      return {
        noSidebar: layoutElement.classList.contains('noSidebar'),
        infoRight: infoBounds.right,
        panelLeft: panelBounds.left
      }
    })
    expect(leavingLayout.noSidebar).toBe(false)
    expect(leavingLayout.panelLeft).toBeGreaterThanOrEqual(leavingLayout.infoRight - 1)

    await expect(panel).toHaveCount(0)
    await expect(layout).toHaveClass(/noSidebar/)
  })

  test('comments load on request', async ({ app, page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()

    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.comment').count()).toBeGreaterThan(0)

    const commentHeader = page.locator('.commentHeader')
    const commentTitle = commentHeader.locator('.commentsTitle')
    const commentActions = commentHeader.locator('.commentHeaderActions')
    const commentSort = commentActions.locator('.select')
    const reloadComments = commentActions.locator('.reloadComments')

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseVerticalTabBar', true)
      store.commit('setVerticalTabBarWidth', 180)
    })
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
    await setWindowWidth(app, 660)
    await expect.poll(async () => {
      const [
        tabBarBox,
        topNavBox,
        routeBox,
        sideNavBox,
        headerBox,
        titleBox,
        actionsBox,
        sortBox,
        reloadBox
      ] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        page.locator('.topNav').boundingBox(),
        page.locator('.app > .routerView').boundingBox(),
        page.locator('.sideNav').boundingBox(),
        commentHeader.boundingBox(),
        commentTitle.boundingBox(),
        commentActions.boundingBox(),
        commentSort.boundingBox(),
        reloadComments.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        topNavBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        topNavBox.x + topNavBox.width <= viewportWidth + 1 &&
        routeBox.x + routeBox.width <= viewportWidth + 1 &&
        sideNavBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        sideNavBox.x + sideNavBox.width <= viewportWidth + 1 &&
        actionsBox.y >= titleBox.y + titleBox.height &&
        Math.abs(actionsBox.width - headerBox.width) <= 1 &&
        sortBox.x >= headerBox.x &&
        reloadBox.x + reloadBox.width <= headerBox.x + headerBox.width
      )
    }).toBe(true)
    await reloadComments.click({ trial: true })

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseVerticalTabBar', false)
    })
    await expect(page.locator('.app')).not.toHaveClass(/verticalTabs/)
    await expect.poll(async () => {
      const [topNavBox, routeBox, titleBox, actionsBox] = await Promise.all([
        page.locator('.topNav').boundingBox(),
        page.locator('.app > .routerView').boundingBox(),
        commentTitle.boundingBox(),
        commentActions.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        topNavBox.x <= 1 &&
        topNavBox.x + topNavBox.width <= viewportWidth + 1 &&
        routeBox.x + routeBox.width <= viewportWidth + 1 &&
        actionsBox.y < titleBox.y + titleBox.height
      )
    }).toBe(true)
    await setWindowWidth(app, 1600)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
    })
    await expect(page.getByLabel('Loading more comments')).toHaveCount(0)

    // Exercise reply loading and its continuation path, not only the initial
    // top-level comment batch (8bcf0b58d).
    const replyToggle = page.locator('.commentMoreReplies').first()
    await expect(replyToggle).toBeVisible()
    await replyToggle.click()
    const replies = page.locator('.commentReplyBranch')
    await expect(replies.first()).toBeVisible({ timeout: 30_000 })

    const showMoreReplies = page.locator('.showMoreReplies').first()
    await expect(showMoreReplies).toBeVisible()
    const [continuationResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'POST' &&
        response.url().includes('/youtubei/v1/next')
      )),
      showMoreReplies.click()
    ])
    expect(continuationResponse.ok()).toBe(true)
    await expect(replies.first()).toBeVisible()
  })

  test('fullscreen comments dock preserves its active state and scroll position', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollHeight)).toBeGreaterThan(500)
    await comments.evaluate((element) => { element.scrollTop = 300 })
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)

    await page.locator('.fullscreenCommentHeader .fullscreenCommentAction').last().click()
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toHaveCount(0)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)

    await setPlayerFullscreen(page, false)
    await setPlayerFullscreen(page, true)
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)
  })

  test('fullscreen comments keep auto-loading while the sentinel stays visible', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    const commentCards = page.locator('.fullscreenCommentsOverlay .comment')
    await expect(comments).toBeVisible()

    await page.addStyleTag({
      content: `
        .fullscreenCommentsOverlay .comment { display: none; }
        .fullscreenCommentsOverlay.open { inset-block-start: calc(100% - 306px) !important; }
      `
    })
    await page.route(/\/youtubei\/v1\/next/, async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.continue()
    })
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
    })
    const initialCommentCount = await commentCards.count()
    await expect.poll(() => commentCards.count(), { timeout: 30_000 }).toBeGreaterThan(initialCommentCount)
    const repeatedLoadCount = await commentCards.count()
    await expect.poll(() => commentCards.count(), { timeout: 30_000 }).toBeGreaterThan(repeatedLoadCount)
  })

  test('fullscreen metadata uses one full-dock scrollbar', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.playerFullscreenTitleOverlay').click({ force: true })

    const metadata = page.locator('.fullscreenMetadataOverlay.open')
    const target = metadata.locator('.fullscreenMetadataTarget')
    await expect(metadata).toBeVisible()
    await expect(target).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(metadata.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect(metadata.locator('.descriptionScroll'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')

    await metadata.locator('.description').evaluate((element) => {
      element.textContent = Array.from(
        { length: 100 },
        (_, index) => `Long description line ${index + 1}`
      ).join('\n')
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollHeight > element.clientHeight
    )).toBe(true)

    const scrollbar = target.locator(':scope > .os-scrollbar-vertical')
    const scrollbarBounds = await scrollbar.boundingBox()
    const targetBounds = await target.boundingBox()
    expect(Math.abs(scrollbarBounds.y - targetBounds.y)).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        targetBounds.y + targetBounds.height -
        scrollbarBounds.y - scrollbarBounds.height
      )
    ).toBeLessThanOrEqual(1)

    await target.evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 3
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollTop
    )).toBeGreaterThan(0)
    const handle = scrollbar.locator('.os-scrollbar-handle')
    await handle.hover()
  })

  test('fullscreen comments scrollbar reaches the dock bottom', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const dock = page.locator('.fullscreenCommentsOverlay.open')
    const content = dock.locator('.commentsContentWrapper')
    await expect(content).toBeVisible()

    const bottomGap = await Promise.all([dock.boundingBox(), content.boundingBox()])
      .then(([dockBox, contentBox]) => (
        dockBox.y + dockBox.height - contentBox.y - contentBox.height
      ))
    expect(bottomGap).toBeLessThanOrEqual(2)
  })

  test('fullscreen SponsorBlock uses one content scrollbar', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenSponsorBlockToggle').click({ force: true })

    const sponsorBlock = page.locator('.fullscreenSponsorBlockOverlay.open')
    await expect(sponsorBlock).toBeVisible()
    await expect(sponsorBlock.locator('.sponsorBlockContent'))
      .toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(sponsorBlock.locator('.sponsorBlockSegments'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(sponsorBlock.locator('.os-scrollbar-vertical')).toHaveCount(1)
  })

  test('fullscreen title opens the video information dock', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.route(/\/api\/timedtext/, route => route.fulfill({
      body: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nTest transcript line.\n',
      contentType: 'text/vtt'
    }))
    await openCaptionedVideoOrSkip(page)
    await waitForPlaybackOrSkip(test, page)

    await setPlayerFullscreen(page, true)
    const title = page.locator('.playerFullscreenTitleOverlay')
    const titleBounds = await title.boundingBox()
    const playerBounds = await page.locator('.ftVideoPlayer').boundingBox()
    const titleRight = titleBounds.x + titleBounds.width
    const besideTitleX = titleRight + (playerBounds.x + playerBounds.width - titleRight) / 2
    const titleCenterY = titleBounds.y + titleBounds.height / 2

    await page.mouse.dblclick(besideTitleX, titleCenterY)
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(false)

    await setPlayerFullscreen(page, true)
    await page.mouse.move(titleBounds.x + titleBounds.width / 2, titleCenterY)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.waitForTimeout(100)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(true)

    await title.click({ force: true })

    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenMetadataTarget .videoTitle')).toContainText(CAPTIONED_VIDEO.title)
    await expect(page.locator('.fullscreenMetadataTarget')).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(page.locator('.fullscreenMetadataOverlay .os-scrollbar-vertical')).toHaveCount(1)
    await expect(page.locator('.fullscreenMetadataTarget .descriptionScroll'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(page.locator('.fullscreenMetadataTarget .shareButton')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataTarget .quickBookmarkVideoIcon')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataTarget').getByRole('button', { name: 'Add to playlist' })).toHaveCount(0)
    await expect(page.locator('.fullscreenActions .fullscreenShareAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenPlaylistAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenQuickBookmarkAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenTranscriptToggle')).toHaveCount(1)
    await expect(page.locator('.fullscreenMetadataTarget').getByRole('button', { name: 'Show transcript' })).toHaveCount(0)
    const dockDescription = page.locator('.fullscreenMetadataTarget .videoDescription')
    await expect(dockDescription).toHaveClass(/alwaysExpanded/)
    await expect(dockDescription).not.toHaveClass(/short/)
    await expect(dockDescription.locator('.descriptionStatus')).toHaveCount(0)
    await expect(page.locator('.infoArea .videoTitle')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataHeader')).not.toHaveCSS('cursor', 'grab')
    const playerVideo = page.locator('.ftVideoPlayer video.player')
    const metadataDock = page.locator('.fullscreenMetadataOverlay.open')
    await expect.poll(async () => {
      const [currentVideoBounds, currentMetadataBounds] = await Promise.all([
        playerVideo.boundingBox(),
        metadataDock.boundingBox()
      ])
      return currentVideoBounds.x + currentVideoBounds.width - currentMetadataBounds.x
    }).toBeLessThanOrEqual(1)
    await page.locator('.ftVideoPlayer').evaluate((element) => {
      const annotations = document.createElement('div')
      annotations.className = 'videoAnnotations'
      annotations.dataset.testAnnotations = ''
      annotations.style.position = 'absolute'
      annotations.style.insetBlock = '0'
      annotations.style.insetInlineStart = '0'
      element.append(annotations)
    })
    const annotations = page.locator('[data-test-annotations]')
    await expect(annotations).toHaveCSS('transition-property', 'inset-inline-end')
    await expect(annotations).toHaveCSS('transition-duration', '0.25s')
    await expect.poll(async () => {
      const [videoBounds, annotationBounds] = await Promise.all([
        playerVideo.boundingBox(),
        annotations.boundingBox()
      ])
      return Math.abs(
        videoBounds.x + videoBounds.width - annotationBounds.x - annotationBounds.width
      )
    }).toBeLessThanOrEqual(1)
    await page.locator('.fullscreenActions').getByRole('button', { name: 'Show transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenMetadataHeader')).toHaveCSS('cursor', 'grab')
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptCard')).toBeVisible()
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptSegment').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptSegments'))
      .toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptActions .iconButton')).toHaveCount(2)

    const transcriptDock = page.locator('.fullscreenTranscriptOverlay.open')
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return Math.abs(metadataBox.height - transcriptBox.height)
    }).toBeLessThan(5)
    const [stackedMetadataBounds, transcriptBounds] = await Promise.all([
      metadataDock.boundingBox(),
      transcriptDock.boundingBox()
    ])
    const resizeHandle = metadataDock.locator('.fullscreenDockResizeHandle')
    const resizeHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      resizeHandleBounds.x + resizeHandleBounds.width / 2,
      resizeHandleBounds.y + resizeHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.locator('.ftVideoPlayer').evaluate(element => element.classList.add('no-cursor'))
    await expect(page.locator('.ftVideoPlayer')).toHaveCSS('cursor', 'row-resize')
    await expect(metadataDock).toHaveCSS('transition-duration', '0s')
    await page.mouse.move(resizeHandleBounds.x + resizeHandleBounds.width / 2, resizeHandleBounds.y + 100)
    await page.mouse.up()
    await page.locator('.ftVideoPlayer').evaluate(element => element.classList.remove('no-cursor'))
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThan(stackedMetadataBounds.height + 60)
    await expect.poll(async () => (await transcriptDock.boundingBox()).height)
      .toBeLessThan(transcriptBounds.height - 60)

    const resizedMetadataHeight = (await metadataDock.boundingBox()).height
    await resizeHandle.press('ArrowUp')
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeLessThan(resizedMetadataHeight)

    const [currentHandleBounds, fullscreenPlayerBounds] = await Promise.all([
      resizeHandle.boundingBox(),
      page.locator('.ftVideoPlayer').boundingBox()
    ])
    await page.mouse.move(
      currentHandleBounds.x + currentHandleBounds.width / 2,
      currentHandleBounds.y + currentHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      currentHandleBounds.x + currentHandleBounds.width / 2,
      fullscreenPlayerBounds.y + fullscreenPlayerBounds.height - 1
    )
    await page.mouse.up()
    await expect.poll(async () => (await transcriptDock.boundingBox()).height)
      .toBeGreaterThanOrEqual(360)

    const fullscreenPlayer = page.locator('.ftVideoPlayer')
    await fullscreenPlayer.evaluate(element => {
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: 700 })
    })
    await expect.poll(async () => fullscreenPlayer.evaluate(element => element.clientHeight)).toBe(700)
    const denseStackMetadataHeight = (await metadataDock.boundingBox()).height
    const denseStackHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      denseStackHandleBounds.x + denseStackHandleBounds.width / 2,
      denseStackHandleBounds.y + denseStackHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      denseStackHandleBounds.x + denseStackHandleBounds.width / 2,
      denseStackHandleBounds.y + 60
    )
    await page.mouse.up()
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThan(denseStackMetadataHeight + 20)
    await resizeHandle.dblclick({ force: true })
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return Math.abs(metadataBox.height - transcriptBox.height)
    }).toBeLessThan(5)
    await fullscreenPlayer.evaluate(element => { delete element.clientHeight })
    await expect.poll(async () => fullscreenPlayer.evaluate(element => element.clientHeight)).toBeGreaterThan(700)

    const metadataHeader = metadataDock.locator('.fullscreenMetadataHeader')
    const transcriptHeader = transcriptDock.locator('.transcriptHeader')
    const expandedMetadataHeight = (await metadataDock.boundingBox()).height
    await metadataHeader.dblclick({ position: { x: 30, y: 26 } })
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThanOrEqual(60)
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeLessThan(61)
    await metadataHeader.dblclick({ position: { x: 30, y: 26 } })
    await expect.poll(async () => Math.abs((await metadataDock.boundingBox()).height - expandedMetadataHeight))
      .toBeLessThan(2)

    const [metadataHeaderBounds, transcriptHeaderBounds] = await Promise.all([
      metadataHeader.boundingBox(),
      transcriptHeader.boundingBox()
    ])
    await page.mouse.move(
      transcriptHeaderBounds.x + 30,
      transcriptHeaderBounds.y + transcriptHeaderBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      metadataHeaderBounds.x + 30,
      metadataHeaderBounds.y + 10,
      { steps: 5 }
    )
    await page.mouse.up()
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return transcriptBox.y < metadataBox.y
    }).toBe(true)

    const [reorderedMetadataBounds, reorderedTranscriptHeaderBounds] = await Promise.all([
      metadataDock.boundingBox(),
      transcriptHeader.boundingBox()
    ])
    await page.mouse.move(
      reorderedTranscriptHeaderBounds.x + 30,
      reorderedTranscriptHeaderBounds.y + reorderedTranscriptHeaderBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      reorderedMetadataBounds.x + 30,
      reorderedMetadataBounds.y + reorderedMetadataBounds.height - 10,
      { steps: 5 }
    )
    await page.mouse.up()
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return metadataBox.y < transcriptBox.y
    }).toBe(true)

    await page.getByRole('button', { name: 'Close transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toHaveCount(0)

    await setPlayerFullscreen(page, false)
    await expect(page.locator('.infoArea .videoTitle')).toBeVisible()
    const inlineDescription = page.locator('.infoArea .videoDescription')
    await expect(inlineDescription).not.toHaveClass(/alwaysExpanded/)
    await expect(inlineDescription.locator('.descriptionStatus')).not.toHaveCount(0)
    await setPlayerFullscreen(page, true)
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    await page.getByRole('button', { name: 'Close video information' }).click()
    await expect(title).toHaveAttribute('aria-expanded', 'false')
  })

  test('fullscreen player overlays appear above the action pill', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    await setPlayerFullscreen(page, true)
    const actions = page.locator('.fullscreenActions')
    const seekBar = page.locator('.shaka-seek-bar-container')
    const fullscreenButton = page.locator('.shaka-fullscreen-button')
    await actions.evaluate((element) => {
      const sponsorBlockNotice = element.cloneNode(false)
      sponsorBlockNotice.className = 'skippedSegmentsWrapper'
      element.parentElement.append(sponsorBlockNotice)
    })
    const sponsorBlockNotice = page.locator('.skippedSegmentsWrapper')

    await expect(actions).toBeVisible()
    await expect(actions).toHaveCSS('z-index', '2')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '3')
    await fullscreenButton.hover()
    // The Shaka tooltip is a hover-only ::after pseudo-element whose content is
    // pulled from the button's aria-label. Assert it actually renders (rather
    // than only checking the static capability class) so a tooltip
    // rendering/config regression fails the test; the z-index checks below then
    // confirm it sits above the action dock.
    await expect.poll(() => fullscreenButton.evaluate((element) => {
      const { content } = getComputedStyle(element, '::after')
      return content !== 'none' && content !== 'normal' && content !== ''
    })).toBe(true)
    await expect(actions).toHaveCSS('z-index', '0')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '3')
    const seekBarBounds = await seekBar.boundingBox()
    await page.mouse.move(
      seekBarBounds.x + (seekBarBounds.width / 2),
      seekBarBounds.y + (seekBarBounds.height / 2)
    )
    await expect(actions).toHaveCSS('z-index', '0')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '0')
  })

  test('full window playlist action shows its popover above the player', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    await page.locator('.full-window-button').click({ force: true })
    await expect(page.locator('.ftVideoPlayer.fullWindow')).toBeVisible()
    await page.locator('.fullscreenPlaylistAction .iconButton').click({ force: true })

    const popover = page.locator('.fullscreenPlaylistAction .iconDropdown')
    await expect(popover.locator('.dropdownHeader')).toBeVisible()
    await expect(popover.locator('.playlistRow').first()).toBeVisible()
    // Dismiss the popover before continuing
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    await page.locator('.fullscreenQuickBookmarkAction').click({ force: true })
    const toastHolder = page.locator('.toast-holder')
    await expect(toastHolder.locator('.toast')).toBeVisible()
    expect(await toastHolder.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(1000)
  })

  // Regression: edited comments show their "(edited)" marker (929369543)
  test('edited comments carry the edited badge', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    // The comment ranking is not deterministic, so load a few batches and
    // only assert the badge when an edited comment actually shows up.
    const editedBadge = page.locator('.commentDate', { hasText: '(edited)' })
    for (let i = 0; i < 3 && (await editedBadge.count()) === 0; i++) {
      const showMore = page.locator('.getMoreComments')
      if (await showMore.count() === 0) { break }
      await showMore.scrollIntoViewIfNeeded()
      await showMore.click()
      await page.waitForTimeout(2000)
    }

    test.skip(await editedBadge.count() === 0, 'no edited comments in the loaded batches')
    await expect(editedBadge.first()).toBeVisible()
  })
})
