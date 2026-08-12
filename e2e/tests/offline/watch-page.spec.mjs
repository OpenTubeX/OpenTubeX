import { sel, setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { demoPlayerResponse } from '../../helpers/media.mjs'

// These used to live in the network suite, gated on the live API. They all use
// "Me at the zoo", whose page and comment pages are recorded, so they run
// against the mocked watch page and the local demo video instead. See
// e2e/README.md, "Playing a video without YouTube".

// yt-dlp isn't installed in the test environment, so its extraction attempt
// only costs time and leaves a fallback toast over the page. The migration
// marker stops the store from switching the engine back on launch.
const WATCH_PAGE_SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true
}

test.use({ seed: { settings: WATCH_PAGE_SEED } })

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
    playlistItemId: 'playlist-item-0',
    type: 'video'
  }, ...Array.from({ length: 29 }, (_, index) => ({
    videoId: `playlist${String(index + 1).padStart(3, '0')}`,
    title: `Playlist video ${index + 1}`,
    author: 'Playlist channel',
    authorId: 'UC-playlist-channel',
    lengthSeconds: 60,
    playlistItemId: `playlist-item-${index + 1}`,
    type: 'video'
  }))],
  createdAt: Date.now() - 86_400_000,
  lastUpdatedAt: Date.now() - 86_400_000
}

async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    browserWindow.setBounds({ ...browserWindow.getBounds(), width: targetWidth })
  }, width)
}

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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateAvoidTranslation', 'watch_only')
  })
}

test.describe('watch page', () => {
  test('keeps live chat and replay visibility independent and restores a closed chat', async ({ app, page }) => {
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateAvoidTranslation', 'disabled')
    })
    const oembedResponse = page.waitForResponse(/\/oembed\?/)
    releaseOembed()
    await oembedResponse
    await page.waitForTimeout(100)

    await expect(page.locator(`${activeTab} .annotationTitleText`))
      .toHaveText('Translated end-screen title')
  })

  test('shows tags below the description and copies the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const videoDescription = Array(30).fill('Description to copy').join('\n')
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component, description) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = description
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = ['first tag', 'second tag']
      watchView.isLoading = false
      await watchView.$nextTick()
    }, videoDescription)

    const description = page.locator(`${activeTab} .videoDescription`)
    const descriptionText = description.locator('.description')
    const tags = description.locator('.videoTags')
    const expandControl = description.locator(':scope > .descriptionStatus')
    const copyButton = description.locator('.descriptionCopyButton')
    const controlsOverlap = async () => expandControl.evaluate((element, copyButtonElement) => {
      const expandRect = element.getBoundingClientRect()
      const copyRect = copyButtonElement.getBoundingClientRect()
      return (
        expandRect.top < copyRect.bottom &&
        expandRect.bottom > copyRect.top &&
        expandRect.left < copyRect.right &&
        expandRect.right > copyRect.left
      )
    }, await copyButton.elementHandle())

    await description.evaluate(element => { element.style.height = '70px' })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '160px' })
    await expect(expandControl).not.toHaveClass(/avoidCopyButton/)
    await expect(expandControl).toHaveCSS('inset-inline-end', '16px')

    await description.evaluate(element => {
      element.dir = 'rtl'
      element.style.height = '70px'
    })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '' })

    await expandControl.click()
    await expect(tags.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
    await expect(tags.locator('.videoTagLink').first()).toHaveAttribute('href', /\/search\/first%20tag/)
    await expect(description.locator('.descriptionScroll')).toHaveCSS('overflow-anchor', 'none')
    expect(await descriptionText.evaluate((element, tagsElement) => (
      Boolean(element.compareDocumentPosition(tagsElement) & Node.DOCUMENT_POSITION_FOLLOWING)
    ), await tags.elementHandle())).toBe(true)
    expect(await tags.evaluate(element => element.closest('.descriptionScroll') !== null)).toBe(true)
    const descriptionScroll = description.locator('.descriptionScroll')
    expect(await descriptionScroll.evaluate(element => getComputedStyle(element).maskImage))
      .toContain('linear-gradient')
    await expect(descriptionScroll).not.toHaveClass(/descriptionFadeTop/)
    const collapseControl = description.locator('.descriptionScroll > .descriptionStatus')
    await expect(collapseControl).toBeVisible()
    await expect(collapseControl).toHaveCSS('position', 'sticky')
    const collapseControlStyles = await collapseControl.evaluate(element => {
      const style = getComputedStyle(element)
      const fadeStyle = getComputedStyle(element, '::before')
      return {
        fadeBackground: fadeStyle.backgroundImage,
        fadeHeight: Number.parseFloat(fadeStyle.height),
        fontSize: Number.parseFloat(style.fontSize),
        marginBlockStart: Number.parseFloat(style.marginBlockStart)
      }
    })
    expect(collapseControlStyles.fadeBackground).toContain('linear-gradient')
    expect(collapseControlStyles.fadeHeight).toBeGreaterThan(0)
    expect(collapseControlStyles.marginBlockStart).toBeGreaterThan(collapseControlStyles.fontSize)
    const maxScrollTop = await descriptionScroll.evaluate(element =>
      element.scrollHeight - element.clientHeight
    )
    expect(maxScrollTop).toBeGreaterThan(0)
    await descriptionScroll.evaluate((element, maxScrollTop) => {
      element.scrollTop = maxScrollTop / 2
    }, maxScrollTop)
    await expect.poll(() => descriptionScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeTop/)
    await expect.poll(() => descriptionScroll.evaluate(element =>
      element.scrollTop < element.scrollHeight - element.clientHeight
    )).toBe(true)
    await expect.poll(() => collapseControl.evaluate(element => {
      const controlBottom = element.getBoundingClientRect().bottom
      const scrollBottom = element.parentElement.getBoundingClientRect().bottom
      return Math.abs(controlBottom - scrollBottom) <= 1
    })).toBe(true)

    await description.locator('.descriptionCopyButton button').click()
    await expect(page.locator('.toast', { hasText: 'Description copied to clipboard' })).toBeVisible()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(videoDescription)
    await watchComponent.dispose()
  })

  test('handles videos without a description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = ''
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = []
      watchView.videoGames = []
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    await expect(page.locator(`${activeTab} .videoDescription`)).toHaveCount(0)
    expect(pageErrors).toEqual([])
    await watchComponent.dispose()
  })

  test('the sidebar panels use overlay scrollbars', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    // Whether these overflow depends on the video, so assert that the directive
    // took hold rather than measuring widths: the panel stays the scrolling
    // element and gets its own overlay scrollbars.
    for (const selector of ['.descriptionScroll', '.commentsContentWrapper']) {
      await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator(`${selector}[data-overlayscrollbars-viewport]`)).toHaveCount(1)
      await expect(page.locator(`${selector} > .os-scrollbar-vertical`)).toHaveCount(1)
    }
  })

  test('resets the Shorts auxiliary viewport when switching panels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.isShort = true
      watchView.videoDescription = Array(200).fill('Long Shorts metadata').join('\n')
      watchView.videoDescriptionHtml = ''
      watchView.shortsMetadataOpen = true
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    const target = page.locator('.shortsAuxPanelTarget')
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(() => target.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleTranscript()
      await component.proxy.$nextTick()
    })
    await expect(page.locator('.shortsAuxPanelTarget .watchVideoTranscript')).toBeVisible()
    await page.waitForTimeout(250)
    expect(await target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.dispose()
  })

  test('shares the Shorts information dock with fullscreen and keeps its settings menu visible', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      await Promise.all([
        component.proxy.$store.dispatch('updateRememberPlaybackSpeedPerChannel', true),
        component.proxy.$store.dispatch('updateRememberVideoQualityPerChannel', true),
      ])
      await component.proxy.$nextTick()
    })

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const moreOptions = player.getByRole('button', { name: 'More Options' })
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const auxPanel = page.locator('.shortsAuxPanel')

    await moreOptions.click()
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: /Save channel setting/i }).click()
    const settingsMenu = page.locator('.app > .iconDropdown.portal')
    await expect(settingsMenu).toBeVisible()
    expect(await settingsMenu.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      return element.contains(hit)
    })).toBe(true)
    await page.keyboard.press('Escape')

    await setPlayerFullscreen(page, true)
    const fullscreenMetadata = player.locator('.fullscreenMetadataOverlay.open')
    await expect(fullscreenMetadata).toBeVisible()

    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    const fullscreenTranscript = player.locator('.fullscreenTranscriptOverlay.open')
    await expect(fullscreenTranscript).toBeVisible()
    await fullscreenMetadata.locator('.fullscreenMetadataHeader').dblclick({
      position: { x: 30, y: 26 }
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeLessThan(100)
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(false)
    })
    await expect(fullscreenTranscript).toHaveCount(0)
    await fullscreenMetadata.getByRole('button', { name: 'Close video information' }).click()
    await player.locator('.shortsFullscreenTitleButton').click()
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeGreaterThan(150)

    await setPlayerFullscreen(page, false)
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: 'Close video information' }).click()
    await expect(auxPanel).not.toHaveClass(/shortsAuxPanelOpen/)

    await setPlayerFullscreen(page, true)
    await moreOptions.click({ force: true })
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(player.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await setPlayerFullscreen(page, false)
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await watchComponent.dispose()
  })

  test('sidebar chapters and SponsorBlock honor roundness while closing beside the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

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

  test('fullscreen metadata uses one full-dock scrollbar', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
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

  test('fullscreen comments scrollbar reaches the dock bottom', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
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

  test('fullscreen SponsorBlock uses one content scrollbar', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)
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

  test('displays and submits full-video SponsorBlock labels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
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

    await openMockedVideo(page)

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
})

test.describe('fullscreen captions', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        defaultCaptionSettings: JSON.stringify({ fontScale: 1.5 })
      }
    }
  })

  test('keeps the configured caption size in fullscreen', async ({ app }) => {
    const { page } = app
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

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

    // The player is only a few hundred pixels tall here, so the captions scale down with it.
    await setWindowWidth(app, 400)
    await expect.poll(async () => captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })).not.toEqual(windowedFontSizes)

    const narrowFontSizes = await captionContainers.evaluateAll(elements => {
      return elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize))
    })
    for (const fontSize of narrowFontSizes) {
      expect(fontSize).toBeGreaterThan(30 * 0.45)
      expect(fontSize).toBeLessThan(30 * 0.75)
    }

    // Fullscreen makes the player tall again, so the configured size comes back.
    await setPlayerFullscreen(page, true)
    await expect.poll(async () => captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })).toEqual(windowedFontSizes)
  })
})

test.describe('fullscreen playlist dock', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
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

  async function openFullscreenPlaylistVideo(page, { enableQuickBookmark = false } = {}) {
    await page.locator(sel.sideNavLink('userplaylists')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/userplaylists/)
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.playlistName }).first().click()
    await expect(page).toHaveURL(new RegExp(`#\\/playlist\\/${FULLSCREEN_PLAYLIST_ID}`))
    if (enableQuickBookmark) {
      const enableButton = page.getByTitle('Enable Quick Bookmark With This Playlist')
      const enabledIndicator = page.getByTitle('Quick Bookmark Enabled')
      // Wait for either state before branching, isVisible() does not retry.
      await expect(enableButton.or(enabledIndicator).first()).toBeVisible()
      if (await enableButton.isVisible()) {
        await enableButton.click()
      }
      await expect(enabledIndicator).toBeVisible()
    }
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.videos[0].title }).first().click()
    await expect(page).toHaveURL(
      new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`)
    )
  }

  test('does not duplicate the remove action for the Quick Bookmark playlist', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page, { enableQuickBookmark: true })

    const item = page.locator('.watchVideoPlaylist .playlistItem').first()
    await item.locator('.videoThumbnail').hover()
    await expect(item.locator('.trashIcon')).toHaveCount(1)
    await expect(item.locator('.quickBookmarkVideoIcon')).toHaveCount(0)
  })

  test('clamps the watch playlist after removing most entries', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenPlaylistToggle').click()
    await expect(page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')).toBeVisible()

    const playlist = page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')
    const scroller = playlist.locator('.playlistItemsWrapper')
    const items = scroller.locator('.playlistItem')
    await expect(items).toHaveCount(FULLSCREEN_PLAYLIST.videos.length)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.evaluate(async ({ playlistId, playlistItemIds }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('removeVideos', { _id: playlistId, playlistItemIds })
    }, {
      playlistId: FULLSCREEN_PLAYLIST_ID,
      playlistItemIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.playlistItemId)
    })
    await expect(items).toHaveCount(4)
    await page.waitForTimeout(250)
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(0)
  })

  test('keeps compact watched labels and playlist menus clear of other controls', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
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
})

test.describe('manual comment loading', () => {
  // These drive the click-to-load path and the reply pagination on top of a
  // single loaded page, so they turn off the automatic pagination that would
  // otherwise load (and keep loading) the comments on its own.
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        generalAutoLoadMorePaginatedItemsEnabled: false
      }
    }
  })

  test('stale reply controls disappear after an empty final reply page', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const comments = page.locator('.comment')
    const commentIndex = await comments.evaluateAll(elements => (
      elements.findIndex(element => element.querySelector('.commentMoreReplies'))
    ))
    expect(commentIndex).toBeGreaterThanOrEqual(0)
    const comment = comments.nth(commentIndex)
    const replyToggle = comment.locator('.commentMoreReplies')
    await expect(replyToggle).toBeVisible()

    await page.route(/\/youtubei\/v1\/next/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onResponseReceivedEndpoints: [{
          appendContinuationItemsAction: {
            targetId: 'comment-replies-item-stale'
          }
        }]
      })
    }), { times: 1 })

    await replyToggle.click()

    await expect(comment.locator('.commentMoreRepliesSpinner')).toHaveCount(0)
    await expect(comment.locator('.commentMoreReplies')).toHaveCount(0)
    await expect(comment.locator('.commentReplyBranch')).toHaveCount(0)
  })

  test('reloading fullscreen comments scrolls back to the first comment', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await waitForPlayback(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollHeight)).toBeGreaterThan(500)

    // The end of the loaded comments: the offset the reloaded, shorter list has
    // no room for, so it used to leave the dock parked past its own content.
    await comments.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)

    const [reloadResponse] = await Promise.all([
      page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 }),
      page.locator('.fullscreenCommentHeader').getByRole('button', { name: 'Reload Comments' }).click()
    ])
    expect(reloadResponse.ok()).toBe(true)
    await expect(page.locator('.fullscreenCommentsOverlay .comment').first()).toBeVisible({ timeout: 30_000 })

    // OverlayScrollbars reapplies its remembered offset once the new list has
    // rendered, so the position has to still be at the top a moment later.
    await page.waitForTimeout(1000)
    expect(await comments.evaluate((element) => element.scrollTop)).toBe(0)
  })
})
