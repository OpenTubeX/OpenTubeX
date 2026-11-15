import { expectTabHighlightAligned, selectChannelTab } from '../../helpers/tabs.mjs'
import { test, expect } from '../../helpers/app.mjs'

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

/** Shown tabs sit in one row inside the container, which never scrolls. */
async function expectTabsFitRow(tabs) {
  await expect.poll(() => tabs.evaluate(container => {
    const viewport = container.getBoundingClientRect()
    const rects = [...container.querySelectorAll('[role="tab"]:not(.overflowedTab)')].map(tab => tab.getBoundingClientRect())
    const tolerance = 2 / devicePixelRatio
    const overflowed = container.querySelectorAll('.overflowedTab:not(.moreTab)').length
    return {
      noScrolling: container.scrollWidth <= container.clientWidth,
      oneRow: Math.max(...rects.map(rect => rect.top)) - Math.min(...rects.map(rect => rect.top)) < 1,
      inside: rects.every(rect => rect.left >= viewport.left - tolerance && rect.right <= viewport.right + tolerance),
      moreOnlyWithOverflow: !container.querySelector('#moreTab').classList.contains('overflowedTab') === (overflowed > 0),
      fullLabels: [...container.querySelectorAll('.tabLabel > span')].every(label => label.scrollWidth <= label.clientWidth + 1)
    }
  })).toEqual({ noScrolling: true, oneRow: true, inside: true, moreOnlyWithOverflow: true, fullLabels: true })
}

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

test('moves channel tabs that do not fit into a More menu', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
  // Selects and checks every tab at four widths, about 40 tab switches, which
  // outlasts the default timeout on a loaded machine.
  test.slow()
  const tabs = page.locator('.channelDetails:visible .tabs')
  const more = page.locator('.channelDetails:visible #moreTab')
  await page.evaluate(value => window.$store.dispatch('updateUiScale', value), uiScale)
  for (const [width, locale] of [[375, 'en-US'], [412, 'de-DE'], [760, 'en-US'], [412, 'ar']]) {
    await app.electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), Math.round(width * uiScale / 100))
    await page.evaluate(locale => { document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale = locale }, locale)
    await expectAligned(page)
    await expectTabsFitRow(tabs)
    await expect(more, `More tab at ${width}px in ${locale}`).toBeVisible()
    expect(await tabs.locator('[role="tab"]:not(.overflowedTab)').evaluateAll(elements =>
      elements.every(element => element.getBoundingClientRect().height > 47.5)
    ), 'Touch-sized tabs').toBe(true)
    // Every tab stays reachable: the shown ones directly, the rest from the menu,
    // where the More tab takes over the selected tab's label and highlight.
    for (const id of await tabs.locator('.tab:not(.moreTab)').evaluateAll(elements => elements.map(element => element.dataset.tab))) {
      await selectChannelTab(page, id)
      await expectAligned(page)
      await expectTabsFitRow(tabs)
    }
    await selectChannelTab(page, 'videos')
    await expect(more).toHaveAttribute('aria-selected', 'false')
  }

  await page.evaluate(() => { document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale = 'en-US' })
  await app.electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), Math.round(412 * uiScale / 100))
  await expectTabsFitRow(tabs)
  // Arrow keys still cycle through every tab; hidden ones focus the More tab.
  await page.locator('#videosTab').focus()
  const tabCount = await tabs.locator('.tab:not(.moreTab)').count()
  for (const key of ['ArrowLeft', ...Array(tabCount + 1).fill('ArrowRight')]) {
    await page.keyboard.press(key)
    await expect.poll(() => page.evaluate(() => {
      const focused = document.activeElement
      return focused?.getAttribute('aria-selected') === 'true' && focused.getClientRects().length > 0 &&
        getComputedStyle(focused).visibility === 'visible'
    }), `${key} focuses the selected, visible tab`).toBe(true)
    await expectAligned(page)
  }
  await expect(page.locator('#videosTab')).toHaveAttribute('aria-selected', 'true')
  await testInfo.attach('channel tabs with More menu', {
    body: await page.locator('.channelDetails:visible').screenshot(),
    contentType: 'image/png'
  })
})

test('keeps full channel labels and updates the More menu when labels or available tabs change', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(375, 812)
  })
  const tabs = page.locator('.channelDetails:visible .tabs')
  const more = page.locator('.channelDetails:visible #moreTab')
  await expectTabsFitRow(tabs)
  await expect(more).toBeVisible()
  await selectChannelTab(page, 'about')
  await expectAligned(page)
  await page.locator('#videosTab .tabLabel').evaluate(label => {
    label.dataset.label = 'A very long translated video tab label'
    label.firstElementChild.textContent = label.dataset.label
  })
  await expectTabsFitRow(tabs)
  await expect(page.locator('#videosTab .tabLabel > span')).toHaveCSS('text-overflow', 'clip')
  await expect(more).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(async () => {
    const store = window.$store
    await Promise.all(['Shorts', 'Playlists', 'Community', 'Releases', 'Podcasts', 'Courses']
      .map(tab => store.dispatch(`updateHideChannel${tab}`, true)))
  })
  await expectTabsFitRow(tabs)
  await page.locator('#videosTab .tabLabel').evaluate(label => {
    label.dataset.label = 'Videos'
    label.firstElementChild.textContent = 'Videos'
  })
  await expectTabsFitRow(tabs)
  await expect(more).toBeHidden()
  await expect(page.locator('#aboutTab')).toHaveAttribute('aria-selected', 'true')
  await expectAligned(page)
  await expect(page.locator('#videosTab .channelTabIcon')).toBeVisible()
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
