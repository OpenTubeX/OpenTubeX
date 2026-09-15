import { test, expect, goTo, sel, setWindowSize } from '../../helpers/app.mjs'

const getVideoMetadataGap = locator => locator.evaluate(element => {
  const textBounds = (selector) => {
    const range = document.createRange()
    range.selectNodeContents(element.querySelector(selector))
    return range.getBoundingClientRect()
  }
  return textBounds('.channelNameText').top - textBounds('.title').bottom
})

const getChannelMetadataLayout = locator => locator.evaluate(element => {
  const line = element.querySelector('.infoLine').getBoundingClientRect()
  const handle = element.querySelector('.handle').getBoundingClientRect()
  const subscribers = element.querySelector('.subscriberCount').getBoundingClientRect()
  const titleRange = document.createRange()
  titleRange.selectNodeContents(element.querySelector('.h3Title'))
  const title = titleRange.getBoundingClientRect()
  const centerDifference = bounds => Math.abs(
    bounds.left + bounds.width / 2 - line.left - line.width / 2
  )
  return {
    metadataGap: handle.top - title.bottom,
    wrapped: subscribers.top > handle.top + 1,
    handleCenterDifference: centerDifference(handle),
    subscriberCenterDifference: centerDifference(subscribers),
    separator: getComputedStyle(element.querySelector('.subscriberCount'), '::before').content
  }
})

for (const uiScale of [100, 125]) {
  test.describe(`mobile search and settings at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale, useDeArrowTitles: true } } })

    test('settings categories and search matches have roomy touch targets', async ({ page, app }) => {
      await setWindowSize(app, page, { width: 460, height: 850 })
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await goTo(page, 'settings')
      const actions = page.locator('.settingsHeaderActions')
      expect(await actions.locator('button').evaluateAll(buttons => {
        const bounds = buttons.map(button => button.getBoundingClientRect())
        return bounds.every((rect, index) => index === 0 || rect.left - bounds[index - 1].right >= 7.99)
      })).toBe(true)
      const category = page.locator('.settingsMenu .title[data-section="appearance"]')
      await expect(category).toBeVisible()
      await expect(category.locator('..')).toHaveCSS('min-block-size', '64px')
      expect((await category.boundingBox()).height).toBeGreaterThanOrEqual(64)
      await category.click({ position: { x: 12, y: 4 } })
      await expect(page.locator('.settingsContent > [data-section="appearance"]')).toBeVisible()
      const search = page.getByRole('searchbox', { name: 'Search settings' })
      await search.fill('SponsorBlock API')
      const buttons = page.locator('.settingsSearchResultHeading, .settingsSearchResultMatch')
      await expect(buttons.first()).toBeVisible()
      expect(await buttons.evaluateAll(elements => Math.min(...elements.map(el => el.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(47.99)
      expect(await buttons.evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true)
      const longLabel = page.locator('.settingsSearchResultMatch').filter({ hasText: 'SponsorBlock API Url' })
      await expect(longLabel).toHaveCount(1)
      expect(await longLabel.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return new Set([...range.getClientRects()]
          .filter(rect => rect.width > 0)
          .map(rect => Math.round(rect.top))).size
      })).toBeGreaterThan(1)
      await session.detach()
    })

    test('keeps video search metadata as compact as desktop', async ({ page, app }) => {
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('addVideoToDeArrowCache', {
          videoId: 'touch-video', title: 'Clear title', thumbnail: null, thumbnailTimestamp: 10, videoDuration: 60
        })
        store.commit('addToSessionSearchHistory', {
          query: 'touch',
          data: [{ type: 'video', videoId: 'touch-video', title: 'Short title', author: 'Channel', authorId: 'UCtouch', lengthSeconds: 60, viewCount: 1, publishedText: 'Today', videoThumbnails: [] }],
          searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
          nextPageRef: null,
          hasMoreResults: false,
          apiUsed: 'local'
        })
      })
      await page.locator(sel.searchInput).fill('touch')
      await page.locator(sel.searchInput).press('Enter')
      const title = page.locator('.ft-list-item .title').first()
      const channel = page.locator('.ft-list-item a.channelName').first()
      await expect(title).toHaveText('Clear title')
      await expect(page.locator('.deArrowToggleButton')).toBeVisible()
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateListType', 'grid'))
      const desktopTextGap = await getVideoMetadataGap(title.locator('xpath=..'))

      await setWindowSize(app, page, { width: 460, height: 850 })
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      const mobileTextGap = await getVideoMetadataGap(title.locator('xpath=..'))
      expect(mobileTextGap).toBeLessThanOrEqual(desktopTextGap + 1)

      for (const listType of ['grid', 'list']) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateListType', value), listType)
        await expect(page.locator('.ft-list-item').first()).toHaveClass(new RegExp(listType))
        const titleBounds = await title.boundingBox()
        const channelBounds = await channel.boundingBox()
        expect(channelBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height - 0.01)
        // Fractional UI scales can round a 48px target just below 48.
        expect(await page.locator('.ft-list-item .iconButton, .ft-list-item .deArrowToggleButton').evaluateAll(elements => elements.every(element => {
          const bounds = element.getBoundingClientRect()
          return bounds.width >= 47.99 && bounds.height >= 47.99
        }))).toBe(true)
      }
      await page.locator('.deArrowToggleButton').click({ position: { x: 4, y: 24 } })
      await expect(title).toHaveText('Short title')
      await channel.click({ position: { x: 12, y: 4 } })
      await expect(page).toHaveURL(/#\/channel\/UCtouch/)
      await session.detach()
    })
  })
}

test.describe('mobile channel search metadata', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE', listType: 'grid' } } })

  test('centers wrapped metadata and hides its leading separator', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('addToSessionSearchHistory', {
        query: 'channels',
        data: [{
          type: 'channel',
          dataSource: 'local',
          id: 'UCmobilechannelresult1',
          name: 'Dinge Erklärt - Kurzgesagt',
          thumbnail: '',
          handle: '@KurzgesagtDE',
          subscribers: 2670000,
          descriptionShort: ''
        }],
        searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
        nextPageRef: null,
        hasMoreResults: false,
        apiUsed: 'local'
      })
    })
    await page.locator(sel.searchInput).fill('channels')
    await page.locator(sel.searchInput).press('Enter')

    const channel = page.locator('.ft-list-channel')
    const metadata = channel.locator('.infoLine')
    await expect(metadata).toBeVisible()
    const desktopLayout = await getChannelMetadataLayout(channel)
    expect(desktopLayout.wrapped).toBe(false)
    expect(desktopLayout.separator).not.toBe('none')

    await page.setViewportSize({ width: 504, height: 900 })
    await expect(channel).toHaveClass(/ft-list-channel/)
    await expect.poll(async () => (await getChannelMetadataLayout(channel)).separator).toBe('none')
    const mobileLayout = await getChannelMetadataLayout(channel)
    expect(mobileLayout.wrapped).toBe(true)
    expect(mobileLayout.metadataGap).toBeLessThanOrEqual(desktopLayout.metadataGap + 1)
    expect(mobileLayout.handleCenterDifference).toBeLessThanOrEqual(1)
    expect(mobileLayout.subscriberCenterDifference).toBeLessThanOrEqual(1)
  })
})
