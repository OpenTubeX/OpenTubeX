import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false } } })

test('color picker stays within bounds on opening when neither side fits', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setWindowSize(app, page, { width: 1200, height: 650 })
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Create custom theme' }).click()
  await page.locator('.settingsWindow').getByRole('button', { name: 'Maximize', exact: true }).click()
  const trigger = page.locator('.customThemeEditor .colorFieldTrigger').first()
  await trigger.evaluate(button => {
    const scroller = button.closest('.colorGrid')
    const spacer = document.createElement('div')
    spacer.style.gridColumn = '1 / -1'
    spacer.style.blockSize = `${innerHeight * 2}px`
    scroller.prepend(spacer)
    scroller.append(spacer.cloneNode())
    const viewport = scroller.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const top = Math.max(viewport.top + 16, Math.min(innerHeight / 2, viewport.bottom - rect.height - 16))
    scroller.scrollTop += rect.top - top
  })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await trigger.evaluate(button => button.click())
  const popup = page.locator('.colorPickerPopover')
  await expect(popup).toBeVisible()
  expect(await popup.evaluate(menu => {
    const button = document.querySelector('.customThemeEditor .colorFieldTrigger').getBoundingClientRect()
    const height = menu.getBoundingClientRect().height
    return height < innerHeight - 24 && button.top - 20 < height && innerHeight - button.bottom - 20 < height
  }), 'the popup fits the viewport but neither side of the trigger').toBe(true)
  await expect.poll(() => popup.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return rect.top >= 11 && rect.bottom <= innerHeight - 11
  })).toBe(true)
})

async function moveTriggerToEdge(trigger, edge) {
  await trigger.evaluate((button, edge) => {
    const scroller = document.querySelector('.customThemeEditor .colorGrid')
    const viewport = scroller.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const targetTop = edge === 'top'
      ? Math.max(viewport.top, 0) + 32
      : Math.min(viewport.bottom, innerHeight) - rect.height - 32
    scroller.scrollTop += rect.top - targetTop
  }, edge)
  await expect.poll(() => trigger.evaluate((button, edge) => {
    const viewport = document.querySelector('.customThemeEditor .colorGrid').getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const targetTop = edge === 'top'
      ? Math.max(viewport.top, 0) + 32
      : Math.min(viewport.bottom, innerHeight) - rect.height - 32
    return Math.abs(rect.top - targetTop)
  }, edge)).toBeLessThanOrEqual(1)
}

async function expectPlacement(popup, side) {
  await expect.poll(() => popup.evaluate((menu, side) => {
    const button = document.querySelector('.customThemeEditor .colorFieldTrigger').getBoundingClientRect()
    const rect = menu.getBoundingClientRect()
    return side === 'above' ? button.top - rect.bottom : rect.top - button.bottom
  }, side)).toBeGreaterThanOrEqual(7)
}

for (const initialSide of ['below', 'above']) {
  test(`color picker flips from ${initialSide} after real ancestor scrolling`, { tag: '@scale' }, async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setWindowSize(app, page, { width: 1500, height: 1400 })
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Create custom theme' }).click()
    const settingsWindow = page.locator('.settingsWindow')
    await settingsWindow.getByRole('button', { name: 'Maximize', exact: true }).click()
    await expect(settingsWindow).toHaveClass(/maximized/)
    // Leave real scroll room on both sides without changing trigger geometry.
    await page.locator('.customThemeEditor .colorGrid').evaluate(element => {
      const spacer = document.createElement('div')
      spacer.style.gridColumn = '1 / -1'
      spacer.style.blockSize = `${innerHeight * 2}px`
      element.prepend(spacer)
      element.append(spacer.cloneNode())
    })
    const trigger = page.locator('.customThemeEditor .colorFieldTrigger').first()
    await moveTriggerToEdge(trigger, initialSide === 'below' ? 'top' : 'bottom')
    await trigger.evaluate(button => button.click())
    const popup = page.locator('.colorPickerPopover')
    await expect(popup).toBeVisible()
    await expectPlacement(popup, initialSide)
    const scroller = page.locator('.customThemeEditor .colorGrid')
    const initialScrollTop = await scroller.evaluate(element => element.scrollTop)

    await moveTriggerToEdge(trigger, initialSide === 'below' ? 'bottom' : 'top')
    expect(Math.abs(await scroller.evaluate(element => element.scrollTop) - initialScrollTop)).toBeGreaterThan(100)
    // The trigger stays visible, with enough space for the entire popup on
    // the opposite side. Clamping across the trigger is not a placement flip.
    await expectPlacement(popup, initialSide === 'below' ? 'above' : 'below')
    await expect.poll(() => popup.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return rect.top >= 11 && rect.bottom <= innerHeight - 11
    })).toBe(true)
  })
}
