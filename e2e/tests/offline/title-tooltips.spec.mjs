import { test, expect } from '../../helpers/app.mjs'

const menuButton = '.topNav .menuButton'

test.describe('title tooltips', () => {
  test('replace the native tooltip with a themed one below the element @scale', async ({ page }) => {
    const button = page.locator(menuButton)
    const tooltip = page.locator('.ftTitleTooltip')
    await expect(button).toHaveAttribute('title', 'Expand side navigation')

    await button.hover()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText('Expand side navigation')
    // An empty title hides the native tooltips of the element and its ancestors
    await expect(button).toHaveAttribute('title', '')

    const [buttonBox, tooltipBox, viewport] = await Promise.all([
      button.boundingBox(),
      tooltip.boundingBox(),
      page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    ])
    expect(tooltipBox.y).toBeGreaterThan(buttonBox.y + buttonBox.height)
    expect(tooltipBox.x).toBeGreaterThanOrEqual(0)
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width)

    const colors = await tooltip.evaluate(element => {
      const style = getComputedStyle(element)
      const probe = document.createElement('div')
      probe.style.cssText = 'background-color: var(--card-bg-color); color: var(--primary-text-color)'
      document.body.append(probe)
      const expected = getComputedStyle(probe)
      const result = {
        background: style.backgroundColor,
        color: style.color,
        expectedBackground: expected.backgroundColor,
        expectedColor: expected.color
      }
      probe.remove()
      return result
    })
    expect(colors.background).toBe(colors.expectedBackground)
    expect(colors.color).toBe(colors.expectedColor)

    await page.mouse.move(600, 600)
    await expect(tooltip).toBeHidden()
    await expect(button).toHaveAttribute('title', 'Expand side navigation')
  })

  test('stay centered below the element while the pointer moves over it @scale', async ({ page }) => {
    const navOption = page.locator('.sideNav .navOption[href="#/userplaylists"]:visible')
    const tooltip = page.locator('.ftTitleTooltip')
    const box = await navOption.boundingBox()
    // Wider than an icon button, so it used to move the tooltip along with the pointer
    expect(box.width).toBeGreaterThan(64)

    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await expect(tooltip).toBeVisible()
    const before = await tooltip.boundingBox()
    expect(before.y).toBeGreaterThan(box.y + box.height)
    // The side navigation touches the window edge, so the tooltip keeps an 8px margin
    const centeredLeft = Math.max(box.x + box.width / 2 - before.width / 2, 8)
    expect(Math.abs(before.x - centeredLeft)).toBeLessThanOrEqual(1)

    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 5 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await tooltip.boundingBox()).toEqual(before)
  })

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

  test('elements with an empty title hide the tooltip of their ancestors', async ({ page }) => {
    await page.evaluate(() => {
      const outer = document.createElement('div')
      outer.id = 'titleTooltipOuter'
      outer.title = 'Outer title'
      outer.style.cssText = 'position: fixed; inset-block-start: 300px; inset-inline-start: 300px; inline-size: 200px; block-size: 100px; z-index: 10'
      const inner = document.createElement('div')
      inner.id = 'titleTooltipInner'
      inner.title = ''
      inner.style.cssText = 'inline-size: 50px; block-size: 50px'
      outer.append(inner)
      document.body.append(outer)
    })
    const tooltip = page.locator('.ftTitleTooltip')

    await page.locator('#titleTooltipOuter').hover({ position: { x: 150, y: 80 } })
    await expect(tooltip).toHaveText('Outer title')

    // On a large element the tooltip opens below the pointer and stays there
    const before = await tooltip.boundingBox()
    expect(Math.abs(before.x + before.width / 2 - (300 + 150))).toBeLessThanOrEqual(1)
    expect(before.y).toBeGreaterThan(300 + 80)
    await page.mouse.move(300 + 110, 300 + 60, { steps: 5 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await tooltip.boundingBox()).toEqual(before)

    await page.locator('#titleTooltipInner').hover()
    await expect(tooltip).toBeHidden()
    await expect(page.locator('#titleTooltipOuter')).toHaveAttribute('title', 'Outer title')
  })
})
