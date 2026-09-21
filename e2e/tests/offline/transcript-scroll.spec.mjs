import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

for (const zoom of [1, 1.25]) {
  test(`transcript animation after closing search is smooth at ${zoom} scale`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.test/transcript.vtt', route => route.fulfill({
      contentType: 'text/vtt',
      body: `WEBVTT\n\n${Array.from({ length: 300 }, (_, index) => {
        const timestamp = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`
        return `${timestamp(index)} --> ${timestamp(index + 1)}\nTranscript line ${index}.`
      }).join('\n\n')}\n`
    }))
    await openMockedVideo(page)
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    const view = await watchViewHandle(page)
    await view.evaluate(async view => {
      view.captions = [{ url: 'https://example.test/transcript.vtt', label: 'English', language: 'en' }]
      view.currentTime = 150
      view.showTranscript = true
      await view.$nextTick()
    })
    const list = page.locator('.transcriptSegments')
    const card = page.locator('.transcriptCard')
    await expect(card.locator('.transcriptSegment')).toHaveCount(300)
    await expect.poll(() => list.evaluate(element => {
      const active = element.querySelector('[aria-current="true"]')
      return Math.abs(element.scrollTop - (active.offsetTop - element.clientHeight / 2 + active.clientHeight / 2))
    })).toBeLessThanOrEqual(1)
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => list.evaluate(element => (
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
    ))).toBeLessThanOrEqual(1)
    const search = card.getByRole('button', { name: 'Search transcript' })
    await search.click()
    await card.getByPlaceholder('Search transcript').fill('Transcript line 250.')
    await expect(card.locator('.transcriptSegment')).toHaveCount(1)
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
    await expect.poll(() => list.evaluate(element => (
      element.scrollHeight - element.clientHeight
    ))).toBeLessThanOrEqual(1)
    await expect(list.locator('.os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-visible/)
    await list.evaluate(element => {
      window.transcriptScrollCalls = []
      const nativeScrollTo = element.scrollTo.bind(element)
      element.scrollTo = options => {
        window.transcriptScrollCalls.push({
          from: element.scrollTop,
          top: options.top,
          behavior: options.behavior,
          height: element.clientHeight
        })
        nativeScrollTo(options)
      }
    })
    await search.click()
    await expect(card.locator('.transcriptSegment')).toHaveCount(300)
    await view.evaluate(view => { view.currentTime = 151 })
    await expect.poll(() => page.evaluate(() => window.transcriptScrollCalls.length)).toBe(1)
    const [returnScroll] = await page.evaluate(() => window.transcriptScrollCalls)
    expect(returnScroll.behavior).toBe('smooth')
    expect(Math.abs(returnScroll.top - returnScroll.from)).toBeLessThanOrEqual(returnScroll.height + 1)
    await expect.poll(() => list.evaluate(element => {
      const active = element.querySelector('[aria-current="true"]')
      return Math.abs(element.scrollTop - (active.offsetTop - element.clientHeight / 2 + active.clientHeight / 2))
    })).toBeLessThanOrEqual(1)
    const previousTop = await list.evaluate(element => element.scrollTop)
    await view.evaluate(view => { view.currentTime = 152 })
    await expect.poll(() => page.evaluate(() => window.transcriptScrollCalls.length)).toBe(2)
    const [, nextScroll] = await page.evaluate(() => window.transcriptScrollCalls)
    expect(Math.abs(nextScroll.from - previousTop)).toBeLessThanOrEqual(1)
    expect(nextScroll.behavior).toBe('smooth')
    expect(Math.abs(nextScroll.top - nextScroll.from)).toBeLessThan(100)
    await view.dispose()
  })
}
