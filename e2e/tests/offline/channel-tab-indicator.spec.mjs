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

test('keeps all tabs visible without scrolling after labels or available tabs change', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(375, 812)
  })
  const tabs = page.locator('.channelDetails:visible .tabs')
  async function expectAllTabsFit() {
    await expect.poll(() => tabs.evaluate(container => {
      const bounds = container.getBoundingClientRect()
      const tabs = [...container.querySelectorAll('[role="tab"]')].map(tab => tab.getBoundingClientRect())
      return {
        oneRow: Math.max(...tabs.map(tab => tab.top)) - Math.min(...tabs.map(tab => tab.top)) < 1,
        fit: tabs.every(tab => tab.left >= bounds.left - 1 && tab.right <= bounds.right + 1),
        noScroll: container.scrollWidth <= container.clientWidth + 1 && container.scrollLeft === 0
      }
    })).toEqual({ oneRow: true, fit: true, noScroll: true })
    await expectAligned(page)
  }
  await expectAllTabsFit()
  await page.locator('#aboutTab').click()
  await expectAllTabsFit()
  await page.locator('#videosTab .tabLabel').evaluate(label => {
    label.dataset.label = 'A very long translated video tab label'
    label.firstElementChild.textContent = label.dataset.label
  })
  await expectAllTabsFit()
  await expect(page.locator('#videosTab .tabLabel > span')).toHaveCSS('text-overflow', 'ellipsis')
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all(['Shorts', 'Playlists', 'Community', 'Releases', 'Podcasts', 'Courses']
      .map(tab => store.dispatch(`updateHideChannel${tab}`, true)))
  })
  await expectAllTabsFit()
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
