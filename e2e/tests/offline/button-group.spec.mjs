import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

function measure(group) {
  return group.evaluate(element => [...element.children].map(button => {
    const bounds = button.getBoundingClientRect()
    return { center: bounds.left + bounds.width / 2, top: bounds.top, width: bounds.width }
  }))
}

test('a pressed group button widens without moving or wrapping its neighbors', { tag: '@scale' }, async ({ page }) => {
  const storage = await goToSettingsSection(page, 'storage')
  await storage.getByRole('button', { name: 'Remove Watch History' }).click()
  const group = page.getByRole('dialog').getByRole('group')
  const buttons = group.locator(':scope > .btn')
  await expect(buttons).toHaveCount(2)
  // The dialog scales in, so wait until its buttons stop moving.
  let resting
  await expect.poll(async () => {
    const previous = resting
    resting = await measure(group)
    return JSON.stringify(previous) === JSON.stringify(resting)
  }).toBe(true)

  for (const [pressed, neighbor] of [[0, 1], [1, 0]]) {
    const bounds = await buttons.nth(pressed).boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await expect.poll(async () => (await measure(group))[pressed].width - resting[pressed].width).toBeCloseTo(8, 0)
    const active = await measure(group)
    expect(active[neighbor].width - resting[neighbor].width).toBeCloseTo(-4, 0)
    for (let index = 0; index < resting.length; index++) {
      expect(active[index].center).toBeCloseTo(resting[index].center, 0)
      expect(active[index].top).toBeCloseTo(resting[index].top, 0)
    }
    // Release over the prompt text, so the press neither answers nor closes the prompt.
    const text = await page.getByRole('dialog').getByText(/Are you sure/).boundingBox()
    await page.mouse.move(text.x + 4, text.y + text.height / 2)
    await page.mouse.up()
    await expect.poll(async () => (await measure(group))[pressed].width).toBeCloseTo(resting[pressed].width, 0)
  }
})
