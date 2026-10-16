import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('wraps long unbroken words in comments and replies at wide and narrow widths', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const thread = page.locator('.commentThread').first()
  await expect(thread).toBeVisible()
  await thread.locator('.commentReplyRootToggle button').click()
  const reply = thread.locator('.commentReplyContent').first()
  await expect(reply).toBeVisible()

  const texts = [thread.locator(':scope > .commentText'), reply.locator(':scope > .commentText')]
  for (const text of texts) {
    await text.evaluate(element => {
      element.textContent = 'LongUnbrokenCommentText'.repeat(12)
    })
  }

  for (const width of [1600, 640, 360]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
    }, { width, uiScale })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    if (width === 360) {
      await page.locator('.phoneCommentsOpen').click()
      await expect(page.locator('.mobileSheet[open]')).toBeVisible()
    }

    for (const text of texts) {
      await expect.poll(() => text.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const bounds = element.getBoundingClientRect()
        const lines = [...range.getClientRects()]
        return lines.length > 1 && lines.every(line => line.left >= bounds.left - 1 && line.right <= bounds.right + 1)
      })).toBe(true)
    }
  }
})
