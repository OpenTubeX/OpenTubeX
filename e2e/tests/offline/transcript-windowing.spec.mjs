import { test, expect, expectScrollAtRenderedEnd, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { WINDOWED_LIST_OVERSCAN_PX } from '../../../src/renderer/helpers/windowedList.js'

// About three hours of two-second cues.
const SEGMENT_COUNT = 5400
// Rows mount and release together in chunks of this size.
const CHUNK_SIZE = 25

function timestamp(seconds) {
  const pad = value => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.000`
}

async function openLongTranscript(app, page, currentTime) {
  await mockPlayableWatchPage(app, page)
  await page.route('https://example.test/transcript.vtt', route => route.fulfill({
    contentType: 'text/vtt',
    body: `WEBVTT\n\n${Array.from({ length: SEGMENT_COUNT }, (_, index) => (
      // Every seventh line wraps, so rows differ in height.
      `${timestamp(index * 2)} --> ${timestamp(index * 2 + 2)}\nTranscript line ${index}.${index % 7 === 0 ? ' It continues with enough words to wrap onto another line in the sidebar.' : ''}`
    )).join('\n\n')}\n`
  }))
  await openMockedVideo(page)
  const video = await waitForPlayback(page)
  await video.evaluate(element => element.pause())
  const view = await watchViewHandle(page)
  await view.evaluate(async (view, currentTime) => {
    view.captions = [{ url: 'https://example.test/transcript.vtt', label: 'English', language: 'en' }]
    view.currentTime = currentTime
    view.showTranscript = true
    await view.$nextTick()
  }, currentTime)
  return { view, list: page.locator('.transcriptSegments') }
}

const mountedBeyondWindow = list => list.evaluate((element, [overscan, chunkSize]) => {
  const mounted = [...element.querySelectorAll('.transcriptSegment')]
  const rowHeight = Math.min(...mounted.map(row => row.getBoundingClientRect().height))
  // Whole chunks mount, so allow a partial one at each end of the window.
  return mounted.length - Math.ceil((element.clientHeight + 2 * overscan) / rowHeight) - 2 * chunkSize
}, [WINDOWED_LIST_OVERSCAN_PX, CHUNK_SIZE])

test('centers a distant active transcript segment and follows it', { tag: '@scale' }, async ({ app, page }) => {
  const { view, list } = await openLongTranscript(app, page, 9000)
  const active = list.locator('[aria-current="true"]')
  const centerOffset = () => list.evaluate(element => {
    const active = element.querySelector('[aria-current="true"]')
    const offset = active.getBoundingClientRect().top - element.getBoundingClientRect().top
    return Math.abs(offset + active.offsetHeight / 2 - element.clientHeight / 2)
  })
  await expect(active).toHaveText(/Transcript line 4500\./)
  await expect.poll(centerOffset).toBeLessThanOrEqual(1)

  // The next active segment is in another chunk.
  await view.evaluate(view => { view.currentTime = 9050 })
  await expect(active).toHaveText(/Transcript line 4525\./)
  await expect.poll(centerOffset).toBeLessThanOrEqual(1)
  await view.dispose()
})

test('mounts only transcript segments near the viewport', { tag: '@performance' }, async ({ app, page }) => {
  const { view, list } = await openLongTranscript(app, page, 9000)
  await expect(list.locator('[aria-current="true"]')).toHaveText(/Transcript line 4500\./)
  await expect.poll(() => mountedBeyondWindow(list)).toBeLessThanOrEqual(0)
  await list.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(list.locator(`[data-segment-index="${SEGMENT_COUNT - 1}"]`)).toBeAttached()
  await expect(list.locator('[data-segment-index="4500"]')).toBeAttached()
  await expect.poll(() => mountedBeyondWindow(list)).toBeLessThanOrEqual(CHUNK_SIZE)
  await view.dispose()
})

test('keeps a valid transcript offset when searching or resizing at the end', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await setWindowSize(app, page, { width: 1500, height: 1000 })
  const { view, list } = await openLongTranscript(app, page, 0)
  await expect(list.locator('[aria-current="true"]')).toHaveText(/Transcript line 0\./)
  const jumpToEnd = () => expect.poll(() => list.evaluate((element, count) => {
    element.scrollTop = element.scrollHeight
    return !!element.querySelector(`[data-segment-index="${count - 1}"]`) &&
      element.scrollTop + element.clientHeight >= element.scrollHeight - 1
  }, SEGMENT_COUNT)).toBe(true)
  const expectScrollbarMatchesRange = () => expect.poll(() => list.evaluate(element => (
    element.querySelector(':scope > .os-scrollbar-vertical').classList.contains('os-scrollbar-visible') ===
      (element.scrollHeight - element.clientHeight > 1)
  ))).toBe(true)

  // A wider window unwraps rows, including released chunks.
  await jumpToEnd()
  await setWindowSize(app, page, { width: 1900, height: 1050 })
  await page.setViewportSize({ width: Math.round(1900 * uiScale / 100), height: Math.round(1050 * uiScale / 100) })
  await expectScrollAtRenderedEnd(list)
  await expectScrollbarMatchesRange()

  // Searching replaces the rows with a short result list.
  await jumpToEnd()
  const card = page.locator('.transcriptCard')
  await card.getByRole('button', { name: 'Search transcript' }).click()
  await card.getByRole('searchbox', { name: 'Search transcript', exact: true }).fill('Transcript line 4321')
  await expect(list.locator('.transcriptSegment')).toHaveCount(1)
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
  await expectScrollAtRenderedEnd(list)
  await expectScrollbarMatchesRange()
  await view.dispose()
})
