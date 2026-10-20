import { test, expect, sel } from '../../helpers/app.mjs'

test('right-clicking the search filter button clears active filters', async ({ page }) => {
  const searchInput = page.locator(sel.searchInput)
  const filterButton = page.locator('.navFilterButton')

  await searchInput.fill('keep this query')
  await filterButton.click()
  await page.locator('.searchRadio', { hasText: 'Prioritize' }).getByText('Popularity', { exact: true }).click()
  await page.locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
  await page.locator('.searchRadio', { hasText: 'Type' }).getByText('Videos', { exact: true }).click()
  await page.locator('.searchRadio', { hasText: 'Duration' }).getByText('3 - 20 minutes', { exact: true }).click()
  await page.locator('.searchRadio', { hasText: 'Features' }).getByText('HD', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(filterButton).toHaveClass(/filterChanged/)

  await filterButton.evaluate(element => {
    element.addEventListener('contextmenu', event => {
      element.dataset.contextMenuDefaultPrevented = String(event.defaultPrevented)
    }, { once: true })
  })
  await filterButton.click({ button: 'right' })

  await expect(filterButton).not.toHaveClass(/filterChanged/)
  await expect(filterButton).toHaveAttribute('data-context-menu-default-prevented', 'true')
  await expect(searchInput).toHaveValue('keep this query')
  await expect(page.getByRole('heading', { name: 'Search Filters' })).toBeHidden()
  await expect(page.getByRole('menu', { name: 'Context Menu' })).toBeHidden()

  await filterButton.click()
  await expect(page.locator('input[type="radio"][value="relevance"]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Time' }).locator('input[value=""]')).toBeChecked()
  await expect(page.locator('input[type="radio"][value="all"]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Duration' }).locator('input[value=""]')).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'HD', exact: true })).not.toBeChecked()
})

test('right-clicking the search filter button clears only the active tab', async ({ page }) => {
  const searchInput = page.locator(sel.searchInput)
  const filterButton = page.locator('.navFilterButton')

  await searchInput.fill('first tab query')
  await filterButton.click()
  await page.locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator(sel.newTabButton).click()
  await searchInput.fill('second tab query')
  await filterButton.click()
  await page.locator('.searchRadio', { hasText: 'Prioritize' }).getByText('Popularity', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator(sel.tabs).first().click()
  await expect(searchInput).toHaveValue('first tab query')
  await expect(filterButton).toHaveClass(/filterChanged/)
  await filterButton.click({ button: 'right' })
  await expect(filterButton).not.toHaveClass(/filterChanged/)

  await page.locator(sel.tabs).nth(1).click()
  await expect(searchInput).toHaveValue('second tab query')
  await expect(filterButton).toHaveClass(/filterChanged/)
  await filterButton.click()
  await expect(page.locator('input[type="radio"][value="popularity"]')).toBeChecked()
  await expect(page.locator('input[type="radio"][value="today"]')).not.toBeChecked()
})

test('desktop search filter options keep compact spacing', { tag: '@scale' }, async ({ page }, testInfo) => {
  await page.locator('.navFilterButton').click()
  const labels = page.locator('.searchRadio', { hasText: 'Type' }).locator('input + label')
  await expect(labels).toHaveCount(6)

  const tops = await labels.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top))
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i] - tops[i - 1]).toBeLessThan(32)
  }

  const overflow = await page.locator('.searchFiltersCard .promptContentScroller').evaluate(element => {
    const viewport = element.querySelector('[data-overlayscrollbars-viewport]') ?? element
    return viewport.scrollHeight - viewport.clientHeight
  })
  expect(overflow).toBeLessThanOrEqual(0)

  await page.locator('.searchFiltersCard').screenshot({ path: testInfo.outputPath('search-filters.png') })
})
