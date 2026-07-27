import { test, expect, goTo } from '../../helpers/app.mjs'

// The page's own scrollbars are the ones appended to the body.
const PAGE_SCROLLBAR = 'body > .os-scrollbar-vertical'

test.describe('overlay scrollbars', () => {
  test('the main scroll container reserves no layout space for its scrollbar', async ({ page }) => {
    await goTo(page, 'settings')

    // A classic scrollbar shrinks clientWidth below the viewport width, an
    // overlay one floats above the content and leaves the layout untouched.
    const { clientWidth, innerWidth } = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth
    }))

    expect(clientWidth).toBe(innerWidth)
  })

  test('the scrollbar hides once the pointer rests and follows it back', async ({ page }) => {
    await goTo(page, 'settings')
    const scrollbar = page.locator(PAGE_SCROLLBAR)

    await page.mouse.move(800, 400)
    await page.mouse.wheel(0, 300)
    await expect(scrollbar).toHaveCSS('opacity', '1')

    // Idle pointer: gone after the library's 1300ms auto hide delay.
    await expect(scrollbar).toHaveCSS('opacity', '0', { timeout: 5000 })

    await page.mouse.move(800, 500)
    await expect(scrollbar).toHaveCSS('opacity', '1')
  })

  test('the scrollbar handle picks up the theme', async ({ page }) => {
    await goTo(page, 'settings')
    await page.mouse.wheel(0, 300)

    await expect(page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`)).toHaveCSS(
      'background-color',
      // --scrollbar-color of the light theme
      'rgb(204, 204, 204)'
    )
  })

  test('nested scroll containers scroll themselves, so scrollTop keeps working', async ({ page }) => {
    const sideNavInner = page.locator('.sideNav .inner')

    await expect(sideNavInner).toHaveCSS('overflow-y', 'auto')
    expect(await sideNavInner.evaluate(element => element.clientWidth === element.offsetWidth)).toBe(true)
  })

  test('turning "Always Show Scrollbars" on keeps them visible while idle', async ({ page }) => {
    await goTo(page, 'settings')
    const scrollbar = page.locator(PAGE_SCROLLBAR)

    await page.mouse.move(800, 400)
    await page.mouse.wheel(0, 300)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300)

    const toggle = page.getByRole('checkbox', { name: 'Always Show Scrollbars' })
    await expect(toggle).not.toBeChecked()
    // The styled label covers the checkbox input, so click that instead.
    await page.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' }).click()
    await expect(toggle).toBeChecked()

    // The switch takes effect on the scrollbars that already exist, and
    // rebuilding them mustn't lose where the page was scrolled to.
    await page.mouse.move(400, 700)
    await page.waitForTimeout(2500)

    await expect(scrollbar).toBeVisible()
    await expect(scrollbar).toHaveCSS('opacity', '1')
    // Roughly, not exactly: flipping the switch also reflows the settings page
    // a little by revealing the "changed setting" indicator.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(250)
  })
})
