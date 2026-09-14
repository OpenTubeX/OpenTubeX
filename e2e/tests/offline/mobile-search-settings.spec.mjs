import { test, expect, goTo, sel, setWindowSize } from '../../helpers/app.mjs'

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
      expect((await category.boundingBox()).height).toBeGreaterThanOrEqual(64)
      await category.click({ position: { x: 12, y: 4 } })
      await expect(page.locator('.settingsContent > [data-section="appearance"]')).toBeVisible()
      const search = page.getByRole('searchbox', { name: 'Search settings' })
      await search.fill('Show')
      const buttons = page.locator('.settingsSearchResultHeading, .settingsSearchResultMatch')
      await expect(buttons.first()).toBeVisible()
      expect(await buttons.evaluateAll(elements => Math.min(...elements.map(el => el.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(47.99)
      expect(await buttons.evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true)
      await session.detach()
    })

    test('video search titles and channel links have separate touch targets', async ({ page, app }) => {
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
      await setWindowSize(app, page, { width: 460, height: 850 })
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      const title = page.locator('.ft-list-item .title').first()
      const channel = page.locator('.ft-list-item a.channelName').first()
      await expect(title).toHaveText('Clear title')
      await expect(page.locator('.deArrowToggleButton')).toBeVisible()
      for (const listType of ['grid', 'list']) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateListType', value), listType)
        await expect(page.locator('.ft-list-item').first()).toHaveClass(new RegExp(listType))
        const titleBounds = await title.boundingBox()
        const channelBounds = await channel.boundingBox()
        expect(titleBounds.height).toBeGreaterThanOrEqual(47.99)
        expect(channelBounds.height).toBeGreaterThanOrEqual(47.99)
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
