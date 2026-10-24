import { test, expect, goTo, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { clickFullscreenAction, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function expectValidScrollRange(scroller) {
  await expect.poll(() => scroller.evaluate(element => {
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    const lastItem = [...element.querySelectorAll(':scope > .playlistItem')].at(-1)
    const viewport = element.getBoundingClientRect()
    const end = lastItem
      ? lastItem.getBoundingClientRect().bottom + (Number.parseFloat(getComputedStyle(lastItem).marginBlockEnd) || 0)
      : viewport.top
    const scrollable = element.scrollHeight > element.clientHeight
    return {
      offsetValid: element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1,
      contentEndValid: element.scrollTop === 0 || end >= viewport.bottom - 1,
      scrollbarValid: !!scrollbar && (scrollable || !scrollbar.classList.contains('os-scrollbar-visible') || scrollbar.classList.contains('os-scrollbar-unusable')),
      scrollTop: element.scrollTop,
      contentEnd: end,
      viewportEnd: viewport.bottom
    }
  })).toMatchObject({ offsetValid: true, contentEndValid: true, scrollbarValid: true })
}

const videos = Array.from({ length: 12 }, (_, index) => ({
  videoId: index === 0 ? 'jNQXAC9IVRw' : `layoutvideo${index}`,
  title: `Playlist video ${index + 1}`,
  author: 'Test channel',
  authorId: 'UC-test-channel-id',
  lengthSeconds: 120,
  ...(index === 11 ? {} : { viewCount: index === 10 ? null : index === 9 ? 0 : 12345 }),
  published: Date.now() - 86400000,
  timeAdded: Date.now() + index,
  playlistItemId: `layout-item-${index}`,
  type: 'video'
}))

// Every test launches Electron, starts playback and then runs several layout
// phases, which leaves little headroom under the default timeout when parallel
// workers share the CPU.
test.describe.configure({ timeout: 120_000 })

test.use({
  seed: {
    settings: {
      animationSpeed: 0,
      shortenViewCounts: false,
      userPlaylistSortOrder: 'custom',
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    },
    history: [{ ...videos[1], _id: videos[1].videoId, isWatched: true, watchProgress: 60, timeWatched: Date.now() }],
    playlists: [{
      _id: 'layout-playlist',
      playlistName: 'Layout test playlist',
      protected: false,
      description: '',
      videos,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now()
    }]
  }
})

async function openPlaylist(app, page) {
  await mockPlayableWatchPage(app, page)
  await goTo(page, 'userplaylists')
  await page.getByText('Layout test playlist', { exact: true }).click()
  await page.getByText('Playlist video 1', { exact: true }).click()
  await waitForPlayback(page)
  await expect(page.locator('.watchVideoPlaylist .playlistItem')).toHaveCount(videos.length)
  return watchViewHandle(page)
}

test('playing playlist shows thumbnail numbers and retains reorder controls', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  const watch = await openPlaylist(app, page)
  const panel = page.locator('.watchVideoPlaylist').filter({ visible: true })
  await expect(panel.locator('.playlistIndex label')).toHaveText('1 / 12')
  await expect(panel.locator('.videoIndex')).toHaveCount(0)
  await expect(panel.locator('.videoIndexIcon')).toBeVisible()
  const secondRow = panel.locator('.playlistItem').nth(1)
  await expect(secondRow.locator('.grabBar')).toBeVisible()
  await expect(secondRow.locator('.videoDuration')).toHaveText('2:00')
  await expect(secondRow.locator('.playlistIndexBadge')).toHaveText('2')
  await expect.poll(() => secondRow.locator('.videoThumbnail').evaluate(thumbnail => {
    const bounds = thumbnail.getBoundingClientRect()
    const index = thumbnail.querySelector('.playlistIndexBadge').getBoundingClientRect()
    const duration = thumbnail.querySelector('.videoDuration').getBoundingClientRect()
    return Math.abs(index.left - bounds.left - 4) < 1 && Math.abs(index.top - bounds.top - 4) < 1 && index.bottom <= duration.top
  })).toBe(true)
  await attachScreenshot('playing-playlist-thumbnail-numbers')
  await panel.screenshot({ path: test.info().outputPath('playlist-thumbnail-numbers.png') })
  await secondRow.locator('.videoIndexArea').press('ArrowDown')
  await expect(panel.locator('.playlistItem').nth(2)).toContainText('Playlist video 2')
  await expect(panel.locator('.playlistItem').nth(2).locator('.playlistIndexBadge')).toHaveText('3')
  await expect(panel.locator('.playlistIndex label')).toHaveText('1 / 12')
  await watch.dispose()
})

test('playlist row menu moves and removes videos while thumbnail shortcuts stay contained', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await openPlaylist(app, page)
  const item = page.locator('.watchVideoPlaylist .playlistItem').nth(1)
  const expectContainedActions = async () => {
    await item.hover()
    await expect.poll(() => item.evaluate(element => {
      const image = [...element.querySelectorAll('.thumbnailImage')]
        .find(image => getComputedStyle(image).visibility !== 'hidden').getBoundingClientRect()
      const buttons = [...element.querySelectorAll('.playlistIcons button')]
      return buttons.length > 0 && buttons.every(button => {
        const bounds = button.getBoundingClientRect()
        return bounds.left >= image.left - 0.5 && bounds.right <= image.right + 0.5 &&
        bounds.top >= image.top - 0.5 && bounds.bottom <= image.bottom + 0.5
      })
    })).toBe(true)
  }
  await expectContainedActions()
  await page.evaluate(async () => {
    await window.$store.dispatch('addPlaylist', { _id: 'bookmarks', playlistName: 'Bookmarks', videos: [] })
    await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', 'bookmarks')
    await window.$store.dispatch('updateExtraThumbnailAction', 'history')
  })
  await expect(item.locator('.extraThumbnailActionIcon')).toBeVisible()
  await expect(item.locator('.playlistIcons button')).toHaveCount(3)
  await expectContainedActions()
  await item.locator('.addToPlaylistIcon button').click()
  await expect(page.locator('.addToPlaylistDropdown')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(item.locator('.upArrowIcon, .downArrowIcon, .trashIcon')).toHaveCount(0)
  await expect.poll(() => item.evaluate(element => {
    const menu = element.querySelector('.playlistItemMenu').getBoundingClientRect()
    const info = element.querySelector('.info').getBoundingClientRect()
    return menu.left >= info.right - 0.5 && menu.right <= element.getBoundingClientRect().right + 0.5
  })).toBe(true)
  await item.locator('.playlistItemMenu button').click()
  await expect(page.getByRole('menuitem', { name: /^Move video up$/i })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: /^Move video down$/i })).toBeEnabled()
  await page.getByRole('menuitem', { name: /^Move video up$/i }).click()
  const titles = page.locator('.watchVideoPlaylist .playlistItem .h3Title')
  await expect(titles.first()).toHaveText('Playlist video 2')
  const movedItem = page.locator('.watchVideoPlaylist .playlistItem').first()
  await movedItem.locator('.playlistItemMenu button').click()
  await expect(page.getByRole('menuitem', { name: /^Move video up$/i })).toBeDisabled()
  await page.getByRole('menuitem', { name: /^Move video down$/i }).click()
  await expect(titles.nth(1)).toHaveText('Playlist video 2')
  await item.locator('.playlistItemMenu button').click()
  await page.getByRole('menuitem', { name: /^Remove from playlist$/i }).click()
  await expect(titles).toHaveCount(videos.length - 1)
  await expect(page.locator('.watchVideoPlaylist .playlistItem').filter({ has: page.getByRole('heading', { name: 'Playlist video 2', exact: true }) })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylist('layout-playlist').videos.some(video => video.title === 'Playlist video 2'))).toBe(false)
  await item.locator('.playlistItemMenu button').click()
  await expect(page.getByRole('menuitem', { name: /^Remove from playlist$/i })).toBeVisible()
  await expect(page.locator('.contextMenu')).toHaveCSS('opacity', '1')
  await attachScreenshot('playlist row actions menu')
})

test('playlist preview batches pointer measurements', { tag: '@scale' }, async ({ app, page }) => {
  const watch = await openPlaylist(app, page)
  const panel = page.locator('.watchVideoPlaylist').filter({ visible: true })
  const container = panel.locator('.playlistProgressBarContainer')
  await container.hover()
  await expect(panel.locator('.progressBarPreview')).toBeVisible()
  const reads = await container.evaluate(async element => {
    const bar = element.querySelector('.playlistProgressBar')
    const original = bar.getBoundingClientRect
    const bounds = original.call(bar)
    let reads = 0
    bar.getBoundingClientRect = function () { reads++; return original.call(this) }
    try {
      for (let index = 0; index < 50; index++) {
        element.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, clientX: bounds.left + bounds.width * index / 49
        }))
      }
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))
      return reads
    } finally {
      bar.getBoundingClientRect = original
    }
  })
  console.log('Rendered playlist preview pointer work:', { reads })
  expect(reads).toBe(1)
  await expect(panel.locator('.previewText')).toContainText('12 / 12')
  const expectInsidePanel = async () => {
    const panelBounds = await panel.boundingBox()
    const tooltip = await panel.locator('.previewTooltip').boundingBox()
    expect(tooltip.x).toBeGreaterThanOrEqual(panelBounds.x + 7)
    expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width - 7)
  }
  await expectInsidePanel()
  await setWindowSize(app, page, { width: 1200, height: 800 })
  await container.hover({ position: { x: 2, y: 5 } })
  await expect(panel.locator('.previewText')).toContainText('1 / 12')
  await expectInsidePanel()
  await page.mouse.move(10, 10)
  await expect(panel.locator('.progressBarPreview')).toHaveCount(0)
  await watch.dispose()
})

test('phone playlist centers pending current items when opened', { tag: '@scale' }, async ({ app, page }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.setViewportSize({ width: 480, height: 800 })
  await page.evaluate(async () => {
    const store = window.$store
    // Phone grid cards can detach while being clicked: https://github.com/OpenTubeX/OpenTubeX/issues/2149
    await store.dispatch('updatePlaylistViewType', 'list')
    const playlist = store.getters.getPlaylist('layout-playlist')
    const [current, ...others] = playlist.videos
    await store.dispatch('updatePlaylist', { ...playlist, videos: [...others.slice(0, 8), current, ...others.slice(8)] })
  })
  const watch = await openPlaylist(app, page)
  await page.locator('.phonePlaylistButton').click()
  const sheet = page.locator('.dockedSheet[open]')
  const list = sheet.locator('.playlistItemsWrapper')
  const current = list.locator('.playlistItem').filter({ has: page.getByText('Playlist video 1', { exact: true }) })
  const expectCurrentVisible = async () => {
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    await expect.poll(async () => {
      const item = await current.boundingBox()
      const viewport = await list.boundingBox()
      return item != null && viewport != null && item.y >= viewport.y - 1 && item.y + item.height <= viewport.y + viewport.height + 1
    }).toBe(true)
  }
  await expectCurrentVisible()
  await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await watch.evaluate(async vm => {
    const playlist = vm.$store.getters.getPlaylist('layout-playlist')
    const current = playlist.videos.find(video => video.videoId === vm.videoId)
    const others = playlist.videos.filter(video => video !== current)
    await vm.$store.dispatch('updatePlaylist', { ...playlist, videos: [...others.slice(0, 10), current, ...others.slice(10)] })
  })
  await page.locator('.phonePlaylistButton').click()
  await expectCurrentVisible()
  await watch.dispose()
})

test('portrait playlist opens below the video and clamps after resize and removal', { tag: '@scale' }, async ({ app, page, attachScreenshot, uiScale }) => {
  const watch = await openPlaylist(app, page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.setViewportSize({ width: Math.round(480 * uiScale / 100), height: Math.round(800 * uiScale / 100) })
  await watch.evaluate(vm => { vm.videoDescription = 'Description line\n'.repeat(30); vm.videoDescriptionHtml = '' })
  const preview = page.locator('.phoneDescriptionPreview')
  await expect(preview).toHaveClass(/short/)
  const descriptionScroll = preview.locator('.descriptionScroll')
  await expect.poll(() => preview.locator('.description').evaluate(el =>
    el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)
  )).toBeCloseTo(5, 1)
  expect(await descriptionScroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await expect(page.locator('.watchVideoPlaylist')).toBeHidden()
  await page.locator('.phonePlaylistButton').click()
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet).toBeVisible()
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  await expect(sheet.locator('.mobileSheetHeader')).toContainText('Layout test playlist')
  await expect(sheet.locator('.playlistIndex')).toBeHidden()
  await expect(sheet.locator('.playlistProgressBarContainer')).toBeHidden()
  const list = sheet.locator('.playlistItemsWrapper')
  await expect(list).toHaveAttribute('data-overlayscrollbars-viewport')
  await expect.poll(async () => {
    const header = await sheet.locator('.playlistHeader').boundingBox()
    const viewport = await list.boundingBox()
    return viewport.y >= header.y + header.height - 1
  }).toBe(true)
  const videoBox = await page.locator('.ftVideoPlayer').boundingBox()
  const sheetBox = await sheet.boundingBox()
  expect(sheetBox.y).toBeGreaterThanOrEqual(videoBox.y + videoBox.height - 1)
  const actions = sheet.locator('.mobileSheetHeader .playlistButtons')
  await expect(actions).toBeVisible()
  await expect(sheet.locator('.phonePanelContent .playlistButtons')).toHaveCount(0)
  for (const button of await actions.getByRole('button').all()) {
    const bounds = await button.boundingBox()
    // Chromium rounds fractional CSS pixels at non-100% UI scales.
    expect(bounds.width).toBeGreaterThanOrEqual(47.9)
    expect(bounds.height).toBeGreaterThanOrEqual(47.9)
  }
  await actions.getByRole('button', { name: 'Shuffle Playlist' }).click()
  await expect(actions.getByRole('button', { name: 'Shuffle Playlist' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => actions.getByRole('button', { name: 'Shuffle Playlist' }).evaluate(el => getComputedStyle(el).color))
    .toBe(await page.evaluate(() => {
      const el = document.createElement('span')
      el.style.color = 'var(--accent-color)'
      document.body.append(el)
      const color = getComputedStyle(el).color
      el.remove()
      return color
    }))
  await actions.getByRole('button', { name: 'Shuffle Playlist' }).click()
  await list.evaluate(el => { el.scrollTop = 200 })
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(200)
  const actionBounds = await actions.boundingBox()
  const headerBounds = await sheet.locator('.mobileSheetHeader').boundingBox()
  expect(actionBounds.y).toBeGreaterThanOrEqual(headerBounds.y)
  expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(headerBounds.y + headerBounds.height)
  expect(actionBounds.x + actionBounds.width).toBeLessThanOrEqual(headerBounds.x + headerBounds.width)
  await attachScreenshot('portrait playlist header actions')
  const position = await list.evaluate(el => el.scrollTop)
  await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await page.locator('.phonePlaylistButton').click()
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(position)

  await list.evaluate(async el => {
    for (let i = 0; i < 3; i++) {
      el.scrollTop = el.scrollHeight
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  })
  // A taller sheet increases the viewport while the list is at its old end.
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 480, height: 950 }))
  await page.setViewportSize({ width: Math.round(480 * uiScale / 100), height: Math.round(950 * uiScale / 100) })
  await expectValidScrollRange(list)
  await list.evaluate(el => { el.scrollTop = el.scrollHeight })
  await watch.evaluate(async vm => {
    for (const video of vm.$store.getters.getPlaylist('layout-playlist').videos.slice(1)) {
      await vm.$store.dispatch('removeVideo', { _id: 'layout-playlist', videoId: video.videoId, playlistItemId: video.playlistItemId })
    }
  })
  await expect(list.locator('.playlistItem')).toHaveCount(1)
  await expectValidScrollRange(list)
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0)
  await attachScreenshot('portrait playlist')
  await sheet.press('Escape')
  await expect(sheet).toHaveCount(0)
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 800 }))
  await page.setViewportSize({ width: Math.round(1280 * uiScale / 100), height: Math.round(800 * uiScale / 100) })
  await expect(page.locator('.watchVideoPlaylist')).toBeVisible()
  await expect(page.locator('.watchVideoPlaylist .playlistTitle')).toContainText('Layout test playlist')
  await expect(page.locator('.watchVideoPlaylist .playlistHeader .playlistButtons')).toBeVisible()
  await expect(page.locator('.watchVideoPlaylist .playlistIndex')).toBeVisible()
  await expect(page.locator('.watchVideoPlaylist .playlistProgressBarContainer')).toBeVisible()
})

test('shuffled and reversed playlists keep the progress bar between the counter and buttons', { tag: '@scale' }, async ({ app, page }) => {
  const watch = await openPlaylist(app, page)
  const panel = page.locator('.watchVideoPlaylist').filter({ visible: true })
  const shuffle = panel.getByRole('button', { name: 'Shuffle Playlist' })
  const reverse = panel.getByRole('button', { name: 'Reverse Playlist' })
  const expectControlsBelowCounter = async () => {
    await expect(panel.locator('.playlistProgressBarContainer')).toBeVisible()
    await expect.poll(() => panel.evaluate(element => {
      const counter = element.querySelector('.playlistIndex label').getBoundingClientRect()
      const bar = element.querySelector('.playlistProgressBar').getBoundingClientRect()
      const buttons = [...element.querySelectorAll('.playlistButtons .playlistButton')]
        .map(button => button.getBoundingClientRect())
      return bar.top >= counter.bottom - 0.5 && buttons.every(button => button.top >= bar.bottom - 0.5)
    })).toBe(true)
  }

  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await expectControlsBelowCounter()
  await shuffle.click()
  await reverse.click()
  await expect(reverse).toHaveAttribute('aria-pressed', 'true')
  await panel.locator('.playlistItem').first().scrollIntoViewIfNeeded()
  await expect(panel.locator('.playlistItem').first().locator('.playlistIndexBadge')).toHaveText('12')
  await expectControlsBelowCounter()
  await watch.dispose()
})

test('keyboard moves watch playlist videos to the top and bottom', async ({ app, page }) => {
  const watch = await openPlaylist(app, page)
  const titles = page.locator('.watchVideoPlaylist .playlistItem .h3Title')
  const handleOf = title => page.locator('.watchVideoPlaylist .playlistItem')
    .filter({ has: page.getByText(title, { exact: true }) })
    .getByRole('button', { name: 'Drag or use the arrow keys to reorder' })

  await handleOf('Playlist video 3').focus()
  await page.keyboard.press('End')
  await expect(titles.last()).toHaveText('Playlist video 3')
  await expect(handleOf('Playlist video 3')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(titles.first()).toHaveText('Playlist video 3')
  await expect(handleOf('Playlist video 3')).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylist('layout-playlist').videos[0].title))
    .toBe('Playlist video 3')
  await watch.dispose()
})

test('playlist saves retain available view counts across restart', async ({ app, page }) => {
  await openPlaylist(app, page)
  await page.evaluate(async () => {
    await window.$store.dispatch('addPlaylist', { _id: 'saved-counts', playlistName: 'Saved counts', videos: [] })
    await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', 'saved-counts')
  })
  const rows = page.locator('.watchVideoPlaylist .playlistItem')
  await rows.nth(1).hover()
  await rows.nth(1).locator('.quickBookmarkVideoIcon button').click()
  await rows.nth(2).hover()
  await rows.nth(2).locator('.addToPlaylistIcon button').click()
  await page.getByRole('option').filter({ hasText: 'Saved counts' }).click()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylist('saved-counts').videos.map(video => video.viewCount))).toEqual([12345, 12345])
  await page.keyboard.press('Escape')
  for (const index of [9, 10, 11]) {
    await rows.nth(index).hover()
    await rows.nth(index).locator('.quickBookmarkVideoIcon button').click()
  }
  const counts = target => target.evaluate(() => window.$store?.getters.getPlaylist('saved-counts')?.videos.map(video => ({
    hasCount: Object.hasOwn(video, 'viewCount'), count: video.viewCount ?? null
  })))
  const expected = [
    { hasCount: true, count: 12345 }, { hasCount: true, count: 12345 },
    { hasCount: true, count: 0 }, { hasCount: false, count: null }, { hasCount: false, count: null }
  ]
  await expect.poll(() => counts(page)).toEqual(expected)
  const restarted = await app.relaunch()
  await expect.poll(() => counts(restarted.page)).toEqual(expected)
})

for (const [layout, count] of [['fullscreen', 12345], ['Shorts', 0]]) {
  test(`${layout} save controls retain available view counts`, async ({ app, page }) => {
    const watch = await openPlaylist(app, page)
    await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
    await page.evaluate(async () => {
      await window.$store.dispatch('addPlaylist', { _id: 'action-counts', playlistName: 'Action counts', videos: [] })
      await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', 'action-counts')
      await window.$store.dispatch('updateFullscreenActions', ['addToPlaylist', 'quickBookmark'])
    })
    await watch.evaluate((vm, { layout, count }) => {
      vm.videoViewCount = count
      if (layout === 'Shorts') {
        vm.useCustomShortsPlayerForCurrentVideo = true
        vm.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
      }
    }, { layout, count })
    if (layout === 'fullscreen') await setPlayerFullscreen(page, true)
    const controls = page.locator(layout === 'fullscreen' ? '.fullscreenActions' : '.shortsActionRail')
    const quickBookmark = controls.getByRole('button', { name: /Action counts/ })
    await quickBookmark.click()
    const savedCounts = () => page.evaluate(() => window.$store.getters.getPlaylist('action-counts').videos.map(video => video.viewCount))
    await expect.poll(savedCounts).toEqual([count])
    await quickBookmark.click()
    await expect.poll(savedCounts).toEqual([])
    await controls.getByRole('button', { name: /^Add to playlist$/i }).click()
    await page.getByRole('option').filter({ hasText: 'Action counts' }).click()
    await expect.poll(savedCounts).toEqual([count])
    await watch.dispose()
    const restarted = await app.relaunch()
    await expect.poll(() => restarted.page.evaluate(() => window.$store?.getters.getPlaylist('action-counts')?.videos.map(video => video.viewCount))).toEqual([count])
  })
}

test('playlist metadata groups views and upload time below the channel', { tag: '@scale' }, async ({ app, page }) => {
  await openPlaylist(app, page)
  const infoLine = page.locator('.watchVideoPlaylist .playlistItem .infoLine').first()
  await expect(page.locator('.watchVideoPlaylist .playlistItem').last().locator('.viewCount')).toHaveCount(0)
  await expect(infoLine.locator('.viewCount')).toContainText('12,345')
  await expect(infoLine.locator('.viewCount .statIcon')).toBeVisible()
  await expect(infoLine.locator('.uploadedTime .statIcon')).toBeVisible()
  await expect.poll(() => infoLine.evaluate(element => {
    const channel = element.querySelector('.channelName').getBoundingClientRect()
    const views = element.querySelector('.viewCount').getBoundingClientRect()
    const uploaded = element.querySelector('.uploadedTime').getBoundingClientRect()
    const bounds = element.getBoundingClientRect()
    return { belowChannel: views.top >= channel.bottom && uploaded.top >= channel.bottom, contained: views.right <= bounds.right + 0.5 && uploaded.right <= bounds.right + 0.5 }
  })).toEqual({ belowChannel: true, contained: true })
})

test('playlist channel separator follows the counter', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  const watch = await openPlaylist(app, page)
  await watch.evaluate(async (vm, items) => {
    const store = vm.$store
    const router = vm.tabRouter
    const tabId = vm.tabId ?? 'web'
    await router.push('/watch/jNQXAC9IVRw')
    await vm.$nextTick()
    store.commit('setCachedPlaylist', {
      tabId,
      value: { id: 'channel-layout', title: 'Channel playlist', channelName: 'Test channel', channelId: 'UC-test', totalVideoCount: items.length, items, continuationData: null }
    })
    await router.push('/watch/jNQXAC9IVRw?playlistId=channel-layout')
  }, videos)
  await waitForPlayback(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.setViewportSize({ width: Math.round(480 * uiScale / 100), height: Math.round(800 * uiScale / 100) })
  await page.locator('.phonePlaylistButton').click()
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet.locator('.playlistHeader > .channelName')).toHaveText('Test channel', { useInnerText: true })
  await expect(sheet.locator('.playlistIndex')).toBeHidden()
  await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 850 }))
  await page.setViewportSize({ width: Math.round(1280 * uiScale / 100), height: Math.round(850 * uiScale / 100) })
  await expect(page.locator('.watchVideoPlaylist .playlistHeader > .channelName')).toHaveText('Test channel -')
  await expect(page.locator('.watchVideoPlaylist .playlistIndex')).toBeVisible()
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 550 }))
  await page.setViewportSize({ width: 1280, height: 550 })
  await expect.poll(() => page.evaluate(() => window.matchMedia('(height <= 600px)').matches)).toBe(true)
  // Exercise the ordinary component independently of the phone-layout query.
  await watch.evaluate(vm => { vm.phoneLayout = false })
  await expect(page.locator('.watchVideoPlaylist')).toBeVisible()
  await expect(page.locator('.watchVideoPlaylist .playlistHeader > .channelName')).toHaveText('Test channel -', { useInnerText: true })
  await expect(page.locator('.watchVideoPlaylist .playlistIndex')).toBeVisible()
  await expect(page.locator('.watchVideoPlaylist .playlistProgressBarContainer')).toBeVisible()
  await watch.dispose()
})

test('landscape fullscreen playlist shows more videos and keeps controls outside the scroller', { tag: '@scale' }, async ({ app, page, attachScreenshot, uiScale }) => {
  await openPlaylist(app, page)
  // A slow run must not reach the end of the 30-second demo video, and the
  // player keeps its controls shown while paused.
  await page.locator('.ftVideoPlayer video').evaluate(element => element.pause())
  await setWindowSize(app, page, { width: 960, height: 440 })
  await page.setViewportSize({ width: Math.round(960 * uiScale / 100), height: Math.round(440 * uiScale / 100) })
  await setPlayerFullscreen(page, true)
  await clickFullscreenAction(page.locator('.ftVideoPlayer'), '.fullscreenPlaylistToggle')
  const dock = page.locator('.fullscreenPlaylistTarget')
  await expect(dock.locator('.playlistItemsWrapper')).toBeVisible()
  await expect(dock.locator('.playlistProgressBarContainer')).toBeHidden()
  await expect(dock.locator('.playlistIndex')).toBeHidden()
  const watchedThumbnail = dock.locator('.ft-list-item.watched .videoThumbnail').first()
  await expect(watchedThumbnail.locator('.videoWatched')).toBeVisible()
  await expect.poll(() => watchedThumbnail.evaluate(thumbnail => {
    const watched = thumbnail.querySelector('.videoWatched').getBoundingClientRect()
    const duration = thumbnail.querySelector('.videoDuration').getBoundingClientRect()
    const bounds = thumbnail.getBoundingClientRect()
    const index = thumbnail.querySelector('.playlistIndexBadge').getBoundingClientRect()
    return index.right <= watched.left && watched.bottom <= duration.top && watched.top >= bounds.top && duration.bottom <= bounds.bottom
  })).toBe(true)
  await watchedThumbnail.evaluate(thumbnail => {
    const label = thumbnail.querySelector('.videoDuration').cloneNode(false)
    label.className = 'sponsorBlockVideoLabel'
    label.textContent = 'Sponsor'
    thumbnail.append(label)
  })
  await expect.poll(() => watchedThumbnail.evaluate(thumbnail => {
    const index = thumbnail.querySelector('.playlistIndexBadge').getBoundingClientRect()
    const sponsor = thumbnail.querySelector('.sponsorBlockVideoLabel').getBoundingClientRect()
    return index.bottom <= sponsor.top
  })).toBe(true)
  await expect.poll(() => watchedThumbnail.evaluate(thumbnail => thumbnail.getBoundingClientRect().height)).toBeLessThanOrEqual(45.1)
  const list = dock.locator('.playlistItemsWrapper')
  await expect.poll(() => list.locator('.playlistItem').evaluateAll(items => {
    const viewport = items[0].parentElement.getBoundingClientRect()
    return items.filter(item => {
      const rect = item.getBoundingClientRect()
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom
    }).length
  })).toBeGreaterThanOrEqual(4)
  const headerBefore = await dock.locator('.playlistHeader').boundingBox()
  await list.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expectValidScrollRange(list)
  const headerAfter = await dock.locator('.playlistHeader').boundingBox()
  expect(headerAfter.y).toBe(headerBefore.y)
  await dock.getByRole('button', { name: 'Reverse Playlist' }).click()
  await expect(dock.getByRole('button', { name: 'Reverse Playlist' })).toHaveAttribute('aria-pressed', 'true')
  await list.evaluate(el => { el.scrollTop = 0 })
  await expect(list.locator('.playlistItem').first()).toContainText('Playlist video 12')
  await attachScreenshot('landscape fullscreen playlist')
  await setPlayerFullscreen(page, false)
})

test.describe('long watch playlist', () => {
  const longVideos = Array.from({ length: 120 }, (_, index) => ({
    ...videos[index % videos.length],
    videoId: index === 0 ? 'jNQXAC9IVRw' : `longvideo${String(index).padStart(3, '0')}`,
    title: `Long playlist video ${index + 1}`,
    timeAdded: Date.now() + index,
    playlistItemId: `long-item-${index}`,
  }))

  test.use({
    seed: {
      settings: {
        animationSpeed: 0,
        shortenViewCounts: false,
        userPlaylistSortOrder: 'custom',
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true
      },
      playlists: [{
        _id: 'long-playlist',
        playlistName: 'Long test playlist',
        protected: false,
        description: '',
        videos: longVideos,
        createdAt: Date.now(),
        lastUpdatedAt: Date.now()
      }]
    }
  })

  test('closes a row menu when scrolling releases its row', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await goTo(page, 'userplaylists')
    await page.getByText('Long test playlist', { exact: true }).click()
    await page.getByText('Long playlist video 1', { exact: true }).click()
    await (await waitForPlayback(page)).evaluate(element => element.pause())
    const list = page.locator('.watchVideoPlaylist .playlistItemsWrapper')
    const row = list.locator(':scope > .playlistItem').first()
    await row.locator('.playlistItemMenu button').click()
    await expect(page.getByRole('menuitem', { name: 'Remove from playlist', exact: true })).toBeVisible()
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(row.locator('.ft-list-video')).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Remove from playlist', exact: true })).toHaveCount(0)
  })

  test('remeasures released rows when a height-only breakpoint restyles the fullscreen playlist', { tag: '@scale' }, async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    await goTo(page, 'userplaylists')
    await page.getByText('Long test playlist', { exact: true }).click()
    await page.getByText('Long playlist video 1', { exact: true }).click()
    // A slow run must not reach the end of the 30-second demo video. The
    // playlist would advance, and the next video's player leaves fullscreen
    // and closes the dock until it restores them. Paused, Shaka also keeps
    // its controls shown, so the action pill cannot stop taking clicks.
    await (await waitForPlayback(page)).evaluate(element => element.pause())

    // Landscape above the 600px height breakpoint, then only the height changes.
    await setWindowSize(app, page, { width: 1000, height: 700 })
    await page.setViewportSize({ width: Math.round(1000 * uiScale / 100), height: Math.round(700 * uiScale / 100) })
    await setPlayerFullscreen(page, true)
    await clickFullscreenAction(page.locator('.ftVideoPlayer'), '.fullscreenPlaylistToggle')
    const list = page.locator('.fullscreenPlaylistTarget .playlistItemsWrapper')
    await expect(list).toBeVisible()

    const shellHeights = () => list.evaluate(element => [...element.querySelectorAll(':scope > .playlistItem')]
      .filter(row => !row.querySelector('.ft-list-video') && row.style.blockSize)
      .map(row => Number.parseFloat(row.style.blockSize)))
    // NaN until a row mounts or while the list is hidden, which fails both
    // height comparisons below.
    const rowHeight = () => list.evaluate(element => element.querySelector(':scope > .playlistItem:has(.ft-list-video)')
      ?.getBoundingClientRect().height || Number.NaN)
    // Scroll to the end so rows near the top become measured shells.
    await expect.poll(async () => {
      await list.evaluate(element => { element.scrollTop = element.scrollHeight })
      return (await shellHeights()).length
    }).toBeGreaterThan(20)
    // Rows near the end mount from an intersection observer after the scroll.
    let tallRow
    await expect.poll(async () => (tallRow = await rowHeight())).toBeGreaterThan(0)

    // setWindowSize waits for both dimensions to change, so resize the height alone directly.
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1000, height: 440 }))
    await page.setViewportSize({ width: Math.round(1000 * uiScale / 100), height: Math.round(440 * uiScale / 100) })
    await expect.poll(rowHeight).toBeLessThan(tallRow - 1)
    // Distant shells are rebuilt two per frame. A loaded renderer can leave
    // more time between frames than between polls, so wait for the rebuilt
    // heights rather than for a stable range. Stale shells keep the tall height.
    await expect.poll(async () => (await shellHeights()).filter(height => height > tallRow - 1).length,
      { timeout: 30_000 }).toBe(0)
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    // At fractional UI scales the offset snaps to device pixels and scrollHeight
    // rounds, so the end may sit up to about a pixel past the last row. Stale
    // shells or a retained overflow range leave far more empty space than that.
    await expect.poll(() => list.evaluate(element => {
      const rows = element.querySelectorAll(':scope > .playlistItem')
      const last = rows[rows.length - 1]
      return element.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom -
        (Number.parseFloat(getComputedStyle(last).marginBlockEnd) || 0)
    })).toBeLessThan(2)

    // Stale shells would change the range once the rows near the top mount again.
    const range = () => list.evaluate(element => element.scrollHeight)
    const settled = await range()
    await list.evaluate(element => { element.scrollTop = 0 })
    await expect(list.locator(':scope > .playlistItem').first().locator('.ft-list-video')).toBeVisible()
    await expect.poll(async () => Math.abs(await range() - settled)).toBeLessThanOrEqual(1)
    await setPlayerFullscreen(page, false)
  })
})
