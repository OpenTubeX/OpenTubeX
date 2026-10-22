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

for (const chapterCount of [1, 30]) {
  test(`touch scrolling chains from sidebar chapters to the page (${chapterCount} chapters)`, { tag: '@scale' }, async ({ app, page }) => {
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
    }, chapterCount)
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
}

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

test('offers a YouTube link action in the watch tab context menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.locator('.tab.active').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeVisible()
})

test('uses the stored watch route for a dev-server tab link action', async ({ app, page }) => {
  const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
    url: 'http://localhost:9080/#/watch/jNQXAC9IVRw',
    title: 'Dev watch tab',
    makeActive: false,
    lazyLoad: true
  }))

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    return state.tabs.find(tab => tab.id === watchTab.id)?.route.fullPath
  }).toBe('/watch/jNQXAC9IVRw')
  await page.locator(`.tab[data-tab-id="${watchTab.id}"]`).click({ button: 'right' })
  const copyYouTubeLink = page.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })
  await expect(copyYouTubeLink).toBeVisible()
  await copyYouTubeLink.click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://youtu.be/jNQXAC9IVRw')
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

for (const blur of [false, true]) {
  test(`paints the toolbar's Save to dropdown above the cards below it${blur ? ' with blurred cards' : ''}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    if (blur) {
      // Custom theme blurs give the cards and the toolbar backdrop filters,
      // which make them stacking contexts
      await page.evaluate(() => {
        document.body.style.setProperty('--card-bg-blur', 'blur(8px)')
        document.body.style.setProperty('--secondary-card-bg-blur', 'blur(8px)')
      })
    }

    const videoInfo = page.locator('.infoArea .watchVideoInfo')
    await videoInfo.locator('.videoOptions').evaluate(element => element.scrollIntoView({ block: 'start' }))
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
}

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

test('keeps stacked watch cards separated in the Capacitor phone layout', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowWidth(app, 520)
  await page.locator('.app').evaluate((element) => {
    element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
  })

  const cards = page.locator('.watchVideoInfo:visible, .videoDescription:visible, .watchVideoRecommendations:visible, .commentsArea > .watchVideo:visible')
  await expect(cards).toHaveCount(3)

  const geometry = await cards.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      bottom: bounds.bottom,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      viewportWidth: window.innerWidth
    }
  }))

  for (const card of geometry) {
    expect(card.left).toBeGreaterThanOrEqual(-1)
    expect(card.right).toBeLessThanOrEqual(card.viewportWidth + 1)
    expect(card.left).toBeLessThanOrEqual(1)
    expect(card.viewportWidth - card.right).toBeLessThanOrEqual(1)
  }

  for (let index = 1; index < geometry.length; index++) {
    expect(geometry[index].top - geometry[index - 1].bottom).toBeGreaterThanOrEqual(12)
  }
})

for (const { name, options, expectedCount } of [
  { name: 'hides transcript actions without captions', options: {}, expectedCount: 0 },
  {
    name: 'shows transcript actions with captions',
    options: { captionCueSettings: 'align:center' },
    expectedCount: 1
  }
]) {
  test(name, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, options)
    await openMockedVideo(page)

    await expect(page.locator('.infoArea .watchVideoInfo')
      .getByRole('button', { name: 'Show transcript' }))
      .toHaveCount(expectedCount)
    await expect(page.locator('.fullscreenActions .fullscreenTranscriptToggle'))
      .toHaveCount(expectedCount)
  })
}

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

  test('collapses the sidebar after closing the transcript', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await openMockedVideo(page)

    const layout = page.locator(`${activeTab} .videoLayout`)
    await expect(layout).toHaveClass(/noSidebar/)

    await page.getByRole('button', { name: 'Show transcript' }).click()
    await expect(layout).not.toHaveClass(/noSidebar/)
    await page.locator(`${activeTab} .sidebarArea`)
      .getByRole('button', { name: 'Close transcript' })
      .click()

    await expect(layout).toHaveClass(/noSidebar/)
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
  await view.evaluate(view => { view.videoChapters = view.videoChapters.slice(0, 3) })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
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
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', false)
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
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
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

for (const { defaultViewingMode, currentTheatreMode } of [
  { defaultViewingMode: 'theatre', currentTheatreMode: false },
  { defaultViewingMode: 'default', currentTheatreMode: true }
]) {
  test.describe(`recommended video morph with ${defaultViewingMode} as the default`, () => {
    test.use({
      seed: {
        settings: {
          ...WATCH_PAGE_SEED,
          defaultViewingMode
        }
      }
    })

    test(`uses the current ${currentTheatreMode ? 'theatre' : 'default'} layout`, async ({ app, page }) => {
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
      }, currentTheatreMode)
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
        usesTheatreLayout: currentTheatreMode
      })
      expect(await watchView.evaluate(view => view.loadingTheatreMode)).toBe(currentTheatreMode)

      await expect.poll(() => typeof releaseRecommendedPlayer).toBe('function')
      releaseRecommendedPlayer()
    })
  })
}
