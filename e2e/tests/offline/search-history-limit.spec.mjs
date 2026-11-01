import { test, expect, sel, setWindowSize } from '../../helpers/app.mjs'

const now = Date.now()
const entries = Array.from({ length: 25 }, (_, index) => ({
  _id: `search ${String(index + 1).padStart(2, '0')}`,
  lastUpdatedAt: now - index
}))

test.use({
  seed: {
    settings: { enableSearchSuggestions: false },
    searchHistory: entries
  }
})

test('mobile search rows and remove buttons have 48px touch targets', { tag: '@scale' }, async ({ app, page }) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  for (const size of [{ width: 375, height: 850 }, { width: 850, height: 460 }]) {
    await setWindowSize(app, page, size)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    if (!await page.locator(sel.searchInput).isVisible()) await page.locator('.navSearchButton').click()
    await page.locator(sel.searchInput).click()
    const rows = page.locator('.topNav .search .list li')
    await expect(rows).toHaveCount(entries.length)
    const targets = rows.locator('.optionWrapper, .removeButton')
    expect(await targets.evaluateAll(elements => Math.min(...elements.map(element => element.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(47.9)
    expect(await rows.locator('.removeButton').evaluateAll(elements => Math.min(...elements.map(element => element.getBoundingClientRect().width)))).toBeGreaterThanOrEqual(47.9)
  }
  const rows = page.locator('.topNav .search .list li')
  await rows.first().locator('.removeButton').click()
  await expect(rows).toHaveCount(entries.length - 1)

  // Returning to compact desktop rows must not leave empty space at the end.
  await setWindowSize(app, page, { width: 1000, height: 850 })
  const list = page.locator('.topNav .search .list')
  await list.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await expect.poll(() => rows.first().evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(32, 1)
  // Fractional UI scales can leave a subpixel offset at the scroll end.
  await expect.poll(() => list.evaluate(element => {
    const last = element.querySelector('li:last-of-type').getBoundingClientRect()
    return Math.abs(element.getBoundingClientRect().bottom - last.bottom - parseFloat(getComputedStyle(element).paddingBottom))
  })).toBeLessThanOrEqual(1)
  await expect(list.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
  await cdp.detach()
})

test('shows every saved search in a scrollable list', async ({ page }) => {
  await page.locator(sel.searchInput).click()

  const list = page.locator('.topNav .searchContainer .options .list')
  const suggestions = list.locator('li')

  await expect(suggestions).toHaveCount(entries.length)
  await expect(suggestions.first()).toContainText(entries[0]._id)
  await expect(suggestions.last()).toContainText(entries.at(-1)._id)
  await expect(list).toHaveCSS('overflow-y', 'scroll')
  await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  // The scrollbar is an overlay one, so it floats above the suggestions
  // instead of narrowing them.
  await expect.poll(() => list.evaluate(element => {
    return element.clientWidth === element.offsetWidth
  })).toBe(true)

  await list.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.locator(sel.searchInput).fill(entries.at(-1)._id)
  await expect(suggestions).toHaveCount(1)
  await expect.poll(() => list.evaluate(element => ({
    isOverflowing: element.scrollHeight > element.clientHeight,
    isScrollbarUsable: !element.querySelector(':scope > .os-scrollbar-vertical')
      .classList.contains('os-scrollbar-unusable'),
    scrollTop: element.scrollTop,
  }))).toEqual({
    isOverflowing: false,
    isScrollbarUsable: false,
    scrollTop: 0,
  })
})

test('shows the configured number of search rows within the window', { tag: '@scale' }, async ({ app, page }) => {
  await setWindowSize(app, page, { width: 1100, height: 1000 })
  await page.locator(sel.searchInput).click()

  const list = page.locator('.topNav .searchContainer .options .list')
  await expect(list.locator('li')).toHaveCount(entries.length)
  const visibleRows = () => list.evaluate(element => {
    const style = getComputedStyle(element)
    const rowsHeight = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    return rowsHeight / element.querySelector('li').getBoundingClientRect().height
  })
  const scrollToEnd = async () => {
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  }
  // A taller list shrinks the scroll range. The last row must still end at
  // the list's padding, and the scrollbar must match the new range.
  const expectValidScrollEnd = () => expect.poll(() => list.evaluate(element => {
    const isOverflowing = element.scrollHeight - element.clientHeight > 1
    const last = element.querySelector('li:last-of-type').getBoundingClientRect()
    const contentEnd = element.getBoundingClientRect().bottom - parseFloat(getComputedStyle(element).paddingBottom)
    return {
      // Fractional UI scales can leave a subpixel offset at the scroll end.
      endsAtPadding: Math.abs(contentEnd - last.bottom) <= 1,
      scrollTopInRange: element.scrollTop <= element.scrollHeight - element.clientHeight + 1,
      scrollbarMatchesRange: isOverflowing === !element.querySelector(':scope > .os-scrollbar-vertical')
        .classList.contains('os-scrollbar-unusable'),
    }
  })).toEqual({ endsAtPadding: true, scrollTopInRange: true, scrollbarMatchesRange: true })

  await expect.poll(visibleRows).toBeCloseTo(10, 1)
  await scrollToEnd()
  await page.evaluate(() => window.$store.dispatch('updateVisibleSearchSuggestions', 20))
  await expect.poll(visibleRows).toBeCloseTo(20, 1)
  await expectValidScrollEnd()

  // More rows than fit end the list above the bottom of the window.
  await page.evaluate(() => window.$store.dispatch('updateVisibleSearchSuggestions', 50))
  await setWindowSize(app, page, { width: 1000, height: 600 })
  await expect.poll(() => list.evaluate(element => {
    return window.innerHeight - element.getBoundingClientRect().bottom
  })).toBeGreaterThan(0)
  await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect.poll(visibleRows).toBeGreaterThan(10)

  // A taller window gives the list more room.
  await scrollToEnd()
  await setWindowSize(app, page, { width: 1100, height: 1000 })
  await expectValidScrollEnd()
})

test('removing a saved search resets the scrolled list to its rendered start', async ({ page }) => {
  await page.locator(sel.searchInput).click()

  const list = page.locator('.topNav .searchContainer .options .list')
  const suggestions = list.locator('li')
  await expect(suggestions).toHaveCount(entries.length)

  await list.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  const lastEntry = suggestions.last()
  await lastEntry.hover()
  await lastEntry.locator('.removeButton').click()

  await expect(suggestions).toHaveCount(entries.length - 1)
  await expect.poll(() => list.evaluate(element => ({
    isOverflowing: element.scrollHeight > element.clientHeight,
    isScrollbarUsable: !element.querySelector(':scope > .os-scrollbar-vertical')
      .classList.contains('os-scrollbar-unusable'),
    scrollTop: element.scrollTop,
  }))).toEqual({
    isOverflowing: true,
    isScrollbarUsable: true,
    scrollTop: 0,
  })
})

test.describe('a long search history', () => {
  const longEntries = Array.from({ length: 100 }, (_, index) => ({
    _id: `long search ${String(index + 1).padStart(3, '0')}`,
    lastUpdatedAt: now - index
  }))

  test.use({
    seed: {
      settings: { enableSearchSuggestions: false },
      searchHistory: longEntries
    }
  })

  test('renders saved searches as the list is scrolled', async ({ page }) => {
    await page.locator(sel.searchInput).click()

    const list = page.locator('.topNav .searchContainer .options .list')
    const suggestions = list.locator('li')
    await expect(suggestions).toHaveCount(40)

    await expect.poll(async () => {
      await list.evaluate(element => { element.scrollTop = element.scrollHeight })
      return suggestions.count()
    }).toBe(longEntries.length)
    await expect(suggestions.last()).toContainText(longEntries.at(-1)._id)
    await expect(suggestions.last().locator('.optionWrapper')).toHaveAttribute('href', /#\/search\/long%20search%20100/)
  })

  test('keyboard navigation reaches entries that are not rendered yet', async ({ page }) => {
    const input = page.locator(sel.searchInput)
    await input.click()

    const suggestions = page.locator('.topNav .searchContainer .options .list li')
    await expect(suggestions).toHaveCount(40)

    await input.press('ArrowUp')
    await expect(input).toHaveValue(longEntries.at(-1)._id)
    await expect(suggestions).toHaveCount(longEntries.length)
    await expect(suggestions.last()).toHaveClass(/hover/)

    await input.press('Enter')
    await expect(page).toHaveURL(/#\/search\/long%20search%20100/)
  })
})
