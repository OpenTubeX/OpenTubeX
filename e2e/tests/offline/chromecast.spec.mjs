import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { DEMO_MEDIA_URL, DEMO_MEDIA_MIME_TYPE } from '../../helpers/media.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

test.use({
  seed: {
    settings: {
      showChromecastButton: true,
      animationSpeed: 0,
      keepPlayingOnNavigation: false,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

async function mockCast(app) {
  await app.electronApp.evaluate(({ ipcMain }) => {
    const state = { currentTime: 5, duration: 30, paused: false, connected: true, volume: 0.5, muted: false, activeTrackIds: [] }
    globalThis.castTest = { state, starts: [], stops: [], controls: [], failStart: false, startDelayMs: 0, failStatus: false, failStop: false, statusCalls: 0 }
    for (const name of ['cast-discover', 'cast-start', 'cast-status', 'cast-control', 'cast-stop']) ipcMain.removeHandler(name)
    ipcMain.handle('cast-discover', () => [{ id: 'test-tv', name: 'Test TV' }])
    ipcMain.handle('cast-start', async (_, payload) => {
      globalThis.castTest.starts.push(payload)
      await new Promise(resolve => setTimeout(resolve, globalThis.castTest.startDelayMs))
      if (globalThis.castTest.failStart === 'throw') throw new Error('Receiver connection failed')
      if (globalThis.castTest.failStart) return { error: 'Receiver rejected media' }
      state.currentTime = payload.startSeconds
      state.paused = payload.paused
      return { castId: 'session-id', deviceName: 'Test TV', status: { ...state } }
    })
    ipcMain.handle('cast-status', () => {
      globalThis.castTest.statusCalls++
      if (globalThis.castTest.failStatus) throw new Error('Cast status unavailable')
      return { ...state }
    })
    ipcMain.handle('cast-control', (_, id, action, value) => {
      globalThis.castTest.controls.push({ id, action, value })
      if (action === 'pause') state.paused = true
      if (action === 'play') state.paused = false
      if (action === 'seek') state.currentTime = value
      if (action === 'volume') state.volume = value
      if (action === 'mute') state.muted = value
      if (action === 'caption') state.activeTrackIds = value === 0 ? [] : [value]
      return { ...state }
    })
    ipcMain.handle('cast-stop', (_, id) => {
      globalThis.castTest.stops.push(id)
      if (globalThis.castTest.failStop) throw new Error('Cast stop unavailable')
      return { ...state, connected: false }
    })
  })
}

async function openCastVideo(app, page) {
  await mockCast(app)
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.route('https://cast-media.test/*.vtt', route => route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00.000 --> 00:30.000\nCast caption\n' }))
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    // The existing WebM fixture remains the local player's first format.
    vm.legacyFormats = [...vm.legacyFormats, { mimeType: 'video/mp4; codecs="avc1, mp4a.40.2"', url: 'https://cast-media.test/video.mp4', height: 720 }]
    vm.captions = [{ url: 'https://cast-media.test/en.vtt', label: 'English', language: 'en', mimeType: 'text/vtt' }]
  })
  return watch
}

async function choice(page, name) {
  await page.locator('.chromecastControl > button').click()
  await page.getByRole('option', { name, exact: true }).click()
}

test('casts the current video, controls the receiver and returns to its remote position', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await watch.evaluate(vm => { vm.$refs.player.setCurrentTime(5); vm.$refs.player.play() })
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
  await choice(page, 'Test TV')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('title', 'Casting to Test TV')
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(true)
  const starts = await app.electronApp.evaluate(() => globalThis.castTest.starts)
  expect(starts[0].source).toEqual({ url: 'https://cast-media.test/video.mp4', contentType: 'video/mp4' })
  expect(starts[0].startSeconds).toBeGreaterThanOrEqual(5)
  expect(starts[0].paused).toBe(false)

  await choice(page, 'Pause')
  await choice(page, 'Forward 10 seconds')
  await choice(page, 'Increase volume')
  await choice(page, 'Mute')
  await choice(page, 'English')
  await choice(page, 'Play')
  await app.electronApp.evaluate(() => { globalThis.castTest.state.currentTime = 18 })
  await expect.poll(() => watch.evaluate(vm => vm.getTimestamp())).toBe(18)
  expect(await page.locator('.ftVideoPlayer video').evaluate(video => video.currentTime)).toBeLessThan(10)
  await choice(page, 'Return to local playback')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(18)
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
  const controls = await app.electronApp.evaluate(() => globalThis.castTest.controls)
  expect(controls.map(control => control.action)).toEqual(['pause', 'seek', 'volume', 'mute', 'caption', 'play'])
  expect(controls[1].value).toBeGreaterThanOrEqual(15)
  expect(await app.electronApp.evaluate(() => globalThis.castTest.stops)).toEqual(['session-id'])
})

test('receiver buffering does not accumulate watched time and returns to playing locally', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await watch.evaluate(async vm => {
    await vm.$store.dispatch('updateEnableWatchStats', true)
    await vm.$store.dispatch('updateRememberHistory', true)
    vm.$refs.player.play()
  })
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
  await choice(page, 'Test TV')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
  await app.electronApp.evaluate(() => { globalThis.castTest.state.buffering = true })
  await expect.poll(() => watch.evaluate(vm => vm.chromecastStatus?.buffering)).toBe(true)
  await watch.evaluate(vm => { vm.pendingWatchTimeByDate = {}; vm.watchTimeLastTick = null })
  const before = await app.electronApp.evaluate(() => globalThis.castTest.statusCalls)
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.castTest.statusCalls)).toBeGreaterThanOrEqual(before + 2)
  expect(await watch.evaluate(vm => Object.values(vm.pendingWatchTimeByDate).reduce((sum, value) => sum + value, 0))).toBe(0)
  expect(await watch.evaluate(vm => vm.watchTimeLastTick)).toBe(null)
  expect(await watch.evaluate(vm => vm.chromecastStatus.paused)).toBe(false)

  await app.electronApp.evaluate(() => {
    globalThis.castTest.state.buffering = false
    globalThis.castTest.state.currentTime = 18
  })
  await expect.poll(() => watch.evaluate(vm => vm.chromecastStatus?.buffering)).toBe(false)
  await expect.poll(() => watch.evaluate(vm => Object.values(vm.pendingWatchTimeByDate).reduce((sum, value) => sum + value, 0))).toBeGreaterThan(0)
  await app.electronApp.evaluate(() => { globalThis.castTest.state.buffering = true })
  await expect.poll(() => watch.evaluate(vm => vm.chromecastStatus?.buffering)).toBe(true)
  await choice(page, 'Return to local playback')
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(18)
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
})

for (const outcome of ['playing', 'paused', 'stop failure']) {
  test(`removing the Cast control restores local playback after ${outcome}`, async ({ app, page }) => {
    const watch = await openCastVideo(app, page)
    await watch.evaluate(vm => vm.$refs.player.play())
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
    await choice(page, 'Test TV')
    await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
    await app.electronApp.evaluate(outcome => {
      globalThis.castTest.state.currentTime = 18
      globalThis.castTest.state.paused = outcome === 'paused'
      globalThis.castTest.failStop = outcome === 'stop failure'
    }, outcome)
    await expect.poll(() => watch.evaluate(vm => vm.chromecastStatus.currentTime)).toBe(18)
    await watch.evaluate(vm => vm.$store.dispatch('updateShowChromecastButton', false))
    await expect(page.locator('.chromecastControl')).toHaveCount(0)
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(18)
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(outcome === 'paused')
    await expect.poll(() => watch.evaluate(vm => vm.chromecastActive)).toBe(false)
    expect(await app.electronApp.evaluate(() => globalThis.castTest.stops)).toEqual(['session-id'])
  })
}

test('casts from the current Invidious instance without a saved default', async ({ app, page }) => {
  await mockCast(app)
  await mockPlayableWatchPage(app, page)
  const instanceUrl = 'https://invidious.test'
  await page.route(`${instanceUrl}/api/v1/videos/**`, route => route.fulfill({
    json: {
      title: 'Invidious Cast test',
      author: 'Test Channel',
      authorId: 'UC-test-channel-id',
      authorThumbnails: [],
      videoThumbnails: [{ url: '/vi/jNQXAC9IVRw/hqdefault.jpg', width: 480, height: 360 }],
      description: '',
      descriptionHtml: '',
      viewCount: 1,
      likeCount: 1,
      dislikeCount: 0,
      subCountText: '1',
      published: 1700000000,
      genre: 'People & Blogs',
      keywords: [],
      recommendedVideos: [],
      captions: [],
      liveNow: false,
      isPostLiveDvr: false,
      isListed: true,
      isFamilyFriendly: true,
      lengthSeconds: 30,
      formatStreams: [
        { itag: 43, type: DEMO_MEDIA_MIME_TYPE, url: DEMO_MEDIA_URL, size: '640x360', qualityLabel: '360p', fps: 30, bitrate: '200000' },
        { itag: 18, type: 'video/mp4; codecs="avc1, mp4a.40.2"', url: `${instanceUrl}/videoplayback`, size: '640x360', qualityLabel: '360p', fps: 30, bitrate: '200000' }
      ],
      adaptiveFormats: [{ itag: 140, url: `${DEMO_MEDIA_URL}&dur=30`, type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: '128000', init: '0-700', index: '701-800', audioQuality: 'AUDIO_QUALITY_MEDIUM', audioSampleRate: '48000', audioChannels: 2 }]
    }
  }))
  const defaultInstance = await page.evaluate(async url => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    // Keep an in-flight startup list refresh inside this fixture's instance set.
    store.subscribe(({ type, payload }) => {
      if (type === 'setInvidiousInstancesList' && (payload.length !== 1 || payload[0] !== url)) {
        store.commit('setInvidiousInstancesList', [url])
      }
    })
    await Promise.all([
      store.dispatch('updateBackendPreference', 'invidious'),
      store.dispatch('updateDefaultInvidiousInstance', ''),
      store.dispatch('updateDefaultVideoFormat', 'legacy'),
      store.dispatch('updateHideChapters', true)
    ])
    // Startup can choose another instance after its background refresh finishes.
    store.commit('setInvidiousInstancesList', [url])
    store.commit('setCurrentInvidiousInstance', url)
    return store.getters.getDefaultInvidiousInstance
  }, instanceUrl)
  expect(defaultInstance).toBe('')
  await openMockedVideo(page)
  await expect(page.locator('.infoArea .videoTitle')).toHaveText('Invidious Cast test')
  await choice(page, 'Test TV')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
  const starts = await app.electronApp.evaluate(() => globalThis.castTest.starts)
  expect(starts[0].source).toEqual({ url: `${instanceUrl}/videoplayback`, contentType: 'video/mp4' })
  expect(starts[0].invidiousInstanceUrl).toBe(instanceUrl)
  await choice(page, 'Return to local playback')
})

test('DLNA and Google Cast cannot start overlapping sessions', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.dlnaTest = { starts: [], stops: [], stopRequests: 0, finishStop: null }
    for (const name of ['dlna-discover', 'dlna-start', 'dlna-stop', 'yt-dlp-get-playback-info']) ipcMain.removeHandler(name)
    ipcMain.handle('yt-dlp-get-playback-info', () => ({ formats: [] }))
    ipcMain.handle('dlna-discover', () => [{ id: 'dlna-tv', name: 'DLNA TV' }])
    ipcMain.handle('dlna-start', async (_, payload) => {
      globalThis.dlnaTest.starts.push(payload)
      await new Promise(resolve => setTimeout(resolve, 1200))
      return { castId: 'dlna-session', deviceName: 'DLNA TV' }
    })
    ipcMain.handle('dlna-stop', async (_, id) => {
      globalThis.dlnaTest.stopRequests++
      await new Promise(resolve => { globalThis.dlnaTest.finishStop = resolve })
      globalThis.dlnaTest.stops.push(id)
      return true
    })
    globalThis.castTest.startDelayMs = 1200
  })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateShowDlnaCastButton', true))
  await watch.evaluate(vm => vm.$refs.player.play())
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
  const dlna = page.locator('.dlnaCastControl > button')
  const googleCast = page.locator('.chromecastControl > button')
  await dlna.click()
  await page.getByRole('option', { name: 'DLNA TV', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.dlnaTest.starts.length)).toBe(1)
  await expect(googleCast).toHaveAttribute('aria-disabled', 'true')
  await expect(dlna).toHaveAttribute('aria-pressed', 'true')
  expect(await app.electronApp.evaluate(() => globalThis.castTest.starts)).toEqual([])
  await dlna.click()
  await page.getByRole('option', { name: 'Stop casting', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.dlnaTest.stopRequests)).toBe(1)
  await expect(googleCast).toHaveAttribute('aria-disabled', 'true')
  expect(await app.electronApp.evaluate(() => globalThis.dlnaTest.stops)).toEqual([])
  await app.electronApp.evaluate(() => globalThis.dlnaTest.finishStop())
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.dlnaTest.stops.length)).toBe(1)
  await expect(googleCast).toHaveAttribute('aria-disabled', 'false')
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
  await choice(page, 'Test TV')
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.castTest.starts.length)).toBe(1)
  await expect(googleCast).toHaveAttribute('aria-pressed', 'true')
  await expect(dlna).toHaveCount(0)
  const [payload] = await app.electronApp.evaluate(() => globalThis.castTest.starts)
  expect(payload.paused).toBe(false)
  await choice(page, 'Return to local playback')
  await expect(dlna).toHaveAttribute('aria-disabled', 'false')
})

test('failed casting preserves local playback and paused casting returns paused', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await watch.evaluate(vm => vm.$refs.player.play())
  await app.electronApp.evaluate(() => { globalThis.castTest.failStart = true })
  await choice(page, 'Test TV')
  await expect(page.getByText('Could not cast the video', { exact: true })).toBeVisible()
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
  await app.electronApp.evaluate(() => { globalThis.castTest.failStart = false })
  await watch.evaluate(vm => vm.$refs.player.pause())
  await choice(page, 'Test TV')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
  await choice(page, 'Return to local playback')
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(true)
})

for (const outcome of ['success', 'reported failure', 'thrown failure']) {
  test(`a delayed Cast ${outcome} snapshots playback at the paused handoff`, async ({ app, page }) => {
    const watch = await openCastVideo(app, page)
    await watch.evaluate(vm => { vm.$refs.player.setCurrentTime(5); vm.$refs.player.play() })
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
    await app.electronApp.evaluate((_, outcome) => {
      globalThis.castTest.startDelayMs = 1800
      globalThis.castTest.failStart = outcome === 'thrown failure' ? 'throw' : outcome === 'reported failure'
    }, outcome)
    await choice(page, 'Test TV')
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.castTest.starts.length)).toBe(1)
    const [payload] = await app.electronApp.evaluate(() => globalThis.castTest.starts)
    expect(payload.paused).toBe(false)
    expect(await page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(true)
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.currentTime)).toBeCloseTo(payload.startSeconds, 1)
    if (outcome === 'success') {
      await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => watch.evaluate(vm => vm.currentTime)).toBeCloseTo(payload.startSeconds, 1)
    } else {
      await expect(page.getByText('Could not cast the video', { exact: true })).toBeVisible()
      await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'false')
      await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
    }
  })
}

test('Cast controls fit a narrow window at fractional UI scale and stop on navigation', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await setWindowSize(app, page, { width: 600, height: 850 })
  await choice(page, 'Test TV')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.chromecastControl > button').click()
  await expect(page.getByRole('option', { name: 'Return to local playback', exact: true })).toBeVisible()
  const bounds = await page.getByRole('option', { name: 'Return to local playback', exact: true }).boundingBox()
  const width = await page.evaluate(() => window.innerWidth)
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
  await page.keyboard.press('Escape')
  await watch.evaluate(vm => {
    const player = vm.$refs.player
    const play = player.play.bind(player)
    window.castResumeCalls = 0
    player.play = (...args) => { window.castResumeCalls++; return play(...args) }
  })
  await goTo(page, 'history')
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.castTest.stops)).toEqual(['session-id'])
  expect(await page.evaluate(() => window.castResumeCalls)).toBe(0)
})

test('packaged sender discovers and plays on the selected authenticated Cast receiver', async ({ app, page }) => {
  test.skip(!process.env.OPENTUBEX_CAST_TEST_DEVICE, 'Requires an explicitly selected Google-authenticated Cast receiver')
  const directory = await mkdtemp(path.join(tmpdir(), 'otx-cast-electron-'))
  let upstream
  const instanceRequests = []
  const mediaRequests = []
  try {
    const filename = path.join(directory, 'video.mp4')
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', path.resolve('e2e/fixtures/media/demo.webm'), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', filename])
    const media = await readFile(filename)
    upstream = createServer((request, response) => {
      if (request.url === '/inv/videoplayback') {
        instanceRequests.push(request.headers)
        if (request.headers.authorization !== 'Bearer cast-test') return response.writeHead(401).end()
        return response.writeHead(302, { location: '/video.mp4' }).end()
      }
      mediaRequests.push(request.headers)
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
      response.writeHead(range ? 206 : 200, {
        'content-type': 'video/mp4',
        'content-length': end - start + 1,
        'accept-ranges': 'bytes',
        ...(range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {})
      }).end(request.method === 'HEAD' ? undefined : media.subarray(start, end + 1))
    })
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const instanceUrl = `http://127.0.0.1:${upstream.address().port}/inv`
    await page.evaluate(url => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateDefaultInvidiousInstance', url), instanceUrl)
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(url => window.ftElectron.setInvidiousAuthorization('Bearer cast-test', url), instanceUrl)
    const watch = await watchViewHandle(page)
    await watch.evaluate((vm, url) => {
      vm.legacyFormats = [...vm.legacyFormats, { mimeType: 'video/mp4; codecs="avc1, mp4a.40.2"', url, height: 720 }]
      vm.$refs.player.setCurrentTime(5)
      vm.$refs.player.play()
    }, `${instanceUrl}/videoplayback`)
    await choice(page, process.env.OPENTUBEX_CAST_TEST_DEVICE)
    const button = page.locator('.chromecastControl > button')
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(true)
    await expect.poll(() => instanceRequests.length).toBeGreaterThan(0)
    expect(instanceRequests.every(headers => headers.authorization === 'Bearer cast-test')).toBe(true)
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(0)
    expect(mediaRequests.every(headers => headers.authorization === undefined)).toBe(true)
    await choice(page, 'Forward 10 seconds')
    await choice(page, 'Pause')
    await button.click()
    await expect(page.getByRole('option', { name: 'Play', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await choice(page, 'Return to local playback')
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(9)
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(true)
  } finally {
    upstream?.closeAllConnections()
    upstream?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('receiver polling saves progress before navigation', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await choice(page, 'Test TV')
  await app.electronApp.evaluate(() => { globalThis.castTest.state.currentTime = 18 })
  await expect.poll(() => watch.evaluate(vm => vm.currentTime)).toBe(18)
  await watch.evaluate(vm => vm.handleWatchProgressManualSave())
  await expect.poll(() => watch.evaluate(vm => vm.historyEntry?.watchProgress)).toBe(18)
  await page.locator('.sideNav a[href="#/history"]').first().evaluate(link => link.click())
  await expect(page).toHaveURL(/#\/history/)
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.castTest.stops)).toEqual(['session-id'])
})

for (const failStop of [false, true]) {
  test(`a status polling error releases local controls with a ${failStop ? 'failed' : 'successful'} stop`, async ({ app, page }) => {
    const watch = await openCastVideo(app, page)
    await choice(page, 'Test TV')
    await app.electronApp.evaluate(() => { globalThis.castTest.state.currentTime = 18 })
    await expect.poll(() => watch.evaluate(vm => vm.currentTime)).toBe(18)
    const successfulCalls = await app.electronApp.evaluate(failStop => {
      globalThis.castTest.failStatus = true
      globalThis.castTest.failStop = failStop
      return globalThis.castTest.statusCalls
    }, failStop)
    await expect(page.getByText('Could not cast the video', { exact: true })).toBeVisible()
    await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.castTest.stops)).toEqual(['session-id'])
    await expect.poll(() => watch.evaluate(vm => vm.chromecastActive)).toBe(false)
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(true)
    await page.waitForTimeout(2100)
    expect(await app.electronApp.evaluate(() => globalThis.castTest.statusCalls)).toBe(successfulCalls + 1)
    await app.electronApp.evaluate(() => { globalThis.castTest.failStatus = false; globalThis.castTest.failStop = false })
    await choice(page, 'Test TV')
    await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.castTest.statusCalls)).toBeGreaterThan(successfulCalls + 1)
  })
}

test('natural receiver completion marks watched and invokes Watch completion once', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await watch.evaluate(vm => { window.castCompletions = 0; vm.handleVideoEnded = () => { window.castCompletions++ } })
  await choice(page, 'Test TV')
  await app.electronApp.evaluate(() => { Object.assign(globalThis.castTest.state, { currentTime: 30, ended: true }) })
  await expect.poll(() => page.evaluate(() => window.castCompletions)).toBe(1)
  await expect.poll(() => watch.evaluate(vm => vm.historyEntry?.isWatched)).toBe(true)
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'false')
  expect(await app.electronApp.evaluate(() => globalThis.castTest.stops)).toEqual(['session-id'])
})

test('prefers the resolved adaptive source over a progressive SABR fallback', async ({ app, page }) => {
  await mockCast(app)
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.legacyFormats = [...vm.legacyFormats, { url: 'https://cast-media.test/360.mp4', mimeType: 'video/mp4', height: 360 }]
    vm.getChromecastSource = async () => ({ url: 'https://cast-media.test/manifest.mpd', contentType: 'application/dash+xml' })
  })
  await choice(page, 'Test TV')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
  expect((await app.electronApp.evaluate(() => globalThis.castTest.starts))[0].source.contentType).toBe('application/dash+xml')
})

test('preserves the active subtitle identity when Watch and player track order differ', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await watch.evaluate(vm => {
    vm.captions = [{ url: 'https://cast-media.test/de.vtt', label: 'German', language: 'de', mimeType: 'text/vtt' }, ...vm.captions]
    vm.currentSubtitlesState = true
  })
  await page.locator('.ftVideoPlayer video').evaluate(async video => {
    const player = video.ui.getControls().getPlayer()
    // Load English first so its Shaka index differs from its Watch index.
    const english = await player.addTextTrackAsync('https://cast-media.test/en.vtt', 'en', 'captions', 'text/vtt', undefined, 'English')
    await player.addTextTrackAsync('https://cast-media.test/de.vtt', 'de', 'captions', 'text/vtt', undefined, 'German')
    player.selectTextTrack(english)
  })
  await expect.poll(() => watch.evaluate(vm => vm.$refs.player.getActiveCaption()?.language)).toBe('en')
  await choice(page, 'Test TV')
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
  const [started] = await app.electronApp.evaluate(() => globalThis.castTest.starts)
  expect(started.captions[started.captionIndex].language).toBe('en')
})

for (const setting of ['YtDlpSubtitleUseCookies', 'YtDlpPlaybackAlwaysUseCookies']) {
  test(`casts cookie-backed captions through the authenticated subtitle download with ${setting}`, async ({ app, page }) => {
    const watch = await openCastVideo(app, page)
    const url = 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&fmt=vtt'
    const text = 'WEBVTT\n\n00:00.000 --> 00:30.000\nPrivate caption\n'
    await page.route(url, route => route.fulfill({ status: 403, body: 'Cookies required' }))
    await app.electronApp.evaluate(({ ipcMain }, text) => {
      globalThis.castSubtitleRequests = []
      ipcMain.removeHandler('yt-dlp-get-subtitle')
      ipcMain.handle('yt-dlp-get-subtitle', (_, url) => {
        globalThis.castSubtitleRequests.push(url)
        return text
      })
    }, text)
    await page.evaluate(setting => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(`update${setting}`, true), setting)
    await watch.evaluate((vm, url) => { vm.captions = [{ url, label: 'English', language: 'en', mimeType: 'text/vtt' }] }, url)
    await choice(page, 'Test TV')
    await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
    const [started] = await app.electronApp.evaluate(() => globalThis.castTest.starts)
    expect(started.captions[0].url).toBe(`data:text/vtt;charset=utf-8,${encodeURIComponent(text)}`)
    expect(await app.electronApp.evaluate(() => globalThis.castSubtitleRequests)).toContain(url)
    await choice(page, 'Return to local playback')
  })
}

test('an authenticated Cast caption failure leaves local playback running', async ({ app, page }) => {
  const watch = await openCastVideo(app, page)
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('yt-dlp-get-subtitle')
    ipcMain.handle('yt-dlp-get-subtitle', () => ({ error: 'Unable to load subtitle with configured cookies' }))
  })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateYtDlpSubtitleUseCookies', true))
  await watch.evaluate(vm => {
    vm.captions = [{ url: 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&fmt=vtt', label: 'English', language: 'en', mimeType: 'text/vtt' }]
    vm.$refs.player.play()
  })
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
  await choice(page, 'Test TV')
  await expect(page.getByText('Could not cast the video', { exact: true })).toBeVisible()
  expect(await app.electronApp.evaluate(() => globalThis.castTest.starts)).toEqual([])
  await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.paused)).toBe(false)
})

for (const outcome of ['resolved', 'rejected']) {
  test(`refreshes a ${outcome} Cast source lookup superseded by stream recovery`, async ({ app, page }) => {
    const watch = await openCastVideo(app, page)
    await watch.evaluate((vm, obsoleteOutcome) => {
      window.castSourceLookups = 0
      vm.getChromecastSource = () => {
        if (++window.castSourceLookups === 1) {
          return new Promise((resolve, reject) => {
            window.finishCastLookup = result => obsoleteOutcome === 'rejected' ? reject(new Error('Obsolete source failed')) : resolve(result)
          })
        }
        return Promise.resolve({ url: 'https://cast-media.test/recovered.mpd', contentType: 'application/dash+xml' })
      }
    }, outcome)
    await page.locator('.chromecastControl > button').click()
    await expect.poll(() => page.evaluate(() => typeof window.finishCastLookup)).toBe('function')
    await watch.evaluate(async vm => {
      vm.manifestSrc = 'https://cast-media.test/recovered.sabr'
      vm.manifestMimeType = 'application/sabr+json'
      await vm.$nextTick()
      window.finishCastLookup({ url: 'https://cast-media.test/obsolete.mpd', contentType: 'application/dash+xml' })
    })
    await expect.poll(() => page.evaluate(() => window.castSourceLookups), { timeout: 5000 }).toBe(2)
    await page.getByRole('option', { name: 'Test TV', exact: true }).click()
    await expect(page.locator('.chromecastControl > button')).toHaveAttribute('aria-pressed', 'true')
    const [started] = await app.electronApp.evaluate(() => globalThis.castTest.starts)
    expect(started.source.url).toBe('https://cast-media.test/recovered.mpd')
  })
}
