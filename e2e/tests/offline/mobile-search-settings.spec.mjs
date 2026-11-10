import { test, expect, goTo, sel, setWindowSize } from '../../helpers/app.mjs'

const getVideoMetadataGap = locator => locator.evaluate(element => {
  const textBounds = (selector) => {
    const range = document.createRange()
    range.selectNodeContents(element.querySelector(selector))
    return range.getBoundingClientRect()
  }
  return textBounds('.channelNameText').top - textBounds('.title').bottom
})

test.describe('mobile search and settings', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { currentLocale: 'en-US', useDeArrowTitles: true } } })

  test('settings categories and search matches have roomy touch targets', async ({ page, app }) => {
    await setWindowSize(app, page, { width: 460, height: 850 })
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await goTo(page, 'settings')
    const actions = page.locator('.settingsHeaderActions')
    await expect.poll(() => actions.locator('button').evaluateAll(buttons => {
      const bounds = buttons.map(button => button.getBoundingClientRect()).filter(rect => rect.width > 0)
      return bounds.every((rect, index) => index === 0 || rect.left - bounds[index - 1].right >= 7.99)
    })).toBe(true)
    const category = page.locator('.settingsMenu .title[data-section="appearance"]')
    await expect(category).toBeVisible()
    await expect(category.locator('..')).toHaveCSS('min-block-size', '64px')
    expect((await category.boundingBox()).height).toBeGreaterThanOrEqual(64)
    await category.click({ position: { x: 12, y: 4 } })
    await expect(page.locator('.settingsContent > [data-section="appearance"]')).toBeVisible()
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await search.fill('Display Titles Without')
    const buttons = page.locator('.settingsSearchResultHeading, .settingsSearchResultMatch')
    await expect(buttons.first()).toBeVisible()
    expect(await buttons.evaluateAll(elements => Math.min(...elements.map(el => el.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(47.99)
    expect(await buttons.evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true)
    const longLabel = page.locator('.settingsSearchResultMatch').filter({ hasText: 'Display Titles Without Excessive Capitalisation And Punctuation' })
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
      const store = window.$store
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
    await page.evaluate(() => window.$store.dispatch('updateListType', 'grid'))
    const desktopTextGap = await getVideoMetadataGap(page.locator('.ft-list-item .info').first())

    const touchSession = await page.context().newCDPSession(page)
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    expect(await page.locator('.playlistIcons button').first().evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(48)
    await touchSession.detach()

    await setWindowSize(app, page, { width: 460, height: 850 })
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const mobileTextGap = await getVideoMetadataGap(page.locator('.ft-list-item .info').first())
    expect(mobileTextGap).toBeLessThanOrEqual(desktopTextGap + 1)

    for (const listType of ['grid', 'list']) {
      await page.evaluate(value => window.$store.dispatch('updateListType', value), listType)
      await expect(page.locator('.ft-list-item').first()).toHaveClass(new RegExp(listType))
      if (listType === 'list') {
        await expect(page.locator('.autoGrid > .list').first()).toHaveCSS('min-block-size', '131px')
      }
      const titleBounds = await title.boundingBox()
      const channelBounds = await channel.boundingBox()
      expect(channelBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height - 0.01)
      // Fractional UI scales can round a 48px target just below 48.
      expect(await page.locator('.ft-list-item .optionsButton .iconButton, .ft-list-item .deArrowToggleButton').evaluateAll(elements => elements.every(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.width >= 47.99 && bounds.height >= 47.99
      }))).toBe(true)
      expect(await page.locator('.ft-list-item .title, .ft-list-item a.channelName').evaluateAll(elements => elements.every(element => {
        const target = getComputedStyle(element, '::before')
        return parseFloat(target.width) >= 47.99 && parseFloat(target.height) >= 47.99
      }))).toBe(true)
    }
    await expect(page.locator('.playlistIcons')).toBeHidden()
    const thumbnail = page.locator('.thumbnailLink').first()
    const bounds = await thumbnail.boundingBox()
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
    })
    const actions = page.locator('.mobileThumbnailActionRow')
    await expect(actions).toBeVisible()
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const rows = page.locator('.mobileLinkQuickActions')
    await expect(rows).toHaveCount(2)
    expect((await rows.nth(1).boundingBox()).y).toBeGreaterThan((await rows.first().boundingBox()).y)
    await expect(actions.getByRole('menuitemcheckbox', { name: 'Add to Favorites', checked: false })).toBeVisible()
    await actions.getByRole('menuitemcheckbox', { name: 'Add to Favorites', checked: false }).click()
    await expect(page.locator('.mobileLinkActions')).toHaveCount(0)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
    })
    await expect(actions).toBeVisible()
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(actions.getByRole('menuitemcheckbox', { name: 'Remove from Favorites', checked: true })).toBeVisible()

    const save = actions.getByRole('menuitem', { name: 'Save, Add to Playlist', exact: true })
    await expect(save).toBeVisible()
    await save.click()
    await expect(page.locator('.mobileLinkActions')).toHaveCount(0)
    await expect(page.locator('.mobileSheet[open] .playlistSearch')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.mobileSheet[open]')).toHaveCount(0)
    await page.locator('.deArrowToggleButton').click({ position: { x: 4, y: 24 } })
    await expect(title).toHaveText('Short title')
    await channel.click({ position: { x: 12, y: 4 } })
    await expect(page).toHaveURL(/#\/channel\/UCtouch/)
    await session.detach()
  })
})
