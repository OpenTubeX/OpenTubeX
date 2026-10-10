import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`touch customization at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale } } })

    for (const { name, rowSelector, idAttribute, handleSelector = '.dragHandle' } of [
      { name: 'fullscreen actions', rowSelector: '.selectedAction', idAttribute: 'data-fullscreen-action-id' },
      { name: 'navigation', rowSelector: '.selectedItem', idAttribute: 'data-navigation-item-id' },
      { name: 'quick settings', rowSelector: '.selectedSection', idAttribute: 'data-section-id', handleSelector: ':scope > .sectionHeader .dragHandle' },
    ]) {
      test(`scrolls to offscreen ${name} items during a touch drag`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 600 })
        const appearance = await goToSettingsSection(page, 'appearance')
        await appearance.getByRole('button', { name: `Customize ${name}` }).click()

        const rows = page.locator(rowSelector)
        const scroller = page.locator('.settingsSubpageScroll')
        const itemIds = () => rows.evaluateAll((elements, attribute) => (
          elements.map(element => element.getAttribute(attribute))
        ), idAttribute)
        const original = await itemIds()
        const session = await page.context().newCDPSession(page)
        try {
          for (const down of [true, false]) {
            const handle = rows.nth(down ? 0 : original.length - 1).locator(handleSelector)
            await handle.scrollIntoViewIfNeeded()
            const source = await handle.boundingBox()
            const viewport = await scroller.boundingBox()
            const x = source.x + source.width / 2
            const startY = source.y + source.height / 2
            const endY = down ? viewport.y + viewport.height - 10 : viewport.y + 10
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }],
            })
            for (let step = 1; step <= 5; step++) {
              await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove', touchPoints: [{ x, y: startY + (endY - startY) * step / 5, id: 1 }],
              })
            }
            await expect.poll(() => scroller.evaluate((element, scrollDown) => (
              scrollDown
                ? element.scrollHeight - element.clientHeight - element.scrollTop
                : element.scrollTop
            ), down)).toBeLessThanOrEqual(1)
            await expect.poll(() => rows.evaluateAll((elements, attribute) => elements
              .toSorted((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
              .map(element => element.getAttribute(attribute)), idAttribute))
              .toEqual(down ? [...original.slice(1), original[0]] : original)
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
            await expect.poll(itemIds).toEqual(down ? [...original.slice(1), original[0]] : original)
            await expect(page.locator(`${rowSelector}.dragging`)).toHaveCount(0)
          }
        } finally {
          await session.detach()
        }
      })

      test(`reorders ${name} by touch and cancels interrupted drags`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        const appearance = await goToSettingsSection(page, 'appearance')
        await appearance.getByRole('button', { name: `Customize ${name}` }).click()

        const rows = page.locator(rowSelector)
        const itemIds = () => rows.evaluateAll((elements, attribute) => (
          elements.map(element => element.getAttribute(attribute))
        ), idAttribute)
        const original = await itemIds()
        const session = await page.context().newCDPSession(page)

        async function drag(from, to, cancel = false) {
          const current = await itemIds()
          const handle = rows.nth(from).locator(handleSelector)
          await handle.scrollIntoViewIfNeeded()
          const source = await handle.boundingBox()
          const sourceRow = await rows.nth(from).boundingBox()
          const target = await rows.nth(to).boundingBox()
          const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
          const restingTop = to > from ? target.y + target.height - sourceRow.height : target.y
          const end = { x: start.x, y: start.y + restingTop - sourceRow.y }
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ ...start, id: 1 }],
          })
          for (let step = 1; step <= 5; step++) {
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: end.x, y: start.y + (end.y - start.y) * step / 5, id: 1 }],
            })
          }
          const preview = current.slice()
          preview.splice(to, 0, preview.splice(from, 1)[0])
          await expect.poll(() => rows.evaluateAll((elements, attribute) => elements
            .toSorted((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
            .map(element => element.getAttribute(attribute)), idAttribute)).toEqual(preview)
          await session.send('Input.dispatchTouchEvent', {
            type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [],
          })
          await expect(page.locator(`${rowSelector}.dragging`)).toHaveCount(0)
          await expect(page.locator(`${rowSelector}.dropBefore, ${rowSelector}.dropAfter`)).toHaveCount(0)
        }

        try {
          await drag(2, 0)
          await expect.poll(itemIds).toEqual([original[2], original[0], original[1], ...original.slice(3)])
          await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled()
          await drag(0, 2)
          await expect.poll(itemIds).toEqual(original)
          await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
          await drag(2, 0, true)
          await expect.poll(itemIds).toEqual(original)
        } finally {
          await session.detach()
        }
      })
    }
  })
}
