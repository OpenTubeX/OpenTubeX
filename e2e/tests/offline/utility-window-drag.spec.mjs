import { test, expect } from '../../helpers/app.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`utility window dragging at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', uiScale } } })

    test('follows the pointer, preserves scrolling, clamps, and saves its position', async ({ page }) => {
      await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 850, height: 520 })))
      for (const view of [null, 'about', 'downloads']) {
        await page.evaluate(view => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', view), view)
        const dialog = page.locator('.settingsWindow')
        await expect(dialog).toBeVisible()
        await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
        const scroller = dialog.locator(view ? '.settingsSubpageScroll' : '.settingsContent')
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        const scrollTop = await scroller.evaluate(element => element.scrollTop)
        const before = await dialog.boundingBox()
        const header = await dialog.locator('.settingsBreadcrumbLabel').first().boundingBox()
        const pointer = { x: header.x + header.width / 2, y: header.y + header.height / 2 }
        await page.mouse.move(pointer.x, pointer.y)
        await page.mouse.down()
        await page.mouse.move(pointer.x + 100, pointer.y + 40, { steps: 10 })
        await expect.poll(async () => {
          const after = await dialog.boundingBox()
          return Math.max(Math.abs(after.x - before.x - 100), Math.abs(after.y - before.y - 40))
        }).toBeLessThan(1)
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeCloseTo(scrollTop, 0)
        await page.mouse.up()
        await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('draggingSettingsWindow'))).toBe(false)
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opentubex-settings-window-bounds')).x))
          .toBeCloseTo(before.x + 100, 0)

        // Clamping still uses the actual viewport, including fractional zoom.
        const movedHeader = await dialog.locator('.settingsBreadcrumbLabel').first().boundingBox()
        await page.mouse.move(movedHeader.x + movedHeader.width / 2, movedHeader.y + movedHeader.height / 2)
        await page.mouse.down()
        await page.mouse.move(-500, -500)
        await page.mouse.up()
        const clamped = await dialog.boundingBox()
        expect(clamped.x).toBeCloseTo(12, 0)
        expect(clamped.y).toBeCloseTo(12, 0)
        expect(clamped.width).toBeCloseTo(before.width, 0)
        expect(clamped.height).toBeCloseTo(before.height, 0)

        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await page.evaluate(view => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', view), view)
        await expect(dialog).toBeVisible()
        await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
        const reopened = await dialog.boundingBox()
        expect(reopened.x).toBeCloseTo(clamped.x, 0)
        expect(reopened.y).toBeCloseTo(clamped.y, 0)
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(dialog).toHaveCount(0)
      }
    })
  })
}

test('preserves the rendered drag position on viewport resize and cleans up on cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 850, height: 520 }))
    return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow')
  })
  const dialog = page.locator('.settingsWindow')
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
  await dialog.evaluate(element => {
    element.querySelector('.settingsWindowHeader').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 600, clientY: 80 }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 800, clientY: 140 }))
  })
  await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(300, 0)
  await page.setViewportSize({ width: 1400, height: 850 })
  await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(300, 0)
  await expect.poll(async () => (await dialog.boundingBox()).y).toBeCloseTo(120, 0)
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 1000, clientY: 300 }))
  })
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('draggingSettingsWindow'))).toBe(false)
  await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(300, 0)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opentubex-settings-window-bounds')).x)).toBeCloseTo(300, 0)
})

test('stops dragging when the viewport forces a maximized layout', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 850, height: 520 }))
    return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow')
  })
  const dialog = page.locator('.settingsWindow')
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
  await dialog.evaluate(element => {
    element.querySelector('.settingsWindowHeader').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 600, clientY: 80 }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 800, clientY: 140 }))
  })
  await page.setViewportSize({ width: 375, height: 800 })
  await expect(dialog).toHaveClass(/maximized/)
  expect(await page.evaluate(() => document.documentElement.classList.contains('draggingSettingsWindow'))).toBe(false)
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 200, clientY: 300 })))
  const bounds = await dialog.boundingBox()
  expect(bounds.x).toBeCloseTo(0, 0)
  expect(bounds.y).toBeCloseTo(0, 0)
  expect(bounds.width).toBeCloseTo(375, 0)
})
