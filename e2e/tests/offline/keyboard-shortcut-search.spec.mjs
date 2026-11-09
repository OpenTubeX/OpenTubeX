import { test, expect, goTo, setWindowSize, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

test.beforeEach(async ({ page }) => {
  await goTo(page, 'settings')
  await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
})

test('searches shortcut actions, sections and bindings while preserving editing', async ({ page }) => {
  const search = page.locator('.shortcutToolbar').getByRole('searchbox', { name: 'Search', exact: true })
  await expect(search).toBeVisible()
  for (const name of ['Show keyboard shortcuts', 'Highlight settings changed from defaults', 'Show performance impact indicators']) {
    await expect(page.locator('.settingsHeaderActions').getByRole('button', { name, exact: true })).toHaveCount(0)
  }

  const rows = page.locator('.labelAndShortcut')
  const total = await rows.count()
  await search.fill('  fOcUs on the search  ')
  await expect(rows).toHaveCount(1)
  const binding = page.locator('[data-shortcut-path="APP.GENERAL.FOCUS_SEARCH"]')
  await expect(binding).toBeVisible()
  await binding.click()
  await binding.press('Control+Shift+k')
  await expect(binding).toHaveText('Ctrl+Shift+k')

  await search.fill('ctrl+shift+k')
  await expect(rows).toHaveCount(1)
  await expect(binding).toBeVisible()
  await search.fill('no-such-shortcut')
  await expect(rows).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('No matching results')
  const reset = page.getByRole('button', { name: 'Reset to defaults', exact: true })
  await expect(reset).toBeEnabled()
  await reset.click()
  await expect(reset).toBeDisabled()

  await search.fill('playback')
  await expect(page.locator('.shortcutSection h3')).toHaveText([/Video:\s*Playback/])
  await search.fill('')
  await expect(rows).toHaveCount(total)
  await expect(page.getByRole('status')).toHaveCount(0)

  await page.locator('.settingsBackButton').click()
  await expect(page.getByRole('button', { name: 'Show Keyboard Shortcuts' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Highlight settings changed from defaults' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show performance impact indicators', exact: true })).toBeVisible()
})

test('keeps shortcut search above results and clamps filtering and resizing @scale', async ({ page, app }) => {
  const search = page.locator('.shortcutToolbar').getByRole('searchbox')
  const reset = page.getByRole('button', { name: 'Reset to defaults', exact: true })
  const scroller = page.locator('.shortcutColumns')
  await expect(search).toBeVisible()
  const searchBounds = await search.boundingBox()
  const resetBounds = await reset.boundingBox()
  expect(searchBounds.x).toBeGreaterThan(resetBounds.x + resetBounds.width)
  expect(Math.abs(searchBounds.y + searchBounds.height / 2 - resetBounds.y - resetBounds.height / 2)).toBeLessThan(2)
  const toolbarTop = (await page.locator('.shortcutToolbar').boundingBox()).y

  for (const query of ['focus on the search', 'no-such-shortcut']) {
    await search.fill('')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await search.fill(query)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scroller.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    expect((await page.locator('.shortcutToolbar').boundingBox()).y).toBeCloseTo(toolbarTop, 0)
  }

  await search.fill('')
  for (const [width, height] of [[375, 850], [1000, 900], [1600, 950]]) {
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await setWindowSize(app, page, { width, height })
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.querySelector('.shortcutColumnsContent')
      const maximum = Math.max(0, content.getBoundingClientRect().bottom -
        element.getBoundingClientRect().top + element.scrollTop +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      const scrollbar = element.querySelector('.os-scrollbar-vertical')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const handle = scrollbar.querySelector('.os-scrollbar-handle')
      const expectedRatio = Math.max(element.clientHeight / element.scrollHeight,
        Number.parseFloat(getComputedStyle(handle).minHeight) / track.height)
      return element.scrollTop <= maximum + 1 && element.scrollHeight - element.clientHeight <= maximum + 1 &&
        Math.abs(handle.getBoundingClientRect().height / track.height - expectedRatio) < 0.02
    })).toBe(true)
    await expect.poll(() => scroller.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await expect(search).toBeVisible()
    await expect(scroller.locator('.os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
  }
})
