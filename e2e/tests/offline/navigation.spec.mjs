import { test, expect, goTo, sel } from '../../helpers/app.mjs'

// Pages that work without any network access.
const OFFLINE_PAGES = [
  { route: 'subscriptions', name: 'Subscriptions' },
  { route: 'subscribedchannels', name: 'Channels' },
  { route: 'userplaylists', name: 'Playlists' },
  { route: 'history', name: 'History' },
  { route: 'settings', name: 'Settings' }
]

test.describe('side nav navigation', () => {
  for (const { route, name } of OFFLINE_PAGES) {
    test(`navigates to ${name}`, async ({ page }) => {
      await goTo(page, route)
    })
  }

  test('omits About from the mobile navigation', async ({ page }) => {
    const sideNav = page.locator('.sideNav')
    const moreButton = sideNav.getByRole('button', { name: 'More', exact: true })

    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 }
    ]) {
      await page.setViewportSize(viewport)
      await moreButton.click()
      await expect(sideNav.locator('.moreOptionContainer')).toBeVisible()
      await expect(sideNav.getByRole('link', { name: 'About', exact: true })).toHaveCount(0)
      await moreButton.click()
    }
  })

  test('navigation history back and forward work', async ({ page }) => {
    await goTo(page, 'history')
    await goTo(page, 'userplaylists')

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.forwardButton).click()
    await expect(page).toHaveURL(/#\/userplaylists/)
  })

  test('navigation history popout shows page icons and a drop shadow', async ({ page }) => {
    await goTo(page, 'history')
    await goTo(page, 'userplaylists')

    await page.locator(sel.backButton).click({ button: 'right' })

    const popout = page.locator('.topNav .iconDropdown')
    await expect(popout).toBeVisible()
    await expect(popout.locator('[role="option"]')).toHaveCount(3)
    await expect(popout.locator('[role="option"] svg')).toHaveCount(3)
    await expect(popout).not.toHaveCSS('box-shadow', 'none')
  })
})

test.describe('side nav channel names', () => {
  test.use({
    seed: {
      settings: {
        alwaysShowScrollbars: true,
        currentLocale: 'en-US',
        expandSideBar: true,
        uiScale: 125
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          {
            id: 'UCarabicchannelname00000',
            name: 'قناة عربية',
            thumbnail: ''
          },
          ...Array.from({ length: 24 }, (_, index) => ({
            id: `UC${index.toString().padStart(22, '0')}`,
            name: `Channel ${index.toString().padStart(2, '0')}`,
            thumbnail: ''
          }))
        ]
      }]
    }
  })

  test('keeps RTL channel names clear of the scrollbar in an LTR app', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    const sideNav = page.locator('.sideNav.expanded')
    const arabicChannel = sideNav.locator('.navChannel', { hasText: 'قناة عربية' })
    await expect(arabicChannel).toBeVisible()

    const metrics = await arabicChannel.evaluate((channel) => {
      const label = channel.querySelector('.navLabel')
      const scrollbar = channel.closest('.inner').querySelector('.os-scrollbar-vertical')
      const labelBounds = label.getBoundingClientRect()
      const scrollbarBounds = scrollbar.getBoundingClientRect()

      return {
        appDirection: getComputedStyle(channel).direction,
        labelDirection: getComputedStyle(label).direction,
        scrollbarClearance: scrollbarBounds.left - labelBounds.right
      }
    })

    expect(metrics.appDirection).toBe('ltr')
    expect(metrics.labelDirection).toBe('rtl')
    expect(metrics.scrollbarClearance).toBeGreaterThanOrEqual(4)
  })
})

for (const uiScale of [90, 100, 125]) {
  test.describe(`side nav without labels at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { hideLabelsSideBar: true, uiScale },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [{
            id: 'UCaaaaaaaaaaaaaaaaaaaaaa',
            name: 'Alpha Channel',
            thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
          }]
        }]
      }
    })

    test('uses square tiles with centered icons and avatars in the collapsed side bar', async ({ page }) => {
      await goTo(page, 'channel/UCaaaaaaaaaaaaaaaaaaaaaa')
      const sideNav = page.locator('.sideNav.hiddenLabels')
      const activeIndicator = sideNav.locator('.activeIndicator')
      const [avatarBounds, channelTileBounds, channelIndicatorBounds] = await Promise.all([
        sideNav.locator('.navChannel.router-link-active .channelThumbnail').boundingBox(),
        sideNav.locator('.navChannel.router-link-active').boundingBox(),
        activeIndicator.boundingBox()
      ])
      const avatarClearance = avatarBounds.x -
        (channelIndicatorBounds.x + channelIndicatorBounds.width)
      const avatarInlineCenter = avatarBounds.x + avatarBounds.width / 2
      const avatarCenter = avatarBounds.y + avatarBounds.height / 2
      const channelInlineCenter = channelTileBounds.x + channelTileBounds.width / 2
      const channelCenter = channelTileBounds.y + channelTileBounds.height / 2
      expect(Math.abs(channelTileBounds.width - 50)).toBeLessThanOrEqual(1)
      expect(Math.abs(channelTileBounds.height - 50)).toBeLessThanOrEqual(1)
      expect(Math.abs(avatarInlineCenter - channelInlineCenter)).toBeLessThanOrEqual(1)
      expect(Math.abs(avatarCenter - channelCenter)).toBeLessThanOrEqual(1)
      expect(avatarClearance).toBeGreaterThanOrEqual(4)

      await goTo(page, 'history')
      const sideNavBounds = await sideNav.boundingBox()
      expect(Math.abs(sideNavBounds.width - 50)).toBeLessThanOrEqual(1)
      const tileMetrics = await sideNav.locator('.inner > .navOption:visible .navIcon').evaluateAll(
        icons => icons.map(icon => {
          const bounds = icon.getBoundingClientRect()
          const optionBounds = icon.closest('.navOption').getBoundingClientRect()
          const iconInlineCenter = bounds.left + bounds.width / 2
          const iconCenter = bounds.top + bounds.height / 2
          const optionInlineCenter = optionBounds.left + optionBounds.width / 2
          const optionCenter = optionBounds.top + optionBounds.height / 2
          return {
            centerOffset: Math.abs(iconCenter - optionCenter),
            height: optionBounds.height,
            inlineCenterOffset: icon.matches(
              "[data-icon='user-check'][data-icon-pack='material']"
            )
              ? null
              : Math.abs(iconInlineCenter - optionInlineCenter),
            left: optionBounds.left,
            width: optionBounds.width
          }
        })
      )
      expect(tileMetrics.length).toBeGreaterThan(0)

      for (const tile of tileMetrics) {
        expect(Math.abs(tile.width - 50)).toBeLessThanOrEqual(1)
        expect(Math.abs(tile.height - 50)).toBeLessThanOrEqual(1)
        expect(Math.abs(tile.left - sideNavBounds.x)).toBeLessThanOrEqual(1)
        expect(tile.centerOffset).toBeLessThanOrEqual(1)
        if (tile.inlineCenterOffset !== null) {
          expect(tile.inlineCenterOffset).toBeLessThanOrEqual(1)
        }
      }

      const activeTile = sideNav.locator('.inner > .navOption.router-link-active:visible')
      const [activeTileBounds, indicatorBounds] = await Promise.all([
        activeTile.boundingBox(),
        activeIndicator.boundingBox()
      ])
      expect(Math.abs(activeTileBounds.x - indicatorBounds.x)).toBeLessThanOrEqual(1)
    })
  })
}

test.describe('navigation history titles', () => {
  test.use({
    seed: {
      history: [{
        _id: 'jNQXAC9IVRw',
        videoId: 'jNQXAC9IVRw',
        title: 'Watch',
        author: 'jawed',
        authorId: 'UC4QobU6STFB0P71PMvOGN5A',
        published: 0,
        lengthSeconds: 19,
        watchProgress: 0,
        timeWatched: Date.now(),
        isWatched: false,
        type: 'video'
      }]
    }
  })

  test('keeps a known video titled Watch when navigating away before it loads', async ({ page }) => {
    await goTo(page, 'history')
    await page.locator('.ft-list-video .title').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.forwardButton).click({ button: 'right' })

    const options = page.locator('.topNav .iconDropdown [role="option"]')
    await expect(options.filter({ hasText: 'Watch' })).toHaveCount(1)
    await expect(options.filter({ hasText: '/watch/jNQXAC9IVRw' })).toHaveCount(0)
  })

  test('removes an untitled watch entry when navigating back before it loads', async ({ page }) => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.evaluate((backButtonSelector) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tabId = store.getters.getActiveTabId
      store.commit('setTabContentTitle', {
        tabId,
        title: 'Watch',
        resolveHistoryEntry: false
      })
      document.querySelector(backButtonSelector).click()
    }, sel.backButton)
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator(sel.forwardButton)).toBeDisabled()
  })

  test('removes an untitled watch entry when navigating forward past it', async ({ page }) => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tab = store.getters.getActiveTab
      tab.history[tab.historyIndex].titlePending = false
    })
    await page.locator(sel.sideNavLink('history')).first().evaluate(link => link.click())
    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.evaluate((forwardButtonSelector) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tab = store.getters.getActiveTab
      tab.history[tab.historyIndex].titlePending = true
      store.commit('setTabContentTitle', {
        tabId: tab.id,
        title: 'Watch',
        resolveHistoryEntry: false
      })
      document.querySelector(forwardButtonSelector).click()
    }, sel.forwardButton)
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.backButton).click({ button: 'right' })
    const options = page.locator('.topNav .iconDropdown [role="option"]')
    await expect(options).toHaveCount(2)
    await expect(options.filter({ hasText: 'Watch' })).toHaveCount(0)
  })

  test('removes an untitled watch entry when navigating to another page', async ({ page }) => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.getByRole('link', { name: 'Go to Subscriptions' }).click()
    await expect(page).toHaveURL(/#\/subscriptions/)
    await page.locator(sel.backButton).click({ button: 'right' })

    const options = page.locator('.topNav .iconDropdown [role="option"]')
    await expect(options).toHaveCount(2)
    await expect(options.filter({ hasText: 'Watch' })).toHaveCount(0)
  })
})

test('preserves a pasted YouTube comment link target', async ({ page }) => {
  const commentId = 'UgxZaBRFEKqDUoZULy94AaABAg'
  await page.locator(sel.searchInput).fill(
    `https://www.youtube.com/watch?v=jNQXAC9IVRw&lc=${commentId}&pp=0gcJCSIANpG00pGi`
  )
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*commentId=${commentId}`))
})
