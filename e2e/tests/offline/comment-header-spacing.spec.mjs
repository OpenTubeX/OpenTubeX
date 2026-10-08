import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`comment header spacing at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

    test('keeps comments directly below the header at wide and narrow widths', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await expect(page.locator('.comment').first()).toBeVisible()

      for (const width of [1600, 640]) {
        await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
          BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
        }, { width, uiScale })
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)

        await expect.poll(() => page.locator('.commentHeader').evaluate(header => {
          const contentBottom = Math.max(
            header.querySelector('.commentsTitle').getBoundingClientRect().bottom,
            ...Array.from(header.querySelectorAll('.commentHeaderActions button'), button => button.getBoundingClientRect().bottom)
          )
          const avatar = header.parentElement.querySelector('.commentThumbnail, .commentThumbnailHidden')
          return avatar.getBoundingClientRect().top - contentBottom
        })).toBeCloseTo(15, 0)
      }
    })

    test('keeps the empty-state actions compact', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.route(/\/youtubei\/v1\/next/, (route, request) => {
        const body = JSON.parse(request.postData() ?? '{}')
        return body.continuation ? route.fulfill({ json: {} }) : route.fallback()
      })
      await openMockedVideo(page)
      const actions = page.locator('.noCommentActions')
      await expect(actions).toBeVisible()
      await expect.poll(() => actions.evaluate(element => {
        const sortBottom = element.querySelector('.select-text').getBoundingClientRect().bottom
        return element.getBoundingClientRect().bottom - sortBottom
      })).toBeCloseTo(0, 0)
    })
  })
}
