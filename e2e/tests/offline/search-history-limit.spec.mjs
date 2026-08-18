import { test, expect, sel } from '../../helpers/app.mjs'

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
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
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
    hasVisibleScrollbar: element.querySelector(':scope > .os-scrollbar-vertical')
      .classList.contains('os-scrollbar-visible'),
    isOverflowing: element.scrollHeight > element.clientHeight,
    scrollTop: element.scrollTop,
  }))).toEqual({
    hasVisibleScrollbar: true,
    isOverflowing: true,
    scrollTop: 0,
  })
})
