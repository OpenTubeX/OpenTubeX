import { sel, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { demoPlayerResponse } from '../../helpers/media.mjs'
import { WATCH_PAGE_SEED, setWindowWidth } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

async function observeUpNextHandoff(page) {
  await page.evaluate((activeTabSelector) => {
    window.__emptyUpNextRendered = false
    window.__upNextObserver = new MutationObserver(() => {
      const recommendations = document.querySelector(`${activeTabSelector} .watchVideoRecommendations`)
      if (recommendations && !recommendations.querySelector('.ft-list-video')) {
        window.__emptyUpNextRendered = true
      }
    })
    window.__upNextObserver.observe(document.querySelector('#app'), {
      childList: true,
      subtree: true,
    })
  }, activeTab)
}

async function expectPopulatedUpNextHandoff(page) {
  expect(await page.evaluate(() => {
    window.__upNextObserver.disconnect()
    return window.__emptyUpNextRendered
  })).toBe(false)
}

test('keeps an allowed Up Next recommendation rendered through loading and filtering', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await observeUpNextHandoff(page)
  await openMockedVideo(page)
  await expect(page.locator(`${activeTab} .watchVideoRecommendations .ft-list-video`).first()).toBeVisible()
  await expectPopulatedUpNextHandoff(page)

  const watchView = await watchViewHandle(page)
  const { allowedTitle, hiddenTitles } = await watchView.evaluate(async view => {
    view.isLoading = true
    await view.$nextTick()

    const hiddenTitles = view.recommendedVideos.slice(0, 5).map(video => video.title)
    const nextAllowedVideo = view.recommendedVideos.slice(5)
      .find(video => !hiddenTitles.some(title => video.title.toLowerCase().includes(title.toLowerCase())))
    return { allowedTitle: nextAllowedVideo.title, hiddenTitles }
  })
  await page.evaluate(() => {
    window.__upNextIntersectionObserver = window.IntersectionObserver
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    }
  })

  await observeUpNextHandoff(page)
  await watchView.evaluate(async view => {
    view.isLoading = false
    await view.$nextTick()
  })
  await expect(page.locator(`${activeTab} .watchVideoRecommendations .ft-list-video`)).toHaveCount(5)
  await expectPopulatedUpNextHandoff(page)

  await observeUpNextHandoff(page)
  await watchView.evaluate(async (view, titles) => {
    await view.$store.dispatch('updateForbiddenTitles', JSON.stringify(titles))
    await view.$nextTick()
  }, hiddenTitles)
  await expect(page.locator(`${activeTab} .watchVideoRecommendations .title`, { hasText: allowedTitle })).toBeVisible()
  await expect(page.locator(`${activeTab} .watchVideoRecommendations .ft-list-video`)).toHaveCount(5)
  await expectPopulatedUpNextHandoff(page)

  await watchView.evaluate(async view => {
    await view.$store.dispatch('updateForbiddenTitles', '[]')
    await view.$nextTick()
  })
  await expect(page.locator(`${activeTab} .watchVideoRecommendations .ft-list-video`)).toHaveCount(5)

  await watchView.evaluate(async (view, titles) => {
    await view.$store.dispatch('updateForbiddenTitles', JSON.stringify(titles))
    await view.$nextTick()
  }, hiddenTitles)
  await expect(page.locator(`${activeTab} .watchVideoRecommendations .title`, { hasText: allowedTitle })).toBeVisible()

  await watchView.evaluate(async view => {
    view.isLoading = true
    await view.$nextTick()
  })
  await observeUpNextHandoff(page)
  await watchView.evaluate(async view => {
    view.isLoading = false
    await view.$nextTick()
  })
  await expect(page.locator(`${activeTab} .watchVideoRecommendations .title`, { hasText: allowedTitle })).toBeVisible()
  await expectPopulatedUpNextHandoff(page)
  await watchView.evaluate(view => view.$store.dispatch('updateForbiddenTitles', '[]'))
  await page.evaluate(() => {
    window.IntersectionObserver = window.__upNextIntersectionObserver
  })
  await watchView.dispose()
})

async function swipeVertically(session, locator, distance) {
  // The mini player appears once the page scrolls the player out of view and
  // can cover the list. Touch a visible point of the list once it settles.
  await locator.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(locator.page().locator(`${activeTab} .ftVideoPlayer`)).not.toHaveClass(/scrollMiniPlayerAnimating/)
  const { x, y } = await locator.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const x = bounds.left + bounds.width / 2
    const top = Math.max(bounds.top, 0)
    const bottom = Math.min(bounds.bottom, innerHeight)
    const center = (top + bottom) / 2
    for (let offset = 0; offset < (bottom - top) / 2; offset++) {
      for (const y of [center - offset, center + offset]) {
        if (element.contains(document.elementFromPoint(x, y))) return { x, y }
      }
    }
    throw new Error('The list is covered')
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x, y }]
  })
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: y + distance * step / 10 }]
    })
  }
  // Hold before releasing so momentum cannot race the next boundary check.
  await new Promise(resolve => setTimeout(resolve, 200))
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('touch scrolling chains from sidebar chapters to the page (30 chapters)', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.locator(`${activeTab} .ftVideoPlayer video`).evaluate(video => video.pause())
  await setWindowSize(app, page, { width: 800, height: 850 })
  const session = await page.context().newCDPSession(page)
  const view = await watchViewHandle(page)
  await view.evaluate(async (view, count) => {
    view.videoChapters = Array.from({ length: count }, (_, index) => ({
      title: `Test chapter ${index + 1}`,
      timestamp: `${index}:00`,
      startSeconds: index * 60
    }))
    view.videoCurrentChapterIndex = count - 1
    view.showSidebarChapters = true
    await view.$nextTick()
  }, 30)
  const panel = page.locator(`${activeTab} .watchVideoChaptersPanel`)
  const chapters = panel.locator('.chaptersWrapper')
  await expect(panel).toBeVisible()
  await expect(panel).not.toHaveClass(/chapters-panel-enter-active/)
  await expect(chapters).toHaveCSS('overscroll-behavior-y', 'contain')
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  await expect(chapters).toHaveCSS('overscroll-behavior-y', 'auto')
  await chapters.evaluate(element => {
    element.scrollIntoView({ block: 'center' })
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => chapters.evaluate(element =>
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
  )).toBeLessThanOrEqual(1)
  const initialPageScroll = await page.evaluate(() => window.scrollY)
  expect(await page.evaluate(() =>
    document.scrollingElement.scrollHeight - innerHeight - scrollY
  )).toBeGreaterThan(100)
  await swipeVertically(session, chapters, -150)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(initialPageScroll + 50)

  await chapters.evaluate(element => {
    element.scrollIntoView({ block: 'center' })
    element.scrollTop = 0
  })
  const pageScrollAtTop = await page.evaluate(() => window.scrollY)
  expect(pageScrollAtTop).toBeGreaterThan(100)
  await swipeVertically(session, chapters, 150)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(pageScrollAtTop - 50)
  await session.detach()
  await view.dispose()
})

test('keeps metadata errors visible in family-friendly-only mode', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => {
      throw new Error('VM operation timed out')
    })
  })
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateShowFamilyFriendlyOnly', true)
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=4FEzLc7iBY0')
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(/#\/watch\/4FEzLc7iBY0/)
  await expect(page.locator('.errorMessage')).toContainText('VM operation timed out')
  await expect(page.locator('.infoArea .ageRestrictedBadge')).toHaveCount(0)
})

test('shows age-restricted and unlisted badges below the video title', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.microformat.playerMicroformatRenderer.isFamilySafe = false
    response.microformat.playerMicroformatRenderer.isUnlisted = true
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })

  await openMockedVideo(page)

  const videoInfo = page.locator('.infoArea .watchVideoInfo')
  const ageRestrictedBadge = videoInfo.locator('.ageRestrictedBadge')
  const unlistedBadge = videoInfo.locator('.unlistedBadge')
  await expect(videoInfo.locator('.videoBadges')).toHaveCount(1)
  await expect(ageRestrictedBadge).toHaveText('Age restricted')
  await expect(ageRestrictedBadge.locator('[data-icon="user-lock"]')).toBeVisible()
  await expect(unlistedBadge).toHaveText('Unlisted')
  await expect(unlistedBadge.locator('[data-icon="eye-slash"]')).toBeVisible()

  const [badgeBounds, titleBounds] = await Promise.all([
    ageRestrictedBadge.boundingBox(),
    videoInfo.locator('.videoTitle').boundingBox()
  ])
  expect(badgeBounds).not.toBeNull()
  expect(titleBounds).not.toBeNull()
  expect(badgeBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height)
})

test('paints the toolbar\'s Save to dropdown above the cards below it with blurred cards', { tag: '@scale' }, async ({ app, page }) => {
  // Scrolling the toolbar to the top docks the scroll mini player, and
  // scrolling back before the click undocks it. Either animation can pass
  // over the dropdown while its hit test runs.
  await page.evaluate(() => window.$store.dispatch('updateScrollPlayerMode', 'off'))
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  // Custom theme blurs give the cards and the toolbar backdrop filters,
  // which make them stacking contexts
  await page.evaluate(() => {
    document.body.style.setProperty('--card-bg-blur', 'blur(8px)')
    document.body.style.setProperty('--secondary-card-bg-blur', 'blur(8px)')
  })

  const videoInfo = page.locator('.infoArea .watchVideoInfo')
  // Leaves room for the dropdown below the toolbar. Scrolling it to the top would hide
  // the button behind the top navigation, and the click would scroll the page back.
  await videoInfo.locator('.videoOptions').evaluate(element => element.scrollIntoView({ block: 'center' }))
  await videoInfo.locator('.videoOptions').getByRole('button', { name: 'Add to playlist', exact: true }).click()
  const dropdown = videoInfo.locator('.iconDropdown:has(.addToPlaylistDropdown)')
  await expect(dropdown.locator('.playlistRow').first()).toBeVisible()

  const hits = await dropdown.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const card = element.closest('.watchVideoInfo').getBoundingClientRect()
    const missed = []
    for (let y = rect.top + 4; y < rect.bottom - 4; y += 16) {
      for (const x of [rect.left + 8, rect.left + rect.width / 2, rect.right - 8]) {
        if (!element.contains(document.elementFromPoint(x, y))) {
          missed.push({ x, y, hit: document.elementFromPoint(x, y)?.className })
        }
      }
    }
    return { extendsPastCard: rect.bottom > card.bottom + 50, missed }
  })
  // Only meaningful when the dropdown reaches into the cards below the video info
  expect(hits.extendsPastCard).toBe(true)
  expect(hits.missed).toEqual([])
})

test('opens the toolbar\'s Save to dropdown above the button without scrolling when only the space above fits it', { tag: '@scale' }, async ({ app, page }) => {
  await page.evaluate(() => window.$store.dispatch('updateScrollPlayerMode', 'off'))
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  const videoInfo = page.locator('.infoArea .watchVideoInfo')
  const button = videoInfo.locator('.videoOptions').getByRole('button', { name: 'Add to playlist', exact: true })
  await videoInfo.locator('.videoOptions').evaluate(element => element.scrollIntoView({ block: 'end' }))
  const buttonBefore = await button.boundingBox()
  const viewportHeight = await page.evaluate(() => window.innerHeight)
  // Only meaningful when the button sits low enough that the dropdown cannot fit below it
  expect(buttonBefore.y).toBeGreaterThan(viewportHeight / 2)

  await button.click()
  const dropdown = videoInfo.locator('.iconDropdown:has(.addToPlaylistDropdown)')
  await expect(dropdown.locator('.playlistRow').first()).toBeVisible()

  const buttonAfter = await button.boundingBox()
  const dropdownBounds = await dropdown.boundingBox()
  expect(dropdownBounds.height).toBeGreaterThan(viewportHeight - buttonBefore.y - buttonBefore.height)
  expect(buttonAfter.y).toBe(buttonBefore.y)
  expect(dropdownBounds.y + dropdownBounds.height).toBeLessThanOrEqual(buttonAfter.y)
  expect(dropdownBounds.y).toBeGreaterThanOrEqual(0)
})

test.describe('with many playlists', () => {
  test.use({
    seed: {
      settings: WATCH_PAGE_SEED,
      playlists: Array.from({ length: 12 }, (_, index) => ({
        _id: `playlist${index}`,
        playlistName: index === 0 ? 'A long playlist name that widens the dropdown' : `Playlist ${index}`,
        protected: false,
        videos: [],
      })),
    },
  })

  test('keeps the toolbar\'s Save to dropdown in place with nothing left to scroll while searching', { tag: '@scale' }, async ({ app, page }) => {
    await page.evaluate(() => window.$store.dispatch('updateScrollPlayerMode', 'off'))
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const videoInfo = page.locator('.infoArea .watchVideoInfo')
    await videoInfo.locator('.videoOptions').evaluate(element => element.scrollIntoView({ block: 'center' }))
    await videoInfo.locator('.videoOptions').getByRole('button', { name: 'Add to playlist', exact: true }).click()
    const dropdown = videoInfo.locator('.iconDropdown:has(.addToPlaylistDropdown)')
    const list = dropdown.locator('.playlistList')
    await expect(dropdown.getByRole('option')).toHaveCount(12)
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await dropdown.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)))
    const before = await dropdown.boundingBox()

    // Playlists 1, 10 and 11 fit without scrolling
    await dropdown.locator('.playlistSearch input').fill('Playlist 1')
    await expect(dropdown.getByRole('option')).toHaveCount(3)
    await expect.poll(() => list.evaluate(element => element.scrollTop === 0 &&
      element.scrollHeight - element.clientHeight <= 1 &&
      element.querySelector('.os-scrollbar-vertical').classList.contains('os-scrollbar-unusable'))).toBe(true)
    const after = await dropdown.boundingBox()
    for (const key of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(after[key] - before[key]), key).toBeLessThanOrEqual(1)
    }
  })
})

test('keeps watch metadata and comment filters inside a narrow viewport', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowWidth(app, 520)

  const videoInfo = page.locator('.infoArea .watchVideoInfo')
  await expect(videoInfo.locator('.videoCategory')).toBeVisible()
  expect(await videoInfo.evaluate(element => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)

  await expect.poll(() => watchViewHandle(page).then(handle => handle.evaluate(view => view.phonePanelsEnabled))).toBe(true)
  await page.locator('.phoneCommentsButton').click()
  const comments = page.locator('.mobileSheet[open]')
  await expect(comments).toBeVisible()
  const loadComments = comments.locator('.getCommentsTitle')
  if (await loadComments.count() > 0) {
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
  }
  await expect(comments.locator('.fullscreenCommentHeader h3')).toBeVisible({ timeout: 30_000 })
  await comments.getByRole('button', { name: 'Filter loaded comments' }).click()

  const menuBounds = await page.getByRole('dialog', { name: 'Comment filters' }).evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return {
      left: bounds.left,
      right: bounds.right,
      viewportLeft: window.visualViewport?.offsetLeft ?? 0,
      viewportRight: (window.visualViewport?.offsetLeft ?? 0) +
        (window.visualViewport?.width ?? window.innerWidth)
    }
  })
  expect(menuBounds.left).toBeGreaterThanOrEqual(menuBounds.viewportLeft)
  expect(menuBounds.right).toBeLessThanOrEqual(menuBounds.viewportRight)
})

test('shows transcript actions with captions', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
  await openMockedVideo(page)

  await expect(page.locator('.infoArea .watchVideoInfo')
    .getByRole('button', { name: 'Show transcript' }))
    .toHaveCount(1)
  await expect(page.locator('.fullscreenActions .fullscreenTranscriptToggle'))
    .toHaveCount(1)
})

test.describe('watch sidebar panels without recommendations', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        defaultViewingMode: 'theatre',
        hideRecommendedVideos: true
      }
    }
  })

  test('opens the panel from Open Chapters below the video in theatre mode', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await openMockedVideo(page)

    const layout = page.locator(`${activeTab} .videoLayout`)
    await expect(layout).toHaveClass(/noSidebar/)
    await expect(layout).not.toHaveClass(/useTheatreMode/)

    await page.locator(`${activeTab} .ftVideoPlayer`).hover()
    await page.getByRole('button', { name: 'Open Chapters', exact: true }).first().click()
    await expect(layout).not.toHaveClass(/noSidebar/)
    await expect(layout).toHaveClass(/useTheatreMode/)
  })
})

test('chapters stay centered through layout changes until manually scrolled', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(async element => {
    element.pause()
    element.currentTime = element.duration * 20.5 / 40
    if (element.seeking) {
      await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
    }
  })
  const chapterDuration = await video.evaluate(element => element.duration / 40)
  const view = await watchViewHandle(page)
  await view.evaluate(async (view, chapterDuration) => {
    view.videoChapters = Array.from({ length: 40 }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      timestamp: `${index}:00`,
      startSeconds: index * chapterDuration
    }))
    view.videoCurrentChapterIndex = 20
    view.showSidebarChapters = true
    await view.$nextTick()
  }, chapterDuration)
  const scroller = page.locator('.watchVideoChaptersPanel .chaptersWrapper')
  const expectCentered = () => expect.poll(() => scroller.evaluate(element => {
    const row = element.querySelector('.chapter.current').getBoundingClientRect()
    const viewport = element.getBoundingClientRect()
    return Math.abs(row.top + row.height / 2 - viewport.top - viewport.height / 2)
  })).toBeLessThan(2)
  await expectCentered()
  await scroller.locator('.chapter.current .copyTimestamp').click()
  await scroller.evaluate(element => { element.style.maxBlockSize = '240px' })
  await expectCentered()
  await scroller.locator('.chapter.current .copyTimestamp').press('Shift')
  await scroller.evaluate(element => { element.style.maxBlockSize = '360px' })
  await expectCentered()
  await scroller.hover()
  await page.mouse.wheel(0, 2000)
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(2000)
  await scroller.evaluate(element => { element.style.maxBlockSize = '480px' })
  await expect.poll(() => scroller.evaluate(element => (
    Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight))
  ))).toBeLessThan(2)
  // Revealing the list re-centers the current chapter one frame later. A wheel
  // in between, e.g. while a dock slides in, must win over that deferred frame.
  await scroller.evaluate(element => new Promise(resolve => {
    let hidden = false
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        hidden = true
        element.style.translate = ''
      } else if (hidden) {
        observer.disconnect()
        // A task after every observer callback of this update, before the next frame.
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
          element.dispatchEvent(new WheelEvent('wheel'))
          element.scrollTop = element.scrollHeight
          resolve()
        }
        channel.port2.postMessage(null)
      }
    })
    observer.observe(element)
    element.style.translate = '-100000px'
  }))
  expect(await scroller.evaluate(async element => {
    for (let frame = 0; frame < 10; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight))
  })).toBeLessThan(2)
  await scroller.locator('.chapterSeek').nth(32).click()
  await expect(scroller.locator('.chapter.current .chapterTitle')).toHaveText('Chapter 33')
  await scroller.evaluate(element => { element.style.maxBlockSize = '240px' })
  await expectCentered()
  await scroller.hover()
  await page.mouse.wheel(0, 2000)
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(2000)
  // A list scrolled by hand stays put when playback reaches the next chapter
  // and offers a button to follow playback again.
  const sync = page.locator('.watchVideoChaptersPanel').getByRole('button', { name: 'Sync to video time' })
  await expect(sync).toBeVisible()
  await view.evaluate(async view => {
    view.videoCurrentChapterIndex = 10
    await view.$nextTick()
  })
  await expect(scroller.locator('.chapter.current .chapterTitle')).toHaveText('Chapter 11')
  expect(await scroller.evaluate(async element => {
    for (let frame = 0; frame < 10; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight))
  })).toBeLessThan(2)
  // Space activates the button rather than the player's play shortcut.
  await sync.press('Space')
  await expectCentered()
  expect(await video.evaluate(element => element.paused)).toBe(true)
  await expect(sync).toHaveCount(0)
  await expect(scroller.locator('.chapter.current .chapterSeek')).toBeFocused()
  await scroller.hover()
  await page.mouse.wheel(0, 2000)
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(2000)
  // Two padded segmented rows fit the 240px list without scrolling.
  await view.evaluate(view => { view.videoChapters = view.videoChapters.slice(0, 2) })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
  // Without a scroll range there is nothing to sync back to.
  await expect(sync).toHaveCount(0)
  await view.dispose()
})

test('sidebar chapters resize from their handle and keep the size for later panels', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.locator(`${activeTab} .ftVideoPlayer video`).evaluate(video => video.pause())
  // Keep the sidebar layout at every scale; stacked, the scroll mini player
  // covers the list's handle.
  await setWindowSize(app, page, { width: Math.round(1300 * uiScale / 100), height: Math.round(1100 * uiScale / 100) })
  const view = await watchViewHandle(page)
  const setChapters = (count) => view.evaluate(async (view, count) => {
    view.videoChapters = Array.from({ length: count }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      timestamp: `${index}:00`,
      startSeconds: index * 0.5
    }))
    view.videoCurrentChapterIndex = 0
    view.showSidebarChapters = true
    await view.$nextTick()
  }, count)
  const reopen = async () => {
    await view.evaluate(async view => {
      view.showSidebarChapters = false
      await view.$nextTick()
    })
    await expect(panel).toHaveCount(0)
    await view.evaluate(view => { view.showSidebarChapters = true })
    await expect(panel).not.toHaveClass(/chapters-panel-enter-active/)
  }
  const panel = page.locator(`${activeTab} .watchVideoChaptersPanel`)
  const chapters = panel.locator('.chaptersWrapper')
  const listHeight = () => chapters.evaluate(element => element.getBoundingClientRect().height)
  const dragHandle = async (distance) => {
    await chapters.scrollIntoViewIfNeeded()
    const box = await chapters.boundingBox()
    // The handle sits in the list's bottom end corner.
    const x = box.x + box.width - 3
    const y = box.y + box.height - 3
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + distance / 2)
    await page.mouse.move(x, y + distance)
    await page.mouse.up()
  }

  await setChapters(40)
  await expect(panel).not.toHaveClass(/chapters-panel-enter-active/)
  await expect(chapters).toHaveCSS('resize', 'vertical')
  await expect.poll(async () => Math.abs(await listHeight() - 480)).toBeLessThan(2)

  // Growing the list from its end shrinks the scroll range; it must stay at
  // the new end with a matching scrollbar.
  await chapters.hover()
  await page.mouse.wheel(0, 2000)
  await chapters.evaluate(element => { element.scrollTop = element.scrollHeight })
  await dragHandle(200)
  await expect.poll(listHeight).toBeGreaterThan(640)
  await expect(chapters.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
  await expect.poll(() => chapters.evaluate(element => {
    const maximum = element.scrollHeight - element.clientHeight
    const viewport = element.getBoundingClientRect()
    const content = element.querySelector('.chaptersContent').getBoundingClientRect()
    const track = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect()
    const thumb = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect()
    return Math.max(
      Math.max(0, -element.scrollTop, element.scrollTop - maximum),
      Math.abs(content.bottom - viewport.bottom),
      Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) * track.height,
      Math.abs(track.bottom - thumb.bottom)
    ) * devicePixelRatio
  })).toBeLessThanOrEqual(2)
  const expanded = await listHeight()
  await reopen()
  await expect.poll(async () => Math.abs(await listHeight() - expanded)).toBeLessThan(2)

  await dragHandle(-400)
  await expect.poll(listHeight).toBeLessThan(320)
  const shrunk = await listHeight()
  await reopen()
  await expect.poll(async () => Math.abs(await listHeight() - shrunk)).toBeLessThan(2)

  // The stored size is a limit; a short list still fits its chapters.
  await dragHandle(400)
  await expect.poll(listHeight).toBeGreaterThan(640)
  await setChapters(2)
  await reopen()
  const contentHeight = await chapters.evaluate(element => element.querySelector('.chaptersContent').getBoundingClientRect().height)
  await expect.poll(async () => Math.abs(await listHeight() - contentHeight)).toBeLessThan(2)
  await view.dispose()
})

test('a background watch tab stays loading until its cached avatar is ready', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  await page.evaluate(() => {
    window.__backgroundWatchIconStates = []
    const record = () => {
      for (const tab of document.querySelectorAll('.tab')) {
        window.__backgroundWatchIconStates.push({
          id: tab.dataset.tabId,
          loading: tab.querySelector('.tabLoadingLine') != null,
          avatar: tab.querySelector('.tabAvatar') != null,
          pageIcon: tab.querySelector('.tabPageIcon') != null
        })
      }
    }
    new MutationObserver(record).observe(
      document.querySelector('.tabsContainer'),
      { childList: true, subtree: true }
    )
  })

  const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/watch/jNQXAC9IVRw',
    title: 'Cached video',
    makeActive: false,
    preloadInBackground: true
  }))
  const tab = page.locator(`.tab[data-tab-id="${watchTab.id}"]`)

  await expect(tab.locator('.tabLoadingLine')).toBeVisible()
  const avatarCached = await page.evaluate(async tabId => {
    const avatarBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUzZpk7I4HSAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=='
    const avatarBytes = Uint8Array.from(atob(avatarBase64), character => character.charCodeAt(0))
    return await window.ftElectron.tabs.updateAvatar(
      avatarBytes.buffer,
      tabId,
      '/watch/jNQXAC9IVRw'
    )
  }, watchTab.id)
  expect(avatarCached).toBe(true)
  await expect(tab.locator('.tabLoadingLine')).toHaveCount(0)
  await expect.poll(() => page.evaluate(tabId => (
    window.__backgroundWatchIconStates.some(state => state.id === tabId && !state.loading && state.avatar)
  ), watchTab.id)).toBe(true)

  const states = await page.evaluate(
    tabId => window.__backgroundWatchIconStates.filter(state => state.id === tabId),
    watchTab.id
  )
  expect(states.some(state => state.loading)).toBe(true)
  expect(states.some(state => !state.loading && state.avatar)).toBe(true)
  expect(states.some(state => state.loading && state.pageIcon)).toBe(true)
})

test('keeps background comment loading local to the loaded watch page', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setAutoLoadComments', false)
  })
  await openMockedVideo(page)

  const watchTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
  const watchTab = page.locator(`.tab[data-tab-id="${watchTabId}"]`)
  const watchContent = page.locator(`.tabContent[data-tab-id="${watchTabId}"]`)
  await expect(watchContent.locator('.getCommentsTitle')).toHaveCount(1)
  await expect(watchTab).not.toHaveClass(/loading/)

  let commentRequestStarted = false
  let releaseComments = () => {}
  const commentsReleased = new Promise(resolve => { releaseComments = resolve })
  await page.route(/\/youtubei\/v1\/next/, async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (!body.continuation) return route.fallback()

    commentRequestStarted = true
    await commentsReleased
    return route.fallback()
  })

  try {
    await page.locator(sel.newTabButton).click()
    await expect(watchContent).toHaveAttribute('aria-hidden', 'true')
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setAutoLoadComments', true)
    })
    await expect.poll(() => commentRequestStarted).toBe(true)
    await expect(watchContent.locator('.commentsArea .commentLoader')).toHaveCount(1)
    await expect(watchContent.locator('.commentsArea [data-tab-loading-indicator]')).toHaveCount(0)
    await expect(watchTab).not.toHaveClass(/loading/)
  } finally {
    releaseComments()
  }

  await expect(watchContent.locator('.commentsArea .commentLoader')).toHaveCount(0)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(view => { view.isLoading = true })
  await expect(watchTab).toHaveClass(/loading/)
  await watchView.evaluate(view => { view.isLoading = false })
  await expect(watchTab).not.toHaveClass(/loading/)
  await watchView.dispose()
})

test.describe('recommended video morph with default as the default', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        defaultViewingMode: 'default'
      }
    }
  })

  test('uses the current theatre layout', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let releaseRecommendedPlayer
    await page.route(/\/youtubei\/v1\/player/, async (route, request) => {
      const videoId = JSON.parse(request.postData() ?? '{}').videoId
      if (videoId === 'recommended-video') {
        await new Promise(resolve => { releaseRecommendedPlayer = resolve })
      }
      return route.fallback()
    })

    await openMockedVideo(page)
    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view, theatreMode) => {
      view.useTheatreMode = theatreMode
      view.recommendedVideos = [{
        videoId: 'recommended-video',
        title: 'Recommended video',
        author: 'Recommended channel',
        authorId: 'UC-recommended-channel',
        lengthSeconds: 60,
        published: Date.now(),
        type: 'video'
      }]
      await view.$nextTick()
    }, true)
    const lazyRecommendation = page.locator('.watchVideoRecommendations .recommendationsContent > div')
    await lazyRecommendation.evaluate(element => { element.style.minHeight = '1px' })
    await lazyRecommendation.scrollIntoViewIfNeeded()
    const recommendation = page.locator('.watchVideoRecommendations .title', {
      hasText: 'Recommended video'
    })
    await expect(recommendation).toBeVisible()

    await page.evaluate((activeTabSelector) => {
      const startViewTransition = document.startViewTransition.bind(document)
      document.startViewTransition = (update) => {
        window.__recommendedMorph = {
          sourceName: document.querySelector('.watchVideoRecommendations .thumbnailImage')
            ?.style.viewTransitionName
        }
        return startViewTransition(async () => {
          await update()
          const player = document.querySelector(`${activeTabSelector} .videoPlayer`)
          const layout = document.querySelector(`${activeTabSelector} .videoLayout`)
          window.__recommendedMorph.destinationName = getComputedStyle(player).viewTransitionName
          window.__recommendedMorph.usesTheatreLayout = layout.classList.contains('useTheatreMode')
        })
      }
    }, activeTab)

    await recommendation.click()
    await expect(page).toHaveURL(/#\/watch\/recommended-video/)
    await expect.poll(() => page.evaluate(() => window.__recommendedMorph)).toEqual({
      sourceName: 'video-morph',
      destinationName: 'video-morph',
      usesTheatreLayout: true
    })
    expect(await watchView.evaluate(view => view.loadingTheatreMode)).toBe(true)

    await expect.poll(() => typeof releaseRecommendedPlayer).toBe('function')
    releaseRecommendedPlayer()
  })
})

test('watch toolbar settles at every card width when actions move to its More menu', { tag: '@scale' }, async ({ app, page }) => {
  test.setTimeout(240000)
  await page.evaluate(async () => {
    await window.$store.dispatch('updateUseSponsorBlock', true)
    await window.$store.dispatch('updateEnableDownloads', false)
  })
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 1100, height: 850 })
  // Sweep across the widths where the toolbar starts moving actions to its
  // More menu. Each width has to settle instead of moving them back and forth.
  const unsettledWidths = await page.locator(`${activeTab} .watchVideoInfo`).evaluate(async card => {
    const toolbar = card.querySelector('.videoOptions')
    const frames = count => new Promise(resolve => {
      const step = () => (--count <= 0 ? resolve() : requestAnimationFrame(step))
      requestAnimationFrame(step)
    })
    const unsettled = []
    let overflowed = false
    for (let width = 240; width <= 400; width++) {
      card.style.inlineSize = `${width}px`
      await frames(4)
      let changes = 0
      const observer = new MutationObserver(records => { changes += records.length })
      observer.observe(toolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
      await frames(8)
      observer.disconnect()
      if (changes > 0) unsettled.push(width)
      overflowed ||= toolbar.querySelector('.moreActions') !== null
    }
    return { unsettled, overflowed }
  })
  expect(unsettledWidths).toEqual({ unsettled: [], overflowed: true })
})
