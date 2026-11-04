import { test, expect } from '../../helpers/app.mjs'

test.describe('utility window dragging', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('follows the pointer, preserves scrolling, clamps, and saves its position', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 850, height: 520 })))
    for (const view of [null, 'about', 'downloads']) {
      await page.evaluate(view => window.$store.dispatch('showSettingsWindow', view), view)
      const dialog = page.locator('.settingsWindow')
      await expect(dialog).toBeVisible()
      await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
      const scroller = dialog.locator(view === 'about' ? '.settingsAboutPage' : view === 'downloads' ? '.settingsDownloadsPage' : '.settingsContent')
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
      await page.evaluate(view => window.$store.dispatch('showSettingsWindow', view), view)
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

test('preserves the rendered drag position on viewport resize and cleans up on cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 850, height: 520 }))
    return window.$store.dispatch('showSettingsWindow')
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

for (const gesture of [
  { name: 'dragging', handle: '.settingsWindowHeader', className: 'draggingSettingsWindow' },
  { name: 'resizing', handle: '.resize-se', className: 'resizingSettingsWindow' }
]) {
  test(`stops ${gesture.name} when the viewport forces a maximized layout`, { tag: '@scale' }, async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 850, height: 520 }))
      return window.$store.dispatch('showSettingsWindow')
    })
    const dialog = page.locator('.settingsWindow')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
    await dialog.evaluate((element, handle) => {
      element.querySelector(handle).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 600, clientY: 80 }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 800, clientY: 140 }))
    }, gesture.handle)
    await page.setViewportSize({ width: 375, height: 800 })
    await expect(dialog).toHaveClass(/maximized/)
    expect(await page.evaluate(className => document.documentElement.classList.contains(className), gesture.className)).toBe(false)
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 200, clientY: 300 })))
    const bounds = await dialog.boundingBox()
    expect(bounds.x).toBeCloseTo(0, 0)
    expect(bounds.y).toBeCloseTo(0, 0)
    expect(bounds.width).toBeCloseTo(await page.evaluate(() => window.visualViewport.width), 0)
  })
}

test('keeps following the pointer when a resize crosses the narrow layout breakpoint', { tag: '@scale' }, async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 800, height: 520 }))
    return window.$store.dispatch('showSettingsWindow')
  })
  const dialog = page.locator('.settingsWindow')
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
  const handle = await dialog.locator('.resize-se').boundingBox()
  const pointer = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const before = await dialog.boundingBox()
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  // Shrinking below 760px switches the settings layout, which rerenders the window.
  await page.mouse.move(pointer.x - 100, pointer.y, { steps: 10 })
  await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(before.width - 100, 0)
  await page.mouse.up()
  await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(before.width - 100, 0)
})

test('ignores a second pointer while a window gesture is active', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 100, y: 60, width: 850, height: 520 }))
    return window.$store.dispatch('showSettingsWindow')
  })
  const dialog = page.locator('.settingsWindow')
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
  const activeGestures = await dialog.evaluate(element => {
    const header = element.querySelector('.settingsWindowHeader')
    const handle = element.querySelector('.resize-se')
    const press = (target, pointerId) => target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId, clientX: 600, clientY: 80 }))
    const release = pointerId => window.dispatchEvent(new PointerEvent('pointerup', { pointerId }))
    const gestures = () => ['draggingSettingsWindow', 'resizingSettingsWindow']
      .filter(className => document.documentElement.classList.contains(className))
    const states = []
    for (const [first, other] of [[header, handle], [handle, header]]) {
      press(first, 1)
      press(other, 2)
      press(first, 3)
      // Only the pointer that started the gesture may end it.
      release(2)
      release(3)
      states.push(gestures())
      release(1)
      states.push(gestures())
    }
    return states
  })
  expect(activeGestures).toEqual([['draggingSettingsWindow'], [], ['resizingSettingsWindow'], []])
})
