import { openPlaylistMenuItem, sel, setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { measureFullscreenDockToggle } from '../../helpers/fullscreen-docks.mjs'
import { WATCH_PAGE_SEED, setWindowWidth } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test.describe('fullscreen ambient mode', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        uiScale: 95
      }
    }
  })

  test('stays off without bars and centers letterbox glow beside a dock', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateAmbientMode', true)
    })

    await setPlayerFullscreen(page, true)
    const player = page.locator('.ftVideoPlayer')
    const ambient = player.locator('.ambientFullscreenCanvas')
    await expect.poll(() => ambient.evaluate(element => Number(getComputedStyle(element).opacity)))
      .toBe(0)

    await video.evaluate(async (element) => {
      const source = document.createElement('canvas')
      source.width = 190
      source.height = 90
      source.getContext('2d').fillStyle = '#ff0000'
      source.getContext('2d').fillRect(0, 0, source.width, source.height)

      const stream = source.captureStream(10)
      element.srcObject = stream
      await element.play()
      window.__ambientModeTestMedia = { source, stream }
    })
    await expect.poll(() => video.evaluate(element => [element.videoWidth, element.videoHeight]))
      .toEqual([190, 90])

    await expect.poll(() => ambient.evaluate(element => Number(getComputedStyle(element).opacity)))
      .toBeGreaterThan(0)
    await expect.poll(() => ambient.evaluate((element) => {
      const [red, green, blue, alpha] = element.getContext('2d').getImageData(40, 22, 1, 1).data
      return red > 200 && green < 20 && blue < 20 && alpha === 255
    })).toBe(true)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenMetadata(true)
    })
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await expect.poll(async () => {
      const [playerBounds, videoBounds] = await Promise.all([
        player.boundingBox(),
        video.boundingBox()
      ])
      return playerBounds.width - videoBounds.width
    }).toBeGreaterThan(100)
    await expect.poll(async () => {
      const [ambientBounds, videoBounds] = await Promise.all([
        ambient.boundingBox(),
        video.boundingBox()
      ])
      const ambientCenter = ambientBounds.x + ambientBounds.width / 2
      const videoCenter = videoBounds.x + videoBounds.width / 2
      return Math.abs(ambientCenter - videoCenter)
    }).toBeLessThanOrEqual(1)

    await player.evaluate((element) => {
      for (const overlay of element.querySelectorAll('.shaka-controls-container, .playerFullscreenTitleOverlay')) {
        overlay.style.visibility = 'hidden'
      }
    })
    const screenshot = await player.screenshot()
    const letterboxPixel = await page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()

      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return [...context.getImageData(Math.floor(image.width / 2), 20, 1, 1).data]
    }, screenshot.toString('base64'))

    expect(letterboxPixel[0]).toBeGreaterThan(40)
    expect(letterboxPixel[0]).toBeGreaterThan(letterboxPixel[1] * 2)
    expect(letterboxPixel[0]).toBeGreaterThan(letterboxPixel[2] * 2)
  })
})

test('Android fullscreen host keeps watch cards behind the player', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.evaluate(() => {
    document.body.classList.add('capacitorTabs')
    const host = document.querySelector('.videoLayout')
    host.addEventListener('click', event => {
      event.stopImmediatePropagation()
      host.requestFullscreen()
    }, { once: true, capture: true })
  })
  await page.locator('.videoLayout').click({ position: { x: 8, y: 8 } })
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('videoLayout'))).toBe(true)

  await expect.poll(() => page.evaluate(() => {
    const card = document.querySelector('.infoArea .watchVideoInfo')
    const bounds = card.getBoundingClientRect()
    const element = document.elementFromPoint(bounds.left + 100, bounds.top + 100)
    return Boolean(element?.closest('.ftVideoPlayer'))
  })).toBe(true)
})

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

test.describe('watch page', () => {
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
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
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

    const transcript = page.locator('.shortsAuxPanelTarget .watchVideoTranscript')
    await transcript.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.closeTranscript()
      await component.proxy.$nextTick()
    })
    await expect(transcript).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: true,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    const sponsorBlock = page.locator('.shortsAuxPanelTarget .watchVideoSponsorBlock')
    await expect(sponsorBlock).toBeVisible()
    await sponsorBlock.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: false,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    await expect(sponsorBlock).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.dispose()
  })

  test('shares the Shorts information dock with fullscreen and keeps its settings menu visible', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const moreOptions = player.getByRole('button', { name: 'More Options' })
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const auxPanel = page.locator('.shortsAuxPanel')

    // Shorts hide their top controls while playing without pointer activity,
    // so reveal them like a user would instead of racing their fade-out.
    await player.hover()
    await moreOptions.click()
    await expect(overflowMenu.locator(':scope > button').first())
      .toHaveAccessibleName('Video information')
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: /Save channel setting/i }).click()
    const settingsMenu = page.locator('.app > .dropdownLayer > .iconDropdown.portal')
    await expect(settingsMenu).toBeVisible()
    await expect(settingsMenu).not.toHaveCSS('max-inline-size', 'none')
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
    await expect(player).not.toHaveClass(/presentationModeChanging/)

    await expect(player.locator('.shaka-controls-container')).toHaveCSS('transition-property', 'none')

    expect(await player.evaluate(element => {
      return getComputedStyle(
        element.querySelector('.shaka-seek-bar-container')
      ).transitionProperty
    })).toBe('none')

    const initialSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    const closingMotion = await measureFullscreenDockToggle(watchComponent, false)
    expect(closingMotion.animationKeyframes).toHaveLength(2)
    expect(closingMotion.animationKeyframes[0].scale).not.toBe(closingMotion.animationKeyframes[1].scale)
    expect(closingMotion.widths.length).toBeLessThanOrEqual(2)
    expect(closingMotion.controlWidths.length).toBeLessThanOrEqual(2)
    await expect(fullscreenMetadata).toHaveCount(0)
    const fullscreenWidth = (await player.boundingBox()).width
    await expect.poll(async () => {
      return player.locator('.shaka-controls-container').evaluate(element => {
        return element.getBoundingClientRect().width
      })
    }).toBeCloseTo(fullscreenWidth, 0)
    const closedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(closedSeekLeft).toBeGreaterThan(initialSeekLeft)

    const reopeningMotion = await measureFullscreenDockToggle(watchComponent, true)
    await expect(fullscreenMetadata).toBeVisible()
    expect(reopeningMotion.animationKeyframes).toHaveLength(2)
    expect(reopeningMotion.animationKeyframes[0].scale).not.toBe(reopeningMotion.animationKeyframes[1].scale)
    expect(reopeningMotion.widths.length).toBeLessThanOrEqual(2)
    expect(reopeningMotion.controlWidths.length).toBeLessThanOrEqual(2)
    const reopenedControlsWidth = await player.locator('.shaka-controls-container').evaluate(element => {
      return element.getBoundingClientRect().width
    })
    expect(reopenedControlsWidth).toBeLessThan(fullscreenWidth)
    const reopenedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(reopenedSeekLeft).toBeLessThan(closedSeekLeft)

    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(overflowMenu).toBeHidden()

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
    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(player.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    // Cover reopening the menu after playback controls have auto-hidden.
    await page.mouse.move(0, 0)
    await expect(player.locator('.shortsTopControls')).toBeHidden()
    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await setPlayerFullscreen(page, false)
    await expect(overflowMenu).toBeHidden()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)

    await watchComponent.dispose()
  })

  test('toggles information from the Shorts title and matches the comments header', async ({ app, page }) => {
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateBaseTheme', 'light')
    })
    await expect(page.locator('body')).toHaveClass(/light/)
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const titleButton = page.locator('.shortsExternalTitleButton')
    await expect(titleButton).toHaveAttribute('aria-expanded', 'false')
    await titleButton.click()
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await expect(titleButton).toHaveAttribute('aria-expanded', 'true')

    const headerStyles = async (headerSelector, closeSelector) => page.evaluate(
      ({ headerSelector, closeSelector }) => {
        const header = document.querySelector(headerSelector)
        const heading = header?.querySelector('h2, h3')
        const close = document.querySelector(closeSelector)
        const headerStyle = getComputedStyle(header)
        const headingStyle = getComputedStyle(heading)
        const closeStyle = getComputedStyle(close)
        return {
          header: {
            height: headerStyle.height,
            padding: headerStyle.padding,
            backgroundColor: headerStyle.backgroundColor,
            borderBottomColor: headerStyle.borderBottomColor
          },
          heading: {
            margin: headingStyle.margin,
            fontSize: headingStyle.fontSize,
            color: headingStyle.color
          },
          close: {
            width: closeStyle.width,
            height: closeStyle.height,
            color: closeStyle.color,
            backgroundColor: closeStyle.backgroundColor,
            borderRadius: closeStyle.borderRadius,
            fontSize: closeStyle.fontSize
          }
        }
      },
      { headerSelector, closeSelector }
    )

    const informationStyles = await headerStyles(
      '.shortsAuxPanelHeader',
      '.shortsAuxPanelClose'
    )

    await titleButton.click()
    await expect(page.locator('.shortsAuxPanel')).not.toHaveClass(/shortsAuxPanelOpen/)
    await expect(titleButton).toHaveAttribute('aria-expanded', 'false')

    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleShortsComments()
      await component.proxy.$nextTick()
    })
    await expect(page.locator('.shortsCommentsPanel .fullscreenCommentHeader')).toBeVisible()
    const commentText = page.locator('.shortsCommentsPanel .commentText').first()
    await expect(commentText).toBeVisible()
    const commentContrast = await commentText.evaluate(element => {
      const parseRgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const luminance = value => {
        const channels = parseRgb(value).map(channel => {
          const normalized = channel / 255
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      }
      const foreground = luminance(getComputedStyle(element).color)
      const background = luminance(getComputedStyle(element.closest('.shortsCommentsPanel')).backgroundColor)
      return (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
    })
    expect(commentContrast).toBeGreaterThanOrEqual(4.5)
    const commentsStyles = await headerStyles(
      '.shortsCommentsPanel .fullscreenCommentHeader',
      '.shortsCommentsPanel .fullscreenCommentAction:last-of-type'
    )

    expect(informationStyles.header.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(informationStyles.heading.color).toBe(informationStyles.close.color)
    expect(informationStyles).toEqual(commentsStyles)
    await watchComponent.dispose()
  })

  test('keeps the Shorts comment filter menu above creator hearts', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleShortsComments()
      await component.proxy.$nextTick()
    })

    const commentsPanel = page.locator('.shortsCommentsPanel')
    const heart = commentsPanel.locator('.commentHeartBadgeRed').first()
    await expect(heart).toBeVisible({ timeout: 30_000 })
    await commentsPanel.getByRole('button', { name: 'Filter loaded comments' }).click()

    const menu = commentsPanel.getByRole('dialog', { name: 'Comment filters' })
    await expect(menu).toBeVisible()
    await attachScreenshot('Shorts comment filter above creator heart')
    const menuCoversHeart = await menu.evaluate((element, heartElement) => {
      const menuBounds = element.getBoundingClientRect()
      const heartBounds = heartElement.getBoundingClientRect()
      const x = Math.max(menuBounds.left, heartBounds.left) + 1
      const y = Math.max(menuBounds.top, heartBounds.top) + 1
      const overlaps = x < Math.min(menuBounds.right, heartBounds.right) &&
        y < Math.min(menuBounds.bottom, heartBounds.bottom)
      return overlaps && document.elementFromPoint(x, y)?.closest('.commentFilterMenu') === element
    }, await heart.elementHandle())

    expect(menuCoversHeart).toBe(true)
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
    expect(standardCardRadius).toBe('24px')
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

    const closeChapters = panel.getByRole('button', { name: 'Close Chapters' })
    await expect(closeChapters).toBeEnabled()
    // Click and read the leaving state in one renderer task: the leave
    // transition only lasts 250ms, which a loaded machine can exceed between
    // separate Playwright calls, detaching the panel before it is measured.
    const leaving = await closeChapters.evaluate(async (button) => {
      const panelElement = button.closest('.watchVideoChaptersPanel')
      button.click()
      await window.__sidebarRoundnessWatchView.$nextTick()

      const viewport = panelElement.querySelector('.chaptersWrapper')
      const layoutElement = document.querySelector('.videoLayout')
      const infoBounds = document.querySelector('.infoArea').getBoundingClientRect()
      const panelBounds = panelElement.getBoundingClientRect()

      return {
        leaveActive: panelElement.isConnected &&
          panelElement.classList.contains('chapters-panel-leave-active'),
        scrollbar: viewport && {
          initializing: viewport.hasAttribute('data-overlayscrollbars-initialize'),
          nativeScrollbarWidth: getComputedStyle(viewport).scrollbarWidth
        },
        layout: {
          noSidebar: layoutElement.classList.contains('noSidebar'),
          infoRight: infoBounds.right,
          panelLeft: panelBounds.left
        }
      }
    })
    expect(leaving.leaveActive).toBe(true)
    expect(leaving.scrollbar).toEqual({
      initializing: true,
      nativeScrollbarWidth: 'none'
    })

    const leavingLayout = leaving.layout
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

  test('fullscreen metadata separators stay between wrapped items', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.playerFullscreenTitleOverlay').click()

    const metadata = page.locator('.fullscreenMetadataOverlay.open .datePublishedAndViewCount')
    await expect(metadata).toBeVisible()
    await metadata.evaluate(element => { element.style.inlineSize = '160px' })
    const separator = metadata.locator('.videoViews')
    await expect(separator).toBeVisible()
    for (const zoomFactor of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), zoomFactor)
      const geometry = await separator.evaluate(element => {
        const before = getComputedStyle(element, '::before')
        const rect = element.getBoundingClientRect()
        const previous = element.previousElementSibling.getBoundingClientRect()
        return {
          content: before.content,
          left: rect.left,
          wrapped: rect.top > previous.top,
          separatorLeft: rect.left + parseFloat(before.left),
          separatorWidth: parseFloat(before.width)
        }
      })
      expect(geometry.wrapped).toBe(true)
      expect(geometry.content).toBe('""')
      expect(geometry.separatorLeft + geometry.separatorWidth).toBeLessThan(geometry.left)
    }
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
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: Array.from({ length: 20 }, (_, index) => ({
          UUID: `scrollbar-segment-${index}`,
          actionType: 'skip',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [index, index + 0.5],
          videoDuration: 30,
          votes: 1
        }))
      }])
    }))
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
    })
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
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
        enableSubtitlesByDefault: true,
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
      const enableItem = await openPlaylistMenuItem(page, 'Enable Quick Bookmark With This Playlist')
      const enabledItem = page.getByRole('menu').getByRole('menuitem', { name: 'Quick Bookmark Enabled' })
      // Wait for either state before branching, isVisible() does not retry.
      await expect(enableItem.or(enabledItem).first()).toBeVisible()
      if (await enableItem.isVisible()) {
        await enableItem.click()
        await openPlaylistMenuItem(page, 'Quick Bookmark Enabled')
      }
      await expect(enabledItem).toBeVisible()
      await page.keyboard.press('Escape')
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
    await expect(item.locator('.trashIcon')).toHaveCount(0)
    await item.locator('.playlistItemMenu button').click()
    await expect(page.getByRole('menuitem', { name: 'Remove from playlist', exact: true })).toHaveCount(1)
    await expect(item.locator('.quickBookmarkVideoIcon')).toHaveCount(0)
  })

  test('keeps positioned captions centered across playlist videos', async ({ app, page }) => {
    test.setTimeout(120_000)
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'position:63% align:start' })
    // The seeded watch progress, plus any playback before opening the
    // playlist, resumes the first entry near the end of the 30 second demo
    // media. It could then end and advance the playlist while the test acts
    // on its player, so start it from the beginning instead.
    await page.evaluate(() => window.$store.dispatch('removeFromHistory', 'jNQXAC9IVRw'))
    await openFullscreenPlaylistVideo(page)
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer')
    const caption = player.locator('.shaka-text-container [translate="no"]')
    const expectCaptionCentered = async () => {
      await expect(caption).toBeVisible()
      await expect.poll(async () => {
        const [playerBounds, captionBounds] = await Promise.all([
          player.boundingBox(),
          caption.boundingBox(),
        ])
        if (!playerBounds || !captionBounds) return Number.POSITIVE_INFINITY

        return Math.abs(
          (playerBounds.x + playerBounds.width / 2) -
          (captionBounds.x + captionBounds.width / 2)
        )
      }).toBeLessThanOrEqual(1)
    }

    // The source cue must not override the configured anchor in the inline player either.
    await expectCaptionCentered()
    await setPlayerFullscreen(page, true)
    await expectCaptionCentered()

    for (let index = 1; index <= 9; index++) {
      const previousPlayer = await player.elementHandle()
      await player.locator('.skip-next-button').click({ force: true })
      await expect(page).toHaveURL(new RegExp(
        `#\\/watch\\/playlist${String(index).padStart(3, '0')}\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`
      ))
      // The previous video's player and caption stay mounted until the new
      // video replaces them. Checking or skipping before that would act on the
      // old player, so wait for the replacement.
      await expect.poll(() => previousPlayer.evaluate(element => element.isConnected)).toBe(false)
      await previousPlayer.dispose()
      await expectCaptionCentered()
    }
  })

  test('clamps the watch playlist after removing most entries', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)
    await waitForPlayback(page)

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenPlaylistToggle').click()
    await expect(page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')).toBeVisible()

    const playlist = page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')
    const scroller = playlist.locator('.playlistItemsWrapper')
    const items = scroller.locator('.playlistItem')
    await expect(items).toHaveCount(FULLSCREEN_PLAYLIST.videos.length)
    // The dock may still be laying out its items, so keep scrolling until it can.
    await expect.poll(() => scroller.evaluate(element => {
      element.scrollTop = element.scrollHeight
      return element.scrollTop
    })).toBeGreaterThan(0)

    await page.evaluate(async ({ playlistId, playlistItemIds, videoIds }) => {
      const store = window.$store
      await store.dispatch('removeVideos', { _id: playlistId, playlistItemIds, videoIds })
    }, {
      playlistId: FULLSCREEN_PLAYLIST_ID,
      playlistItemIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.playlistItemId),
      videoIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.videoId)
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
    const dropdown = page.locator('.app > .dropdownLayer > .iconDropdown.portal')
    await expect(dropdown).toBeVisible()
    const [buttonBox, dropdownBox] = await Promise.all([
      addToPlaylist.boundingBox(),
      dropdown.boundingBox(),
    ])
    expect(
      dropdownBox.y + dropdownBox.height <= buttonBox.y ||
      dropdownBox.y >= buttonBox.y + buttonBox.height
    ).toBe(true)
    expect(dropdownBox.x).toBeGreaterThanOrEqual(8)
    expect(dropdownBox.x + dropdownBox.width).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth - 8)
    )
    expect(await dropdown.evaluate(element => element.parentElement?.parentElement?.classList.contains('app'))).toBe(true)
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

    await item.locator('.title').click({ button: 'right' })
    const contextMenu = page.locator('.contextMenu')
    await expect(contextMenu).toBeVisible()
    await expect(contextMenu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeVisible()
    const menuBounds = await contextMenu.boundingBox()
    expect(menuBounds.x).toBeGreaterThanOrEqual(8)
    expect(menuBounds.y).toBeGreaterThanOrEqual(8)
    // offsetWidth rounds while rendered bounds can retain fractional CSS pixels.
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth - 7))
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight - 7))
  })
})
