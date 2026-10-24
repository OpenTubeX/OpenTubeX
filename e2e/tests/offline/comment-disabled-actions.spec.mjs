import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

for (const presentation of ['phone', 'fullscreen']) {
  test(`${presentation} comments visibly disable online actions after disconnecting`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await page.route(/https:\/\/yt3\.(ggpht|googleusercontent)\.com\//, route => fulfillVisualFixture(route, 'avatar'))
    await openMockedVideo(page)
    await expect(page.locator('.comment').first()).toBeVisible()

    if (presentation === 'phone') {
      await setWindowSize(app, page, { width: 450, height: 850 })
      await (await watchViewHandle(page)).evaluate(view => view.openPhonePanel('comments'))
    } else {
      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })
    }

    const header = page.locator('.fullscreenCommentHeader')
    const sort = header.getByRole('button', { name: 'Sort by', exact: true })
    const reload = header.getByRole('button', { name: 'Reload Comments', exact: true })
    const filter = header.getByRole('button', { name: 'Filter loaded comments', exact: true })
    await sort.click()
    await expect(header.locator('.fullscreenSortMenu')).toBeVisible()

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(header.locator('.fullscreenSortMenu')).toHaveCount(0)
    for (const button of [sort, reload]) {
      await expect(button).toBeDisabled()
      await expect(button).toHaveCSS('opacity', '0.5')
      await expect(button).toHaveCSS('cursor', 'default')
      await button.hover()
      await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    }
    await expect(filter).toBeEnabled()
    await expect(filter).toHaveCSS('opacity', '1')
    await filter.click()
    await expect(header.getByRole('dialog', { name: 'Comment filters' })).toBeVisible()
    await filter.click()
    await page.mouse.move(0, 0)
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme })
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
      await page.evaluate(() => document.fonts.ready)
      await expect.poll(async () => {
        const before = await header.screenshot({ animations: 'disabled' })
        await page.waitForTimeout(100)
        const after = await header.screenshot({ path: testInfo.outputPath(`offline-comments-${theme}.png`), animations: 'disabled' })
        return before.equals(after)
      }).toBe(true)
    }

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      window.dispatchEvent(new Event('online'))
    })
    for (const button of [sort, reload]) {
      await expect(button).toBeEnabled()
      await expect(button).toHaveCSS('opacity', '1')
      await expect(button).toHaveCSS('cursor', 'pointer')
    }
    await sort.click()
    await expect(header.locator('.fullscreenSortMenu')).toBeVisible()
  })
}
