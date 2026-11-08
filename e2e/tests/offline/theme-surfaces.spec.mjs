import { test, expect, goTo, openInterfaceCustomizer, setPlayerFullscreen } from '../../helpers/app.mjs'
import { sampleColors } from '../../helpers/colors.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

function maxColorDifference(actual, reference) {
  return Math.max(...actual.flatMap((color, point) =>
    color.map((value, channel) => Math.abs(value - reference[point][channel]))))
}

async function expectContinuousBackground(app, region, points) {
  const colors = await sampleColors(app, region, points)
  const difference = Math.max(...colors.slice(1).flatMap(color =>
    color.map((value, index) => Math.abs(value - colors[0][index]))))
  expect.soft(difference, `background pixels: ${JSON.stringify(colors)}`).toBeLessThanOrEqual(2)
}

async function expectDescriptionBackground(app, region, points) {
  await app.page.mouse.move(0, 0)
  // Compare identical viewport positions so the theme's natural color change
  // across the fade isn't mistaken for a seam. Retry while scrolling or a
  // transient player overlay still affects the captured framebuffer.
  await expect.poll(async () => {
    const actual = await sampleColors(app, region, points)
    const style = await app.page.addStyleTag({
      content: `
        .videoDescription .descriptionStatus { visibility: hidden !important; }
      `
    })
    try {
      const reference = await sampleColors(app, region, points)
      return maxColorDifference(actual, reference)
    } finally {
      await style.evaluate(element => element.remove())
    }
  }, { message: 'Description footer must match the card at the same pixels' }).toBeLessThanOrEqual(2)
}

async function attachThemeScreenshot(app, testInfo, name) {
  await app.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const base64 = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  await testInfo.attach(name, { body: Buffer.from(base64, 'base64'), contentType: 'image/png' })
}

async function expectPanelOwnsBackground(app, card, points) {
  // Docks slide in on the compositor, which keeps drawing the slide until a
  // finished frame is rasterized. Let it end on its own so the capture cannot
  // show the dock mid-slide.
  await expect.poll(() => card.evaluate(element => {
    let animations = 0
    for (let node = element; node; node = node.parentElement) animations += node.getAnimations().length
    return animations
  })).toBe(0)
  // Compare identical pixels before and after removing the nested background
  // so the panel gradient or video behind it cannot be mistaken for a seam.
  const actual = await sampleColors(app, card, points)
  const originalStyle = await card.getAttribute('style')
  await card.evaluate(element => {
    element.style.setProperty('background', 'transparent', 'important')
    element.style.setProperty('backdrop-filter', 'none', 'important')
  })
  try {
    const reference = await sampleColors(app, card, points)
    const difference = maxColorDifference(actual, reference)
    expect.soft(difference, `Panel card pixels: ${JSON.stringify({ actual, reference })}`).toBeLessThanOrEqual(2)
  } finally {
    await card.evaluate((element, style) => {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }, originalStyle)
  }
}

/**
 * Chromium repaints everything over a background with a fixed attachment on
 * every scroll frame, so the page must composite them with FtFixedBackground.
 *
 * @param {import('@playwright/test').Page} page
 */
async function repaintingFixedBackgrounds(page) {
  return page.evaluate(() => [...document.querySelectorAll('*')].flatMap(element =>
    [null, '::before', '::after'].filter(pseudo => {
      const style = getComputedStyle(element, pseudo)
      return style.backgroundAttachment.includes('fixed') && style.backgroundImage !== 'none'
    }).map(pseudo => `${element.localName}.${[...element.classList].join('.')}${pseudo ?? ''}`)))
}

// These themes share layout rules; pair light/dark with regular/fractional zoom.
for (const [theme, scale] of [['openTubeXLight', 100], ['openTubeXDark', 125]]) {
  test.describe(`${theme} continuous backgrounds at ${scale}%`, () => {
    test.use({
      seed: {
        settings: {
          baseTheme: theme,
          uiScale: scale,
          currentLocale: 'en-US',
          fetchSubscriptionsAutomatically: false,
          showNewSubscriptionFeed: true,
          scrollMiniPlayerEnabled: false,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true
        }
      }
    })

    test('subscription category tabs blend into their card', async ({ app, page }, testInfo) => {
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="all"]').click()
      await page.getByRole('button', { name: 'Show tabbed view' }).click()
      const header = page.locator('.subscriptionsHeader')
      await expect(header.locator('.newFeedTabs')).toBeVisible()
      const height = await header.evaluate(element => element.getBoundingClientRect().height)
      // Sample the empty gutter on both sides of the header's bottom edge.
      await expectContinuousBackground(app, header, [[5, height - 4], [5, height + 4]])
      await attachThemeScreenshot(app, testInfo, `${theme} subscription header at ${scale}%`)
    })

    test('Subscriptions feed fields stay composited and match fixed backgrounds', async ({ app, page }) => {
      await goTo(page, 'subscriptions')
      const card = page.locator('.subscriptionsPage > .card')
      await expect(card.locator(':scope > .fixedBackgroundLayer')).toBeVisible()
      expect(await repaintingFixedBackgrounds(page)).toEqual([])

      // Scroll the card past the window, then compare the composited fields
      // with the fixed attachments they replace at the same pixels.
      await card.evaluate(element => { element.style.minBlockSize = '300vh' })
      await page.evaluate(() => window.scrollTo(0, innerHeight))
      await page.mouse.move(0, 0)
      const topNav = page.locator('.topNav')
      const points = async () => {
        const [nav, field] = await Promise.all([topNav, card].map(locator =>
          locator.evaluate(element => element.getBoundingClientRect())))
        const viewportHeight = await page.evaluate(() => innerHeight)
        return [
          ...[0.4, 0.6, 0.9].map(fraction => [field.x + 24 - nav.x, viewportHeight * fraction - nav.y]),
          [field.right - 24 - nav.x, viewportHeight * 0.8 - nav.y],
          // The window's field beside the card.
          [field.right + 4 - nav.x, viewportHeight * 0.7 - nav.y]
        ]
      }
      const composited = await sampleColors(app, topNav, points)
      const style = await page.addStyleTag({
        content: `
          body, .app { background-image: var(--bg-image) !important; background-attachment: fixed !important; }
          .app { background-color: var(--bg-color) !important; }
          body::before, .fixedBackgroundLayer { display: none !important; }
          .subscriptionsPage > .card { background-clip: border-box !important; background-attachment: fixed !important; }
        `
      })
      try {
        const reference = await sampleColors(app, topNav, points)
        expect(maxColorDifference(composited, reference), `Field pixels: ${JSON.stringify({ composited, reference })}`).toBeLessThanOrEqual(2)
      } finally {
        await style.evaluate(element => element.remove())
      }
    })

    test('search filter background does not flash when its opening animation ends', async ({ app, page }) => {
      await page.addStyleTag({ content: '.promptCard { animation-play-state: paused !important; }' })
      await page.locator('.navFilterButton').click()
      const dialog = page.getByRole('dialog', { name: 'Search Filters' })
      await expect(dialog).toBeVisible()
      await dialog.evaluate(element => {
        const animation = element.getAnimations().find(animation => animation.animationName?.startsWith('prompt-card-enter'))
        if (!animation) throw new Error('Missing prompt opening animation')
        // Sample just before the transform is removed, with effectively
        // identical geometry and opacity to the settled dialog. The spring
        // easing reaches its end value exactly in its final microseconds.
        animation.currentTime = animation.effect.getComputedTiming().duration - 5
        element.closest('.prompt').getAnimations().forEach(animation => animation.finish())
      })
      await expect(dialog).not.toHaveCSS('transform', 'none')
      const points = await dialog.evaluate(element => {
        const { width, height } = element.getBoundingClientRect()
        // Clear of the extra-large corner arcs, whose antialiasing shifts with the transform.
        return [[4, 32], [width / 2, 4], [width - 4, height / 2], [4, height - 32]]
      })
      const opening = await sampleColors(app, dialog, points, { finishAnimations: false })
      const settled = await sampleColors(app, dialog, points)
      await expect(dialog).toHaveCSS('transform', 'none')
      const difference = maxColorDifference(opening, settled)
      expect(difference, `Opening and settled backgrounds: ${JSON.stringify({ opening, settled })}`).toBeLessThanOrEqual(2)
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toBeHidden()
    })

    test('quick settings background does not change when its opening transition ends', async ({ app, page }) => {
      await page.addStyleTag({ content: '.quick-settings-menu-enter-active { transition-duration: 1000s !important; }' })
      await page.locator('.topNav .profileTrigger').click()
      const menu = page.locator('.quickSettingsMenu')
      await expect(menu).toBeVisible()
      await menu.evaluate(element => {
        const transitions = element.getAnimations()
        if (transitions.length === 0) throw new Error('Missing quick settings opening transition')
        // Sample just before the transform is removed, with effectively
        // identical geometry and opacity to the settled menu.
        for (const transition of transitions) {
          transition.pause()
          transition.currentTime = transition.effect.getComputedTiming().duration - 5
        }
      })
      await expect(menu).not.toHaveCSS('transform', 'none')
      const points = await menu.evaluate(element => {
        const { width, height } = element.getBoundingClientRect()
        // Clear of the large corner arcs, whose antialiasing shifts with the transform.
        return [[4, 24], [width / 2, 4], [width - 4, height / 2], [4, height - 24]]
      })
      const opening = await sampleColors(app, menu, points, { finishAnimations: false })
      const settled = await sampleColors(app, menu, points)
      await expect(menu).toHaveCSS('transform', 'none')
      const difference = maxColorDifference(opening, settled)
      expect(difference, `Opening and settled backgrounds: ${JSON.stringify({ opening, settled })}`).toBeLessThanOrEqual(2)
    })

    test('notifications dropdown uses the card gradient', async ({ page }) => {
      await page.locator('.notificationCenter').click()
      const dropdown = page.locator('.notificationCenterDropdown')
      await expect(dropdown).toBeVisible()
      await expect(dropdown).toHaveCSS('background-image', /radial-gradient.*linear-gradient/)
      await expect(dropdown).toHaveCSS('background-attachment', /^scroll(, scroll)*$/)
    })

    test('Profile Manager and About cards stay solid on the settings window gradient', async ({ app, page }, testInfo) => {
      const window = page.locator('.settingsWindow')
      const expectSolidCards = async cards => {
        await expect(cards.first()).toBeVisible()
        await expect(window).toHaveCSS('background-image', /linear-gradient/)
        for (const card of await cards.all()) await expect(card).toHaveCSS('background-image', 'none')
      }
      await page.locator('.topNav .profileTrigger').click()
      await page.locator('.profileSummary').click()
      await page.locator('.profilePanelHeader').getByRole('button', { name: 'Profile', exact: true }).click()
      await expectSolidCards(page.locator('.profileSettingsContent .ft-card'))
      await attachThemeScreenshot(app, testInfo, `${theme} profile manager at ${scale}%`)
      await window.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(window).toHaveCount(0)

      await page.locator('.topNav .profileTrigger').click()
      await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()
      await expectSolidCards(page.locator('.settingsAboutPage .ft-card'))
      await attachThemeScreenshot(app, testInfo, `${theme} about window at ${scale}%`)

      // The Quick Settings preview mirrors the real menu, gradient included.
      await window.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(window).toHaveCount(0)
      const customizer = await openInterfaceCustomizer(page, 'quick settings')
      await expect(customizer.locator('.quickSettingsMenu')).toHaveCSS('background-image', /linear-gradient/)
    })

    test('Watch page keeps the window background below the top bar', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
      await page.mouse.move(0, 0)
      const host = page.locator('.watchPreviewHost.watchRouteActive')
      await expect(host).toBeVisible()
      // The host is taller than the window, so measure from the top bar,
      // which stays on screen, to sample beside the player across its top edge.
      const topNav = page.locator('.topNav')
      await expectContinuousBackground(app, topNav, async () => {
        const [nav, watch] = await Promise.all([topNav, host].map(locator =>
          locator.evaluate(element => element.getBoundingClientRect())))
        const offset = watch.y - nav.y
        return [[watch.x - nav.x + 5, offset - 4], [watch.x - nav.x + 5, offset + 4]]
      })
      await attachThemeScreenshot(app, testInfo, `${theme} Watch page top at ${scale}%`)
    })

    test('download dialog footer blends into its card', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
      await page.locator('.watchVideoInfo').getByRole('button', { name: 'Download Video' }).click()
      const footer = page.locator('.downloadPromptCard .downloadFooter')
      await expect(footer).toBeVisible()
      await page.mouse.move(0, 0)
      // Left of the centered folder row and buttons.
      await expectPanelOwnsBackground(app, footer, [[5, 4], [5, 30]])
      await attachThemeScreenshot(app, testInfo, `${theme} download dialog at ${scale}%`)
    })

    test('description controls and fades blend into their card', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      const view = await watchViewHandle(page)
      await view.evaluate(async component => {
        component.isLoading = true
        await component.$nextTick()
        component.videoDescription = Array(30).fill('A short description line.').join('\n')
        component.videoDescriptionHtml = ''
        component.videoTags = []
        component.isLoading = false
        await component.$nextTick()
      })
      // Remounting updates the description's initial state and restarts the
      // player. Let its startup scroll finish before sampling the card.
      await waitForPlayback(page)
      await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
      const card = page.locator('.videoDescription')
      await expect(card.locator('.description')).toContainText('A short description line.')
      const footer = card.locator(':scope > .descriptionStatus')
      for (const expanded of [false, true]) {
        if (expanded) await footer.click()
        await expect(footer).toHaveAttribute('aria-expanded', String(expanded))
        await footer.scrollIntoViewIfNeeded()
        const { width, height } = await footer.evaluate(element => {
          const { width, height } = element.getBoundingClientRect()
          return { width, height }
        })
        // Empty space on both sides of the centered label, clear of the divider.
        await expectDescriptionBackground(app, footer, [
          [12, height / 2], [width / 4, height / 2], [width * 3 / 4, height / 2], [width - 12, height / 2]
        ])
      }
      await attachThemeScreenshot(app, testInfo, `${theme} description footer at ${scale}%`)
    })

    test('Shorts video information blends into its panel', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
      await openMockedVideo(page)
      const view = await watchViewHandle(page)
      await view.evaluate(async component => {
        component.isLoading = true
        await component.$nextTick()
        component.isShort = true
        component.videoDescription = 'A short description.'
        component.videoDescriptionHtml = ''
        component.videoTags = ['shorts', 'theme']
        component.shortsMetadataOpen = true
        component.isLoading = false
        await component.$nextTick()
      })
      await waitForPlayback(page)
      await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
      const panel = page.locator('.shortsAuxPanel')
      await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
      await page.mouse.move(0, 0)
      for (const selector of ['.watchVideoInfo', '.videoDescription']) {
        const card = panel.locator(selector)
        await expect(card).toBeVisible()
        const height = await card.evaluate(element => element.getBoundingClientRect().height)
        // Compare the empty gutter immediately across each section boundary,
        // skipping the header's intentional one-pixel separator.
        await expectContinuousBackground(app, card, [[5, -4], [5, 4]])
        await expectContinuousBackground(app, card, [[5, height - 4], [5, height + 4]])
      }
      await attachThemeScreenshot(app, testInfo, `${theme} Shorts information at ${scale}%`)

      await setPlayerFullscreen(page, true)
      const fullscreenPanel = page.locator('.fullscreenMetadataOverlay.open')
      await expect(fullscreenPanel).toBeVisible()
      for (const selector of ['.watchVideoInfo', '.videoDescription']) {
        await expectPanelOwnsBackground(app, fullscreenPanel.locator(selector), [[5, 4], [5, 40]])
      }
      await attachThemeScreenshot(app, testInfo, `${theme} fullscreen information at ${scale}%`)

      await view.evaluate(component => component.toggleTranscript())
      const transcript = page.locator('.fullscreenTranscriptOverlay.open .watchVideoTranscript')
      await expect(transcript).toBeVisible()
      await expectPanelOwnsBackground(app, transcript, [[5, 80], [5, 160]])
      await setPlayerFullscreen(page, false)
      const shortsTranscript = panel.locator('.watchVideoTranscript')
      await expect(shortsTranscript).toBeVisible()
      await expectPanelOwnsBackground(app, shortsTranscript, [[5, 80], [5, 160]])
    })

    test('Shorts comments blend into their panel and fullscreen overlay', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      const view = await watchViewHandle(page)
      await view.evaluate(async component => {
        component.isShort = true
        await component.$nextTick()
        component.toggleShortsComments()
      })
      await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
      const comments = page.locator('.shortsCommentsPanel .fullscreenCommentCard')
      await expect(comments).toBeVisible()
      await expectPanelOwnsBackground(app, comments, [[5, 80], [5, 160]])
      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })
      const fullscreenComments = page.locator('.fullscreenCommentsOverlay.open .fullscreenCommentCard')
      await expect(fullscreenComments).toBeVisible()
      await expectPanelOwnsBackground(app, fullscreenComments, [[5, 80], [5, 160]])
    })

    test('other feed headers and channel panels blend into their cards', async ({ app, page }, testInfo) => {
      await page.evaluate(async () => {
        const store = window.$store
        await store.dispatch('updateBackendPreference', 'invidious')
        await store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
      })
      await page.route('https://invidious.test/api/v1/popular/**', route => route.fulfill({ json: [] }))
      await page.route('https://invidious.test/api/v1/trending/**', route => route.fulfill({ json: [] }))
      for (const route of ['popular', 'trending']) {
        const tab = await page.evaluate(route => window.ftElectron.tabs.create({
          route: `/${route}`, makeActive: false
        }), route)
        await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
        const header = page.locator(`.${route}Page .pageHeader`)
        const height = await header.evaluate(element => element.getBoundingClientRect().height)
        // Skip the intentional one-pixel separator.
        await expectContinuousBackground(app, header, [[5, height - 4], [5, height + 4]])
      }

      const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
      await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
        json: {
          author: 'Theme test channel',
          authorId: channelId,
          authorThumbnails: [],
          authorBanners: [],
          isFamilyFriendly: true,
          subCount: 100,
          description: 'A channel description.',
          totalViews: 1000,
          joined: 1000000000,
          relatedChannels: [],
          tabs: ['about']
        }
      }))
      const tab = await page.evaluate(id => window.ftElectron.tabs.create({
        route: `/channel/${id}/about`, makeActive: false
      }), channelId)
      await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
      const info = page.locator('.channelDetails .infoContainer')
      await expect(page.locator('#aboutPanel')).toBeVisible()
      const infoWidth = await info.evaluate(element => element.getBoundingClientRect().width)
      // The banner above has its own image; compare the info surface with
      // its parent card at the same pixels instead of crossing that boundary.
      await expectPanelOwnsBackground(app, info, [[infoWidth - 60, 4], [infoWidth - 60, 20]])
      const about = page.locator('#aboutPanel')
      const aboutWidth = await about.evaluate(element => element.getBoundingClientRect().width)
      await expectContinuousBackground(app, about, [[aboutWidth - 5, 40], [aboutWidth + 5, 40]])
      expect(await repaintingFixedBackgrounds(page)).toEqual([])
      await attachThemeScreenshot(app, testInfo, `${theme} channel panels at ${scale}%`)
    })
  })
}
