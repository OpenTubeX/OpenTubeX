import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'
import { test, expect, sel } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const indicatorSelector = '.channelDetails:visible .tabsIndicator'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: 'https://invidious.test',
      reducedMotion: 'off',
      uiScale: 95
    }
  }
})

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
          tabs: ['videos', 'shorts', 'streams', 'playlists', 'posts', 'releases', 'podcasts', 'courses'],
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
  await expect.poll(() => page.locator(indicatorSelector).evaluate(indicator => {
    const line = indicator.getBoundingClientRect()
    const tab = indicator.parentElement.querySelector('.selectedTab').getBoundingClientRect()
    return Math.max(
      Math.abs(line.left - tab.left),
      Math.abs(line.width - tab.width),
      Math.abs(line.bottom - tab.bottom)
    )
  })).toBeLessThan(2)
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

test('hides channel tab icons before shortening labels when space is limited', async ({ app, page }, testInfo) => {
  for (const [width, scale] of [[375, 95], [812, 125], [1250, 100], [1600, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setSize(width, 900)
    }, width)
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    if (width === 1600) await expect(page.locator('#videosTab .channelTabIcon')).toBeVisible()
    else await expect(page.locator('#videosTab .channelTabIcon')).toBeHidden()
    await expect.poll(() => page.locator('.channelDetails:visible .tabLabel > span').evaluateAll(labels =>
      labels.every(label => label.scrollWidth <= label.clientWidth + 1 && getComputedStyle(label).textOverflow !== 'ellipsis')
    )).toBe(true)
    await expectAligned(page)
  }
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all(['Community', 'Releases', 'Courses'].map(tab => store.dispatch(`updateHideChannel${tab}`, true)))
    await store.dispatch('updateUiScale', 100)
  })
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(450, 900))
  await expect(page.locator('#videosTab .channelTabIcon')).toBeHidden()
  await expect.poll(() => page.locator('.channelDetails:visible .tabs').evaluate(container =>
    container.scrollWidth - container.clientWidth
  )).toBeLessThanOrEqual(1)
  await expectTabScrollRange(page.locator('.channelDetails:visible .tabs'))
  await captureAppFramebuffer(app, testInfo, 'channel-tabs-full-labels-without-icons')
})

test('keeps channel header rows evenly spaced below the banner', async ({ app, page }, testInfo) => {
  for (const [width, height, scale] of [[500, 1000, 100], [375, 812, 95], [812, 375, 125], [750, 900, 100], [1600, 900, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height)
    }, { width, height })
    await page.evaluate(value => {
      return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value)
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
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 100))
  await testInfo.attach('even channel header spacing', {
    body: await page.locator('.channelDetails:visible').screenshot(),
    contentType: 'image/png'
  })
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateHideSharingActions', true)
    await store.dispatch('updateHideUnsubscribeButton', true)
  })
  await expect(page.locator('.channelDetails:visible .infoActionsContainer')).toBeHidden()
  await expect.poll(() => page.locator('.channelDetails:visible').evaluate(header => {
    const info = header.querySelector('.thumbnailContainer').getBoundingClientRect()
    const search = header.querySelector('.channelSearch input').getBoundingClientRect()
    return Math.round(search.top - info.bottom)
  })).toBe(20)
})

test('collapses channel search to an accessible icon at narrow widths', async ({ app, page }) => {
  const input = page.locator('.channelSearch input')
  const toggle = page.getByRole('button', { name: 'Search Channel', exact: true })
  for (const [width, scale] of [[500, 100], [375, 95], [812, 125], [1600, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
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
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
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

test('keeps channel content rows 20px below the tabs', async ({ app, page }, testInfo) => {
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
      tabs: ['videos', 'shorts', 'streams', 'playlists', 'posts'],
      relatedChannels: [],
      videos,
      latestVideos: videos,
      playlists: [],
      comments: []
    }
  }))
  await page.reload()
  await expect(page.locator('.channel-view-all:visible')).toBeVisible()
  for (const [width, height, scale] of [[500, 1000, 100], [375, 812, 95], [812, 375, 125], [1600, 900, 95]]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height)
    }, { width, height })
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    for (const [tabId, contentSelector] of [
      ['videosTab', '.select-container'],
      ['shortsTab', '.select-container'],
      ['liveTab', '.select-container'],
      ['playlistsTab', '.elementList .message:visible'],
      ['communityTab', '.elementList .message:visible'],
      ['aboutTab', '#aboutPanel h2:first-child']
    ]) {
      await page.locator(`#${tabId}`).click()
      await expect(page.locator(contentSelector)).toBeVisible()
      if (tabId === 'videosTab') {
        expect(await page.locator('.select-container').evaluate(row => {
          const button = row.querySelector('.channel-view-all').getBoundingClientRect()
          const select = row.querySelector('.select-text').getBoundingClientRect()
          return Math.abs(button.top + button.height / 2 - select.top - select.height / 2)
        }), `View All center at ${width}px, ${scale}%`).toBeLessThanOrEqual(1)
      }
      await expect.poll(() => page.locator(contentSelector).evaluate(content => {
        const tabs = document.querySelector('.channelDetails .tabs').getBoundingClientRect()
        return Math.round(content.getBoundingClientRect().top - tabs.bottom)
      }), { message: `20px gap to ${tabId} content at ${width}px and ${scale}% UI scale` }).toBe(20)
    }
  }
  await page.locator('#videosTab').click()
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(500, 1000))
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateUiScale', 100)
    await store.dispatch('updateBaseTheme', 'system')
  })
  await page.mouse.move(0, 0)
  await page.evaluate(() => document.activeElement?.blur())
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
    await page.locator('.channelSearchToggle .iconButton').evaluate(button => {
      for (const animation of button.getAnimations()) animation.finish()
    })
    await captureAppFramebuffer(app, testInfo, `channel-controls-${colorScheme}`)
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

test('slides the active channel line with the feed timing and configured animation speed', async ({ page }) => {
  for (const [speed, tabId, duration] of [[100, 'aboutTab', 200], [200, 'videosTab', 100], [50, 'shortsTab', 400]]) {
    await page.evaluate(value => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAnimationSpeed', value)
    }, speed)
    const elapsed = await page.locator(indicatorSelector).evaluate((indicator, tabId) => new Promise(resolve => {
      indicator.addEventListener('transitionend', event => {
        resolve(event.elapsedTime * 1000)
      }, { once: true })
      document.getElementById(tabId).click()
    }), tabId)
    expect(elapsed).toBeCloseTo(duration, 0)
    await expect(page.locator(indicatorSelector)).toHaveCSS('transition-property', 'transform')
    await expectAligned(page)
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
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAnimationSpeed', 25)
  })
  async function expectImmediateAlignment() {
    await expect.poll(() => page.locator(indicatorSelector).evaluate(indicator => {
      const line = indicator.getBoundingClientRect()
      const tab = indicator.parentElement.querySelector('.selectedTab').getBoundingClientRect()
      return {
        aligned: Math.abs(line.left - tab.left) < 2 && Math.abs(line.width - tab.width) < 2,
        animations: indicator.getAnimations().length,
        transition: getComputedStyle(indicator).transitionProperty
      }
    }), { timeout: 1000 }).toEqual({ aligned: true, animations: 0, transition: 'none' })
  }
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(812, 900)
  })
  await expectImmediateAlignment()
  await page.evaluate(() => {
    return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 125)
  })
  await expectImmediateAlignment()
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale = 'ar'
  })
  await expect(page.locator('body')).toHaveAttribute('dir', 'rtl')
  await expectImmediateAlignment()
  await page.evaluate(() => {
    return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateHideChannelShorts', true)
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
      return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value)
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
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiRoundness', value)
    }, roundness)
    await expect.poll(() => page.locator(indicatorSelector).evaluate(element => {
      const style = getComputedStyle(element)
      const [horizontal, vertical = horizontal] = style.borderTopLeftRadius.split(' ').map(Number.parseFloat)
      return {
        horizontal: Math.round(horizontal * new DOMMatrixReadOnly(style.transform).a * 100) / 100,
        vertical
      }
    })).toEqual({ horizontal: 1.5 * roundness / 100, vertical: 1.5 * roundness / 100 })
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateHideChannelShorts', true)
  })
  await page.locator(`.tab[data-tab-id="${channelTabId}"]`).click()
  await expectAligned(page)
  expect(await page.locator(indicatorSelector).evaluate(element => element.getAnimations().length)).toBe(0)

  await page.evaluate(async () => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'on')
  })
  await page.locator('#videosTab').click()
  await expectAligned(page)
  await expect(page.locator(indicatorSelector)).toHaveCSS('transition-property', 'none')
  expect(await page.locator(indicatorSelector).evaluate(element => element.getAnimations().length)).toBe(0)
})

test('desktop channel tabs size to their content and show icons in both packs', async ({ app, page }, testInfo) => {
  for (const pack of ['material', 'remix']) {
    await page.evaluate(pack => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', pack), pack)
    const tabs = page.locator('.channelDetails:visible [role="tab"]')
    for (const tab of await tabs.all()) {
      await expect(tab.locator('.ft-icon__glyph')).toBeVisible()
      const spacing = await tab.evaluate(element => {
        const label = element.querySelector('.tabLabel').getBoundingClientRect()
        const icon = element.querySelector('.ft-icon').getBoundingClientRect()
        return element.getBoundingClientRect().width - label.width - icon.width
      })
      expect(spacing).toBeCloseTo(36, 0)
    }
    await expectAligned(page)
    await captureAppFramebuffer(app, testInfo, `channel-tab-icons-${pack}`)
  }
})
