import { test, expect, goTo, sel } from '../../helpers/app.mjs'

// The page's own scrollbars are the ones appended to the body.
const PAGE_SCROLLBAR = 'body > .os-scrollbar-vertical'

/** The assertions below only mean anything once there is something to scroll. */
const pageOverflows = (page) => page.evaluate(
  () => document.documentElement.scrollHeight > window.innerHeight
)

test.describe('overlay scrollbars', () => {
  test('the main scroll container reserves no layout space for its scrollbar', async ({ page }) => {
    await goTo(page, 'settings')
    await expect.poll(() => pageOverflows(page)).toBe(true)

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

  test('clicking the track jumps to that position', async ({ page }) => {
    await goTo(page, 'settings')
    // Otherwise there is nothing to scroll and the assertion below would fail
    // whether or not click scrolling works.
    await expect.poll(() => pageOverflows(page)).toBe(true)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    // Needs the ClickScrollPlugin to be registered; without it the library
    // ignores clickScroll and the track does nothing.
    const track = page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-track`)
    const box = await track.boundingBox()

    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20)
    await page.mouse.down()
    await page.mouse.up()

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test('dragging the page handle scrolls the document', async ({ page }) => {
    await goTo(page, 'settings')
    await expect.poll(() => pageOverflows(page)).toBe(true)

    const handle = page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`)
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 10 })
    await page.mouse.up()

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test.describe('a nested scroll container', () => {
    const now = Date.now()
    test.use({
      seed: {
        settings: { enableSearchSuggestions: false },
        searchHistory: Array.from({ length: 25 }, (_, index) => ({
          _id: `search ${index + 1}`,
          lastUpdatedAt: now - index
        }))
      }
    })

    test('stays the scrolling element, so scrollTop keeps working', async ({ page }) => {
      await page.locator(sel.searchInput).click()
      const list = page.locator('.topNav .searchContainer .options .list')
      await expect(list).toBeVisible()

      const measurements = await list.evaluate((element) => {
        const overflows = element.scrollHeight > element.clientHeight
        element.scrollTop = 120
        return {
          overflows,
          noLayoutCost: element.clientWidth === element.offsetWidth,
          scrollTop: element.scrollTop
        }
      })

      expect(measurements.overflows).toBe(true)
      expect(measurements.noLayoutCost).toBe(true)
      expect(measurements.scrollTop).toBe(120)
    })
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
