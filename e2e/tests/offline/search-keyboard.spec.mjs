import { test, expect, sel, waitForAppReady } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      enableSearchSuggestions: false,
      keyboardShortcuts: JSON.stringify({
        APP: {
          GENERAL: {
            SEARCH_IN_NEW_WINDOW: 'ctrl+enter'
          }
        }
      })
    }
  }
})

test('Enter searches in place', async ({ page }) => {
  await page.locator(sel.searchInput).fill('enter search')
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(/#\/search\/enter%20search/)
})

test('Shift+Enter searches in a new window', async ({ app, page }) => {
  await page.locator(sel.searchInput).fill('shift enter search')

  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window'),
    page.locator(sel.searchInput).press('Shift+Enter')
  ])
  await waitForAppReady(newWindow)

  await expect(newWindow).toHaveURL(/#\/search\/shift%20enter%20search/)
  await expect(newWindow.locator('.navFilterButton')).not.toHaveClass(/filterChanged/)
  await expect(page).not.toHaveURL(/#\/search\//)
})
