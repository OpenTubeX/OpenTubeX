import { test, expect, goTo, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

for (const zoom of [1, 1.25]) {
  test(`playlist creation stays at the heading edge at ${zoom} scale`, async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
    for (const width of [375, 850, 1280]) {
      await setWindowSize(app, page, { width, height: width === 375 ? 850 : width === 850 ? 700 : 800 })
      await expect.poll(() => page.locator('.newPlaylistButton').evaluate(element => {
        const button = element.getBoundingClientRect()
        const heading = element.closest('.heading').getBoundingClientRect()
        return Math.abs(heading.right - button.right)
      })).toBeLessThan(1)
    }
    await page.getByRole('button', { name: /^Create new playlist$/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test(`transcript copy and save stay side by side at ${zoom} scale`, async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.test/transcript.vtt', route => route.fulfill({
      contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:00:30.000\nExample transcript.\n'
    }))
    await openMockedVideo(page)
    await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
    const view = await watchViewHandle(page)
    await view.evaluate(async view => {
      view.captions = ['English', 'Deutsch'].map(label => ({ url: 'https://example.test/transcript.vtt', label, language: label === 'English' ? 'en' : 'de' }))
      view.showTranscript = true
      await view.$nextTick()
    })
    await expect(page.locator('.transcriptSegment')).toHaveCount(1)
    for (const width of [375, 850, 1280]) {
      await setWindowSize(app, page, { width, height: width === 375 ? 850 : width === 850 ? 700 : 800 })
      // Reproduce a landscape side panel even in a wide desktop window.
      await page.locator('.transcriptCard').evaluate(card => { card.style.width = 'min(300px, 100%)' })
      await expect.poll(() => page.locator('.transcriptHeaderActions').evaluate(element => {
        const buttons = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect())
        const header = element.closest('.transcriptHeader').getBoundingClientRect()
        const distances = buttons.slice(1).map((rect, index) => rect.left + rect.width / 2 - buttons[index].left - buttons[index].width / 2)
        return buttons.every(rect => Math.abs(rect.top - buttons[0].top) < 1 && rect.left >= header.left && rect.right <= header.right + 1) &&
          Math.max(...distances) - Math.min(...distances) < 0.2
      })).toBe(true)
    }
    await page.locator('.transcriptCard').evaluate(card => { card.style.removeProperty('width') })
    await setPlayerFullscreen(page, true)
    await view.evaluate(view => view.$refs.player.setFullscreenTranscript(true))
    const fullscreenActions = page.locator('.fullscreenTranscriptOverlay.open .transcriptHeaderActions')
    await expect(fullscreenActions).toBeVisible()
    await expect.poll(() => page.locator('.fullscreenTranscriptOverlay.open .transcriptCard').evaluate(card => {
      const bounds = card.getBoundingClientRect()
      const target = card.closest('.fullscreenTranscriptTarget').getBoundingClientRect()
      return Math.abs(target.right - bounds.right)
    })).toBeLessThan(1)
    await expect.poll(() => fullscreenActions.evaluate(element => {
      const buttons = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect())
      const distances = buttons.slice(1).map((rect, index) => rect.left + rect.width / 2 - buttons[index].left - buttons[index].width / 2)
      return buttons.every(rect => Math.abs(rect.top - buttons[0].top) < 1) &&
        Math.max(...distances) - Math.min(...distances) < 0.2
    })).toBe(true)
    await attachScreenshot('transcript toolbar')
    await view.dispose()
  })
}
