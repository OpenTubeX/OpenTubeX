import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

for (const mode of ['desktop', 'phone', 'fullscreen']) {
  test(`closes comment search directly in the ${mode} layout`, { tag: '@scale' }, async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await expect(page.locator('.commentsTitle')).toBeVisible()

    let section = page.locator('.commentHeader').locator('..')
    if (mode === 'phone') {
      await setWindowSize(app, page, { width: Math.round(400 * uiScale / 100), height: Math.round(850 * uiScale / 100) })
      await page.locator('.phoneCommentsButton').getByRole('button', { name: 'Comments', exact: true }).click()
      section = page.locator('.phoneCommentCard')
    } else if (mode === 'fullscreen') {
      await waitForPlayback(page)
      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })
      section = page.locator('.fullscreenCommentCard')
    }

    await expect(section.locator('.commentThread').first()).toBeVisible()
    const initialCount = await section.locator('.commentThread').count()
    const filter = mode === 'phone'
      ? page.locator('.phoneCommentHeader').getByRole('button', { name: 'Filter loaded comments' })
      : section.getByRole('button', { name: 'Filter loaded comments' })
    await filter.click()
    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()

    const search = section.getByRole('searchbox', { name: 'Search loaded comments' })
    await expect(search).toBeFocused()
    await expect(filter).toHaveClass(/active/)
    expect(await filter.evaluate(button => getComputedStyle(button).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    await search.fill('honored')
    await expect(section.locator('.commentThread')).toHaveCount(1)
    const close = section.locator('.commentSearchClose')
    await expect(close).toHaveAccessibleName('Close')
    await expect.poll(() => close.evaluate(button => {
      const input = button.parentElement.querySelector('input').getBoundingClientRect()
      const bounds = button.getBoundingClientRect()
      const row = button.parentElement.getBoundingClientRect()
      return bounds.left >= input.right && bounds.right <= row.right + 1 && Math.abs(bounds.top + bounds.height / 2 - input.top - input.height / 2) <= 1
    })).toBe(true)
    await close.click()

    await expect(search).toHaveCount(0)
    await expect(section.locator('.commentThread')).toHaveCount(initialCount)
    await expect(filter).toBeFocused()
    await expect(filter).toHaveAttribute('aria-expanded', 'false')
    await expect(filter).not.toHaveClass(/active/)

    await filter.click()
    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
    await expect(search).toHaveValue('')
    await search.press('Escape')
    await expect(search).toHaveCount(0)
    await expect(filter).toBeFocused()
  })
}

test('keeps the phone comments header on one row', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await expect(page.locator('.commentsTitle')).toBeVisible()
  await setWindowSize(app, page, { width: Math.round(390 * uiScale / 100), height: Math.round(850 * uiScale / 100) })
  await page.locator('.phoneCommentsButton').getByRole('button', { name: 'Comments', exact: true }).click()

  for (const width of [390, 320]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(0, 0)
      window.setContentSize(Math.round(width * uiScale / 100), Math.round(850 * uiScale / 100))
    }, { width, uiScale })
    await expect.poll(() => page.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(1)
    await expect.poll(() => page.locator('.phoneCommentHeader').evaluate(header => {
      const sheetHeader = header.closest('.mobileSheetHeader')
      const title = header.querySelector('h3').getBoundingClientRect()
      const center = title.top + title.height / 2
      const controls = [...sheetHeader.querySelectorAll('button')].map(button => button.getBoundingClientRect())
      const bounds = sheetHeader.getBoundingClientRect()
      const centers = controls.slice(0, -1).map(button => button.left + button.width / 2)
      const spacing = centers.slice(1).map((center, index) => center - centers[index])
      return controls.every(button => Math.abs(button.top + button.height / 2 - center) <= 1 && button.right <= bounds.right && button.left >= bounds.left) &&
        Math.max(...spacing) - Math.min(...spacing) <= 1 &&
        Math.abs(controls.at(-1).left - controls.at(-2).right - 8) <= 1
    })).toBe(true)
  }
})
