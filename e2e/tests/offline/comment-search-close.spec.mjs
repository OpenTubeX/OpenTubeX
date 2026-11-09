import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

for (const mode of ['desktop', 'phone']) {
  test(`closes comment search directly in the ${mode} layout`, { tag: '@scale' }, async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await expect(page.locator('.commentsTitle')).toBeVisible()

    let section = page.locator('.commentHeader').locator('..')
    if (mode === 'phone') {
      await setWindowSize(app, page, { width: Math.round(400 * uiScale / 100), height: Math.round(850 * uiScale / 100) })
      await page.locator('.phoneCommentsButton').getByRole('button', { name: 'Comments', exact: true }).click()
      section = page.locator('.phoneCommentCard')
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
