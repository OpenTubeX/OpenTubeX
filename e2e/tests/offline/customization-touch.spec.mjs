import { test, expect, openInterfaceCustomizer } from '../../helpers/app.mjs'

test.describe('touch customization', { tag: '@scale' }, () => {
  const rowSelector = '[data-placement-section="bar"] .placementItem:not(.unordered)'
  const idAttribute = 'data-control-bar-button-id'
  const handleSelector = '.dragHandle'

  test('reorders control bar by touch and cancels interrupted drags', async ({ page, uiScale }) => {
    // Keep the editor's CSS height at every UI scale, so a whole drag fits
    // between the edges where useOrderedItemReorder scrolls the editor.
    await page.setViewportSize({ width: 375, height: Math.ceil(812 * uiScale / 100) })
    await openInterfaceCustomizer(page, 'control bar')

    const rows = page.locator(rowSelector)
    const itemIds = () => rows.evaluateAll((elements, attribute) => (
      elements.map(element => element.getAttribute(attribute))
    ), idAttribute)
    const original = await itemIds()
    const scroller = page.locator('.customizerEditorScroll')
    const session = await page.context().newCDPSession(page)

    async function drag(from, to, cancel = false) {
      const current = await itemIds()
      const handle = rows.nth(from).locator(handleSelector)
      await handle.scrollIntoViewIfNeeded()
      async function measure() {
        const source = await handle.boundingBox()
        const sourceRow = await rows.nth(from).boundingBox()
        const target = await rows.nth(to).boundingBox()
        const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
        const restingTop = to > from ? target.y + target.height - sourceRow.height : target.y
        return { start, end: { x: start.x, y: start.y + restingTop - sourceRow.y } }
      }
      // An end near the editor's edge starts edge scrolling, which keeps
      // moving the target after the preview matched, so center the drag.
      const path = await measure()
      await scroller.evaluate((element, middle) => {
        const bounds = element.getBoundingClientRect()
        element.scrollBy({ top: middle - bounds.top - bounds.height / 2, behavior: 'instant' })
      }, (path.start.y + path.end.y) / 2)
      const { start, end } = await measure()
      // useOrderedItemReorder scrolls within 40px of the editor's edges
      const editor = await scroller.boundingBox()
      for (const y of [start.y, end.y]) {
        expect(y).toBeGreaterThan(editor.y + 40)
        expect(y).toBeLessThan(editor.y + editor.height - 40)
      }
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

    const far = 2
    const moved = original.slice()
    moved.splice(0, 0, moved.splice(far, 1)[0])
    try {
      await drag(far, 0)
      await expect.poll(itemIds).toEqual(moved)
      await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled()
      await drag(0, far)
      await expect.poll(itemIds).toEqual(original)
      await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
      await drag(far, 0, true)
      await expect.poll(itemIds).toEqual(original)
    } finally {
      await session.detach()
    }
  })
})
