import { test, expect, goTo, sel } from '../../helpers/app.mjs'

test.describe('distraction and appearance settings', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        hideEndScreenAnnotations: true,
        hideTrendingVideos: true,
        hideProfileSelectorInHeader: true
      }
    }
  })

  test('hidden UI elements stay hidden and the theme applies', async ({ page }) => {
    // Trending is removed from the side nav entirely.
    await expect(page.locator(sel.sideNavLink('trending'))).toHaveCount(0)

    // Fork feature: the profile selector can be hidden from the header (7e8223dba).
    await expect(page.locator('.topNav .profiles .colorOption')).toHaveCount(0)

    // The base theme is applied as a class on <body>.
    await expect(page.locator('body')).toHaveClass(/dark/)

    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Hide End-Screen Annotations' })).toBeChecked()
  })
})

test.describe('default appearance', () => {
  test('trending link and profile selector are visible by default', async ({ page }) => {
    // The link may live in the side nav itself or its "More" flyout,
    // depending on the collapsed state — either way it must exist.
    await expect(page.locator(sel.sideNavLink('trending'))).not.toHaveCount(0)
    await expect(page.locator('.topNav .profiles .colorOption').first()).toBeVisible()
    await expect(page.locator('body')).toHaveClass(/system/)
  })
})
