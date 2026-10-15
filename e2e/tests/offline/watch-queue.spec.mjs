import { test, expect, goTo, setWindowSize, openNewWindowFromTabBar, waitForAppReady } from '../../helpers/app.mjs'

test.describe.configure({ timeout: 120_000 })

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
  await video.locator('.title').click({ button: 'right' })
  await page.getByRole('menuitem', { name: option }).click()
}

test('manages the queue from video menus and the watch sidebar', async ({ page }) => {
  await goTo(page, 'history')

  await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video two', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video three', 'Play Next')

  await page.locator('a.title').filter({ hasText: /Current video/ }).click()

  const queue = page.locator('.watchQueue')
  await expect(queue).toBeVisible()
  await expect(queue.locator('.queueDragHandle svg')).toHaveCount(3)
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video three',
    'Queue video one',
    'Queue video two'
  ])

  const queueItems = queue.locator('.queueItem')
  const queueItem = title => queueItems.filter({ hasText: title })
  const reorderButton = title => queueItem(title).getByRole('button', { name: `Reorder ${title}` })
  const moveStatus = queue.locator('[role="status"]')

  await expect(moveStatus).toHaveCount(1)
  await expect(moveStatus).toHaveAttribute('aria-live', 'polite')
  await expect(moveStatus).toHaveAttribute('aria-atomic', 'true')
  await expect(queueItems.locator('[role="status"]')).toHaveCount(0)

  const middleReorderButton = reorderButton('Queue video one')
  await expect(middleReorderButton).toHaveAccessibleName('Reorder Queue video one')
  await expect(middleReorderButton).toHaveAccessibleDescription(
    'Use the Up and Down Arrow keys to move this video in the queue.'
  )
  await expect(middleReorderButton).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown')
  await expect(queueItem('Queue video one')).toHaveAttribute('aria-posinset', '2')
  await expect(queueItem('Queue video one')).toHaveAttribute('aria-setsize', '3')

  const draggedItem = reorderButton('Queue video three')
  await expect(draggedItem).toHaveAttribute('title', 'Drag Queue video three to reorder queue')
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await draggedItem.dispatchEvent('dragstart', { dataTransfer })
  await queueItem('Queue video two').dispatchEvent('drop', { dataTransfer })
  await draggedItem.dispatchEvent('dragend', { dataTransfer })
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])

  const firstReorderButton = reorderButton('Queue video one')
  await firstReorderButton.press('ArrowUp')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(firstReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText(
    'Cannot move Queue video one up. It is already at position 1 of 3.'
  )

  const thirdReorderButton = reorderButton('Queue video three')
  await thirdReorderButton.press('ArrowDown')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText(
    'Cannot move Queue video three down. It is already at position 3 of 3.'
  )

  await thirdReorderButton.press('ArrowUp')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video three',
    'Queue video two'
  ])
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-posinset', '2')
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-setsize', '3')
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText('Moved Queue video three to position 2 of 3.')

  await page.keyboard.press('ArrowDown')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-posinset', '3')
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText('Moved Queue video three to position 3 of 3.')

  await queue.getByRole('button', { name: 'Remove Queue video three from queue' }).click()
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two'
  ])

  await page.evaluate(() => {
    const store = window.$store
    for (let index = 0; index < 20; index++) {
      store.commit('addVideoToWatchQueue', {
        video: {
          videoId: `overflow${index}`,
          title: `Overflow video ${index}`,
          author: 'Queue Test Channel'
        }
      })
    }
  })
  await expect(queueItems).toHaveCount(22)
  const queueScroller = queue.locator('.queueItems')
  await queueScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => queueScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => {
    const store = window.$store
    const queueItemIds = store.getters.getWatchQueue.slice(4).map(item => item.queueItemId)
    for (const queueItemId of queueItemIds) {
      store.commit('removeVideoFromWatchQueue', queueItemId)
    }
  })
  await expect(queueItems).toHaveCount(4)
  await expect.poll(() => queueScroller.evaluate(element => element.scrollTop)).toBe(0)

  await queue.getByRole('button', { name: 'Clear Queue' }).click()
  await expect(queue).toBeHidden()
})

test('restores the remaining queue in order after restarting and keeps clearing it persistent', async ({ app, page }) => {
  test.setTimeout(120_000)
  await goTo(page, 'history')
  await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video two', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video three', 'Play Next')
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  await page.locator('.queueItem').filter({ hasText: 'Queue video two' })
    .getByRole('button', { name: 'Reorder Queue video two' }).press('ArrowUp')

  ;({ page } = await app.relaunch())
  let queue = page.locator('.watchQueue')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video three', 'Queue video two', 'Queue video one'
  ])

  // Restored IDs must remain distinct from IDs assigned to new duplicates.
  await page.getByRole('button', { name: 'Expand side navigation' }).click()
  await goTo(page, 'history')
  await chooseVideoOption(page, 'Queue video two', 'Add to Queue')
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  await expect(queue.locator('.queueItem')).toHaveCount(4)
  await queue.getByRole('button', { name: 'Remove Queue video one from queue' }).click()
  await queue.locator('.queueVideo').first().click()
  await expect(queue.locator('.queueVideoTitle')).toHaveText(['Queue video two', 'Queue video two'])

  ;({ page } = await app.relaunch())
  queue = page.locator('.watchQueue')
  await expect(queue.locator('.queueVideoTitle')).toHaveText(['Queue video two', 'Queue video two'])
  await queue.getByRole('button', { name: 'Remove Queue video two from queue' }).last().click()
  await expect(queue.locator('.queueVideoTitle')).toHaveText(['Queue video two'])
  await queue.getByRole('button', { name: 'Clear Queue' }).click()

  ;({ page } = await app.relaunch())
  await expect(page.locator('.watchQueue')).toBeHidden()
  expect(await page.evaluate(() => window.$store.getters.getWatchQueueLength)).toBe(0)
})

test('shares queue changes across windows without restoring cleared items', async ({ app, page }) => {
  test.setTimeout(120_000)
  await goTo(page, 'history')
  await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
  const second = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(second)
  await goTo(second, 'history')
  await page.evaluate(() => window.$store.commit('clearWatchQueue'))
  await chooseVideoOption(second, 'Queue video two', 'Add to Queue')
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  await second.locator('a.title').filter({ hasText: /Current video/ }).click()
  for (const window of [page, second]) {
    await expect(window.locator('.queueVideoTitle')).toHaveText(['Queue video two'])
  }
  // Updates issued together by different renderers must both be saved.
  await Promise.all([page, second].map((window, index) => window.evaluate(videoId => {
    window.$store.commit('addVideoToWatchQueue', { video: { videoId, title: videoId } })
  }, `concurrent-${index}`)))
  for (const window of [page, second]) await expect(window.locator('.queueItem')).toHaveCount(3)
  await second.close()
  ;({ page } = await app.relaunch())
  await expect(page.locator('.queueItem')).toHaveCount(3)
  await expect(page.locator('.queueVideoTitle').first()).toHaveText('Queue video two')
  expect(await page.locator('.queueVideoTitle').allTextContents()).toEqual(expect.arrayContaining(['concurrent-0', 'concurrent-1']))
})

for (const clearAll of [false, true]) {
  test(`mobile queue closes after ${clearAll ? 'clearing everything' : 'removing the last video'}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 850 })
    await goTo(page, 'history')
    await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
    await page.locator('a.title').filter({ hasText: /Current video/ }).click()
    await page.getByRole('button', { name: 'Queue Queue video one', exact: true }).click()
    const panel = page.getByRole('dialog').filter({ has: page.locator('.watchQueue') })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: clearAll ? 'Clear Queue' : 'Remove Queue video one from queue', exact: true }).click()
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })
}
