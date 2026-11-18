import { test, expect } from '../../helpers/app.mjs'

const menuButton = '.topNav .menuButton'

test.describe('title tooltips', () => {
  test('follow title changes and restore the title on click', async ({ page }) => {
    const button = page.locator(menuButton)
    const tooltip = page.locator('.ftTitleTooltip')

    await button.hover()
    await expect(tooltip).toHaveText('Expand side navigation')

    // A click hides the tooltip and gives the title back while the pointer stays put
    await page.mouse.down()
    await expect(tooltip).toBeHidden()
    await expect(button).toHaveAttribute('title', 'Expand side navigation')
    await page.mouse.up()
    await expect(button).toHaveAttribute('title', 'Compact side navigation')

    // A title that changes while hovered is shown and restored with its new value
    await page.mouse.move(600, 600)
    await button.hover()
    await expect(tooltip).toHaveText('Compact side navigation')
    await button.evaluate(element => { element.title = 'Changed title' })
    await expect(tooltip).toHaveText('Changed title')
    await expect(button).toHaveAttribute('title', '')
    await page.mouse.move(600, 600)
    await expect(button).toHaveAttribute('title', 'Changed title')
  })

  test('keep the title available to assistive technology while it is held', async ({ page }) => {
    const tooltip = page.locator('.ftTitleTooltip')
    // The logo link has no other name source
    const logo = page.locator('.topNav .logo')
    const logoTitle = await logo.getAttribute('title')

    await logo.hover()
    await expect(tooltip).toHaveText(logoTitle)
    await expect(logo).toHaveAttribute('title', '')
    await expect(logo).toHaveAccessibleName(logoTitle)

    // An element named by aria-label keeps the title as its description
    const button = page.locator(menuButton)
    await button.hover()
    await expect(tooltip).toHaveText('Expand side navigation')
    await expect(button).toHaveAttribute('aria-description', 'Expand side navigation')
    await expect(logo).not.toHaveAttribute('aria-label')

    await page.mouse.move(600, 600)
    await expect(button).not.toHaveAttribute('aria-description')
    await expect(logo).toHaveAccessibleName(logoTitle)
  })
})
