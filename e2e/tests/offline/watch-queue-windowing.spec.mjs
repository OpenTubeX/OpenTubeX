import { test, expect, expectScrollAtRenderedEnd, goTo, setWindowSize } from '../../helpers/app.mjs'
import { WINDOWED_LIST_OVERSCAN_PX } from '../../../src/renderer/helpers/windowedList.js'

const QUEUE_LENGTH = 300
const now = Date.now()

test.describe.configure({ timeout: 120_000 })

test.use({
  seed: {
    history: [{
      _id: 'currentvid1',
      videoId: 'currentvid1',
      title: 'Current video',
      author: 'Queue Test Channel',
      authorId: 'UC-queue-test-channel',
      published: now - 86400000,
      description: '',
      viewCount: 100,
      lengthSeconds: 60,
      watchProgress: 10,
      isWatched: false,
      timeWatched: now,
      isLive: false,
      type: 'video'
    }]
  }
})

async function openLongQueue(app, page, { longTitles = false } = {}) {
  await setWindowSize(app, page, { width: 1500, height: 1100 })
  await page.evaluate(() => window.$store.dispatch('updateHideRecommendedVideos', true))
  await goTo(page, 'history')
  await page.evaluate(({ length, longTitles }) => window.$store.commit('addVideosToWatchQueue', {
    videos: Array.from({ length }, (_, index) => ({
      videoId: `queue${String(index).padStart(6, '0')}`,
      // Titles that wrap make rows taller than the estimate for unmounted rows.
      title: longTitles && index > 20
        ? `Queued video ${index + 1} with a title long enough to wrap onto several lines in the narrow queue sidebar`
        : `Queued video ${index + 1}`,
      author: 'Queue Test Channel',
      lengthSeconds: 60,
    }))
  }), { length: QUEUE_LENGTH, longTitles })
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  const scroller = page.locator('.watchQueue .queueItems')
  await expect(scroller.locator('.queueItem')).toHaveCount(QUEUE_LENGTH)
  await expect(scroller.locator('.queueItem').first().locator('.ft-list-video')).toBeVisible()
  return scroller
}

/** Jumps to the end until the last row is mounted there, without visiting every row. */
async function jumpToEnd(scroller) {
  await expect.poll(() => scroller.evaluate(element => {
    element.scrollTop = element.scrollHeight
    const last = element.querySelector('.queueItem:last-child')
    return !!last.querySelector('.ft-list-video') && element.scrollTop + element.clientHeight >= element.scrollHeight - 1
  })).toBe(true)
}

/** The offset stays in range, the rows reach the viewport end and no visible row is blank. */
async function expectValidRange(scroller) {
  await expectScrollAtRenderedEnd(scroller)
  await expect.poll(() => scroller.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    return {
      offsetValid: element.scrollTop >= 0 && element.scrollTop <= element.scrollHeight - element.clientHeight + 1,
      visibleRowsMounted: [...element.querySelectorAll('.queueItem')].every(row => {
        const { top, bottom } = row.getBoundingClientRect()
        return bottom <= bounds.top || top >= bounds.bottom || !!row.querySelector('.ft-list-video')
      }),
      scrollbarMatchesRange: scrollbar.classList.contains('os-scrollbar-visible') === (element.scrollHeight - element.clientHeight > 1),
    }
  })).toEqual({ offsetValid: true, visibleRowsMounted: true, scrollbarMatchesRange: true })
}

test('mounts only queue rows near the viewport', { tag: '@performance' }, async ({ app, page }) => {
  const scroller = await openLongQueue(app, page)
  const mountedBeyondWindow = () => scroller.evaluate((element, overscan) => {
    const mounted = [...element.querySelectorAll('.queueItem')].filter(row => row.querySelector('.ft-list-video'))
    const rowHeight = Math.min(...mounted.map(row => row.getBoundingClientRect().height))
    return mounted.length - Math.ceil((element.clientHeight + 2 * overscan) / rowHeight) - 2
  }, WINDOWED_LIST_OVERSCAN_PX)
  await expect.poll(mountedBeyondWindow).toBeLessThanOrEqual(0)
  await jumpToEnd(scroller)
  await expect.poll(mountedBeyondWindow).toBeLessThanOrEqual(0)
  await expect(scroller.locator('.queueItem').first().locator('.ft-list-video')).toHaveCount(0)
})

test('keeps a valid queue offset when rows are removed or resized at the end', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  const scroller = await openLongQueue(app, page)
  const rows = scroller.locator('.queueItem')

  // Removing the last videos shortens the queue below the current offset.
  await jumpToEnd(scroller)
  await page.evaluate(() => {
    for (const item of window.$store.getters.getWatchQueue.slice(-5)) {
      window.$store.commit('removeVideoFromWatchQueue', item.queueItemId)
    }
  })
  await expect(rows).toHaveCount(QUEUE_LENGTH - 5)
  await expectValidRange(scroller)

  // A narrow window stacks the sidebar under the player and resizes every row,
  // including released ones.
  await jumpToEnd(scroller)
  await setWindowSize(app, page, { width: 900, height: 1000 })
  await page.setViewportSize({ width: Math.round(900 * uiScale / 100), height: Math.round(1000 * uiScale / 100) })
  await expectValidRange(scroller)

  // Returning to the top shows the first rows again.
  await scroller.evaluate(element => { element.scrollTop = 0 })
  await expect(rows.first().locator('.ft-list-video')).toBeVisible()
})

test('keeps a focused queue row mounted while it scrolls away', async ({ app, page }) => {
  const scroller = await openLongQueue(app, page)
  const first = scroller.locator('.queueItem').first()
  await first.getByRole('button', { name: 'Reorder Queued video 1' }).focus()
  await jumpToEnd(scroller)
  // Releasing distant rows retries a protected row later, so give it the time.
  await expect(scroller.locator('.queueItem').nth(20).locator('.ft-list-video')).toHaveCount(0)
  await expect(first.getByRole('button', { name: 'Reorder Queued video 1' })).toBeFocused()
})

test('a drag that scrolls through the queue keeps going as rows come into view', { tag: '@scale' }, async ({ app, page }) => {
  const scroller = await openLongQueue(app, page, { longTitles: true })
  // Fonts, UI scale and dock widths make real rows differ from the estimate
  // that rows which never mounted use, so they resize when they mount.
  await page.addStyleTag({ content: '.queueItem.windowedListShell:not([style*="block-size"]) { block-size: 60px }' })
  const firstId = await page.evaluate(() => window.$store.getters.getWatchQueue[0].queueItemId)
  // At larger UI scales the queue starts below the visible part of the page.
  await scroller.evaluate(element => element.scrollIntoView({ block: 'end' }))
  const handle = scroller.locator('.queueItem').first().locator('.queueDragHandle')
  const handleBox = await handle.boundingBox()
  const scrollerBox = await scroller.boundingBox()

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  const bottomX = handleBox.x + handleBox.width / 2
  const bottomY = scrollerBox.y + scrollerBox.height - 4
  await page.mouse.move(bottomX, bottomY, { steps: 8 })
  await expect(scroller.locator('.queueItem.dragging')).toHaveCount(1)
  // Holding the pointer at the edge scrolls the queue past rows that never mounted.
  await expect.poll(async () => {
    await page.mouse.move(bottomX, bottomY + (Math.random() < 0.5 ? -1 : 0))
    return scroller.evaluate(element => element.scrollTop)
  }, { timeout: 30_000 }).toBeGreaterThan(scrollerBox.height * 3)
  await expect(scroller.locator('.queueItem.dragging')).toHaveCount(1)
  await page.mouse.up()

  await expect.poll(() => page.evaluate(id => window.$store.getters.getWatchQueue.findIndex(item => item.queueItemId === id), firstId))
    .toBeGreaterThan(10)
})
