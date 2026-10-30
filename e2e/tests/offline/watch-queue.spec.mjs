import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

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
      historyEntry('queuevideo1', 'Queue video one', now - 1000),
      historyEntry('queuevideo2', 'Queue video two', now - 2000),
      historyEntry('queuevideo3', 'Queue video three', now - 3000),
      historyEntry('currentvid1', 'Current video', now - 4000)
    ]
  }
})

async function chooseVideoOption (page, title, option) {
  const video = page.locator('.ft-list-video').filter({ hasText: title })
  await video.hover()
  await video.locator('.title').click({ button: 'right' })
  await page.getByRole('menuitem', { name: option }).click()
}

async function chooseQueueItemOption (page, item, option) {
  await item.getByRole('button', { name: 'More options', exact: true }).click()
  await page.getByRole('menuitem', { name: option, exact: true }).click()
}

// Main applies queue requests in order, so this resolves once the page's
// earlier queue changes are saved and a restart cannot drop them.
async function relaunchAfterQueueSaved (app, page) {
  await page.evaluate(() => window.ftElectron.watchQueue.update({}))
  return app.relaunch()
}

test('dragging the bottom queue item follows the pointer upward', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await setWindowSize(app, page, { width: 1500, height: 1100 })
  await page.evaluate(() => window.$store.dispatch('updateHideRecommendedVideos', true))
  await goTo(page, 'history')
  await page.evaluate(() => {
    for (const [videoId, title] of [['queuevideo1', 'Queue video one'], ['queuevideo2', 'Queue video two']]) {
      window.$store.commit('addVideoToWatchQueue', { video: { videoId, title, author: 'Queue Test Channel', lengthSeconds: 60 } })
    }
  })
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  const queue = page.locator('.watchQueue')
  const bottom = queue.locator('.queueItem').filter({ hasText: 'Queue video two' })
  const top = queue.locator('.queueItem').filter({ hasText: 'Queue video one' })
  const handle = bottom.locator('.queueDragHandle')
  await handle.hover()
  await expect(top).toHaveCSS('transform', 'none')
  await expect(bottom).toHaveCSS('transform', 'none')
  const bottomBounds = await bottom.boundingBox()
  const topBounds = await top.boundingBox()
  const handleBounds = await handle.boundingBox()
  const x = handleBounds.x + handleBounds.width / 2
  const y = handleBounds.y + handleBounds.height / 2
  const distance = bottomBounds.y - topBounds.y
  await page.mouse.down()
  await page.mouse.move(x, y - distance, { steps: 10 })
  await expect(bottom).toHaveClass(/dragging/)
  await expect.poll(() => bottom.evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(topBounds.y, 0)
  await expect.poll(() => top.evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(bottomBounds.y, 0)
  await attachScreenshot('bottom-queue-item-dragged-up')
  await page.mouse.up()
  await expect(queue.locator('.queueItem h3')).toHaveText(['Queue video two', 'Queue video one'])
  await expect(bottom).not.toHaveClass(/dragging/)
})

test('centers queue item content between the row dividers', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await setWindowSize(app, page, { width: 1500, height: 1100 })
  await page.evaluate(() => window.$store.dispatch('updateHideRecommendedVideos', true))
  await goTo(page, 'history')
  await page.evaluate(() => {
    for (const [videoId, title] of [
      ['queuevideo1', 'Queue video one'],
      ['queuevideo2', 'Queue video two has a title long enough to wrap onto three lines in the queue sidebar']
    ]) {
      window.$store.commit('addVideoToWatchQueue', { video: { videoId, title, author: 'Queue Test Channel', lengthSeconds: 60, viewCount: 1000, published: Date.now() - 86400000 } })
    }
  })
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  const items = page.locator('.watchQueue .queueItem')
  await expect(items.locator('.videoThumbnail')).toHaveCount(2)
  const rows = await items.evaluateAll(rows => rows.map(row => {
    const rowBounds = row.getBoundingClientRect()
    const contentBounds = [...row.querySelectorAll('.videoThumbnail, .title, .infoLine')]
      .map(element => element.getBoundingClientRect())
    const center = selector => {
      const bounds = row.querySelector(selector).getBoundingClientRect()
      return bounds.top + bounds.height / 2
    }
    const borderBottom = parseFloat(getComputedStyle(row).borderBlockEndWidth)
    return {
      above: Math.min(...contentBounds.map(bounds => bounds.top)) - rowBounds.top,
      below: rowBounds.bottom - borderBottom - Math.max(...contentBounds.map(bounds => bounds.bottom)),
      handleCenter: center('.queueDragHandle'),
      thumbnailCenter: center('.videoThumbnail')
    }
  }))
  await attachScreenshot('queue-item-spacing')
  for (const row of rows) {
    expect(row.below).toBeCloseTo(row.above, 0)
    expect(row.thumbnailCenter).toBeCloseTo(row.handleCenter, 0)
  }
})

test('manages the queue from video menus and the watch sidebar', { tag: '@scale' }, async ({ page }) => {
  await goTo(page, 'history')

  await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video two', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video three', 'Play Next')

  await page.locator('a.title').filter({ hasText: /Current video/ }).click()

  const queue = page.locator('.watchQueue')
  await expect(queue).toBeVisible()
  await expect(queue.locator('.queueDragHandle svg')).toHaveCount(3)
  await expect(queue.locator('.queueItem h3')).toHaveText([
    'Queue video three',
    'Queue video one',
    'Queue video two'
  ])

  const queueItems = queue.locator('.queueItem')
  const queueItem = title => queueItems.filter({ hasText: title })
  const reorderButton = title => queueItem(title).getByRole('button', { name: `Reorder ${title}` })
  const moveStatus = queue.locator('[role="status"]')

  // Queued videos show the same duration and metadata as playlist items.
  await expect(queueItem('Queue video one').locator('.videoDuration')).toHaveText('1:00')
  await expect(queueItem('Queue video one').locator('.viewCount')).toHaveText('100 views')
  await expect(queueItem('Queue video one').locator('.uploadedTime')).toBeVisible()

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
  // Like tabs, the dragged row follows the pointer on one axis and pushes the others aside.
  const draggedRow = queueItem('Queue video three')
  const rowBounds = await draggedRow.boundingBox()
  const lastBounds = await queueItem('Queue video two').boundingBox()
  const handleBounds = await draggedItem.boundingBox()
  const startX = handleBounds.x + handleBounds.width / 2
  const startY = handleBounds.y + handleBounds.height / 2
  // Hovering waits until the queue toasts no longer cover the handle.
  await draggedItem.hover()
  await page.mouse.down()
  await page.mouse.move(startX + 80, startY + lastBounds.y + lastBounds.height - rowBounds.y - rowBounds.height, { steps: 10 })
  await expect.poll(() => draggedRow.evaluate(element => element.getBoundingClientRect().x)).toBeCloseTo(rowBounds.x, 1)
  for (const title of ['Queue video one', 'Queue video two']) {
    await expect.poll(() => queueItem(title).evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m42))
      .toBeLessThan(-rowBounds.height / 2)
  }
  await page.mouse.up()
  await expect(queue.locator('.queueItem h3')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])

  const firstReorderButton = reorderButton('Queue video one')
  await firstReorderButton.press('ArrowUp')
  await expect(queue.locator('.queueItem h3')).toHaveText([
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
  await expect(queue.locator('.queueItem h3')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText(
    'Cannot move Queue video three down. It is already at position 3 of 3.'
  )

  await thirdReorderButton.press('ArrowUp')
  await expect(queue.locator('.queueItem h3')).toHaveText([
    'Queue video one',
    'Queue video three',
    'Queue video two'
  ])
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-posinset', '2')
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-setsize', '3')
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText('Moved Queue video three to position 2 of 3.')

  await page.keyboard.press('ArrowDown')
  await expect(queue.locator('.queueItem h3')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-posinset', '3')
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText('Moved Queue video three to position 3 of 3.')

  // The item menu offers the same moves without dragging.
  await queueItem('Queue video three').getByRole('button', { name: 'More options', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /^Move video down$/i })).toBeDisabled()
  await page.getByRole('menuitem', { name: /^Move video up$/i }).click()
  await expect(queue.locator('.queueItem h3')).toHaveText([
    'Queue video one',
    'Queue video three',
    'Queue video two'
  ])
  await expect(moveStatus).toHaveText('Moved Queue video three to position 2 of 3.')

  await chooseQueueItemOption(page, queueItem('Queue video three'), 'Remove from Queue')
  await expect(queue.locator('.queueItem h3')).toHaveText([
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

  ;({ page } = await relaunchAfterQueueSaved(app, page))
  let queue = page.locator('.watchQueue')
  await expect(queue.locator('.queueItem h3')).toHaveText([
    'Queue video three', 'Queue video two', 'Queue video one'
  ])

  // Restored IDs must remain distinct from IDs assigned to new duplicates.
  await page.getByRole('button', { name: 'Expand side navigation' }).click()
  await goTo(page, 'history')
  await chooseVideoOption(page, 'Queue video two', 'Add to Queue')
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  await expect(queue.locator('.queueItem')).toHaveCount(4)
  await chooseQueueItemOption(page, queue.locator('.queueItem').filter({ hasText: 'Queue video one' }), 'Remove from Queue')
  await queue.locator('.queueItem h3').first().click()
  await expect(queue.locator('.queueItem h3')).toHaveText(['Queue video two', 'Queue video two'])

  ;({ page } = await relaunchAfterQueueSaved(app, page))
  queue = page.locator('.watchQueue')
  await expect(queue.locator('.queueItem h3')).toHaveText(['Queue video two', 'Queue video two'])
  await chooseQueueItemOption(page, queue.locator('.queueItem').filter({ hasText: 'Queue video two' }).last(), 'Remove from Queue')
  await expect(queue.locator('.queueItem h3')).toHaveText(['Queue video two'])
  await queue.getByRole('button', { name: 'Clear Queue' }).click()

  ;({ page } = await relaunchAfterQueueSaved(app, page))
  await expect(page.locator('.watchQueue')).toBeHidden()
  expect(await page.evaluate(() => window.$store.getters.getWatchQueueLength)).toBe(0)
})

test('shares queue changes across windows without restoring cleared items', async ({ app, page }) => {
  test.setTimeout(120_000)
  await goTo(page, 'history')
  await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
  const firstWindowId = await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)
  const second = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(second)
  await goTo(second, 'history')
  await page.evaluate(() => window.$store.commit('clearWatchQueue'))
  await chooseVideoOption(second, 'Queue video two', 'Add to Queue')
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  await second.locator('a.title').filter({ hasText: /Current video/ }).click()
  for (const window of [page, second]) {
    await expect(window.locator('.queueItem h3')).toHaveText(['Queue video two'])
  }
  // Updates issued together by different renderers must both be saved.
  await Promise.all([page, second].map((window, index) => window.evaluate(videoId => {
    window.$store.commit('addVideoToWatchQueue', { video: { videoId, title: videoId } })
  }, `concurrent-${index}`)))
  for (const window of [page, second]) await expect(window.locator('.queueItem')).toHaveCount(3)
  // Close it like a user would. Page.close() skips the window's close handler,
  // which keeps its session, so the relaunch could open that window first.
  const secondClosed = second.waitForEvent('close')
  await app.electronApp.evaluate(({ BrowserWindow }, firstWindowId) => {
    BrowserWindow.getAllWindows().find(window => window.id !== firstWindowId).close()
  }, firstWindowId)
  await secondClosed
  ;({ page } = await app.relaunch())
  expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await expect(page.locator('.queueItem')).toHaveCount(3)
  await expect(page.locator('.queueItem h3').first()).toHaveText('Queue video two')
  expect(await page.locator('.queueItem h3').allTextContents()).toEqual(expect.arrayContaining(['concurrent-0', 'concurrent-1']))
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
    if (clearAll) {
      await panel.getByRole('button', { name: 'Clear Queue', exact: true }).click()
    } else {
      await chooseQueueItemOption(page, panel.locator('.queueItem').filter({ hasText: 'Queue video one' }), 'Remove from Queue')
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })
}

test('saves the queue to a new playlist and appends a playlist to the queue in its displayed order', async ({ page }) => {
  const queuedVideo = (videoId, title) => ({
    videoId, title, author: 'Queue Test Channel', authorId: 'UC-queue-test-channel', lengthSeconds: 60, viewCount: 100,
  })
  const addToQueue = videos => page.evaluate(videos => {
    for (const video of videos) window.$store.commit('addVideoToWatchQueue', { video })
  }, videos)
  await goTo(page, 'history')
  // Local playlists only hold YouTube videos, so other queued media is not saved.
  await addToQueue([{ videoId: 'external-clip', title: 'External clip' }])
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  const queue = page.locator('.watchQueue')
  const saveButton = queue.getByRole('button', { name: 'Save Queue to Playlist', exact: true })
  await expect(queue.locator('.queueItem h3')).toHaveText(['External clip'])
  await expect(queue.locator('.ft-list-video')).toHaveCount(0)
  await expect(saveButton).toHaveCount(0)

  await addToQueue([queuedVideo('queueVideoA', 'Saved video A'), queuedVideo('queueVideoB', 'Saved video B'), { ...queuedVideo('queueVideoC', 'Saved video C'), isMusic: true }])
  const queuedTitles = ['External clip', 'Saved video A', 'Saved video B', 'Saved video C']
  await expect(queue.locator('.queueItem h3')).toHaveText(queuedTitles)
  await expect(queue.locator('.queueItem').filter({ hasText: 'Saved video C' }).locator('.videoDuration').getByRole('img', { name: 'Music video' })).toBeVisible()
  await saveButton.click()
  const addDialog = page.getByRole('dialog').filter({ hasText: 'Select a playlist to add your 3 videos to' })
  await expect(addDialog).toBeVisible()
  await addDialog.getByRole('button', { name: /^Create new playlist$/i }).click()
  const createDialog = page.getByRole('dialog').filter({ has: page.locator('.playlistNameInput') })
  await createDialog.locator('input').fill('Saved queue')
  await createDialog.getByRole('button', { name: 'Create', exact: true }).click()
  await addDialog.getByRole('button', { name: 'Save', exact: true }).click()

  const getPlaylist = () => page.evaluate(() => window.$store.getters.getAllPlaylists.find(playlist => playlist.playlistName === 'Saved queue'))
  const savedIds = ['queueVideoA', 'queueVideoB', 'queueVideoC']
  await expect.poll(async () => (await getPlaylist())?.videos.map(video => video.videoId)).toEqual(savedIds)
  const playlist = await getPlaylist()
  expect(playlist.videos[0]).toMatchObject(queuedVideo('queueVideoA', 'Saved video A'))
  for (const video of playlist.videos) expect(video).not.toHaveProperty('queueItemId')
  await expect(queue.locator('.queueItem h3')).toHaveText(queuedTitles)

  await page.evaluate(() => window.$store.dispatch('updateUserPlaylistSortOrder', 'video_title_descending'))
  const tab = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: false }), `/playlist/${playlist._id}?playlistType=user`)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await page.getByTitle('Add Playlist to Queue', { exact: true }).filter({ visible: true }).click()
  await expect(page.getByText('Playlist added to queue', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.$store.getters.getWatchQueue.map(item => item.title)))
    .toEqual([...queuedTitles, 'Saved video C', 'Saved video B', 'Saved video A'])
  expect((await getPlaylist()).videos.map(video => video.videoId)).toEqual(savedIds)
})

test('removes a queued video that a click opens in the default external player', async ({ app, page }) => {
  await goTo(page, 'history')
  await page.evaluate(videos => {
    for (const video of videos) window.$store.commit('addVideoToWatchQueue', { video })
  }, [
    { videoId: 'externalQ01', title: 'External player video', author: 'Queue Test Channel', lengthSeconds: 60 },
    { videoId: 'externalQ02', title: 'Next queued video', author: 'Queue Test Channel', lengthSeconds: 60 },
  ])
  await page.locator('a.title').filter({ hasText: /Current video/ }).click()
  const queue = page.locator('.watchQueue')
  await expect(queue.locator('.queueItem')).toHaveCount(2)

  const executable = path.join(app.userDataDir, 'capture-player-arguments.mjs')
  const capturedArguments = path.join(app.userDataDir, 'player-arguments.json')
  await writeFile(executable, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))\n")
  await page.evaluate(async ({ executable, capturedArguments, nodePath }) => {
    const store = window.$store
    await store.dispatch('updateExternalPlayer', 'mpv')
    await store.dispatch('updateDefaultViewingMode', 'external_player')
    await store.dispatch('updateExternalPlayerExecutable', nodePath)
    await store.dispatch('updateExternalPlayerCustomArgs', JSON.stringify([executable, capturedArguments]))
  }, { executable, capturedArguments, nodePath: process.execPath })

  await queue.locator('.queueItem a.title').filter({ hasText: 'External player video' }).click()
  await expect.poll(async () => {
    try {
      return JSON.parse(await readFile(capturedArguments, 'utf8')).at(-1)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }).toBe('https://www.youtube.com/watch?v=externalQ01')
  await expect(queue.locator('.queueItem h3')).toHaveText(['Next queued video'])
})
