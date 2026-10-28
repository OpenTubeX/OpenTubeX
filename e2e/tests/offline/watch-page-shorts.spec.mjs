import { sel, setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

async function waitForShortsNavigationReady(page) {
  await expect.poll(async () => {
    const view = await watchViewHandle(page)
    try {
      return await view.evaluate(view => (
        Date.now() >= view.shortsNavigation.lockedUntil &&
        !view.shortsNavigation.state.settling &&
        !view.shortsNavigation.scrollResetPending &&
        window.scrollY === 0
      ))
    } finally {
      await view.dispose()
    }
  }).toBe(true)
}

test.describe('Shorts transcript navigation', () => {
  const SHORTS_CHANNEL_ID = 'UC-transcript-shorts'
  const CAPTIONED_SHORT_IDS = ['captioned-short-1', 'captioned-short-2']
  const CAPTIONLESS_SHORT_ID = 'captionless-short'
  const shorts = [...CAPTIONED_SHORT_IDS, CAPTIONLESS_SHORT_ID].map((videoId, index) => ({
    type: 'video',
    videoId,
    title: `Transcript Short ${index + 1}`,
    author: 'Transcript Shorts',
    authorId: SHORTS_CHANNEL_ID,
    published: CAPTIONED_SHORT_IDS.length + 1 - index,
    isShort: true,
    lengthSeconds: '',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/frame0.jpg?selected=1`
  }))

  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        useCustomShortsPlayer: true,
        useQuickPlaybackSpeedBar: true,
        fetchSubscriptionsAutomatically: false
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: SHORTS_CHANNEL_ID,
          name: 'Transcript Shorts',
          thumbnail: ''
        }]
      }],
      subscriptionCache: [{
        _id: SHORTS_CHANNEL_ID,
        shorts,
        shortsTimestamp: new Date().toISOString()
      }]
    }
  })

  test('pausing and seeking near the end does not complete a Short', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    const video = await waitForPlayback(page)
    await video.evaluate(async element => {
      element.pause()
      element.currentTime = element.duration - 0.25
      await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
    })
    const view = await watchViewHandle(page)
    await expect.poll(() => view.evaluate(view => ({
      complete: view.shortsPlaybackCompleted,
      progress: view.historyEntry?.watchProgress,
      full: view.historyEntry?.watchProgress === view.historyEntry?.lengthSeconds
    }))).toEqual({ complete: false, progress: expect.any(Number), full: false })
    await video.evaluate(async element => {
      element.currentTime = element.duration - 2
      await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      await element.play()
    })
    await expect.poll(() => view.evaluate(view => view.shortsPlaybackCompleted)).toBe(true)
    await view.dispose()
  })

  test('Escape dismisses the Shorts context menu before exiting full window', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await page.keyboard.press('s')
    await expect(player).toHaveClass(/fullWindow/)
    await player.click({ button: 'right', position: { x: 100, y: 100 } })
    const menu = player.locator('.shaka-context-menu')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(player).toHaveClass(/fullWindow/)
    const volume = player.locator('.shortsVolumeControl')
    await volume.hover()
    await expect(volume.locator('.shortsVolumeSlider')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(player).not.toHaveClass(/fullWindow/)
  })

  test('offers subscription notifications and settings for Shorts channels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    const channelRow = page.locator('.shortsChannelRow')
    // The mocked Short belongs to the fixture video's channel, not the seeded one.
    await expect(channelRow.locator('.subscribeButton')).toHaveText(/^Subscribe\b/)
    await channelRow.locator('.subscribeButton').click()
    await expect(channelRow.locator('.notificationBell')).toBeVisible()
    await channelRow.locator('.profileDropdownToggle').click()
    const dropdown = page.locator('.profileDropdown')
    await expect(dropdown.getByRole('checkbox')).toHaveCount(4)
    await dropdown.press('Escape')
    await expect(dropdown).toBeHidden()

    await setPlayerFullscreen(page, true)
    const fullscreenRow = page.locator(':fullscreen .shortsFullscreenChannelRow')
    await expect(fullscreenRow.locator('.notificationBell')).toBeVisible()
    await fullscreenRow.locator('.profileDropdownToggle').click()
    const fullscreenDropdown = page.locator(':fullscreen .profileDropdown')
    await expect(fullscreenDropdown).toBeVisible()
    const shortsFeedType = fullscreenDropdown.getByRole('checkbox', { name: 'Shorts', exact: true })
    await expect(shortsFeedType).toHaveAttribute('aria-checked', 'true')
    await shortsFeedType.click()
    await expect(shortsFeedType).toHaveAttribute('aria-checked', 'false')
    await expect(fullscreenDropdown).toBeVisible()
    expect(await video.evaluate(element => element.paused)).toBe(true)

    // Leaving fullscreen must not strand the dropdown inside the player.
    await page.evaluate(() => document.exitFullscreen())
    await expect(page.locator('.profileDropdown')).toBeHidden()

    // Leaving full window hides the overlay button, so its dropdown must close too.
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await page.keyboard.press('s')
    await expect(player).toHaveClass(/fullWindow/)
    await player.locator('.shortsFullscreenChannelRow .profileDropdownToggle').click()
    await expect(page.locator('.profileDropdown')).toBeVisible()
    await page.keyboard.press('s')
    await expect(player).not.toHaveClass(/fullWindow/)
    await expect(page.locator('.profileDropdown')).toBeHidden()
  })

  test('Shorts information panels contain wheel input with and without overflow', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await page.getByText('Transcript Short 1', { exact: true }).click()
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    const view = await watchViewHandle(page)
    await view.evaluate(async view => {
      view.videoDescription = 'Short description'
      view.videoDescriptionHtml = ''
      view.toggleShortsMetadata()
      await view.$nextTick()
    })
    const panel = page.locator('.shortsAuxPanel')
    const scroller = panel.locator('.shortsAuxPanelTarget')
    await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
    const originalUrl = page.url()
    const bounds = await scroller.boundingBox()
    await page.mouse.move(bounds.x + 20, bounds.y + 20)
    await page.mouse.wheel(0, 2000)
    // Give a leaked wheel time to navigate to another Short.
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(originalUrl)
    await view.evaluate(async view => {
      view.toggleShortsMetadata()
      await view.$nextTick()
      view.videoDescription = Array(200).fill('Long description').join('\n')
      view.toggleShortsMetadata()
    })
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100)
    const longBounds = await scroller.boundingBox()
    await page.mouse.move(longBounds.x + 20, longBounds.y + 20)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.mouse.wheel(0, 2000)
    // Give a leaked wheel time to navigate to another Short.
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(originalUrl)
    await view.dispose()
  })

  test('keeps the current Short from expanding when YouTube-style Shorts are disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 95)
    })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer')
    await expect(player).toHaveClass(/shortsPlayer/)
    const shortsBounds = await player.boundingBox()
    expect(shortsBounds).not.toBeNull()

    // Avoid Playwright scrolling the Shorts feed to bring menu controls into view.
    await page.locator('.profileTrigger').evaluate(button => button.click())
    await expect(page.locator('.quickSettingsMenu')).toBeVisible()
    await page.locator('.allSettingsShortcut').evaluate(button => button.click())
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(CAPTIONED_SHORT_IDS[0]))
    await page.locator('.settingsMenu [data-section="playback"]').click()
    const toggle = page.getByRole('checkbox', { name: 'Use YouTube-style Shorts' })
    await expect(toggle).toBeChecked()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Use YouTube-style Shorts' })
      .click()
    await expect(toggle).not.toBeChecked()
    // The checkbox changes before the queued setting write commits. The next
    // video snapshots the store preference, so wait for that value too.
    await expect.poll(() => page.evaluate(() => window.$store.getters.getUseCustomShortsPlayer)).toBe(false)
    await expect(page).toHaveURL(new RegExp(CAPTIONED_SHORT_IDS[0]))
    await expect(player).toHaveClass(/shortsPlayer/)

    const bounds = await player.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds.width).toBeLessThanOrEqual(shortsBounds.width + 1)

    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(CAPTIONED_SHORT_IDS[0]))
    await page.locator('.shortsNavigationButton').last().evaluate(element => element.click())
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)
    await expect(player).not.toHaveClass(/shortsPlayer/)
  })

  test('shows quick playback speeds near the pointer without covering the seek preview', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    const video = await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const controlPanel = player.locator('.shaka-controls-button-panel')
    const playbackRateBar = controlPanel.locator('.ft-quick-playback-rate-bar')
    const seekBar = player.locator('.shaka-seek-bar-container')
    const opacity = () => controlPanel.evaluate(element => Number(getComputedStyle(element).opacity))

    await expect(playbackRateBar).toHaveCount(1)
    // Nine speeds plus the action that saves the current speed for the channel
    await expect(playbackRateBar.getByRole('button')).toHaveCount(10)
    await expect(playbackRateBar.locator('.ft-quick-playback-rate-save')).toBeVisible()

    const playerBounds = await player.boundingBox()
    expect(playerBounds).not.toBeNull()

    await player.dispatchEvent('mousemove', {
      clientX: playerBounds.x + playerBounds.width / 2,
      clientY: playerBounds.y + 80
    })
    await expect.poll(opacity).toBe(0)

    let rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await player.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y - 24
    })
    await expect.poll(opacity).toBeGreaterThan(0.2)
    expect(await opacity()).toBeLessThan(0.5)

    rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await player.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y - 6
    })
    await expect.poll(opacity).toBeGreaterThan(0.75)

    rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await playbackRateBar.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y + rateBarBounds.height / 2
    })
    await expect.poll(opacity).toBe(1)
    await attachScreenshot('Shorts quick playback speed bar')

    const playbackRateButton = playbackRateBar.getByRole('button', { name: '1.25x', exact: true })
    await playbackRateButton.click()
    await expect(playbackRateButton).toBeFocused()
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.25)

    await seekBar.hover()
    await expect.poll(opacity).toBe(0)
    await expect(playbackRateButton).not.toBeFocused()
    expect(await seekBar.evaluate(element => getComputedStyle(element).zIndex)).toBe('3')
    expect(await controlPanel.evaluate(element => getComputedStyle(element).zIndex)).toBe('2')
  })

  test('preserves the panel until navigation reaches a captionless Short', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, {
      captionCueSettings: 'align:center',
      captionVideoIds: CAPTIONED_SHORT_IDS
    })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const transcriptButton = page.locator('.shortsComponentAction')
      .filter({ hasText: 'Transcript' })
      .getByRole('button')
    const transcriptPanel = page.locator('.shortsAuxPanelTarget .watchVideoTranscript')
    const next = page.locator('.shortsNavigationButton').last()

    await expect(player).toBeVisible()
    await transcriptButton.click()
    await expect(transcriptPanel).toBeVisible()

    await next.click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await expect(transcriptPanel).toBeVisible()
    await expect(transcriptButton).toHaveAttribute('aria-pressed', 'true')

    await waitForShortsNavigationReady(page)
    await next.click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONLESS_SHORT_ID}\\?short=true`))
    await expect(transcriptPanel).toHaveCount(0)
    await expect(transcriptButton).toHaveCount(0)
  })

  test('docks, scrolls, and clamps video information across Shorts navigation', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setWindowSize(app, page, { width: 1325, height: 760 })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const lines = Array.from({ length: 80 }, (_, index) => `Description line ${index + 1}`)
      view.videoDescription = lines.join('\n')
      view.videoDescriptionHtml = lines.join('<br>')
      view.toggleShortsMetadata()
      await view.$nextTick()
    })

    const panel = page.locator('.shortsAuxPanel')
    const scroller = panel.locator('.shortsAuxPanelTarget')
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(async () => {
      const [panelBounds, playerBounds] = await Promise.all([
        panel.boundingBox(),
        player.boundingBox()
      ])
      const bottomDelta = Math.abs(
        panelBounds.y + panelBounds.height - playerBounds.y - playerBounds.height
      )
      const topDelta = Math.abs(panelBounds.y - playerBounds.y)
      return Math.max(bottomDelta, topDelta)
    }).toBeLessThanOrEqual(1)
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(panel.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect.poll(() => scroller.evaluate(element => {
      return element.scrollHeight - element.clientHeight
    })).toBeGreaterThan(100)

    const initialScrollTop = await scroller.evaluate(element => element.scrollTop)
    const pointer = await scroller.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return {
        x: bounds.left + bounds.width / 2,
        y: Math.min(bounds.bottom - 1, window.innerHeight - 1)
      }
    })
    await page.mouse.move(pointer.x, pointer.y)
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    expect(await scroller.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return element.contains(hit)
    }, pointer)).toBe(true)
    await page.mouse.wheel(0, 500)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop))
      .toBeGreaterThan(initialScrollTop)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => {
      const viewportBounds = element.getBoundingClientRect()
      const descriptionBounds = element.querySelector('.description').getBoundingClientRect()
      return {
        atScrollEnd: element.scrollHeight - element.clientHeight - element.scrollTop <= 1,
        renderedEndVisible: descriptionBounds.bottom <= viewportBounds.bottom + 1
      }
    })).toEqual({ atScrollEnd: true, renderedEndVisible: true })

    await setWindowSize(app, page, { width: 1326, height: 1012 })
    await expect.poll(() => scroller.evaluate(element => {
      const contentEnd = element.querySelector('.shortsAuxPanelContentEnd')
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const viewportBounds = element.getBoundingClientRect()
      const contentEndBounds = contentEnd.getBoundingClientRect()
      const maximumScrollTop = Math.max(0, contentEnd.offsetTop - element.clientHeight)
      const hasVerticalOverflow = maximumScrollTop > 1
      return {
        atRenderedEnd: maximumScrollTop === 0
          ? element.scrollTop <= 1
          : Math.abs(contentEndBounds.bottom - viewportBounds.bottom) <= 1,
        scrollbarMatchesOverflow:
          scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
        withinRenderedRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toEqual({
      atRenderedEnd: true,
      scrollbarMatchesOverflow: true,
      withinRenderedRange: true
    })
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(100)
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))

    await page.locator('.shortsNavigationButton').last().click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)
    await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.querySelector('.videoDescription')
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const viewportBounds = element.getBoundingClientRect()
      const contentBounds = content?.getBoundingClientRect()
      const maximumScrollTop = Math.max(
        0,
        (content?.offsetTop ?? 0) + (content?.offsetHeight ?? 0) - element.clientHeight
      )
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1
      return {
        atRenderedEnd: contentBounds != null &&
          (maximumScrollTop === 0
            ? element.scrollTop <= 1
            : Math.abs(contentBounds.bottom - viewportBounds.bottom) <= 1),
        horizontalOverflowHidden: getComputedStyle(element).overflowX === 'hidden' &&
          element.scrollWidth <= element.clientWidth + 1,
        scrollbarMatchesOverflow:
          scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
        withinRenderedRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toEqual({
      atRenderedEnd: true,
      horizontalOverflowHidden: true,
      scrollbarMatchesOverflow: true,
      withinRenderedRange: true
    })
  })

  test('keeps loading Shorts when another player keeps the shared caption factory alive', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })

    const backgroundTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/watch/background-captioned-video',
      title: 'Background captioned video',
      makeActive: false,
      preloadInBackground: true
    }))
    const backgroundContent = page.locator(`.tabContent[data-tab-id="${backgroundTab.id}"]`)
    const backgroundPlayer = backgroundContent.locator('.ftVideoPlayer')
    await expect(backgroundPlayer).toHaveCount(1, { timeout: 30_000 })
    await expect.poll(() => backgroundPlayer.evaluate(element => {
      return element.ui?.getControls().getPlayer().getAssetUri() ?? ''
    })).not.toBe('')

    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const rendererErrors = []
    page.on('pageerror', error => rendererErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })

    await page.locator('.shortsNavigationButton').last().click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)

    expect(rendererErrors.filter(error => (
      error.includes('getTextTracks') || error.includes('failed to render')
    ))).toEqual([])
  })

  test('keeps the Shorts player, action rail, and comments inside a Capacitor phone viewport', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await waitForPlayback(page)
    await setWindowSize(app, page, { width: 461, height: 1026 })
    await page.locator('.app').evaluate((element) => {
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
      element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
      document.querySelector('.tabBar')?.style.setProperty('display', 'none')
    })

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const rail = page.locator('.shortsActionRail')
    await expect(player).toBeVisible()
    await expect(rail).toBeVisible()
    await page.locator('.shortsCommentsAction .iconButton').click()
    await expect(page.getByRole('dialog', { name: 'Comments' })).toBeVisible()

    const geometry = await page.evaluate(() => {
      const playerBounds = document.querySelector('.ftVideoPlayer.shortsPlayer').getBoundingClientRect()
      const railBounds = document.querySelector('.shortsActionRail').getBoundingClientRect()
      const commentsBounds = document.querySelector('.mobileSheet[open]').getBoundingClientRect()
      const actionLabels = [...document.querySelectorAll('.shortsAction > span')]
      return {
        commentsLeft: commentsBounds.left,
        commentsRight: commentsBounds.right,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        labelsHidden: actionLabels.every(label => getComputedStyle(label).display === 'none'),
        railBottom: railBounds.bottom,
        railLeft: railBounds.left,
        railRight: railBounds.right,
        playerBottom: playerBounds.bottom,
        playerLeft: playerBounds.left,
        playerRight: playerBounds.right,
        viewportWidth: window.innerWidth,
      }
    })

    expect(geometry.labelsHidden).toBe(true)
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1)
    expect(geometry.playerLeft).toBeGreaterThanOrEqual(0)
    // Fractional UI scales can place edges a subpixel past the viewport.
    expect(geometry.playerRight).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.commentsLeft).toBeGreaterThanOrEqual(0)
    expect(geometry.commentsRight).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.railLeft).toBeGreaterThanOrEqual(geometry.playerLeft - 1)
    expect(geometry.railRight).toBeLessThanOrEqual(geometry.playerRight + 1)
    expect(geometry.railRight).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.railBottom).toBeLessThanOrEqual(geometry.playerBottom + 1)
  })
})

test.describe('Shorts feed navigation', () => {
  const SHORTS_CHANNEL = 'UC-transcript-shorts'
  const FIRST_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/jNQXAC9IVRw/frame0.jpg?selected=1'
  const SECOND_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/captioned-short-2/frame0.jpg?selected=1'

  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
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
            videoId: 'jNQXAC9IVRw',
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
            videoId: 'captioned-short-2',
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

  async function openFirstFeedShort(app, page) {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw', 'captioned-short-2'] })
    await page.route('**/api/skipSegments**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    const shortsTab = page
      .locator('.tabContent[aria-hidden="false"]')
      .locator('[data-subscription-feed-tab="shorts"]')
    await shortsTab.click()
    await page.getByText('First seeded Short', { exact: true }).click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await expect(player).toBeVisible({ timeout: 30_000 })
    return {
      player,
      previous: page.locator('.shortsNavigationButton').first(),
      next: page.locator('.shortsNavigationButton').last()
    }
  }

  // The panel and the layout and input checks each take a whole tour through
  // the feed, so they run separately to stay within the timeout on a busy host.
  test('keeps Shorts panels open while scrolling through the cached subscriptions feed', async ({ app, page }) => {
    const { previous, next } = await openFirstFeedShort(app, page)
    await expect(previous).toBeDisabled()
    await expect(next).toBeEnabled()
    await expect(page.locator('.shortsNextPreview')).toBeVisible()
    await expect(page.locator('.shortsNextPreview')).toHaveAttribute(
      'style',
      /captioned-short-2\/frame0\.jpg\?selected=1/
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
    const commentsBounds = await commentsScroller.boundingBox()
    await page.mouse.move(commentsBounds.x + commentsBounds.width / 2, commentsBounds.y + commentsBounds.height / 2)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => commentsScroller.evaluate(element => element.scrollTop))
      .toBeGreaterThan(commentsScrollTop)
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )
    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)

    await waitForShortsNavigationReady(page)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
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
    const sponsorBlockBounds = await sponsorBlockContent.boundingBox()
    await page.mouse.move(sponsorBlockBounds.x + 20, sponsorBlockBounds.y + 20)
    await page.mouse.wheel(0, 2000)
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await waitForShortsNavigationReady(page)
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    await expect(sponsorBlockButton).toHaveAttribute('aria-pressed', 'true')

    await waitForShortsNavigationReady(page)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
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
    const transcriptBounds = await transcriptTarget.boundingBox()
    await page.mouse.move(transcriptBounds.x + 20, transcriptBounds.y + 20)
    await page.mouse.wheel(0, 2000)
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await waitForShortsNavigationReady(page)
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
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

    await waitForShortsNavigationReady(page)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )
    await auxPanel.getByRole('button', { name: 'Close transcript' }).click()
  })

  test('scrolls through the cached subscriptions Shorts feed', async ({ app, page }) => {
    const { player, next } = await openFirstFeedShort(app, page)
    await expect(page.locator('.shortsNextPreview')).toBeVisible()
    await expect(page.locator('.shortsExternalMetadata')).toBeVisible()
    await expect(page.locator('.shortsActionRail')).toBeVisible()

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
        page.locator('.shortsActionRail .shortsAction:visible').first().boundingBox()
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
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    expect(await page.evaluate(() => window.__shortsNavigationDisappeared)).toBe(false)

    await waitForShortsNavigationReady(page)
    await page.keyboard.press('ArrowUp')
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await waitForShortsNavigationReady(page)
    // Browser middle-button autoscroll moves the window instead of emitting a
    // wheel event, so window scrolling must navigate Shorts too.
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )

    await waitForShortsNavigationReady(page)
    await page.keyboard.press('ArrowUp')
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await waitForShortsNavigationReady(page)
    const scrollbarHandle = page.locator(
      'body > .os-scrollbar-vertical .os-scrollbar-handle'
    )
    const handleBounds = await scrollbarHandle.boundingBox()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2
    )
    // The idle scrollbar only becomes hit-testable after the move reveals it.
    await scrollbarHandle.hover()
    await page.mouse.down()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2 + 50
    )
    await page.mouse.up()
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
  })

  test('does not show a stale loading indicator after leaving a loaded Shorts tab', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    const shortTab = page.locator(sel.tabs).first()
    await shortTab.click()

    const shortsFeedTab = page
      .locator('.tabContent[aria-hidden="false"]')
      .locator('[data-subscription-feed-tab="shorts"]')
    await shortsFeedTab.click()
    await page.getByText('First seeded Short', { exact: true }).click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await expect(player).toBeVisible({ timeout: 30_000 })

    await expect(shortTab).not.toHaveClass(/loading/)
    await shortTab.evaluate((tab) => {
      window.__shortTabShowedLoadingWhileScrolling = false
      new MutationObserver(() => {
        if (tab.classList.contains('loading')) {
          window.__shortTabShowedLoadingWhileScrolling = true
        }
      }).observe(tab, { attributes: true, attributeFilter: ['class'] })
    })
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect.poll(() => page.evaluate(
      () => window.__shortTabShowedLoadingWhileScrolling
    )).toBe(true)
    await expect(
      page.locator('.tabContent[aria-hidden="false"] [data-tab-loading-indicator]')
    ).toHaveCount(0)
    await expect(player).toBeVisible({ timeout: 30_000 })
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())

    await expect(shortTab).not.toHaveClass(/loading/)
    await shortTab.evaluate((tab) => {
      window.__shortTabShowedLoadingAfterDeactivation = false
      window.__shortTabLoadingTransitions = []
      new MutationObserver(() => {
        window.__shortTabLoadingTransitions.push({
          loading: tab.classList.contains('loading'),
          markers: [...document.querySelectorAll(
            `[data-tab-id="${tab.dataset.tabId}"] [data-tab-loading-indicator]`
          )].map(element => element.className),
        })
        if (tab.classList.contains('loading')) {
          window.__shortTabShowedLoadingAfterDeactivation = true
        }
      }).observe(tab, { attributes: true, attributeFilter: ['class'] })
    })

    await app.electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const findMenuItem = (items, label) => {
        for (const item of items) {
          if (item.label === label) return item
          const match = findMenuItem(item.submenu?.items ?? [], label)
          if (match) return match
        }
        return null
      }
      const menuItem = findMenuItem(Menu.getApplicationMenu()?.items ?? [], 'Next Tab')
      const browserWindow = BrowserWindow.getFocusedWindow()
      if (!menuItem || !browserWindow) {
        throw new Error('Next Tab application-menu item was not found')
      }
      menuItem.click(undefined, browserWindow, undefined)
    })
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    // Give a stale loading state time to appear on the inactive tab.
    await page.waitForTimeout(5000)
    const loadingResult = await page.evaluate(() => ({
      showed: window.__shortTabShowedLoadingAfterDeactivation,
      transitions: window.__shortTabLoadingTransitions,
    }))
    expect(loadingResult.showed, JSON.stringify(loadingResult.transitions)).toBe(false)
    await expect(shortTab).not.toHaveClass(/loading/)

    await shortTab.click()
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect(shortTab).not.toHaveClass(/loading/)
    await expect(player).toBeVisible()
    await expect(
      page.locator('.tabContent[aria-hidden="false"] [data-tab-loading-indicator]')
    ).toHaveCount(0)
  })
})
