import { sel } from '../../helpers/app.mjs'
import { test, expect, setPlayerFullscreen } from '../../helpers/innertube.mjs'
import { findWatchComponent, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const CAPTIONED_VIDEO = {
  id: 'Xf-uUy5pdUI',
  title: 'What’s It Like to Be Killed by Nature’s Most Brutal Predator',
  url: 'https://www.youtube.com/watch?v=Xf-uUy5pdUI'
}
const FULLSCREEN_PLAYLIST_ID = 'fullscreen-preview'
const FULLSCREEN_PLAYLIST = {
  _id: FULLSCREEN_PLAYLIST_ID,
  playlistName: 'Fullscreen preview',
  protected: false,
  description: '',
  videos: [{
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    author: 'jawed',
    authorId: 'UC4QobU6STFB0P71PMvOGN5A',
    lengthSeconds: 19,
    type: 'video'
  }],
  createdAt: Date.now() - 86_400_000,
  lastUpdatedAt: Date.now() - 86_400_000
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

async function openFullscreenPlaylistVideo(page, { enableQuickBookmark = false } = {}) {
  await page.locator(sel.sideNavLink('userplaylists')).first().evaluate(element => element.click())
  await expect(page).toHaveURL(/#\/userplaylists/)
  await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.playlistName }).first().click()
  await expect(page).toHaveURL(new RegExp(`#\\/playlist\\/${FULLSCREEN_PLAYLIST_ID}`))
  if (enableQuickBookmark) {
    const enableButton = page.getByTitle('Enable Quick Bookmark With This Playlist')
    if (await enableButton.isVisible()) {
      await enableButton.click()
    }
    await expect(page.getByTitle('Quick Bookmark Enabled')).toBeVisible()
  }
  await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.videos[0].title }).first().click()
  await expect(page).toHaveURL(
    new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`)
  )
}

async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

/** Resize the window and wait for the renderer to have laid out at the new size. */
async function setWindowSize(app, page, { width, height }) {
  const before = await getViewport(page)

  await app.electronApp.evaluate(({ BrowserWindow }, size) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, ...size })
  }, { width, height })

  await expect.poll(async () => {
    const viewport = await getViewport(page)
    return viewport.width !== before.width && viewport.height !== before.height
  }).toBe(true)

  return await getViewport(page)
}

function getViewport(page) {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight
  }))
}

/** @param {{ width: number, height: number }} viewport */
async function expectDockedToBottomRight(player, viewport, margin = 16) {
  // Polled because the layout animation skews the box for its first 300ms.
  await expect.poll(async () => {
    const box = await player.boundingBox()
    if (!box) return null

    return {
      right: Math.round(viewport.width - (box.x + box.width)),
      bottom: Math.round(viewport.height - (box.y + box.height))
    }
  }).toEqual({ right: margin, bottom: margin })
}

test('theatre mode works until its responsive button cutoff', async ({ app, page }) => {
  await setWindowWidth(app, 1500)
  await page.locator(sel.searchInput).fill(VIDEO_URL)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.videoLayout')).toBeVisible()
  await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__
    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }
    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.videoLoadGeneration += 1
    watchView.errorMessage = null
    watchView.isUpcoming = false
    watchView.playabilityStatus = 'OK'
    watchView.showTranscript = true
    watchView.activeFormat = 'legacy'
    watchView.handlePlayerError = () => {}
    watchView.legacyFormats = [{
      itag: 18,
      qualityLabel: '360p',
      height: 360,
      width: 640,
      url: 'data:video/mp4;base64,'
    }]
    watchView.isLoading = false
    await watchView.$nextTick()
  })

  const layout = page.locator('.videoLayout')
  const theatreButton = page.locator('.theatre-button').first()
  const videoArea = page.locator('.videoArea')
  const sidebar = page.locator('.sidebarArea')
  await expect(theatreButton).toBeVisible()
  await expect.poll(async () => {
    const [videoBounds, sidebarBounds] = await Promise.all([
      videoArea.boundingBox(),
      sidebar.boundingBox()
    ])
    return sidebarBounds.x >= videoBounds.x + videoBounds.width - 1
  }).toBe(true)

  await theatreButton.evaluate(button => button.click())
  await expect(layout).toHaveClass(/useTheatreMode/)
  await expect.poll(async () => {
    const [videoBounds, sidebarBounds] = await Promise.all([
      videoArea.boundingBox(),
      sidebar.boundingBox()
    ])
    return sidebarBounds.y >= videoBounds.y + videoBounds.height - 1
  }).toBe(true)

  await theatreButton.evaluate(button => button.click())
  await expect(layout).not.toHaveClass(/useTheatreMode/)

  await setWindowWidth(app, 1200)
  await expect(theatreButton).toBeHidden()
  await expect(page.locator('.ftVideoPlayerHost')).toHaveClass(/theatreUnavailable/)

  await page.keyboard.press('t')
  await expect(layout).not.toHaveClass(/useTheatreMode/)
})

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

  test('stops querying Shaka state before a format switch unloads it', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const player = page.locator('.ftVideoPlayer')
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await player.evaluate((element, watchComponent) => {
      const overlay = element.ui ?? element.querySelector('video')?.ui
      const shakaPlayer = overlay?.getControls().getPlayer()
      if (!watchComponent || !shakaPlayer) {
        throw new Error('Unable to access the mounted player')
      }

      window.__hasLoadedAtFormatUnload = []
      const unload = shakaPlayer.unload.bind(shakaPlayer)
      shakaPlayer.unload = (...args) => {
        window.__hasLoadedAtFormatUnload.push(watchComponent.refs.player.hasLoaded)
        return unload(...args)
      }

      const watchView = watchComponent.proxy
      watchView.handleFormatChange(watchView.activeFormat === 'audio' ? 'dash' : 'audio')
    }, watchComponent)
    await watchComponent.dispose()

    await expect.poll(() => page.evaluate(() => window.__hasLoadedAtFormatUnload)).toEqual([false])
  })

  test('keeps audio-only playback at video size with the thumbnail visible', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await page.evaluate((watchComponent) => {
      if (!watchComponent) throw new Error('Unable to access the watch view')
      watchComponent.proxy.handleFormatChange('audio')
    }, watchComponent)
    await watchComponent.dispose()

    const player = page.locator('.ftVideoPlayer')
    await expect(player).toHaveClass(/sixteenByNine/)
    await expect(player.locator('video')).toHaveAttribute('poster', /\S+/)
  })

  test('hides the tab play indicator while buffering', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)
    const activeTab = page.locator(sel.activeTab)
    await expect(activeTab.locator('.playingIcon')).toBeVisible()

    await video.dispatchEvent('waiting')
    await expect(activeTab.locator('.playingIcon')).toHaveCount(0)

    await video.dispatchEvent('playing')
    await expect(activeTab.locator('.playingIcon')).toBeVisible()
  })

  test('animates into and out of the scroll mini player', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)
    await video.evaluate(element => element.pause())
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'no-preference'
      window.scrollMiniPlayerAnimations = []
      const nativeAnimate = Element.prototype.animate

      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains('ftVideoPlayer')) {
          const style = getComputedStyle(this)
          window.scrollMiniPlayerAnimations.push({
            className: this.className,
            keyframes,
            options,
            position: style.position,
            zIndex: style.zIndex
          })
        }
        return nativeAnimate.call(this, keyframes, options)
      }
    })

    const player = page.locator('.ftVideoPlayer')
    await player.evaluate(element => {
      const rect = element.getBoundingClientRect()
      window.scrollTo(0, window.scrollY + rect.bottom)
    })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimations.length)).toBe(1)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimations.length)).toBe(2)

    const animations = await page.evaluate(() => window.scrollMiniPlayerAnimations)
    for (const animation of animations) {
      expect(animation.options.duration).toBe(300)
      expect(animation.options.easing).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
      expect(animation.keyframes[0].transform).toContain('translate(')
      expect(animation.keyframes[0].transform).toContain('scale(')
      expect(animation.keyframes[1].transform).toBe('none')
    }
    expect(animations[1].className).toContain('scrollMiniPlayerAnimating')
    expect(animations[1].position).toBe('relative')
    expect(animations[1].zIndex).toBe('150')
  })

  test('keeps the scroll mini player docked across window resizes', async ({ app, page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await setWindowSize(app, page, { width: 1200, height: 850 })
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')
    const scrollBelowPlayer = () => player.evaluate(element => {
      const rect = element.getBoundingClientRect()
      window.scrollTo(0, window.scrollY + rect.bottom)
    })

    // Docked bottom-right in the small window.
    await scrollBelowPlayer()
    await expect(player).toHaveClass(/scrollMiniPlayer/)

    // Growing the window used to leave the player where the old bottom edge
    // was, i.e. floating in the middle of the screen.
    const grown = await setWindowSize(app, page, { width: 1600, height: 1050 })
    await expectDockedToBottomRight(player, grown)

    // ...and the stale position outlived a trip back to the inline player.
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)

    const shrunk = await setWindowSize(app, page, { width: 1300, height: 900 })
    await scrollBelowPlayer()
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expectDockedToBottomRight(player, shrunk)
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

  test('sidebar chapters and SponsorBlock honor roundness while closing beside the description', async ({ page, innertube }) => {
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

      document.body.style.setProperty('--ui-roundness', '2')
      window.__sidebarRoundnessWatchView = watchView
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
    const standardCardRadius = await page.locator('.watchVideoInfo.ft-card').evaluate(element => {
      return getComputedStyle(element).borderRadius
    })
    await expect(layout).toHaveClass(/useTheatreMode/)
    await expect(panel).toBeVisible()
    expect(standardCardRadius).toBe('16px')
    await expect(panel).toHaveCSS('border-radius', standardCardRadius)
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

    await page.evaluate(async () => {
      window.__sidebarRoundnessWatchView.showSidebarSponsorBlock = true
      await window.__sidebarRoundnessWatchView.$nextTick()
    })
    await expect(page.locator('.watchVideoSponsorBlock')).toHaveCSS(
      'border-radius',
      standardCardRadius
    )
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

  test('displays and submits full-video SponsorBlock labels', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')

    const fullVideoSegment = {
      UUID: 'full-video-label',
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      locked: 0,
      segment: [0, 0],
      videoDuration: 19,
      votes: 1
    }
    let submittedBody = null

    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [fullVideoSegment]
      }]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-full-video-label',
          category: 'exclusive_access',
          segment: [0, 0]
        }]),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openVideo(page)

    await expect(page.locator('.watchVideoInfo .videoBadge'))
      .toContainText('Exclusive Access · Full Video')

    await page.locator('.sponsorblock-start-button').click({ force: true })
    await page.locator('.sponsorblock-open-menu-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await expect(submissionMenu).toBeVisible()
    await submissionMenu.locator('select').first().selectOption('exclusive_access')
    await expect(submissionMenu.locator('select').nth(1)).toHaveValue('full')
    await expect(submissionMenu.locator('.sponsorBlockDraftTimeText')).toHaveText('Full Video')

    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()
    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      segment: [0, 0]
    }])
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(0)
  })

  test('mutes SponsorBlock mute segments without skipping', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')

    let submittedBody = null
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'mute-segment',
          actionType: 'mute',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [2, 10],
          videoDuration: 19,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-mute-segment',
          category: 'sponsor',
          segment: [11, 12]
        }]),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.muted = false
      element.currentTime = 3
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', true)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(10)

    const muteNotification = page.locator('.skippedSegment').filter({ hasText: 'Muted Sponsor segment' })
    await expect(muteNotification).toBeVisible()
    await expect(muteNotification.locator('.skippedSegmentTimer')).toHaveText('7s')
    await muteNotification.getByRole('button', { name: /Unmute/ }).click()
    await expect(video).toHaveJSProperty('muted', false)
    await expect(muteNotification).toBeVisible()
    await expect(muteNotification.getByRole('button', { name: /Mute/ })).toBeVisible()

    await video.evaluate(element => {
      element.currentTime = 4
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(muteNotification).toBeVisible()
    await muteNotification.getByRole('button', { name: /Mute/ }).click()
    await expect(video).toHaveJSProperty('muted', true)

    await video.evaluate(element => {
      element.currentTime = 11
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', false)
    await expect(muteNotification).toHaveCount(0)

    await video.evaluate(element => {
      element.muted = true
      element.currentTime = 3
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(muteNotification).toBeVisible()
    await muteNotification.getByRole('button', { name: /Unmute/ }).click()
    await expect(video).toHaveJSProperty('muted', false)
    await video.evaluate(element => {
      element.currentTime = 11
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', true)
    await video.evaluate(element => { element.muted = false })

    await video.evaluate(element => {
      element.pause()
      element.currentTime = 11
    })
    await page.locator('.sponsorblock-start-button').click({ force: true })
    await video.evaluate(element => { element.currentTime = 12 })
    await page.locator('.sponsorblock-end-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await submissionMenu.locator('select').nth(1).selectOption('mute')
    await submissionMenu.getByRole('button', { name: 'Preview' }).click()
    await video.evaluate(element => {
      element.currentTime = 11.5
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', true)
    await video.evaluate(element => {
      element.currentTime = 12.1
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', false)

    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()
    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'mute',
      category: 'sponsor',
      description: '',
      segment: [11, 12]
    }])
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
    const controls = page.locator('.shaka-controls-container')
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
    // End-screen annotations use z-index 2, so the controls stacking context
    // must rise above them for its seek preview to be visible.
    await expect(controls).toHaveCSS('z-index', '3')
    await expect(actions).toHaveCSS('z-index', '0')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '0')
  })

  test.describe('fullscreen captions', () => {
    test.use({
      seed: {
        settings: {
          defaultCaptionSettings: JSON.stringify({ fontScale: 1.5 })
        }
      }
    })

    test('keeps the configured caption size in fullscreen', async ({ app, innertube }) => {
      test.skip(innertube.replay, 'watch page hydration needs the real API')
      const { page } = app
      await openVideo(page)

      const player = page.locator('.ftVideoPlayer')
      await player.evaluate(element => {
        for (const className of ['shaka-text-container', 'shaka-speech-to-text-container']) {
          if (element.querySelector(`.${className}`)) continue

          const captions = document.createElement('div')
          captions.className = className
          element.append(captions)
        }
      })

      const captionContainers = player.locator(
        '.shaka-text-container, .shaka-speech-to-text-container'
      )
      await expect(captionContainers).toHaveCount(2)
      const windowedFontSizes = await captionContainers.evaluateAll(elements => {
        return elements.map(element => getComputedStyle(element).fontSize)
      })
      expect(windowedFontSizes).toEqual(['30px', '30px'])

      await setWindowWidth(app, 400)
      const narrowFontSizes = ['24px', '24px']
      await expect.poll(async () => captionContainers.evaluateAll(elements => {
        return elements.map(element => getComputedStyle(element).fontSize)
      })).toEqual(narrowFontSizes)

      await setPlayerFullscreen(page, true)
      await expect.poll(async () => captionContainers.evaluateAll(elements => {
        return elements.map(element => getComputedStyle(element).fontSize)
      })).toEqual(narrowFontSizes)
    })
  })

  test.describe('fullscreen playlist dock', () => {
    test.use({
      seed: {
        settings: {
          uiRoundness: 200,
        },
        playlists: [FULLSCREEN_PLAYLIST],
        history: [{
          ...FULLSCREEN_PLAYLIST.videos[0],
          _id: 'jNQXAC9IVRw',
          watchProgress: 19,
          isWatched: true,
          timeWatched: Date.now(),
          isLive: false,
        }]
      }
    })

    test('does not duplicate the remove action for the Quick Bookmark playlist', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'watch page hydration needs the real API')
      await openVideo(page)
      await openFullscreenPlaylistVideo(page, { enableQuickBookmark: true })

      const item = page.locator('.watchVideoPlaylist .playlistItem').first()
      await item.locator('.videoThumbnail').hover()
      await expect(item.locator('.trashIcon')).toHaveCount(1)
      await expect(item.locator('.quickBookmarkVideoIcon')).toHaveCount(0)
    })

    test('keeps compact watched labels and playlist menus clear of other controls', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'watch page hydration needs the real API')
      await openVideo(page)
      await openFullscreenPlaylistVideo(page)

      const playlist = page.locator('.watchVideoPlaylist.resizablePlaylist')
      const item = playlist.locator('.playlistItem').first()
      const thumbnail = item.locator('.videoThumbnail')
      const watched = thumbnail.locator('.videoWatched')
      const actions = thumbnail.locator('.playlistIcons')
      await expect(playlist).toBeVisible()
      await thumbnail.hover()
      await expect(watched).toBeVisible()
      await expect(actions).toBeVisible()
      const duration = thumbnail.locator('.videoDuration')
      await expect(watched).toHaveCSS('font-size', '12px')
      await expect(watched).toHaveCSS('border-radius', '10px')
      await expect(duration).toHaveCSS('font-size', '12px')
      await expect(duration).toHaveCSS('border-radius', '10px')

      const [watchedBox, actionsBox] = await Promise.all([
        watched.boundingBox(),
        actions.boundingBox(),
      ])
      expect(
        watchedBox.x + watchedBox.width <= actionsBox.x ||
        actionsBox.x + actionsBox.width <= watchedBox.x ||
        watchedBox.y + watchedBox.height <= actionsBox.y ||
        actionsBox.y + actionsBox.height <= watchedBox.y
      ).toBe(true)

      const sponsorBlockLabel = thumbnail.locator('.sponsorBlockVideoLabel')
      await thumbnail.evaluate(element => {
        const watched = element.querySelector('.videoWatched')
        watched.style.display = 'none'
        watched.closest('.ft-list-item').classList.remove('watched')

        const label = element.querySelector('.videoDuration').cloneNode(false)
        label.className = 'sponsorBlockVideoLabel'
        const text = document.createElement('span')
        text.textContent = 'Self-Promotion'
        for (const attribute of label.getAttributeNames()) {
          if (attribute.startsWith('data-v-')) {
            text.setAttribute(attribute, '')
          }
        }
        label.append(text)
        element.append(label)
      })
      await expect(sponsorBlockLabel).toBeVisible()
      const [sponsorBlockBox, durationBox, currentActionsBox] = await Promise.all([
        sponsorBlockLabel.boundingBox(),
        duration.boundingBox(),
        actions.boundingBox(),
      ])
      expect(sponsorBlockBox.y).toBeGreaterThan(
        currentActionsBox.y + currentActionsBox.height
      )
      expect(sponsorBlockBox.x + sponsorBlockBox.width).toBeLessThanOrEqual(durationBox.x)

      const addToPlaylist = item.locator('.addToPlaylistIcon .iconButton')
      await addToPlaylist.click()
      const dropdown = page.locator('.app > .iconDropdown.portal')
      await expect(dropdown).toBeVisible()
      const [buttonBox, dropdownBox] = await Promise.all([
        addToPlaylist.boundingBox(),
        dropdown.boundingBox(),
      ])
      expect(dropdownBox.y + dropdownBox.height).toBeLessThanOrEqual(buttonBox.y)
      expect(dropdownBox.x).toBeGreaterThanOrEqual(8)
      expect(dropdownBox.x + dropdownBox.width).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth - 8)
      )
      expect(await dropdown.evaluate(element => element.parentElement?.classList.contains('app'))).toBe(true)
      await expect(dropdown).toHaveCSS(
        'font-family',
        await page.locator('.app').evaluate(element => getComputedStyle(element).fontFamily)
      )
      expect(await dropdown.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2
        ))
      })).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dropdown).toHaveCount(0)

      const moreOptions = item.locator('.optionsButton .iconButton')
      await moreOptions.click()
      await expect(dropdown).toBeVisible()
      await expect(dropdown).toHaveClass(/listVideoOptionsDropdown/)
      await expect(dropdown).toHaveCSS('font-size', '14px')
      await expect(dropdown).toHaveCSS('overflow-y', 'auto')
      const optionsDropdownBox = await dropdown.boundingBox()
      expect(optionsDropdownBox.y).toBeGreaterThanOrEqual(8)
      expect(optionsDropdownBox.y + optionsDropdownBox.height).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerHeight - 8)
      )
      expect(optionsDropdownBox.x).toBeGreaterThanOrEqual(8)
      expect(optionsDropdownBox.x + optionsDropdownBox.width).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth - 8)
      )
      expect(await dropdown.evaluate(element => element.parentElement?.classList.contains('app'))).toBe(true)
      await expect(moreOptions).toBeVisible()
    })

    test('shows the progress preview above the content viewport', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'watch page hydration needs the real API')
      await openVideo(page)
      await openFullscreenPlaylistVideo(page)
      await expect(page.locator('.watchVideoPlaylist.resizablePlaylist')).toBeVisible()

      await page.locator('.full-window-button').click({ force: true })
      await page.locator('.fullscreenPlaylistToggle').click({ force: true })

      const dock = page.locator('.fullscreenPlaylistOverlay.open')
      const content = dock.locator('.fullscreenPlaylistContent')
      const progress = dock.locator('.playlistProgressBarContainer')
      await expect(dock).toBeVisible()
      const progressBox = await progress.boundingBox()
      await page.mouse.move(progressBox.x + 1, progressBox.y + (progressBox.height / 2))

      const preview = dock.locator('.previewTooltip')
      await expect(preview).toBeVisible()
      const contentBox = await content.boundingBox()
      const previewBox = await preview.boundingBox()
      expect(previewBox.y).toBeLessThan(contentBox.y)
      await expect(content).toHaveCSS('overflow', 'visible')
      await expect(content).toHaveAttribute('data-overlayscrollbars-viewport')

      for (const position of [0.25, 0.5, 0.75]) {
        await page.mouse.move(
          progressBox.x + (progressBox.width * position),
          progressBox.y + (progressBox.height / 2)
        )
        const box = await preview.boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(contentBox.x - 1)
        expect(box.x + box.width).toBeLessThanOrEqual(contentBox.x + contentBox.width + 1)
      }

      await page.mouse.move(
        progressBox.x + progressBox.width - 1,
        progressBox.y + (progressBox.height / 2)
      )
      const rightEdgeBox = await preview.boundingBox()
      expect(rightEdgeBox.x + rightEdgeBox.width).toBeLessThanOrEqual(
        contentBox.x + contentBox.width + 1
      )
    })
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

test.describe('custom Shorts player', () => {
  const SHORTS_CHANNEL = 'UCshortsfeed000000000000'
  const FIRST_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/w1WKmSqwM8I/frame0.jpg?selected=1'
  const SECOND_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/RZ6PG5QATg4/frame0.jpg?selected=1'

  test.use({
    seed: {
      settings: {
        useCustomShortsPlayer: true,
        useSponsorBlock: true,
        fetchSubscriptionsAutomatically: false,
        playNextVideo: true,
        defaultInterval: 0
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: SHORTS_CHANNEL,
          name: 'Shorts Channel',
          thumbnail: ''
        }]
      }],
      subscriptionCache: [{
        _id: SHORTS_CHANNEL,
        shorts: [
          {
            type: 'video',
            videoId: 'w1WKmSqwM8I',
            title: 'First seeded Short',
            author: 'Shorts Channel',
            authorId: SHORTS_CHANNEL,
            published: 2,
            isShort: true,
            lengthSeconds: '',
            thumbnailUrl: FIRST_SHORT_THUMBNAIL
          },
          {
            type: 'video',
            videoId: 'RZ6PG5QATg4',
            title: 'Second seeded Short',
            author: 'Shorts Channel',
            authorId: SHORTS_CHANNEL,
            published: 1,
            isShort: true,
            lengthSeconds: '',
            thumbnailUrl: SECOND_SHORT_THUMBNAIL
          }
        ],
        shortsTimestamp: new Date().toISOString()
      }]
    }
  })

  test('pausing exposes loaded player state to the template', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })
    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    const video = await waitForPlaybackOrSkip(test, page)
    await video.evaluate(element => element.pause())
    await expect(player).toHaveClass(/shortsPaused/)
  })

  test('preserves the tall aspect ratio of an explicit Shorts link', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'Shorts detection needs the real API')

    await page.evaluate(() => {
      window.__shortsSeekBarFlashedWhileLoading = false
      const observer = new MutationObserver(() => {
        if (document.querySelector('.ftVideoPlayer.shortsPlayer.shortsPaused')) {
          window.__shortsSeekBarFlashedWhileLoading = true
        }
      })
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
      })
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })

    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    await expect(page.locator('.videoLayout')).toHaveClass(/shortsPlayerActive/)
    await expect(page.locator('.shortsExternalMetadata .shortsExternalTitle')).toBeVisible()
    await expect(page.locator('.shortsTopControls')).toBeVisible()
    await expect(page.locator('.shortsActionRail')).toBeVisible()
    await expect(page.locator('.shortsNavigation')).toBeVisible()
    await expect(page.locator('.infoArea')).toBeHidden()
    const video = player.locator('video')
    await expect(video).toHaveAttribute('loop', '')
    await expect(video).toHaveAttribute('poster', FIRST_SHORT_THUMBNAIL)
    await expect(video).toHaveCSS('object-fit', 'cover')
    await expect(player.locator('.shortsTopControl').first()).toHaveCSS(
      'backdrop-filter',
      /blur\(8px\)/
    )
    expect(await player.evaluate(element => {
      return element.ui.getConfiguration().doubleClickForFullscreen
    })).toBe(false)
    expect(await page.evaluate(() => window.__shortsSeekBarFlashedWhileLoading)).toBe(false)

    const seekBar = player.locator('.shaka-seek-bar-container')
    await video.evaluate(async element => {
      if (element.paused) await element.play()
    })
    await expect(player).not.toHaveClass(/shortsPaused/)
    await expect(seekBar).toHaveCSS('opacity', '0')

    const playerBounds = await player.boundingBox()
    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height - 2
    )
    await expect(seekBar).toHaveCSS('opacity', '1')
    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height / 2
    )
    await player.locator('.shortsTopControl').first().click()
    // Production regression: this class depends on hasLoaded being available
    // to the template after pausing, where Vue runtime warnings are stripped.
    await expect(player).toHaveClass(/shortsPaused/)
    await expect(seekBar).toHaveCSS('opacity', '1')

    const volumeControl = player.locator('.shortsVolumeControl')
    await volumeControl.hover()
    await expect(volumeControl.locator('.shortsVolumeSlider')).toBeVisible()

    const moreOptions = player.getByRole('button', { name: 'More Options' })
    const overflowMenu = player.locator('.shaka-overflow-menu')
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    const [playerBox, menuBox] = await Promise.all([
      player.boundingBox(),
      overflowMenu.boundingBox(),
    ])
    expect(menuBox.y).toBeLessThan(playerBox.y + playerBox.height / 2)
    expect(menuBox.x).toBeGreaterThan(playerBox.x + playerBox.width / 2)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(playerBox.x + playerBox.width)

    const fullWindowMenuButton = overflowMenu.getByRole('button', {
      name: /Full Window/
    })
    await fullWindowMenuButton.click()
    await expect(player).toHaveClass(/fullWindow/)

    await moreOptions.click()
    const exitFullWindowMenuButton = overflowMenu.getByRole('button', {
      name: /Exit Full Window/
    })
    await expect(exitFullWindowMenuButton).toBeVisible()
    await exitFullWindowMenuButton.click()
    await expect(player).not.toHaveClass(/fullWindow/)

    await moreOptions.dblclick()
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true)

    await moreOptions.click()
    const videoInfoMenuButton = overflowMenu.getByRole('button', {
      name: 'Video information'
    })
    await expect(videoInfoMenuButton).toBeVisible()
    await videoInfoMenuButton.click()
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await page.getByRole('button', { name: 'Close video information' }).click()
    await expect(page.locator('.shortsAuxPanel')).not.toHaveClass(/shortsAuxPanelOpen/)

    for (const label of ['Share Video', 'Add to Playlist']) {
      const action = page.locator('.shortsComponentAction').filter({ hasText: label })
      const actionButton = action.getByRole('button', { name: label })
      const idleBackground = await actionButton.evaluate(element => {
        return getComputedStyle(element).backgroundColor
      })

      await actionButton.click()
      await expect(actionButton).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(() => actionButton.evaluate(element => {
        return getComputedStyle(element).backgroundColor
      })).not.toBe(idleBackground)
      await actionButton.click()
    }

    const commentsButton = page.getByRole('button', { name: 'Show Comments' })
    await commentsButton.click()
    await expect(commentsButton).toHaveAttribute('aria-pressed', 'true')
    await expect(commentsButton).toHaveAccessibleName('Hide Comments')
    await expect(page.locator('.shortsCommentsPanel')).toHaveClass(/shortsCommentsPanelOpen/)
    await commentsButton.click()
    await expect(commentsButton).toHaveAttribute('aria-pressed', 'false')

    const quickBookmark = page.locator('.shortsQuickBookmark')
    if (await quickBookmark.count()) {
      await quickBookmark.locator('.iconButton').click()
      await expect(quickBookmark).toHaveClass(/shortsQuickBookmarked/)
    }

    const bounds = await player.boundingBox()
    expect(bounds.height).toBeGreaterThan(bounds.width)
  })

  test('keeps captions fixed when hover controls appear', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'Shorts detection needs the real API')

    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })

    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    await player.locator('video').evaluate(async element => {
      if (element.paused) await element.play()
    })
    await expect(player).not.toHaveClass(/shortsPaused/)

    const controls = player.locator('.shaka-controls-container')
    await player.evaluate(element => {
      if (element.querySelector('.shaka-text-container')) return

      const captions = document.createElement('div')
      captions.className = 'shaka-text-container'
      element.querySelector('.shaka-controls-container').after(captions)
    })
    const captions = player.locator('.shaka-text-container')
    await page.mouse.move(0, 0)
    await expect(controls).not.toHaveAttribute('shown', 'true')
    const captionsBottomWithoutHover = await captions.evaluate(element => {
      return getComputedStyle(element).bottom
    })
    expect(Number.parseFloat(captionsBottomWithoutHover)).toBeGreaterThan(0)

    const playerBounds = await player.boundingBox()
    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height - 2
    )
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect(captions).toHaveCSS('bottom', captionsBottomWithoutHover)
  })

  test('only exposes applicable controls and stays in the Shorts player', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'Shorts detection needs the real API')

    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })

    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    const captionTrackCount = await player.evaluate(element => {
      return element.ui.getControls().getPlayer().getTextTracks().length
    })
    await expect(player.locator('.shortsCaptionsControl')).toHaveCount(captionTrackCount > 0 ? 1 : 0)

    const overflowMenu = player.locator('.shaka-overflow-menu')
    await player.getByRole('button', { name: 'More Options' }).click()
    await expect(overflowMenu).toBeVisible()
    await expect(overflowMenu.getByRole('button', { name: /Autoplay/ })).toHaveCount(0)

    const video = player.locator('video')
    await expect.poll(() => video.evaluate(element => element.duration))
      .toBeGreaterThan(0)
    const duration = await video.evaluate(element => element.duration)
    await video.evaluate(async (element, scrubbedTo) => {
      element.pause()
      element.currentTime = scrubbedTo
      if (element.seeking) {
        await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      }
    }, duration - 0.25)

    // Scrubbing to the end must not count as completing the Short.
    await expect.poll(() => page.evaluate((expectedDuration) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const entry = store.getters.getHistoryCacheById.w1WKmSqwM8I
      return {
        nearEnd: entry?.watchProgress >= expectedDuration - 0.5,
        full: entry?.watchProgress === entry?.lengthSeconds
      }
    }, duration)).toEqual({ nearEnd: true, full: false })

    await video.evaluate(async (element, playbackStart) => {
      element.currentTime = playbackStart
      if (element.seeking) {
        await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      }
      await element.play()
    }, duration - 2)

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const entry = store.getters.getHistoryCacheById.w1WKmSqwM8I
      return {
        watched: entry?.isWatched,
        fullProgress: entry?.watchProgress === entry?.lengthSeconds
      }
    })).toEqual({ watched: true, fullProgress: true })

    // Ticks from the next automatic loop must not replace completed progress
    // with a resume point near the beginning.
    await video.evaluate(element => {
      element.currentTime = 0.2
      element.dispatchEvent(new Event('timeupdate'))
      element.dispatchEvent(new Event('pause'))
    })
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const entry = store.getters.getHistoryCacheById.w1WKmSqwM8I
      return entry.watchProgress === entry.lengthSeconds
    })).toBe(true)

    await player.locator('video').dispatchEvent('ended')
    await page.waitForTimeout(500)

    await expect(page).toHaveURL(/#\/watch\/[^?]+\?[^#]*\bshort=true\b/)
    await expect(page.locator('.autoplayCountdownOverlay')).toHaveCount(0)
  })

  test('scrolls through the cached subscriptions Shorts feed', async ({ page }) => {
    const shortsTab = page
      .locator('.tabContent[aria-hidden="false"]')
      .locator('[data-subscription-feed-tab="shorts"]')
    await shortsTab.click()
    await page.getByText('First seeded Short', { exact: true }).click()
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })
    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    const previous = page.locator('.shortsNavigationButton').first()
    const next = page.locator('.shortsNavigationButton').last()
    await expect(previous).toBeDisabled()
    await expect(next).toBeEnabled()
    await expect(page.locator('.shortsNextPreview')).toBeVisible()
    await expect(page.locator('.shortsNextPreview')).toHaveAttribute(
      'style',
      /RZ6PG5QATg4\/frame0\.jpg\?selected=1/
    )
    await expect(page.locator('.shortsExternalMetadata')).toBeVisible()
    await expect(page.locator('.shortsActionRail')).toBeVisible()

    const commentsButton = page.locator('.shortsCommentsAction').getByRole('button')
    await commentsButton.click()
    const commentsPanel = page.locator('.shortsCommentsPanel')
    await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)
    const commentsScroller = commentsPanel.locator('.commentsContentWrapper')
    const firstComment = commentsPanel.locator('.comment').first()
    const loadComments = commentsPanel.locator('.getCommentsTitle')
    await expect(firstComment.or(loadComments)).toBeVisible()
    if (await loadComments.isVisible()) {
      await loadComments.click()
    }
    await expect(firstComment).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => commentsScroller.evaluate(element => {
      return element.scrollHeight > element.clientHeight
    })).toBe(true)
    const commentsScrollTop = await commentsScroller.evaluate(element => element.scrollTop)
    await commentsPanel.hover()
    await page.mouse.wheel(0, 120)
    await expect.poll(() => commentsScroller.evaluate(element => element.scrollTop))
      .toBeGreaterThan(commentsScrollTop)
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )
    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )

    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/RZ6PG5QATg4\?short=true&shortSource=subscriptions/
    )
    await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)

    await page.waitForTimeout(500)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )
    await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)
    await commentsPanel.getByRole('button', { name: 'Hide Comments' }).click()

    const auxPanel = page.locator('.shortsAuxPanel')
    const sponsorBlockButton = page.getByRole('button', { name: 'Open SponsorBlock info' })
    await sponsorBlockButton.click()
    await expect(sponsorBlockButton).toHaveAttribute('aria-pressed', 'true')
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    const sponsorBlockContent = auxPanel.locator('.sponsorBlockContent')
    await expect(sponsorBlockContent).toHaveCSS('overscroll-behavior', 'contain')
    await sponsorBlockContent.hover()
    await page.mouse.wheel(0, 2000)
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/RZ6PG5QATg4\?short=true&shortSource=subscriptions/
    )
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    await expect(sponsorBlockButton).toHaveAttribute('aria-pressed', 'true')

    await page.waitForTimeout(500)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    await expect(sponsorBlockButton).toHaveAttribute('aria-pressed', 'true')
    await auxPanel.locator('.sponsorBlockHeader').getByRole('button', { name: 'Close' }).click()

    const transcriptButton = page.locator('.shortsComponentAction')
      .filter({ hasText: 'Transcript' })
      .getByRole('button')
    await transcriptButton.click()
    const transcriptCard = auxPanel.locator('.watchVideoTranscript')
    const transcriptTarget = auxPanel.locator('.shortsAuxPanelTarget')
    await expect(transcriptCard).toBeVisible()
    await expect(transcriptTarget).toHaveCSS('overscroll-behavior', 'contain')
    await expect.poll(async () => {
      const [cardHeight, targetHeight] = await Promise.all([
        transcriptCard.evaluate(element => element.offsetHeight),
        transcriptTarget.evaluate(element => element.clientHeight),
      ])
      return Math.abs(cardHeight - targetHeight)
    }).toBeLessThanOrEqual(32)
    await transcriptTarget.hover()
    await page.mouse.wheel(0, 2000)
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/RZ6PG5QATg4\?short=true&shortSource=subscriptions/
    )
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    await expect(transcriptButton).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => {
      const [cardHeight, targetHeight] = await Promise.all([
        transcriptCard.evaluate(element => element.offsetHeight),
        transcriptTarget.evaluate(element => element.clientHeight),
      ])
      return Math.abs(cardHeight - targetHeight)
    }).toBeLessThanOrEqual(32)

    await page.waitForTimeout(500)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )
    await auxPanel.getByRole('button', { name: 'Close transcript' }).click()

    const [playerBounds, videoAreaBounds, metadataBounds, actionBounds, previewBounds, navigationBounds] =
      await Promise.all([
        player.boundingBox(),
        page.locator('.videoArea').boundingBox(),
        page.locator('.shortsExternalMetadata').boundingBox(),
        page.locator('.shortsActionRail').boundingBox(),
        page.locator('.shortsNextPreview').boundingBox(),
        page.locator('.shortsNavigation').boundingBox(),
      ])
    expect(metadataBounds.x + metadataBounds.width).toBeLessThanOrEqual(playerBounds.x)
    expect(actionBounds.x).toBeGreaterThanOrEqual(playerBounds.x + playerBounds.width)
    expect(previewBounds.y).toBeGreaterThanOrEqual(playerBounds.y + playerBounds.height)
    expect(previewBounds.width).toBeCloseTo(playerBounds.width, 0)
    expect(playerBounds.x + playerBounds.width / 2)
      .toBeCloseTo(videoAreaBounds.x + videoAreaBounds.width / 2, 0)
    expect(navigationBounds.x).toBeGreaterThan(actionBounds.x)

    // Narrow layouts move the rail over the player and grow it upwards, so the
    // navigation joins the same column above the actions instead of landing on
    // top of them.
    await page.setViewportSize({ width: 900, height: 700 })
    await expect(page.locator('.shortsExternalChannel')).toHaveCSS('opacity', '1')
    expect(await page.locator('.shortsExternalChannel').evaluate(element => {
      return getComputedStyle(element).color === getComputedStyle(document.body).color
    })).toBe(true)
    await expect.poll(async () => {
      const [rail, navigation, firstAction] = await Promise.all([
        page.locator('.shortsActionRail').boundingBox(),
        page.locator('.shortsNavigation').boundingBox(),
        page.locator('.shortsAction').first().boundingBox()
      ])

      return {
        navigationAboveActions: navigation.y + navigation.height <= firstAction.y,
        centeredInRail: Math.abs(
          (navigation.x + navigation.width / 2) - (rail.x + rail.width / 2)
        ) <= 1,
        insideRail: navigation.x >= rail.x && navigation.x + navigation.width <= rail.x + rail.width
      }
    }).toEqual({ navigationAboveActions: true, centeredInRail: true, insideRail: true })

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect.poll(async () => {
      const [rail, navigation] = await Promise.all([
        page.locator('.shortsActionRail').boundingBox(),
        page.locator('.shortsNavigation').boundingBox()
      ])

      return navigation.x > rail.x + rail.width
    }).toBe(true)

    await page.evaluate(() => {
      window.__shortsNavigationDisappeared = false
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.shortsNavigation')) {
          window.__shortsNavigationDisappeared = true
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })

    await next.click()
    await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toHaveCount(0)
    await expect(page).toHaveURL(
      /#\/watch\/RZ6PG5QATg4\?short=true&shortSource=subscriptions/
    )
    expect(await page.evaluate(() => window.__shortsNavigationDisappeared)).toBe(false)

    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowUp')
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    // Browser middle-button autoscroll moves the window instead of emitting a
    // wheel event, so window scrolling must navigate Shorts too.
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/RZ6PG5QATg4\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowUp')
    await expect(page).toHaveURL(
      /#\/watch\/w1WKmSqwM8I\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    const scrollbarHandle = page.locator(
      'body > .os-scrollbar-vertical .os-scrollbar-handle'
    )
    const handleBounds = await scrollbarHandle.boundingBox()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2 + 50
    )
    await page.mouse.up()
    await expect(page).toHaveURL(
      /#\/watch\/RZ6PG5QATg4\?short=true&shortSource=subscriptions/
    )
  })
})
