import { IpcChannels } from '../../../src/constants.js'
import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

const editors = [
  { name: 'quick setting categories', button: 'Customize quick settings', row: '.selectedSection', attribute: 'data-section-id' },
  { name: 'quick settings within a category', button: 'Customize quick settings', row: '[data-section-id="appearance"] .selectedSetting', attribute: 'data-setting-id' },
  { name: 'navigation', button: 'Customize navigation', row: '.selectedItem', attribute: 'data-navigation-item-id' },
  { name: 'fullscreen actions', button: 'Customize fullscreen actions', row: '.selectedAction', attribute: 'data-fullscreen-action-id' },
]

/** Return visible geometry with a useful failure instead of a null dereference. */
async function visibleBox(locator) {
  const box = await locator.boundingBox()
  expect(box, `Expected visible geometry for ${locator}`).not.toBeNull()
  return box
}

for (const [editor, method] of [
  [editors[0], 'pointer'],
  [editors[0], 'button'],
  [editors[1], 'pointer'],
  [editors[2], 'pointer'],
  [editors[3], 'pointer'],
]) {
  test(`does not announce a failed ${editor.name} ${method} reorder and retries after relaunch`, async ({ app, page }) => {
    const openEditor = async () => {
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: editor.button, exact: true }).click()
      return page.locator(editor.row)
    }
    let rows = await openEditor()
    const ids = () => rows.evaluateAll((elements, attribute) => elements.map(element => element.getAttribute(attribute)), editor.attribute)
    const initial = await ids()
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => { throw new Error('Reorder save failed') })
    }, IpcChannels.DB_SETTINGS)

    const moveFirstDown = async () => {
      if (method === 'button') {
        await rows.first().locator('.sectionHeader').getByRole('button', { name: / down$/ }).click()
        return
      }
      const handle = rows.first().locator('.dragHandle').first()
      await handle.scrollIntoViewIfNeeded()
      const start = await visibleBox(handle)
      const source = await visibleBox(rows.first())
      const target = await visibleBox(rows.nth(1))
      const y = start.y + start.height / 2
      await page.mouse.move(start.x + start.width / 2, y)
      await page.mouse.down()
      await page.mouse.move(start.x + start.width / 2, y + target.y + target.height - source.y - source.height, { steps: 10 })
      await page.mouse.up()
    }
    const errorLogged = page.waitForEvent('console', {
      predicate: message => message.type() === 'error' && message.text().includes('Reorder save failed')
    })
    await moveFirstDown()
    await errorLogged
    await expect.poll(ids).toEqual(initial)
    await expect(page.locator('.reorderStatus')).toHaveText('')

    // Relaunch restores the production handler without inspecting Electron internals.
    ;({ page } = await app.relaunch())
    rows = await openEditor()
    await expect.poll(ids).toEqual(initial)
    await moveFirstDown()
    await expect.poll(ids).toEqual([initial[1], initial[0], ...initial.slice(2)])
    await expect(page.locator('.reorderStatus')).not.toHaveText('')
  })
}

for (const uiScale of [100, 125]) {
  test.describe(`in-place settings reordering at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          quickSettings: ['baseTheme', 'mainColor', 'defaultQuality', 'playNextVideo', 'hideComments'],
        }
      }
    })

    for (const editor of editors) {
      test(`slides ${editor.name} in place and persists only on drop`, async ({ app, page }) => {
        if (uiScale === 125) await setWindowSize(app, page, { width: 500, height: 850 })
        const appearance = await goToSettingsSection(page, 'appearance')
        await appearance.getByRole('button', { name: editor.button, exact: true }).click()
        const rows = page.locator(editor.row)
        const ids = () => rows.evaluateAll((elements, attribute) => elements.map(element => element.getAttribute(attribute)), editor.attribute)
        const initial = await ids()
        const first = rows.first()
        const second = rows.nth(1)
        const handle = first.locator('.dragHandle').first()
        await handle.scrollIntoViewIfNeeded()
        const start = await visibleBox(handle)
        const source = await visibleBox(first)
        const target = await visibleBox(second)
        const last = await visibleBox(rows.last())
        const x = start.x + start.width / 2
        const y = start.y + start.height / 2
        const distance = target.y + target.height / 2 - source.y - source.height / 2 + 8
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x, y + distance, { steps: 12 })
        await expect(first).toHaveClass(/dragging/)
        await expect(first).toHaveCSS('z-index', '2')
        await expect(first).not.toHaveCSS('box-shadow', 'none')
        await expect.poll(() => second.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBeLessThan(-10)
        await expect.poll(ids).toEqual(initial)
        const dragged = await visibleBox(first)
        expect(dragged.y - source.y).toBeCloseTo(Math.min(distance, last.y + last.height - source.y - source.height), 0)
        await page.mouse.up()
        const reordered = [initial[1], initial[0], ...initial.slice(2)]
        await expect.poll(ids).toEqual(reordered)
        await expect(rows.locator('[style*="translateY"]')).toHaveCount(0)
        await expect.poll(() => rows.evaluateAll(elements => elements.every(element => getComputedStyle(element).transform === 'none'))).toBe(true)
        await page.reload()
        const reloaded = await goToSettingsSection(page, 'appearance')
        await reloaded.getByRole('button', { name: editor.button, exact: true }).click()
        await expect.poll(ids).toEqual(reordered)
      })
    }

    test('confines individual quick settings to their category and cancels with Escape', async ({ page }) => {
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Customize quick settings', exact: true }).click()
      const rows = page.locator('.selectedSetting')
      const ids = () => rows.evaluateAll(elements => elements.map(element => element.dataset.settingId))
      const original = await ids()
      const handle = page.locator('[data-setting-id="baseTheme"] .dragHandle')
      const start = await visibleBox(handle)
      const target = await visibleBox(page.locator('[data-section-id="playback"]'))
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
      await page.mouse.down()
      await page.mouse.move(start.x + start.width / 2, target.y + target.height / 2, { steps: 10 })
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect.poll(ids).toEqual(original)
      await expect(page.locator('.selectedSection')).toHaveCount(3)
      await handle.dragTo(page.locator('[data-section-id="playback"] .sectionHeader'))
      await expect.poll(ids).toEqual(['mainColor', 'baseTheme', ...original.slice(2)])
      await expect(page.locator('.selectedSection h3')).toHaveText(['Appearance', 'Playback', 'Content'])
    })
  })
}

for (const cancellation of ['pointercancel', 'lostpointercapture', 'resize']) {
  test(`cancels a navigation drag on ${cancellation}`, async ({ app, page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize navigation', exact: true }).click()
    const rows = page.locator('.selectedItem')
    const ids = () => rows.evaluateAll(elements => elements.map(element => element.dataset.navigationItemId))
    const original = await ids()
    const handle = rows.first().locator('.dragHandle')
    await handle.evaluate(element => element.addEventListener('pointerdown', event => {
      element.dataset.testPointerId = event.pointerId
    }, { once: true }))
    const source = await visibleBox(handle)
    const target = await visibleBox(rows.nth(1))
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2 + 8, { steps: 8 })
    await expect(rows.first()).toHaveClass(/dragging/)
    if (cancellation === 'resize') {
      await setWindowSize(app, page, { width: 900, height: 700 })
    } else {
      await handle.evaluate((element, reason) => {
        const pointerId = Number(element.dataset.testPointerId)
        if (reason === 'lostpointercapture') element.releasePointerCapture(pointerId)
        else element.dispatchEvent(new PointerEvent('pointercancel', { pointerId }))
      }, cancellation)
    }
    await page.mouse.up()
    await expect.poll(ids).toEqual(original)
    await expect(page.locator('.selectedItem.dragging')).toHaveCount(0)
    await expect.poll(() => rows.evaluateAll(elements => elements.every(element => getComputedStyle(element).transform === 'none'))).toBe(true)
  })
}

test('settles without motion when reduced motion is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Customize fullscreen actions', exact: true }).click()
  const rows = page.locator('.selectedAction')
  const original = await rows.evaluateAll(elements => elements.map(element => element.dataset.fullscreenActionId))
  const source = await visibleBox(rows.first().locator('.dragHandle'))
  const target = await visibleBox(rows.nth(1))
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2 + 8, { steps: 8 })
  await expect(rows.nth(1)).toHaveCSS('transition-duration', '0s')
  await page.mouse.up()
  await expect.poll(() => rows.evaluateAll(elements => elements.map(element => element.dataset.fullscreenActionId)))
    .toEqual([original[1], original[0], ...original.slice(2)])
})

test.describe('unequal category heights', () => {
  test.use({ seed: { settings: { quickSettings: ['baseTheme', 'mainColor', 'uiScale', 'defaultQuality'] } } })

  test('moves a tall category past a shorter last category without increasing the scroll range', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize quick settings', exact: true }).click()
    const first = page.locator('.selectedSection').first()
    const last = page.locator('.selectedSection').last()
    const original = await page.locator('.selectedSection').evaluateAll(elements => elements.map(element => element.dataset.sectionId))
    const source = await visibleBox(first.locator('.dragHandle').first())
    const listBounds = await visibleBox(page.locator('.selectedSettings'))
    const firstBounds = await visibleBox(first)
    const lastBounds = await visibleBox(last)
    expect(firstBounds.height).toBeGreaterThan(lastBounds.height)
    const x = source.x + source.width / 2
    const y = source.y + source.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + lastBounds.y + lastBounds.height - firstBounds.y - firstBounds.height, { steps: 15 })
    const draggingBounds = await visibleBox(first)
    expect(draggingBounds.y + draggingBounds.height).toBeLessThanOrEqual(listBounds.y + listBounds.height + 1)
    await page.mouse.up()
    await expect.poll(() => page.locator('.selectedSection').evaluateAll(elements => elements.map(element => element.dataset.sectionId)))
      .toEqual([...original.slice(1), original[0]])
  })
})

test.describe('reorder edge scrolling', () => {
  test.use({ seed: { settings: { uiScale: 125 } } })

  test('scrolls while holding a row near the edge without extending the content range', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 800, height: 600 })
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize navigation', exact: true }).click()
    const rows = page.locator('.selectedItem')
    const original = await rows.evaluateAll(elements => elements.map(element => element.dataset.navigationItemId))
    const scroller = page.locator('.settingsSubpageScroll')
    await scroller.evaluate(element => { element.scrollTop = 0 })
    const scrollHeight = await scroller.evaluate(element => element.scrollHeight)
    const bounds = await visibleBox(scroller)
    const handle = await visibleBox(rows.first().locator('.dragHandle'))
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, bounds.y + bounds.height - 8, { steps: 10 })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(60)
    expect(await scroller.evaluate(element => element.scrollHeight)).toBe(scrollHeight)
    await page.mouse.up()
    await expect.poll(() => rows.evaluateAll(elements => elements.map(element => element.dataset.navigationItemId))).not.toEqual(original)
    await expect(page.locator('.selectedItem.dragging')).toHaveCount(0)
    expect(await scroller.evaluate(element => element.scrollHeight)).toBe(scrollHeight)
  })
})

test.describe('explicit reduced motion override', () => {
  test.use({ seed: { settings: { reducedMotion: 'off' } } })

  test('animates reordering when the app overrides system reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'no-preference')
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize navigation', exact: true }).click()
    const rows = page.locator('.selectedItem')
    const original = await rows.evaluateAll(elements => elements.map(element => element.dataset.navigationItemId))
    const source = await visibleBox(rows.first().locator('.dragHandle'))
    const target = await visibleBox(rows.nth(1))
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2 + 8, { steps: 8 })
    await expect(rows.nth(1)).toHaveCSS('transition-duration', '0.16s')
    await page.mouse.up()
    await expect.poll(() => rows.evaluateAll(elements => elements.map(element => element.dataset.navigationItemId)))
      .toEqual([original[1], original[0], ...original.slice(2)])
  })
})
