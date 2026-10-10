import { expect } from '@playwright/test'

export const SWIPE_VIDEO = {
  _id: 'jNQXAC9IVRw',
  videoId: 'jNQXAC9IVRw',
  title: 'Swipe gesture test',
  author: 'Test Channel',
  authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
  published: 1700000000000,
  description: '',
  viewCount: 1234,
  lengthSeconds: 60,
  watchProgress: 10,
  timeWatched: 1700000000000,
  isWatched: false,
  isLive: false,
  type: 'video',
}

export async function verifySwipeDownloadAvailability(page) {
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const saved = [store.getters.getThumbnailLeftSwipeAction, store.getters.getThumbnailRightSwipeAction, store.getters.getEnableDownloads]
    store.commit('setEnableDownloads', true)
    store.commit('setThumbnailLeftSwipeAction', 'download')
    store.commit('setThumbnailRightSwipeAction', 'download')
    return saved
  })
  const selects = ['Swipe left on thumbnails', 'Swipe right on thumbnails'].map(name => page.getByRole('combobox', { name, exact: true }))
  const expectSelection = async (value, name) => {
    for (const select of selects) {
      await expect(select.locator('.selectedValue')).toHaveText(name)
      await expect(select.locator('..').locator('select')).toHaveValue(value)
    }
  }
  try {
    await expectSelection('download', 'Download Video')
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setEnableDownloads', false))
    await expectSelection('disabled', 'Disabled')
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return [store.getters.getThumbnailLeftSwipeAction, store.getters.getThumbnailRightSwipeAction]
    })).toEqual(['download', 'download'])
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setEnableDownloads', true))
    await expectSelection('download', 'Download Video')
  } finally {
    await page.evaluate(([left, right, downloads]) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setThumbnailLeftSwipeAction', left)
      store.commit('setThumbnailRightSwipeAction', right)
      store.commit('setEnableDownloads', downloads)
    }, saved)
  }
}

export async function verifyCopySwipe(page, session, readClipboard, expectedUrl = `https://youtu.be/${SWIPE_VIDEO.videoId}`) {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setThumbnailLeftSwipeAction', 'copyYoutube')
    store.commit('setThumbnailRightSwipeAction', 'disabled')
  })
  const card = page.locator('.ft-list-video:visible').first()
  const title = card.locator('.title')
  await title.scrollIntoViewIfNeeded()
  const rect = await title.boundingBox()
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const touch = (type, x) => session.send('Input.dispatchTouchEvent', { type, touchPoints: x == null ? [] : [{ ...point, x }] })
  await touch('touchStart', point.x)
  await touch('touchMove', point.x - 40)
  const feedback = card.locator('..').locator('.thumbnailSwipeFeedback')
  await expect(feedback).toHaveAttribute('title', 'Copy YouTube Link')
  await touch('touchMove', point.x - 100)
  await expect(feedback).toHaveClass(/thumbnailSwipeReady/)
  await touch('touchEnd')
  await expect.poll(readClipboard).toBe(expectedUrl)
  await expect(feedback).toHaveCount(0)
  await expect(page).toHaveURL(/#\/history/)
}

/** Exercise actual WebView touch events and the shared video card's action handlers. */
export async function verifyThumbnailSwipes(page, session, screenshot = async () => {}) {
  const card = page.locator('.ft-list-video').first()
  const frame = card.locator('..')
  const thumbnail = card.locator('.videoThumbnail')
  const title = card.locator('.title')
  const feedback = frame.locator('.thumbnailSwipeFeedback')
  const setActions = (left, right) => page.evaluate(([left, right]) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setThumbnailLeftSwipeAction', left)
    store.commit('setThumbnailRightSwipeAction', right)
  }, [left, right])
  const queueLength = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength)
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  const start = async () => {
    await thumbnail.scrollIntoViewIfNeeded()
    // Native CDP touches lack Playwright's hit-target checks. In landscape,
    // a queue toast can temporarily cover the thumbnail's center.
    await expect.poll(() => thumbnail.evaluate(node => {
      const rect = node.getBoundingClientRect()
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
    const rect = await thumbnail.boundingBox()
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    await touch('touchStart', point)
    return point
  }
  await setActions('addToQueue', 'addToPlaylist')
  await expect(frame).toHaveClass(/thumbnailSwipeEnabled/)
  const before = await queueLength()
  const baseline = { thumbnail: await thumbnail.boundingBox(), title: await title.boundingBox(), frame: await frame.boundingBox() }
  let point = await start()
  await touch('touchMove', { ...point, x: point.x - 40 })
  await expect(feedback).toBeVisible()
  const iconScale = await feedback.locator('svg').evaluate(node => getComputedStyle(node).scale)
  const reduced = await page.locator('html').getAttribute('data-reduced-motion') === 'reduce'
  if (reduced) {
    expect(await feedback.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('none')
  } else {
    // Advance the ripple while the finger stays still: expansion follows time,
    // rather than clipping or scaling the action icon with the drag distance.
    const scales = await feedback.evaluate(node => {
      const animation = node.getAnimations({ subtree: true }).find(animation => animation.animationName?.startsWith('thumbnail-swipe-ripple'))
      animation.pause()
      animation.currentTime = 0
      const start = Number(getComputedStyle(node, '::before').scale)
      animation.currentTime = 175
      const held = Number(getComputedStyle(node, '::before').scale)
      animation.play()
      return { start, held }
    })
    expect(scales.start).toBe(0)
    expect(scales.held).toBeGreaterThan(0.5)
    await screenshot('thumbnail swipe held ripple')
  }
  await touch('touchMove', { ...point, x: point.x - 100 })
  await expect(feedback).toHaveClass(/thumbnailSwipeReady/)
  await expect(feedback).toHaveAttribute('title', 'Add to Queue')
  const moved = { thumbnail: await thumbnail.boundingBox(), title: await title.boundingBox(), frame: await frame.boundingBox(), feedback: await feedback.boundingBox() }
  expect(moved.thumbnail.x).toBeLessThan(baseline.thumbnail.x - 40)
  expect(Math.abs((moved.title.x - baseline.title.x) - (moved.thumbnail.x - baseline.thumbnail.x))).toBeLessThan(1)
  expect(moved.frame.x).toBe(baseline.frame.x)
  expect(moved.feedback.x).toBeGreaterThan(moved.thumbnail.x + moved.thumbnail.width)
  expect(await feedback.evaluate(node => getComputedStyle(node).clipPath)).toBe('none')
  await expect(feedback.locator('svg')).toHaveCount(1)
  expect(await feedback.locator('svg').evaluate(node => getComputedStyle(node).scale)).toBe(iconScale)
  await screenshot('thumbnail swipe ready')
  expect(await queueLength()).toBe(before)
  await touch('touchEnd')
  await expect.poll(queueLength).toBe(before + 1)
  await expect(feedback).toHaveCount(0)
  expect(Math.abs((await title.boundingBox()).x - baseline.title.x)).toBeLessThan(1)
  await expect(page).toHaveURL(/#\/history/)

  point = await start()
  await touch('touchMove', { ...point, x: point.x + 40 })
  await expect(feedback).toBeVisible()
  await touch('touchMove', { ...point, x: point.x + 100 })
  await expect(feedback).toHaveClass(/thumbnailSwipeReady/)
  await expect(feedback).toHaveAttribute('title', /Add to playlist/i)
  const rightTitle = await title.boundingBox()
  expect(rightTitle.x).toBeGreaterThan(baseline.title.x + 40)
  expect((await feedback.boundingBox()).x).toBeLessThan(rightTitle.x)
  await touch('touchEnd')
  await expect(page.getByRole('dialog')).toBeVisible()
  await screenshot('swipe playlist picker')
  // Use the dialog's existing close control, which works on Android too.
  await page.getByRole('dialog').getByRole('button', { name: /Close/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Short, cancelled, and vertical movements cannot invoke shortcuts or navigate.
  await setActions('playNext', 'addToQueue')
  const after = await queueLength()
  for (const [x, y, end] of [[20, 0, 'touchEnd'], [-100, 0, 'touchCancel'], [0, 50, 'touchEnd']]) {
    point = await start()
    await touch('touchMove', { x: point.x + x, y: point.y + y })
    await touch(end)
    await expect(feedback).toHaveCount(0)
    expect(await queueLength()).toBe(after)
    await expect(page).toHaveURL(/#\/history/)
  }

  await setActions('disabled', 'disabled')
  await expect(frame).not.toHaveClass(/thumbnailSwipeEnabled/)
  point = await start()
  await touch('touchMove', { ...point, x: point.x - 100 })
  await touch('touchEnd')
  expect(await queueLength()).toBe(after)

  // A long press opens the normal menu and cancels the pending swipe.
  await setActions('addToQueue', 'addToPlaylist')
  await start()
  await expect(page.locator('.mobileLinkActions')).toBeVisible()
  await touch('touchEnd')
  await screenshot('thumbnail long press menu')
  expect(await queueLength()).toBe(after)
  await page.locator('.mobileLinkActions').press('Escape')
  await expect(page.locator('.mobileLinkActions')).toHaveCount(0)
}

/** Verify contextual removal, duplicate-entry targeting, and the existing undo. */
export async function verifyPlaylistSwipeRemoval(page, session, screenshot = async () => {}) {
  const saved = await page.evaluate(async video => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const settings = Object.fromEntries(['ListType', 'QuickBookmarkTargetPlaylistId', 'ThumbnailLeftSwipeAction', 'ThumbnailRightSwipeAction']
      .map(key => [key, store.getters['get' + key]]))
    const playlist = {
      playlistName: 'Swipe removal test',
      description: '',
      protected: false,
      videos: [
        { ...video, title: 'Swipe removal first', playlistItemId: 'swipe-first' },
        { ...video, title: 'Swipe removal second', playlistItemId: 'swipe-second' },
      ],
    }
    await store.dispatch('addPlaylist', playlist)
    return { settings, route: location.hash, playlistId: playlist._id }
  }, SWIPE_VIDEO)
  let tab
  try {
    tab = await page.evaluate(id => window.ftElectron?.tabs?.create({ route: `/playlist/${id}?playlistType=user`, makeActive: false }), saved.playlistId)
    if (tab) {
      await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
    } else {
      await page.evaluate(id => { location.hash = `#/playlist/${id}?playlistType=user` }, saved.playlistId)
    }
    await expect(page).toHaveURL(new RegExp(`#/playlist/${saved.playlistId}`))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setThumbnailLeftSwipeAction', 'addToPlaylist')
      store.commit('setThumbnailRightSwipeAction', 'addToPlaylist')
    })
    for (const [layout, distance] of [['grid', -100], ['list', 100]]) {
      await page.evaluate(layout => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setListType', layout), layout)
      const cards = page.locator('.ft-list-video:visible')
      await expect(cards).toHaveCount(2)
      const first = cards.filter({ hasText: 'Swipe removal first' })
      const title = first.locator('.title')
      await title.scrollIntoViewIfNeeded()
      await expect.poll(() => title.evaluate(node => {
        const rect = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })).toBe(true)
      const rect = await title.boundingBox()
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      const touch = (type, x) => session.send('Input.dispatchTouchEvent', { type, touchPoints: x == null ? [] : [{ ...point, x }] })
      await touch('touchStart', point.x)
      await touch('touchMove', point.x + distance * 0.4)
      const feedback = first.locator('..').locator('.thumbnailSwipeFeedback')
      await expect(feedback).toHaveAttribute('title', 'Remove from Playlist')
      await touch('touchMove', point.x + distance)
      await expect(feedback).toHaveClass(/thumbnailSwipeReady/)
      await screenshot(`playlist swipe removal ${layout}`)
      await touch('touchEnd')
      await expect(cards).toHaveCount(1)
      await expect(cards.locator('.title')).toHaveText('Swipe removal second')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      if (layout === 'grid') {
        await page.getByText('Video has been removed. Click here to undo.', { exact: true }).click()
        await expect(cards).toHaveCount(2)
      } else {
        await expect.poll(() => page.evaluate(async id => {
          if (window.ftElectron) {
            const playlist = await window.ftElectron.libraryQuery('playlistSnapshot', { id })
            return playlist.videos.map(video => video.playlistItemId)
          }
          const playlist = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPlaylist(id)
          return playlist.videos.map(video => video.playlistItemId)
        }, saved.playlistId), { timeout: 10_000 }).toEqual(['swipe-second'])
      }
    }
  } finally {
    if (tab) {
      await page.locator(`.tab[data-tab-id="${tab.id}"]`).getByRole('button', { name: 'Close Tab', exact: true }).click()
    } else {
      await page.evaluate(route => { location.hash = route }, saved.route)
    }
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('removePlaylist', saved.playlistId)
      for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
    }, saved)
  }
}
