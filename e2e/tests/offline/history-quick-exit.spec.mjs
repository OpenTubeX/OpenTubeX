import { readPersistedDatastore } from '../../helpers/datastore.mjs'
import path from 'node:path'
import { test, expect, sel } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { DEMO_MEDIA_URL } from '../../helpers/media.mjs'
import { mockPlayableWatchPage, watchHistoryEntry } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      defaultVideoFormat: 'legacy',
      rememberHistory: true,
      keepPlayingOnNavigation: false,
      watchedProgressSavingMode: 'auto',
      useSponsorBlock: false,
    },
    history: [{ ...watchHistoryEntry, watchProgress: 10, lengthSeconds: 19 }],
  },
})

async function savedProgress(app) {
  const contents = await readPersistedDatastore(path.join(app.userDataDir, 'history.db'), 'utf8')
  return contents.trim().split('\n').map(line => JSON.parse(line))
    .filter(record => record.videoId === 'jNQXAC9IVRw').at(-1)?.watchProgress
}

for (const phase of ['metadata pending', 'media pending', 'first loaded data']) {
  test(`preserves the resume position when leaving with ${phase}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.sideNavLink('history')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/history/)
    let release
    const pending = new Promise(resolve => { release = resolve })
    let reached
    const requested = new Promise(resolve => { reached = resolve })
    if (phase !== 'first loaded data') {
      await page.route(phase === 'metadata pending' ? '**/youtubei/v1/player**' : /googlevideo\.com\/videoplayback/, async route => {
        reached()
        await pending
        await route.fallback()
      })
    } else {
      await page.evaluate(backSelector => {
        document.addEventListener('loadeddata', () => {
          document.querySelector(backSelector).click()
        }, { capture: true, once: true })
      }, sel.backButton)
    }

    try {
      await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator(sel.searchInput).press('Enter')
      if (phase !== 'first loaded data') {
        await requested
        await page.locator(sel.backButton).click()
        release()
      }
      await expect(page).toHaveURL(/#\/history/)
      release()
      expect(await savedProgress(app)).toBeGreaterThanOrEqual(10)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
      expect(await savedProgress(app)).toBeGreaterThanOrEqual(10)
    } finally {
      release()
    }
  })
}

for (const position of [0, 12]) {
  test(`saves a deliberate seek to ${position} seconds after resuming`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.sideNavLink('history')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/history/)
    const video = await openMockedVideo(page)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThanOrEqual(10)
    await video.evaluate((element, seconds) => {
      element.pause()
      return new Promise(resolve => {
        element.addEventListener('seeked', resolve, { once: true })
        element.currentTime = seconds
      })
    }, position)
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)
    await expect.poll(() => savedProgress(app)).toBe(position)
  })
}

for (const exit of ['navigate', 'close tab']) {
  test(`retains successive seeks after reopening with ${exit}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    for (const position of [12, 15]) {
      if (exit === 'close tab') await page.keyboard.press('Control+t')
      const video = await openMockedVideo(page)
      await video.evaluate((element, seconds) => {
        element.pause()
        return new Promise(resolve => {
          element.addEventListener('seeked', resolve, { once: true })
          element.currentTime = seconds
        })
      }, position)
      if (exit === 'navigate') {
        await page.locator(sel.sideNavLink('history')).first().evaluate(element => element.click())
        await expect(page).toHaveURL(/#\/history/)
      } else {
        await page.keyboard.press('Control+w')
        await expect(video).toHaveCount(0)
      }
      await expect.poll(() => savedProgress(app)).toBe(position)
    }
    const reopened = await openMockedVideo(page)
    await expect.poll(() => reopened.evaluate(element => element.currentTime)).toBeGreaterThanOrEqual(15)
  })
}

test('persists the latest seek when quitting the desktop app', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.pause()
    return new Promise(resolve => {
      element.addEventListener('seeked', resolve, { once: true })
      element.currentTime = 15
    })
  })
  await app.electronApp.close()
  expect(await savedProgress(app)).toBe(15)
})

for (const existing of [true, false]) {
  for (const position of [0, 5, 15]) {
    test(`starts at the latest seek to ${position} before the first media data loads with ${existing ? 'existing' : 'new'} history`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      if (!existing) {
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('removeAllHistory'))
      }
      await page.evaluate(seconds => {
        document.addEventListener('loadedmetadata', event => {
          const video = event.target
          window.firstPlaybackPosition = null
          video.addEventListener('playing', () => {
            window.firstPlaybackPosition = video.currentTime
          }, { once: true })
          video.currentTime = 20
          video.currentTime = seconds
        }, { capture: true, once: true })
      }, position)
      await openMockedVideo(page)
      await expect.poll(() => page.evaluate(() => window.firstPlaybackPosition)).not.toBeNull()
      const firstPosition = await page.evaluate(() => window.firstPlaybackPosition)
      expect(firstPosition).toBeGreaterThanOrEqual(position)
      expect(firstPosition).toBeLessThan(position + 1)
    })
  }

  test(`saves a seek before the first media data loads with ${existing ? 'existing' : 'new'} history`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    if (!existing) {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('removeAllHistory'))
    }
    await page.locator(sel.sideNavLink('history')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/history/)
    await page.evaluate(backSelector => {
      document.addEventListener('loadedmetadata', event => {
        const video = event.target
        video.addEventListener('seeking', () => {
          // Let the player's seeking listener establish the position before
          // leaving, without waiting for seeked or any media data.
          queueMicrotask(() => document.querySelector(backSelector).click())
        }, { once: true })
        video.currentTime = 15
      }, { capture: true, once: true })
    }, sel.backButton)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect.poll(() => savedProgress(app)).toBe(15)
    const entry = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.jNQXAC9IVRw)
    expect(entry.title).toBeTruthy()
    expect(entry.lengthSeconds).toBeGreaterThan(0)
    await expect(page).toHaveURL(/#\/history/)
  })
}

for (const position of [0, 5, 15]) {
  test(`starts at a chapter seek to ${position} made before metadata is available`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    let release
    const pending = new Promise(resolve => { release = resolve })
    let reached
    const requested = new Promise(resolve => { reached = resolve })
    await page.route(/googlevideo\.com\/videoplayback/, async route => {
      reached()
      await pending
      await route.fallback()
    })
    try {
      await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator(sel.searchInput).press('Enter')
      await requested
      const watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate((component, seconds) => {
        const player = component.refs.player
        const video = component.proxy.$el.querySelector('video')
        window.firstPlaybackPosition = null
        video.addEventListener('playing', () => {
          window.firstPlaybackPosition = video.currentTime
        }, { once: true })
        player.setCurrentTime(20)
        player.setCurrentTime(seconds)
      }, position)
      release()
      await expect.poll(() => page.evaluate(() => window.firstPlaybackPosition)).not.toBeNull()
      const firstPosition = await page.evaluate(() => window.firstPlaybackPosition)
      expect(firstPosition).toBeGreaterThanOrEqual(position)
      expect(firstPosition).toBeLessThan(position + 1)
    } finally {
      release()
    }
  })
}

for (const action of ['chapter', 'timeline', 'first timeline', 'mouse timeline', 'first mouse timeline before data', 'paused mouse timeline before data', 'blurred mouse timeline before data']) {
  const title = action.startsWith('blurred')
    ? 'autoplays when the window loses focus during a startup seek'
    : action.endsWith('before data')
      ? action.startsWith('paused')
        ? 'preserves a Media Session pause before seeking during startup'
        : 'autoplays at a timeline seek made before the first frame'
      : action === 'first timeline'
        ? 'a first timeline seek during buffering takes precedence over saved progress'
        : `a newer ${action} seek during buffering replaces a chapter seek before metadata`
  test(title, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    if (action.startsWith('paused')) {
      await page.evaluate(() => {
        const register = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
        navigator.mediaSession.setActionHandler = (name, handler) => {
          if (name === 'pause' && handler) window.startupMediaPause = handler
          register(name, handler)
        }
      })
    }
    let release
    const pending = new Promise(resolve => { release = resolve })
    let reached
    const requested = new Promise(resolve => { reached = resolve })
    await page.route(/googlevideo\.com\/videoplayback/, async route => {
      reached()
      await pending
      await route.fallback()
    })
    try {
      await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator(sel.searchInput).press('Enter')
      await requested
      const watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate((component, action) => {
        const video = component.proxy.$el.querySelector('video')
        window.firstPlaybackPosition = null
        window.mouseTimelineTarget = null
        video.addEventListener('playing', () => {
          if (!video.paused) window.firstPlaybackPosition = video.currentTime
        }, { once: true })
        video.addEventListener(action.endsWith('before data') ? 'loadedmetadata' : 'loadeddata', () => {
          if (action.startsWith('paused')) window.startupMediaPause()
          if (action === 'chapter') {
            component.refs.player.setCurrentTime(5)
          } else {
            const range = component.proxy.$el.querySelector('.shaka-seek-bar')
            range.disabled = false
            range.min = '0'
            range.max = '30'
            range.value = '5'
            if (action.includes('mouse timeline')) {
              const rect = range.getBoundingClientRect()
              const point = seconds => rect.left + 6 + (rect.width - 12) * seconds / 30
              range.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: point(15) }))
              if (action.startsWith('blurred')) {
                // Window focus loss need not blur its focused range input.
                window.dispatchEvent(new Event('blur'))
              } else {
                range.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: point(5) }))
              }
              window.mouseTimelineTarget = Number(range.value)
            } else {
              range.dispatchEvent(new Event('input', { bubbles: true }))
            }
          }
        }, { once: true })
        if (!action.startsWith('first ') && !action.startsWith('paused') && !action.startsWith('blurred')) component.refs.player.setCurrentTime(15)
      }, action)
      release()
      if (action.startsWith('paused')) {
        const video = page.locator('.ftVideoPlayer video')
        await expect.poll(() => page.evaluate(() => window.mouseTimelineTarget)).not.toBeNull()
        await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(3)
        await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 0)
        await page.waitForTimeout(200)
        expect(await video.evaluate(element => element.paused)).toBe(true)
        expect(await page.evaluate(() => window.firstPlaybackPosition)).toBeNull()
        return
      }
      await expect.poll(() => page.evaluate(() => window.firstPlaybackPosition)).not.toBeNull()
      const firstPosition = await page.evaluate(() => window.firstPlaybackPosition)
      const target = action.includes('mouse timeline') ? await page.evaluate(() => window.mouseTimelineTarget) : 5
      expect(target).toBeCloseTo(action.startsWith('blurred') ? 15 : 5, 0)
      // Media timestamps can round a fractional pointer target down slightly.
      expect(firstPosition).toBeGreaterThanOrEqual(target - 0.001)
      expect(firstPosition).toBeLessThan(target + 1)
    } finally {
      release()
    }
  })
}

test('native audio loading preserves a seek made during buffering', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate((component, url) => {
    const video = component.proxy.$el.querySelector('video')
    window.firstPlaybackPosition = null
    video.addEventListener('loadedmetadata', () => {
      video.addEventListener('playing', () => { window.firstPlaybackPosition = video.currentTime }, { once: true })
      component.refs.player.setCurrentTime(5)
    }, { once: true })
    component.proxy.manifestSrc = url
    component.proxy.manifestMimeType = 'video/webm'
    component.proxy.activeFormat = 'audio'
  }, DEMO_MEDIA_URL)
  await expect.poll(() => page.evaluate(() => window.firstPlaybackPosition)).not.toBeNull()
  const firstPosition = await page.evaluate(() => window.firstPlaybackPosition)
  expect(firstPosition).toBeGreaterThanOrEqual(5)
  expect(firstPosition).toBeLessThan(6)
})

for (const action of ['chapter', 'timeline']) {
  test(`starts DASH at a ${action} seek made while loading`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    let release
    const pending = new Promise(resolve => { release = resolve })
    let reached
    const requested = new Promise(resolve => { reached = resolve })
    await page.route(/googlevideo\.com\/videoplayback/, async route => {
      reached()
      await pending
      await route.fallback()
    })
    try {
      const watch = await page.evaluateHandle(findWatchComponent)
      const mediaUrl = DEMO_MEDIA_URL.replaceAll('&', '&amp;')
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT30S" minBufferTime="PT0.1S">
        <Period>
          <AdaptationSet mimeType="video/webm" codecs="vp9,opus">
            <Representation id="demo" bandwidth="200000" width="640" height="360">
              <SegmentList duration="30">
                <Initialization sourceURL="${mediaUrl}"/>
                <SegmentURL media="${mediaUrl}"/>
              </SegmentList>
            </Representation>
          </AdaptationSet>
        </Period>
      </MPD>`
      await watch.evaluate((component, manifest) => {
        const view = component.proxy
        view.manifestMimeType = 'application/dash+xml'
        view.manifestSrc = `data:application/dash+xml,${encodeURIComponent(manifest)}`
        view.activeFormat = 'dash'
      }, manifest)
      await requested
      await expect.poll(() => page.locator('.ftVideoPlayer').evaluate(element => element.ui?.getControls().getPlayer().getManifest() != null)).toBe(true)
      await watch.evaluate((component, action) => {
        const video = component.proxy.$el.querySelector('video')
        window.firstPlaybackPosition = null
        video.addEventListener('playing', () => {
          window.firstPlaybackPosition = video.currentTime
        }, { once: true })
        if (action === 'chapter') {
          component.refs.player.setCurrentTime(15)
        } else {
          video.addEventListener('loadedmetadata', () => {
            const range = component.proxy.$el.querySelector('.shaka-seek-bar')
            range.disabled = false
            range.min = '0'
            range.max = '30'
            range.value = '15'
            range.dispatchEvent(new Event('input', { bubbles: true }))
          }, { once: true })
        }
      }, action)
      release()
      await expect.poll(() => page.evaluate(() => window.firstPlaybackPosition)).not.toBeNull()
      const firstPosition = await page.evaluate(() => window.firstPlaybackPosition)
      expect(firstPosition).toBeGreaterThanOrEqual(15)
      expect(firstPosition).toBeLessThan(16)
    } finally {
      release()
    }
  })
}
