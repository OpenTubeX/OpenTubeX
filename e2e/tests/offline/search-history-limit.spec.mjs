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

for (const scale of [1, 1.25]) {
  test(`mobile search rows and remove buttons have 48px touch targets at scale ${scale}`, async ({ app, page }) => {
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
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
      expect(await targets.evaluateAll(elements => Math.min(...elements.map(element => element.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(48)
      expect(await rows.locator('.removeButton').evaluateAll(elements => Math.min(...elements.map(element => element.getBoundingClientRect().width)))).toBeGreaterThanOrEqual(48)
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
    await expect.poll(() => rows.first().evaluate(element => element.getBoundingClientRect().height)).toBe(32)
    await expect.poll(() => list.evaluate(element => {
      const last = element.querySelector('li:last-of-type').getBoundingClientRect()
      return element.getBoundingClientRect().bottom - last.bottom - parseFloat(getComputedStyle(element).paddingBottom)
    })).toBeCloseTo(0, 0)
    await expect(list.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
    await cdp.detach()
  })
}

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
