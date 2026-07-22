import { test, expect, goTo } from '../../helpers/app.mjs'

function historyEntry (videoId, title, timeWatched) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Queue Test Channel',
    authorId: 'UC-queue-test-channel',
    published: Date.now() - 86400000,
    description: '',
    viewCount: 100,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched: false,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

const now = Date.now()

test.use({
  seed: {
    history: [
      historyEntry('queuevideo01', 'Queue video one', now - 1000),
      historyEntry('queuevideo02', 'Queue video two', now - 2000),
      historyEntry('queuevideo03', 'Queue video three', now - 3000),
      historyEntry('currentvid01', 'Current video', now - 4000)
    ]
  }
})

async function chooseVideoOption (page, title, option) {
  const video = page.locator('.ft-list-video').filter({ hasText: title })
  await video.hover()
  await video.locator('.optionsButton').click()
  await page.getByRole('option', { name: option }).click()
}

test('manages a temporary queue from video menus and the watch sidebar', async ({ page }) => {
  await goTo(page, 'history')

  await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video two', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video three', 'Play Next')

  await page.getByRole('link', { name: /Current video/ }).click()

  const queue = page.locator('.watchQueue')
  await expect(queue).toBeVisible()
  await expect(queue.locator('.queueDragHandle svg')).toHaveCount(3)
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video three',
    'Queue video one',
    'Queue video two'
  ])

  const queueItems = queue.locator('.queueItem')
  await queueItems.nth(0).locator('.queueDragHandle').dragTo(queueItems.nth(2))
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])

  const thirdDragHandle = queue.locator('.queueItem').nth(2).locator('.queueDragHandle')
  await thirdDragHandle.press('ArrowUp')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video three',
    'Queue video two'
  ])
  await queue.locator('.queueItem').nth(1).locator('.queueDragHandle').press('ArrowDown')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])

  await queue.getByRole('button', { name: 'Remove Queue video three from queue' }).click()
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two'
  ])

  await queue.getByRole('button', { name: 'Clear Queue' }).click()
  await expect(queue).toBeHidden()
})
