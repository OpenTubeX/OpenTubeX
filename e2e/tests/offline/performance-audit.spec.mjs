import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { IpcChannels } from '../../../src/constants.js'

test.use({
  seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } },
})

test.describe('large bookmark playlist', () => {
  test.use({
    seed: {
      settings: { quickBookmarkTargetPlaylistId: 'favorites' },
      playlists: [{
        _id: 'favorites',
        playlistName: 'Favorites',
        createdAt: 1,
        lastUpdatedAt: 1,
        videos: Array.from({ length: 10_000 }, (_, index) => ({
          videoId: `saved${String(index).padStart(6, '0')}`,
          playlistItemId: `item-${index}`,
          title: `Saved video ${index}`,
          author: 'Creator',
          lengthSeconds: 120,
          timeAdded: 1,
          type: 'video',
        })),
      }],
      history: Array.from({ length: 100 }, (_, index) => ({
        _id: String(index).padStart(11, '0'),
        videoId: String(index).padStart(11, '0'),
        title: `History video ${index}`,
        author: 'Creator',
        lengthSeconds: 120,
        timeWatched: 1000 - index,
        watchProgress: 30,
        isWatched: false,
        type: 'video',
      })),
    },
  })

  test('visible history cards share the bookmark index', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__bookmarkIdReads = 0
      for (const video of store.getters.getQuickBookmarkPlaylist.videos) {
        const id = video.videoId
        Object.defineProperty(video, 'videoId', {
          enumerable: true,
          configurable: true,
          get() { window.__bookmarkIdReads++; return id },
        })
      }
    })
    await goTo(page, 'history')
    await expect.poll(() => page.locator('.quickBookmarkVideoIcon').count()).toBeGreaterThan(5)
    const metrics = await page.evaluate(() => ({
      controls: document.querySelectorAll('.quickBookmarkVideoIcon').length,
      reads: window.__bookmarkIdReads,
    }))
    console.log('Rendered history bookmark work:', metrics)
    expect(metrics.reads).toBe(10_000)
    const card = page.locator('.ft-list-video').first()
    await card.locator('.quickBookmarkVideoIcon').click()
    await expect(card.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await card.locator('.quickBookmarkVideoIcon').click()
    await expect(card.locator('.quickBookmarkVideoIcon.bookmarked')).toHaveCount(0)
  })

  test('playlist overview does not deep-watch saved video titles', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__playlistTitleReads = 0
      for (const video of store.getters.getQuickBookmarkPlaylist.videos) {
        const title = video.title
        Object.defineProperty(video, 'title', {
          enumerable: true,
          configurable: true,
          get() { window.__playlistTitleReads++; return title },
        })
      }
    })
    await goTo(page, 'userplaylists')
    await expect(page.getByRole('link', { name: 'Favorites', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.__playlistTitleReads)).toBe(0)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.getters.getQuickBookmarkPlaylist.videos[0].timeAdded = 2
    })
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => window.__playlistTitleReads)).toBe(0)
  })
})

test('default-speed button transitions do not query animations in JavaScript', async ({ page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateReducedMotion', 'off')
  })
  const button = page.getByRole('button', { name: 'Expand side navigation', exact: true })
  await page.mouse.move(800, 500)
  await button.evaluate(element => {
    window.__buttonAnimationWork = { transitions: 0, queries: 0 }
    element.addEventListener('transitionrun', () => window.__buttonAnimationWork.transitions++)
    const original = element.getAnimations
    element.getAnimations = function (options) {
      window.__buttonAnimationWork.queries++
      return original.call(this, options)
    }
  })
  await button.hover()
  await expect.poll(() => page.evaluate(() => window.__buttonAnimationWork.transitions)).toBeGreaterThan(0)
  const metrics = await page.evaluate(() => window.__buttonAnimationWork)
  console.log('Default-speed button animation work:', metrics)
  expect(metrics.queries).toBe(0)
})

test.describe('history progress direction', () => {
  test.use({
    seed: {
      settings: { uiScale: 95, uiRoundness: 200 },
      history: Array.from({ length: 100 }, (_, index) => ({
        _id: String(index).padStart(11, '0'),
        videoId: String(index).padStart(11, '0'),
        title: `Progress video ${index}`,
        author: 'Performance fixture',
        authorId: 'UC0000000000000000000000',
        timeWatched: Date.now() - index * 1000,
        lengthSeconds: 120,
        watchProgress: 30,
        isWatched: false,
        type: 'video',
      })),
    },
  })

  test('mirrors progress without per-card JavaScript style reads', async ({ app, page }, testInfo) => {
    await page.evaluate(() => {
      const original = window.getComputedStyle
      window.__progressStyleReads = 0
      window.getComputedStyle = function (element, pseudo) {
        if (element.matches?.('svg.embeddedProgress')) window.__progressStyleReads++
        return original.call(this, element, pseudo)
      }
    })
    await goTo(page, 'history')
    const paths = page.locator('.watchedProgressBar .embeddedProgressPath')
    // Cards below the viewport are intentionally rendered lazily.
    await expect.poll(() => paths.count()).toBeGreaterThan(10)
    const path = paths.first()

    const progressStartsOn = async direction => {
      await expect.poll(() => path.evaluate(element => {
        const start = element.getPointAtLength(0).matrixTransform(element.getScreenCTM())
        const end = element.getPointAtLength(element.getTotalLength()).matrixTransform(element.getScreenCTM())
        return start.x < end.x ? 'left' : 'right'
      })).toBe(direction)
    }

    await progressStartsOn('left')
    const mountReads = await page.evaluate(() => window.__progressStyleReads)
    await page.evaluate(() => { document.body.dir = 'rtl' })
    await progressStartsOn('right')
    const directionReads = await page.evaluate(() => window.__progressStyleReads) - mountReads
    await testInfo.attach('progress JavaScript work', {
      body: JSON.stringify({ cards: await paths.count(), mountReads, directionReads }),
      contentType: 'application/json',
    })
    console.log('Progress style reads:', { mountReads, directionReads })
    expect.soft(mountReads).toBe(0)
    expect.soft(directionReads).toBe(0)

    await setWindowSize(app, page, { width: 900, height: 700 })
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await progressStartsOn('right')
    await page.evaluate(() => { document.body.dir = 'ltr' })
    await progressStartsOn('left')
    await expect.poll(() => path.evaluate(element => {
      const svg = element.ownerSVGElement
      return Math.abs(svg.viewBox.baseVal.width - Number.parseFloat(getComputedStyle(svg).width))
    })).toBeLessThan(0.1)
  })
})

test('loop controls update on changes without polling an idle player', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const buttons = page.locator('.ftVideoPlayer .loop-button')
  await expect(buttons.first()).toBeAttached()

  for (const enabled of [true, false]) {
    await video.evaluate((element, enabled) => { element.loop = enabled }, enabled)
    await expect.poll(() => buttons.evaluateAll((elements, enabled) => elements.every(element => (
      element.getAttribute('aria-pressed') === String(enabled)
    )), enabled)).toBe(true)
  }

  const metrics = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll('.ftVideoPlayer .loop-button')]
    const classes = new Set(buttons.map(button => button.classList))
    const original = DOMTokenList.prototype.toggle
    let visibilityChecks = 0
    DOMTokenList.prototype.toggle = function (...args) {
      if (classes.has(this)) visibilityChecks++
      return original.apply(this, args)
    }
    try {
      await new Promise(resolve => setTimeout(resolve, 1100))
      return { buttons: buttons.length, visibilityChecks }
    } finally {
      DOMTokenList.prototype.toggle = original
    }
  })
  await testInfo.attach('idle loop control work', {
    body: JSON.stringify(metrics), contentType: 'application/json',
  })
  console.log('Idle loop control work:', metrics)
  expect(metrics.visibilityChecks).toBe(0)
})

test('video clock updates retain positions without rebuilding media controls', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused')

  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    globalThis.__mediaClockIpc = 0
    ipcMain.on(channel, () => globalThis.__mediaClockIpc++)
  }, IpcChannels.TABS_SET_MEDIA_SESSION_STATE)
  const metrics = await page.evaluate(() => {
    const media = navigator.mediaSession
    const originalHandler = media.setActionHandler
    const originalPosition = media.setPositionState
    let handlers = 0
    let positions = 0
    media.setActionHandler = function (...args) {
      handlers++
      return originalHandler.apply(this, args)
    }
    media.setPositionState = function (...args) {
      positions++
      return originalPosition.apply(this, args)
    }
    try {
      const video = document.querySelector('.ftVideoPlayer video')
      for (let index = 0; index < 60; index++) video.dispatchEvent(new Event('timeupdate'))
      return { handlers, positions }
    } finally {
      media.setActionHandler = originalHandler
      media.setPositionState = originalPosition
    }
  })
  // Flush the renderer's IPC stream before inspecting the main-process count.
  await page.evaluate(() => window.ftElectron.tabs.getState())
  const ipc = await app.electronApp.evaluate(() => globalThis.__mediaClockIpc)
  console.log('Rendered player clock work:', { ...metrics, ipc })
  expect(metrics.positions).toBe(60)
  expect(metrics.handlers).toBe(0)
  expect(ipc).toBe(0)
})

test('native media actions still control playback after switching tabs', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const playingTabId = await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.activeTabId))
  const video = page.locator(`.ftVideoPlayer[data-tab-id="${playingTabId}"] video`)
  const newTabId = await page.evaluate(() => window.ftElectron.tabs.create({ makeActive: true }).then(tab => tab.id))
  await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.presentedTabId))).toBe(newTabId)
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)

  const sendAction = action => app.electronApp.evaluate(({ BrowserWindow }, { channel, action }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, action)
  }, { channel: IpcChannels.TABS_REQUEST_MEDIA_SESSION_ACTION, action })
  await sendAction('pause')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused')

  await page.evaluate(tabId => window.ftElectron.tabs.activate(tabId), playingTabId)
  await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.presentedTabId))).toBe(playingTabId)
  await sendAction('play')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('playing')
})
