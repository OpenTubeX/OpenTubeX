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
  await expect.poll(() => list.evaluate(element => {
    return getComputedStyle(element, '::-webkit-scrollbar').inlineSize
  })).toBe('10px')
})
