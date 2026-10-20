import { writeFile } from 'node:fs/promises'
import { expectTabHighlightAligned, expectTabHighlightStyle, selectTabWithHighlightAnimation, tabHighlightAnimations } from '../../helpers/tabs.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'
import { test, expect, sel } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const indicatorSelector = '.channelDetails:visible [role="tab"][aria-selected="true"]'

const settings = {
  backendPreference: 'invidious',
  defaultInvidiousInstance: 'https://invidious.test',
  reducedMotion: 'off'
}

test.use({ seed: { settings: { ...settings, uiScale: 95 } } })

test.beforeEach(async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: new URL(route.request().url()).pathname.endsWith('/search')
      ? []
      : {
          author: 'Channel',
          authorId: CHANNEL_ID,
          authorThumbnails: [],
          authorBanners: [],
          description: 'Channel description',
          subCount: 0,
          totalViews: 0,
          joined: 0,
          tabs: ['videos', 'shorts', 'streams', 'playlists', 'posts', 'releases', 'podcasts', 'courses', 'about'],
          relatedChannels: [],
          videos: [],
          latestVideos: [],
          playlists: [],
          comments: []
        }
  }))
  const tab = await page.evaluate(id => window.ftElectron.tabs.create({
    route: `/channel/${id}`,
    makeActive: false
  }), CHANNEL_ID)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await expect(page.locator(indicatorSelector)).toBeVisible()
})

async function expectAligned(page) {
  await expectTabHighlightAligned(page.locator(indicatorSelector))
}

for (const [width, scale] of [[1600, 100], [375, 95], [812, 125]]) {
  test(`vertically centers empty channel messages at ${width}px and ${scale}% UI scale`, async ({ app, page }) => {
    const card = page.locator('.channelContent:visible')
    await app.electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setSize(width, 900)
    }, width)
    await page.evaluate(value => window.$store.dispatch('updateUiScale', value), scale)
    for (const tab of ['videos', 'shorts', 'live', 'podcasts', 'releases', 'courses', 'playlists', 'community']) {
      await page.locator(`#${tab}Tab`).click()
      await expect(card.locator('.message')).toBeVisible()
      const layout = await card.evaluate(element => {
        const box = element.getBoundingClientRect()
        const text = element.querySelector('.message').getBoundingClientRect()
        return {
          offset: Math.abs((text.top + text.bottom - box.top - box.bottom) / 2),
          fits: text.left >= box.left && text.right <= box.right &&
            text.top >= box.top && text.bottom <= box.bottom
        }
      })
      expect.soft(layout.offset, `${tab} at ${width}px and ${scale}% scale`).toBeLessThanOrEqual(1)
      expect.soft(layout.fits, `${tab} text fits at ${width}px`).toBe(true)
    }
  })
}

async function expectTabScrollRange(tabs) {
  await expect.poll(() => tabs.evaluate(container => {
    const viewport = container.getBoundingClientRect()
    const content = container.querySelector('.tabsContent').getBoundingClientRect()
    const range = Math.max(0, content.width - viewport.width)
    const scrollbar = container.querySelector('.os-scrollbar-horizontal')
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
    const tolerance = 2 / devicePixelRatio
    const progress = range > 0 ? Math.min(1, Math.abs(container.scrollLeft) / range) : 0
    const rtl = getComputedStyle(container).direction === 'rtl'
    const thumbOffset = (rtl ? 1 - progress : progress) * (track.width - thumb.width)
    return {
      validOffset: Math.abs(container.scrollLeft) <= range + tolerance,
      noEmptySpace: content.left <= viewport.left + tolerance && content.right >= viewport.right - tolerance,
      // Native overflow rounds fractional content and viewport widths separately.
      scrollbarMatchesRange: scrollbar.classList.contains('os-scrollbar-unusable') === (container.scrollWidth <= container.clientWidth),
      thumbSizeMatchesRange: range < 1 || Math.abs(thumb.width - track.width * viewport.width / content.width) <= tolerance,
      thumbPositionMatchesOffset: range < 1 || Math.abs(thumb.left - track.left - thumbOffset) <= tolerance,
      fullLabels: [...container.querySelectorAll('.tabLabel > span')].every(label => label.scrollWidth <= label.clientWidth + 1)
    }
  })).toEqual({
    validOffset: true,
    noEmptySpace: true,
    scrollbarMatchesRange: true,
    thumbSizeMatchesRange: true,
    thumbPositionMatchesOffset: true,
    fullLabels: true
  })
}

test('hides channel tab icons and preserves full labels when space is limited', async ({ app, page }, testInfo) => {
  for (const [width, scale] of [[375, 95], [812, 125], [1250, 100], [1600, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setSize(width, 900)
    }, width)
    await page.evaluate(value => window.$store.dispatch('updateUiScale', value), scale)
    if (width === 1600) await expect(page.locator('#videosTab .channelTabIcon')).toBeVisible()
    else await expect(page.locator('#videosTab .channelTabIcon')).toBeHidden()
    await expect.poll(() => page.locator('.channelDetails:visible .tabLabel > span').evaluateAll(labels =>
      labels.every(label => label.scrollWidth <= label.clientWidth + 1 && getComputedStyle(label).textOverflow !== 'ellipsis')
    )).toBe(true)
    await expectAligned(page)
  }
  await page.evaluate(async () => {
    const store = window.$store
    await Promise.all(['Community', 'Releases', 'Courses'].map(tab => store.dispatch(`updateHideChannel${tab}`, true)))
    await store.dispatch('updateUiScale', 100)
  })
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(450, 900))
  await expect(page.locator('#videosTab .channelTabIcon')).toBeHidden()
  // Pill spacing can require scrolling even with fewer tabs; labels stay complete.
  await expect.poll(() => page.locator('.channelDetails:visible .tabLabel > span').evaluateAll(labels =>
    labels.every(label => label.scrollWidth <= label.clientWidth + 1)
  )).toBe(true)
  await expectTabScrollRange(page.locator('.channelDetails:visible .tabs'))
  await captureAppFramebuffer(app, testInfo, 'channel-tabs-full-labels-without-icons')
})

test('keeps channel header rows evenly spaced below the banner', async ({ app, page }, testInfo) => {
  for (const [width, height, scale] of [[500, 1000, 100], [375, 812, 95], [812, 375, 125], [750, 900, 100], [1600, 900, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height)
    }, { width, height })
    await page.evaluate(value => {
      return window.$store.dispatch('updateUiScale', value)
    }, scale)
    const searchToggle = page.getByRole('button', { name: 'Search Channel', exact: true })
    if (await searchToggle.isVisible() && await searchToggle.getAttribute('aria-expanded') === 'false') {
      await searchToggle.click()
    }
    await expectAligned(page)
    await expect.poll(() => page.locator('.channelDetails:visible').evaluate(header => {
      const bounds = selector => header.querySelector(selector).getBoundingClientRect()
      const banner = bounds('.bannerContainer')
      const avatar = bounds('.thumbnailContainer')
      const actions = bounds('.infoActionsContainer')
      const subscribe = bounds('.buttonList')
      const info = bounds('.info')
      const controls = bounds('.infoTabs')
      const search = bounds('.channelSearch input')
      const tabs = bounds('.tabs')
      const container = bounds('.infoContainer')
      const gaps = {
        bannerToAvatar: avatar.top - banner.bottom,
        infoToControls: controls.top - info.bottom,
        belowTabs: container.bottom - tabs.bottom
      }
      if (actions.top >= avatar.bottom) {
        gaps.avatarToActions = subscribe.top - avatar.bottom
        gaps.actionsToSearch = search.top - subscribe.bottom
      }
      if (search.bottom <= tabs.top) {
        gaps.searchToTabs = tabs.top - search.bottom
      }
      return Object.fromEntries(Object.entries(gaps).map(([name, gap]) => [name, Math.round(gap)]))
    }), { message: `20px header gaps at ${width}x${height}, ${scale}% UI scale` }).toEqual({
      bannerToAvatar: 20,
      infoToControls: 20,
      belowTabs: 20,
      ...(width < 680 || scale === 125 ? { avatarToActions: 20, actionsToSearch: 20 } : {}),
      ...(width <= 800 || scale === 125 ? { searchToTabs: 20 } : {})
    })
  }
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(500, 1000)
  })
  await page.evaluate(() => window.$store.dispatch('updateUiScale', 100))
  await testInfo.attach('even channel header spacing', {
    body: await page.locator('.channelDetails:visible').screenshot(),
    contentType: 'image/png'
  })
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateHideSharingActions', true)
    await store.dispatch('updateHideUnsubscribeButton', true)
  })
  const actions = page.locator('.channelDetails:visible .infoActionsContainer')
  await expect(actions.locator(':scope > *')).toHaveCount(1)
  await expect(actions.getByRole('button', { name: 'Pin to Navigation', exact: true })).toBeVisible()
  await expect.poll(() => page.locator('.channelDetails:visible').evaluate(header => {
    const info = header.querySelector('.thumbnailContainer').getBoundingClientRect()
    const search = header.querySelector('.channelSearch input').getBoundingClientRect()
    const actions = header.querySelector('.infoActionsContainer').getBoundingClientRect()
    return {
      avatarToPin: Math.round(actions.top - info.bottom),
      pinToSearch: Math.round(search.top - actions.bottom)
    }
  })).toEqual({ avatarToPin: 20, pinToSearch: 20 })
})

test('collapses channel search to an accessible icon at narrow widths', async ({ app, page }) => {
  const input = page.locator('.channelSearch input')
  const toggle = page.getByRole('button', { name: 'Search Channel', exact: true })
  for (const [width, scale] of [[500, 100], [375, 95], [812, 125], [1600, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
    await page.evaluate(value => window.$store.dispatch('updateUiScale', value), scale)
    if (width * 100 / scale > 800) {
      await expect(toggle).toBeHidden()
      await expect(input).toBeVisible()
      continue
    }
    await expect(input).toBeHidden()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(input).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await input.fill('animation')
    await input.press('Enter')
    await expect(page).toHaveURL(/searchQueryText=animation/)
    await input.clear()
    await expect(page).not.toHaveURL(/searchQueryText=/)
    await toggle.click()
    await expect(input).toBeHidden()
    await toggle.press('Control+f')
    await expect(input).toBeFocused()
    await toggle.click()
    await expectAligned(page)
  }
})

test('centers channel tab titles vertically at every layout size', async ({ app, page }) => {
  for (const [width, height, scale] of [[500, 1000, 100], [375, 812, 95], [812, 375, 125], [1600, 900, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height)
    }, { width, height })
    await page.evaluate(value => window.$store.dispatch('updateUiScale', value), scale)
    await expect.poll(() => page.locator('.channelDetails:visible [role="tab"]').evaluateAll(tabs => {
      return Math.max(...tabs.map(tab => {
        const bounds = tab.getBoundingClientRect()
        const label = tab.querySelector('.tabLabel').getBoundingClientRect()
        const border = Number.parseFloat(getComputedStyle(tab).borderBottomWidth)
        return Math.abs((label.top + label.bottom) / 2 - (bounds.top + bounds.bottom - border) / 2)
      }))
    }), { message: `Centered tab titles at ${width}x${height}, ${scale}% UI scale` }).toBeLessThan(0.5)
    await expectAligned(page)
  }
})

test('separates the content card on every channel tab', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
  const videos = [0, 1].map(index => ({ videoId: `video${index}aaaaa`, title: 'Video', author: 'Channel', lengthSeconds: 60, videoThumbnails: [] }))
  let description = 'Channel description'
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: {
      author: 'Channel',
      authorId: CHANNEL_ID,
      authorThumbnails: [],
      authorBanners: [],
      description,
      subCount: 0,
      totalViews: 0,
      joined: 0,
      tabs: ['videos', 'shorts', 'streams', 'playlists', 'posts', 'podcasts', 'releases', 'courses'],
      relatedChannels: [],
      videos,
      latestVideos: videos,
      playlists: [],
      comments: []
    }
  }))
  await page.reload()
  await expect(page.locator('.channel-view-all:visible')).toBeVisible()
  const scale = uiScale
  for (const [width, height] of [[500, 1000], [375, 812], [812, 375], [1600, 900]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height)
    }, { width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
    await page.evaluate(value => window.$store.dispatch('updateUiScale', value), uiScale)
    for (const [tabId, contentSelector] of [
      ['videosTab', '.select-container'],
      ['shortsTab', '.select-container'],
      ['liveTab', '.select-container'],
      ['playlistsTab', '.elementList .message:visible'],
      ['communityTab', '.elementList .message:visible'],
      ['podcastsTab', '.elementList .message:visible'],
      ['releasesTab', '.elementList .message:visible'],
      ['coursesTab', '.elementList .message:visible'],
      ['aboutTab', '#aboutPanel h2:first-child']
    ]) {
      await page.locator(`#${tabId}`).click()
      await expect(page.locator(contentSelector)).toBeVisible()
      if (tabId === 'videosTab') {
        expect(await page.locator('.select-container').evaluate(row => {
          const button = row.querySelector('.channel-view-all').getBoundingClientRect()
          const select = row.querySelector('.select-text').getBoundingClientRect()
          return select.top >= button.bottom
            ? select.left >= row.getBoundingClientRect().left - 1 && select.right <= row.getBoundingClientRect().right + 1
            : Math.abs(button.top + button.height / 2 - select.top - select.height / 2) <= 1
        }), `View All and Sort By align or wrap within their row at ${width}px, ${scale}%`).toBe(true)
      }
      // Empty-state cards keep 16px internal padding around their centered message.
      const emptyState = contentSelector === '.elementList .message:visible'
      await expect.poll(() => page.locator(contentSelector).evaluate(content => {
        const tabs = document.querySelector('.channelDetails .tabs').getBoundingClientRect()
        return Math.round(content.getBoundingClientRect().top - tabs.bottom)
      }), { message: `Balanced gap to ${tabId} content at ${width}px and ${scale}% UI scale` }).toBe(width <= 800 ? (emptyState ? 36 : 20) : 46)
      await expect.poll(() => page.locator('.channelContent:visible').evaluate(card => {
        const header = card.previousElementSibling.getBoundingClientRect()
        const bounds = card.getBoundingClientRect()
        return Math.round(bounds.top - header.bottom) || 0
      }), { message: `Card spacing on ${tabId} at ${width}px and ${scale}% UI scale` }).toBe(width <= 800 ? 0 : 10)
    }
  }
  await page.locator('#videosTab').click()
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(500, 1000))
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateUiScale', 100)
    await store.dispatch('updateBaseTheme', 'system')
    await store.dispatch('updateSystemDarkTheme', 'dark')
    await store.dispatch('updateSystemLightTheme', 'light')
  })
  const searchToggle = page.locator('.channelSearchToggle button')
  await expect(searchToggle).toHaveAttribute('aria-pressed', 'false')
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
    for (const interaction of ['rest', 'hover', 'keyboard']) {
      const colors = []
      for (const expanded of [false, true]) {
        if ((await searchToggle.getAttribute('aria-pressed')) !== String(expanded)) {
          await searchToggle.evaluate(button => button.click())
        }
        await expect(searchToggle).toHaveAttribute('aria-pressed', String(expanded))
        await page.mouse.move(0, 0)
        await page.evaluate(() => document.activeElement?.blur())
        if (interaction === 'hover') await searchToggle.hover()
        if (interaction === 'keyboard') {
          await expect.poll(async () => {
            await page.keyboard.press('Tab')
            return searchToggle.evaluate(button => button === document.activeElement)
          }, { message: 'Keyboard Tab reaches the channel search toggle', intervals: [0] }).toBe(true)
          await expect.poll(() => searchToggle.evaluate(button => button.matches(':focus-visible'))).toBe(true)
        }
        colors.push(await searchToggle.evaluate(async button => {
          await Promise.all(button.getAnimations().map(animation => animation.finished))
          return getComputedStyle(button).backgroundColor
        }))
      }
      expect(colors[1], `Search state remains visible during ${interaction} in ${colorScheme}`).not.toBe(colors[0])
    }
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.activeElement?.blur())
    await page.evaluate(() => document.fonts.ready)
    const clip = await page.locator('.channelDetails').evaluate(header => {
      const bounds = header.getBoundingClientRect()
      const top = header.querySelector('.channelSearch').getBoundingClientRect().top - 10
      const bottom = document.querySelector('.select-container').getBoundingClientRect().bottom + 16
      return { x: bounds.x, y: top, width: bounds.width, height: bottom - top }
    })
    let settledScreenshot
    await expect.poll(async () => {
      const before = await page.screenshot({ clip })
      await page.waitForTimeout(120)
      const after = await page.screenshot({ clip })
      settledScreenshot = after
      return before.equals(after)
    }, { message: 'The channel controls settle before the screenshot is saved' }).toBe(true)
    await writeFile(testInfo.outputPath(`channel-controls-${colorScheme}.png`), settledScreenshot)
  }
  description = ''
  await page.reload()
  await page.locator('#aboutTab').click()
  const firstHeading = page.locator('#aboutPanel h2:first-child')
  await expect(firstHeading).toHaveText('Details')
  await expect.poll(() => firstHeading.evaluate(heading => {
    return Math.round(heading.getBoundingClientRect().top - document.querySelector('.channelDetails .tabs').getBoundingClientRect().bottom)
  })).toBe(20)
})

test('narrow channel errors retain internal padding', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await page.evaluate(() => window.$store.dispatch('updateBackendFallback', false))
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    status: 500, json: { error: 'Channel unavailable' }
  }))
  await page.reload()
  const card = page.locator('.channelError:visible')
  await expect(card).toBeVisible()
  await page.evaluate(scale => window.$store.dispatch('updateUiScale', scale), uiScale)
  await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
    BrowserWindow.getAllWindows()[0].setSize(Math.round(500 * scale / 100), Math.round(900 * scale / 100))
  }, uiScale)
  await expect(card).toHaveCSS('padding-top', '16px')
  await expect(card).toHaveCSS('padding-bottom', '16px')
})

test('crossfades the active channel line at the configured animation speed', async ({ page }) => {
  for (const [speed, tabId, duration] of [[100, 'aboutTab', 140], [200, 'videosTab', 70], [50, 'shortsTab', 280]]) {
    await page.evaluate(value => {
      return window.$store.dispatch('updateAnimationSpeed', value)
    }, speed)
    await expectTabHighlightStyle(page.locator(indicatorSelector), 'opacity', '1')
    const animation = await selectTabWithHighlightAnimation(page.locator(`#${tabId}`))
    expect(animation).not.toBeNull()
    expect(animation.duration / animation.playbackRate).toBeCloseTo(duration, 0)
    await expectTabHighlightStyle(page.locator(indicatorSelector), 'transitionProperty', 'opacity')
    await expectAligned(page)
    await expect.poll(() => page.locator(indicatorSelector).evaluate(tabHighlightAnimations)).toEqual([])
  }
})

test('realigns the active channel line when the locale direction changes without switching tabs', async ({ page }) => {
  await expectAligned(page)
  for (const [locale, direction] of [['ar', 'rtl'], ['en-US', 'ltr']]) {
    await page.evaluate(value => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale = value
    }, locale)
    await expect(page.locator('body')).toHaveAttribute('dir', direction)
    await expect(page.locator('#videosTab')).toHaveAttribute('aria-selected', 'true')
    await expectAligned(page)
  }
})

test('places the channel line immediately after layout changes without animating', async ({ app, page }) => {
  await page.evaluate(() => {
    window.$store.commit('setAnimationSpeed', 25)
  })
  async function expectImmediateAlignment() {
    await expectAligned(page)
    expect(await page.locator(indicatorSelector).evaluate(tabHighlightAnimations)).toEqual([])
  }
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(812, 900)
  })
  await expectImmediateAlignment()
  await page.evaluate(() => {
    return window.$store.dispatch('updateUiScale', 125)
  })
  await expectImmediateAlignment()
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale = 'ar'
  })
  await expect(page.locator('body')).toHaveAttribute('dir', 'rtl')
  await expectImmediateAlignment()
  await page.evaluate(() => {
    return window.$store.dispatch('updateHideChannelShorts', true)
  })
  await expect(page.locator('#shortsTab')).toHaveCount(0)
  await expectImmediateAlignment()
})

test('keeps every channel tab in one row across zoom, RTL, and changing labels', async ({ app, page }, testInfo) => {
  for (const [width, height, scale] of [[1600, 900, 95], [375, 812, 95], [812, 375, 125]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height)
    }, { width, height })
    await page.evaluate(value => {
      return window.$store.dispatch('updateUiScale', value)
    }, scale)
    await expectAligned(page)
    await expect.poll(() => page.locator('.channelDetails:visible [role="tab"]').evaluateAll(tabs => {
      const tops = tabs.map(tab => tab.getBoundingClientRect().top)
      return Math.max(...tops) - Math.min(...tops)
    })).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThan(2)
    for (const tab of await page.locator('.channelDetails:visible [role="tab"]').all()) {
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expectAligned(page)
      await expect.poll(() => tab.evaluate(element => {
        const tab = element.getBoundingClientRect()
        const viewport = element.closest('.tabs').getBoundingClientRect()
        return Math.max(viewport.left - tab.left, tab.right - viewport.right)
      })).toBeLessThan(2)
    }
  }
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(812, 1100)
  })
  await expectAligned(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await testInfo.attach('channel indicator in a single row', {
    body: await page.screenshot(),
    contentType: 'image/png'
  })

  await page.locator('.channelDetails:visible .tabs').evaluate(element => { element.dir = 'rtl' })
  await page.locator('#videosTab').click()
  await expectAligned(page)
  await page.locator('#aboutTab').click()
  await expectAligned(page)

  await page.locator('#videosTab .tabLabel').evaluate(label => {
    label.dataset.label = 'Longer video tab label'
    label.firstElementChild.textContent = label.dataset.label
  })
  await expectAligned(page)

  for (const roundness of [0, 50, 100, 200]) {
    await page.evaluate(value => {
      window.$store.commit('setUiRoundness', value)
    }, roundness)
    await expect.poll(() => page.locator(indicatorSelector).evaluate(element => {
      return getComputedStyle(element, '::before').borderRadius === getComputedStyle(element).borderRadius
    })).toBe(true)
  }
})

test('scrolls full channel labels and clamps the range after labels or available tabs change', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(375, 812)
  })
  const tabs = page.locator('.channelDetails:visible .tabs')
  async function expectFullLabels() {
    await expect.poll(() => tabs.evaluate(container => {
      const tabs = [...container.querySelectorAll('[role="tab"]')].map(tab => tab.getBoundingClientRect())
      const labels = [...container.querySelectorAll('.tabLabel > span')]
      return {
        oneRow: Math.max(...tabs.map(tab => tab.top)) - Math.min(...tabs.map(tab => tab.top)) < 1,
        fullLabels: labels.every(label => label.scrollWidth <= label.clientWidth + 1),
        validOffset: Math.abs(container.scrollLeft) <= container.scrollWidth - container.clientWidth + 2 / devicePixelRatio
      }
    })).toEqual({ oneRow: true, fullLabels: true, validOffset: true })
    await expectAligned(page)
    await expectTabScrollRange(tabs)
  }
  await expectFullLabels()
  const scrollbar = tabs.locator(':scope > .os-scrollbar-horizontal')
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  await expect.poll(() => tabs.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await expect.poll(() => tabs.locator('[role="tab"]').evaluateAll(elements =>
    Math.min(...elements.map(element => element.getBoundingClientRect().height))
  )).toBeGreaterThan(47.5)
  await page.locator('#aboutTab').evaluate(tab => tab.click())
  await expectFullLabels()
  await expect.poll(() => page.locator('#aboutTab').evaluate(tab => {
    const bounds = tab.getBoundingClientRect()
    const viewport = tab.closest('.tabs').getBoundingClientRect()
    return Math.max(viewport.left - bounds.left, bounds.right - viewport.right)
  })).toBeLessThan(2)
  await expect.poll(() => tabs.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await page.locator('#videosTab .tabLabel').evaluate(label => {
    label.dataset.label = 'A very long translated video tab label'
    label.firstElementChild.textContent = label.dataset.label
  })
  await expectFullLabels()
  await expect(page.locator('#videosTab .tabLabel > span')).toHaveCSS('text-overflow', 'clip')
  await tabs.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await page.evaluate(async () => {
    const store = window.$store
    await Promise.all(['Shorts', 'Playlists', 'Community', 'Releases', 'Podcasts', 'Courses']
      .map(tab => store.dispatch(`updateHideChannel${tab}`, true)))
  })
  await expectFullLabels()
  await tabs.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await page.locator('#videosTab .tabLabel').evaluate(label => {
    label.dataset.label = 'Videos'
    label.firstElementChild.textContent = 'Videos'
  })
  await expectFullLabels()
  await expect.poll(() => tabs.evaluate(element => ({
    range: element.scrollWidth - element.clientWidth,
    offset: element.scrollLeft
  }))).toEqual({ range: 0, offset: 0 })
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  await expect(page.locator('#videosTab .channelTabIcon')).toBeVisible()
})

test('clamps channel tab scrolling after resize and locale changes', async ({ app, page }) => {
  const tabs = page.locator('.channelDetails:visible .tabs')
  for (const [width, locale] of [[375, 'de-DE'], [375, 'en-US'], [1600, 'en-US'], [375, 'ar'], [1600, 'ar']]) {
    await tabs.evaluate(element => { element.scrollLeft = getComputedStyle(element).direction === 'rtl' ? -element.scrollWidth : element.scrollWidth })
    await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
    await page.evaluate(locale => { document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale = locale }, locale)
    await expectAligned(page)
    await expectTabScrollRange(tabs)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThan(2)
  }
})

test('handles quick switches, search, background tabs, and reduced motion', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('aboutTab').click()
    queueMicrotask(() => document.getElementById('shortsTab').click())
  })
  await expect(page.locator('#shortsTab')).toHaveAttribute('aria-selected', 'true')
  await expectAligned(page)

  await page.locator('#shortsTab').press('ArrowRight')
  await expect(page.locator('#liveTab')).toHaveAttribute('aria-selected', 'true')
  await expectAligned(page)

  await page.locator('.channelSearch input').fill('animation')
  await page.locator('.channelSearch input').press('Enter')
  await expect(page.locator(indicatorSelector)).toHaveCount(0)
  await page.locator('#aboutTab').click()
  await expectAligned(page)

  const channelTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
  await page.locator(sel.newTabButton).click()
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateHideChannelShorts', true)
  })
  await page.locator(`.tab[data-tab-id="${channelTabId}"]`).click()
  await expectAligned(page)
  expect(await page.locator(indicatorSelector).evaluate(tabHighlightAnimations)).toEqual([])

  await page.evaluate(async () => {
    await window.$store.dispatch('updateReducedMotion', 'on')
  })
  await page.locator('#videosTab').click()
  await expectAligned(page)
  await expectTabHighlightStyle(page.locator(indicatorSelector), 'transitionProperty', 'none')
  expect(await page.locator(indicatorSelector).evaluate(tabHighlightAnimations)).toEqual([])
})

test('desktop channel tabs size to their content and show icons in both packs', async ({ app, page }, testInfo) => {
  for (const pack of ['material', 'remix']) {
    await page.evaluate(pack => window.$store.dispatch('updateIconPack', pack), pack)
    const tabs = page.locator('.channelDetails:visible [role="tab"]')
    for (const tab of await tabs.all()) {
      await expect(tab.locator('.ft-icon__glyph')).toBeVisible()
      const spacing = await tab.evaluate(element => {
        const label = element.querySelector('.tabLabel').getBoundingClientRect()
        const icon = element.querySelector('.ft-icon').getBoundingClientRect()
        return element.getBoundingClientRect().width - label.width - icon.width
      })
      expect(spacing).toBeCloseTo(38, 0)
    }
    await expectAligned(page)
    await captureAppFramebuffer(app, testInfo, `channel-tab-icons-${pack}`)
  }
})

test.describe(() => {
  test.use({ seed: { settings } })

  test('hides channel icons when the gaps would otherwise make the row overflow', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 900))
    const tabs = page.locator('.channelDetails:visible .tabs')
    await tabs.evaluate(container => { container.style.cssText = 'flex: none; inline-size: 1200px' })
    await expect(page.locator('#videosTab .channelTabIcon')).toBeVisible()
    const widthWithIcons = await tabs.evaluate(container => {
      const content = container.querySelector('.tabsContent')
      const buttons = [...content.querySelectorAll('.tab')]
      const width = buttons.reduce((sum, tab) => sum + tab.getBoundingClientRect().width, 0)
      const gaps = (buttons.length - 1) * parseFloat(getComputedStyle(content).columnGap)
      container.style.flex = 'none'
      container.style.inlineSize = `${width + gaps / 2}px`
      return width + gaps
    })
    await expect(page.locator('#videosTab .channelTabIcon')).toBeHidden()
    await expect.poll(() => tabs.evaluate(container => container.scrollWidth - container.clientWidth)).toBeLessThanOrEqual(1)
    await expectAligned(page)
    if (uiScale === 100) {
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        await captureAppFramebuffer(app, testInfo, `channel-tabs-fit-${colorScheme}`)
      }
    }
    await tabs.evaluate((container, width) => { container.style.inlineSize = `${width + 2}px` }, widthWithIcons)
    await expect(page.locator('#videosTab .channelTabIcon')).toBeVisible()
    await expect.poll(() => tabs.evaluate(container => container.scrollWidth - container.clientWidth)).toBeLessThanOrEqual(1)
  })

  test('channel panel and document keyboard navigation crossfade the selected highlight', { tag: '@scale' }, async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('updateAnimationSpeed', 25))
    for (const source of ['body', 'panel', 'appTab']) {
      await page.locator('#videosTab').click()
      await expectAligned(page)
      if (source === 'body') await page.evaluate(() => document.activeElement.blur())
      else if (source === 'panel') {
        await page.locator('#aboutTab').click()
        await expectAligned(page)
        await page.locator('[role="tabpanel"][aria-labelledby="aboutTab"]').evaluate(panel => { panel.tabIndex = -1; panel.focus() })
      } else await page.locator('.tab[data-tab-id].active').click()
      expect(await page.evaluate(source => {
        const focused = document.activeElement
        if (source === 'body') return focused === document.body
        return focused.matches(source === 'panel' ? '[role="tabpanel"]' : '.tab[data-tab-id]')
      }, source)).toBe(true)
      await page.locator('.channelDetails:visible .materialTabs').evaluate(container => {
        window.__panelTabTransitions = []
        const capture = event => {
          if (event.propertyName !== 'opacity' || event.pseudoElement !== '::before') return
          window.__panelTabTransitions.push(event.propertyName)
          container.removeEventListener('transitionrun', capture)
        }
        container.addEventListener('transitionrun', capture)
      })
      await page.keyboard.press('ArrowRight')
      await expect(page.locator(source === 'panel' ? '#videosTab' : '#shortsTab')).toHaveAttribute('aria-selected', 'true')
      await expect.poll(() => page.evaluate(() => window.__panelTabTransitions)).toContain('opacity')
      await expectAligned(page)
    }
  })

  test('channel search restores highlights immediately unless a tab is deliberately selected', { tag: '@scale' }, async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('updateAnimationSpeed', 25))
    const search = page.locator('.channelSearch input')
    for (const key of [null, 'Enter', ' ']) {
      await search.fill('animation')
      await search.press('Enter')
      await expect(page.locator(indicatorSelector)).toHaveCount(0)
      expect(await page.locator('.channelDetails:visible [role="tab"]').evaluateAll(tabs => tabs.some(tab =>
        tab.getAnimations({ subtree: true }).some(animation => animation instanceof CSSTransition && animation.transitionProperty === 'opacity' && animation.effect.target === tab && animation.effect.pseudoElement === '::before')
      ))).toBe(false)
      expect(await selectTabWithHighlightAnimation(page.locator('#aboutTab'), key)).toEqual({ property: 'opacity', playbackRate: 0.25, duration: 140 })
      await expectAligned(page)
    }

    await search.fill('animation')
    await search.press('Enter')
    await expect(page.locator(indicatorSelector)).toHaveCount(0)
    const restored = await search.evaluate(async input => {
      input.value = ''
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
      // Measure on the first frame that renders the tabs again; slow runners can need more than one.
      let tab
      for (let frame = 0; frame < 60 && !tab; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        tab = [...document.querySelectorAll('.channelDetails [role="tab"][aria-selected="true"]')].find(tab => tab.getClientRects().length > 0)
      }
      if (!tab) return 'selected tab was not restored'
      return {
        opacity: getComputedStyle(tab, '::before').opacity,
        transitions: tab.getAnimations({ subtree: true }).filter(animation =>
          animation instanceof CSSTransition && animation.transitionProperty === 'opacity').length
      }
    })
    expect(restored).toEqual({ opacity: '1', transitions: 0 })
  })
})

test('clearing the channel search right after searching does not reload the channel', async ({ page }) => {
  const reloads = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/channels/') && !url.pathname.endsWith('/search')) reloads.push(url.pathname)
  })
  const search = page.locator('.channelSearch input')
  for (let attempt = 0; attempt < 10; attempt++) {
    await search.fill('animation')
    // Clear before the search's route replacement settles, so both replacements overlap.
    await search.evaluate(input => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      input.value = ''
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await expect(page).not.toHaveURL(/searchQueryText=/)
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  }
  expect(reloads).toEqual([])
})
