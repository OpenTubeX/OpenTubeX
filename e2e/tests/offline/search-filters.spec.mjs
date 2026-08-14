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

  await filterButton.click({ button: 'right' })

  await expect(filterButton).not.toHaveClass(/filterChanged/)
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
