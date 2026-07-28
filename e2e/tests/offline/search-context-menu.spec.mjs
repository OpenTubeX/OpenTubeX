import { test, expect, sel } from '../../helpers/app.mjs'

test('searching selected text in a new tab uses the default filters', async ({ page }) => {
  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'context search'
  }))
  const search = contextMenu.items.find(item => item.label === 'Search "context search" in a New Tab')

  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: search.actionId })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page).toHaveURL(/#\/search\/context%20search/)

  const filterButton = page.locator('.navFilterButton')
  await expect(filterButton).not.toHaveClass(/filterChanged/)
  await filterButton.click()

  await expect(page.locator('input[type="radio"][value="relevance"]')).toBeChecked()
  await expect(page.locator('input[type="radio"][value="all"]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Time' }).locator('input[value=""]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Duration' }).locator('input[value=""]')).toBeChecked()
})
