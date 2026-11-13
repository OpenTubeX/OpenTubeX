import path from 'node:path'

import { test, expect, abortUnmockedRequest, goTo, repoRoot, setWindowSize, waitForAppReady } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

const downloadSource = (id, videoId, filePath) => `downloadmedia://file/${id}/${videoId}?path=${encodeURIComponent(filePath)}`
const mediaPath = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
test.use({
  seed: {
    settings: { landingPage: 'history', enableDownloads: true },
    downloads: [{
      id: 1,
      videoId: 'offline0001',
      title: 'Offline download',
      status: 'completed',
      mode: 'video',
      percent: 100,
      destination: mediaPath,
      destinations: [mediaPath],
      files: [{ videoId: 'offline0001', path: mediaPath, extension: 'webm' }],
    }],
  },
})

for (const restart of [false, true]) {
  test(`plays downloads offline ${restart ? 'after restarting the renderer' : 'after losing connectivity'}`, async ({ page }) => {
    await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
    const disconnect = () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    }
    await page.context().addInitScript(disconnect)
    await page.evaluate(disconnect)
    if (restart) {
      await page.reload()
      await waitForAppReady(page)
    }
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await goTo(page, 'downloads')
    await expect(page.locator('.downloadRow')).toContainText('Offline download')
    await page.getByRole('button', { name: 'Play download', exact: true }).click()
    const video = page.locator('video').first()
    await expect(video).toBeVisible()
    await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
    await video.evaluate(element => element.play())
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0)
    await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toHaveCount(0)
  })
}

test.describe('download with unreachable YouTube', () => {
  test.use({
    seed: {
      settings: { landingPage: 'history', enableDownloads: true, enableSubtitlesByDefault: true },
      downloads: [{
        id: 1,
        videoId: 'jNQXAC9IVRw',
        title: 'Offline download',
        status: 'completed',
        mode: 'video',
        destination: mediaPath,
        destinations: [mediaPath],
        files: [{ videoId: 'jNQXAC9IVRw', path: mediaPath, extension: 'webm' }],
      }],
    },
  })

  test('plays the file while the metadata request keeps retrying', async ({ app, page }) => {
    // The internet check succeeds, so only network recovery retries YouTube.
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await goTo(page, 'downloads')
    await page.getByRole('button', { name: 'Play download', exact: true }).click()
    const video = page.locator('video').first()
    await expect(video).toHaveJSProperty('currentSrc', downloadSource(1, 'jNQXAC9IVRw', mediaPath))
    await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
    await video.evaluate(element => element.play())
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0)
    await expect(page.locator('.videoTitle:visible')).toHaveText('Offline download')
    await expect(page.locator('.connectionStatus')).toBeHidden()
    const textTrackCount = () => video.evaluate(element => element.ui?.getControls()?.getPlayer()?.getTextTracks().length ?? 0)
    expect(await textTrackCount()).toBe(0)

    // The retried request fills in the metadata without reloading the file.
    const watchView = await watchViewHandle(page)
    const sourceKey = await watchView.evaluate(view => view.playbackSourceKey)
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
    // Network recovery retries at once on a network change, not after its backoff.
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.videoTitle:visible')).toHaveText('Me at the zoo')
    expect(await watchView.evaluate(view => view.playbackSourceKey)).toBe(sourceKey)
    await expect(video).toHaveJSProperty('currentSrc', downloadSource(1, 'jNQXAC9IVRw', mediaPath))
    // The late metadata also brings the captions to the playing file, and
    // turns them on as the default subtitles setting asks.
    await expect.poll(textTrackCount).toBeGreaterThan(0)
    await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().some(track => track.active))).toBe(true)
  })
})

for (const mobile of [false, true]) {
  test.describe(`download watch queue at ${mobile ? 'phone' : 'desktop'} width`, () => {
    const audioPath = path.join(repoRoot, 'e2e/fixtures/media/demo-audio.mp3')
    const missingPath = path.join(repoRoot, 'e2e/fixtures/media/missing.webm')
    const download = (id, videoId, title, mode, filePath, files) => ({
      id,
      videoId,
      title,
      mode,
      status: 'completed',
      destination: filePath,
      destinations: files.map(file => file.path),
      files,
    })
    test.use({
      seed: {
        settings: { landingPage: 'history', enableDownloads: true, autoplayVideos: false, uiScale: mobile ? 95 : 100, iconPack: mobile ? 'remix' : 'material' },
        downloads: [
          download(1, 'offline0001', 'Offline download', 'video', mediaPath,
            [{ videoId: 'offline0001', path: mediaPath, extension: 'webm' }]),
          download(2, 'offline0002', 'Downloaded audio', 'audio', audioPath,
            [{ videoId: 'offline0002', path: audioPath, extension: 'mp3' }]),
          download(3, null, 'Downloaded playlist', 'video', mediaPath, [
            { videoId: 'offline0003', title: 'Playlist video one', path: mediaPath, extension: 'webm' },
            { videoId: 'missing0001', title: 'Missing video', path: missingPath, extension: 'webm' },
            { videoId: 'offline0004', title: 'Playlist video two', path: mediaPath, extension: 'webm' },
          ]),
          download(4, 'missing0002', 'Missing download', 'video', missingPath,
            [{ videoId: 'missing0002', path: missingPath, extension: 'webm' }]),
          download(5, 'subtitle001', 'Subtitles only', 'subtitles', mediaPath,
            [{ videoId: 'subtitle001', path: mediaPath, extension: 'vtt' }]),
          download(6, 'offline0002', 'Second audio download', 'audio', audioPath,
            [{ videoId: 'offline0002', path: audioPath, extension: 'mp3' }]),
        ],
      }
    })

    test('adds saved audio and available playlist videos to the queue and plays them offline', async ({ app, page }, testInfo) => {
      if (mobile) await setWindowSize(app, page, { width: 480, height: 850 })
      await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
        window.dispatchEvent(new Event('offline'))
      })
      await expect(page.locator('.connectionStatus')).toHaveText('Offline')
      if (mobile) {
        await page.getByRole('button', { name: 'Quick settings', exact: true }).click()
        await page.getByRole('button', { name: 'Downloads', exact: true }).click()
      } else {
        await goTo(page, 'downloads')
      }
      const row = title => page.locator('.downloadRow').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      await expect(row('Missing download').getByRole('button', { name: 'Add to Queue', exact: true })).toHaveCount(0)
      await expect(row('Subtitles only').getByRole('button', { name: 'Add to Queue', exact: true })).toHaveCount(0)
      await row('Downloaded audio').getByRole('button', { name: 'Add to Queue', exact: true }).click()
      await row('Downloaded playlist').getByRole('button', { name: 'Add to Queue', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.$store.getters.getWatchQueueLength)).toBe(3)
      const downloadsDialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
      await expect(downloadsDialog).toBeVisible()
      await downloadsDialog.screenshot({ path: testInfo.outputPath('download-queue.png') })
      await downloadsDialog.getByRole('button', { name: 'Close', exact: true }).click()

      await goTo(page, 'home')
      const homeQueue = page.locator('[data-home-section="watchQueue"]')
      const audioLink = homeQueue.getByRole('link').filter({ hasText: 'Downloaded audio' })
      await expect(audioLink).toHaveAttribute('href', /^#\/watch\/offline0002\?downloadId=2&/)
      expect(new URLSearchParams((await audioLink.getAttribute('href')).split('?')[1]).get('downloadFilePath')).toBe(audioPath)
      await homeQueue.getByRole('link').filter({ hasText: 'Downloaded audio' }).click()
      await expect(page).toHaveURL(/#\/watch\/offline0002\?downloadId=2/)
      const video = page.locator('video').first()
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      await expect(video).toHaveAttribute('src', downloadSource(2, 'offline0002', audioPath))
      await video.evaluate(element => element.pause())

      if (mobile) await page.getByRole('button', { name: 'Queue Playlist video one', exact: true }).click()
      const queue = page.locator('.watchQueue')
      await expect(queue.locator('.queueItem h3')).toHaveText(['Playlist video one', 'Playlist video two'])
      await expect(queue.locator('.queueItem a.title').first()).toHaveAttribute('href', /^#\/watch\/offline0003\?(.+&)?downloadId=3(&|$)/)
      // Downloads have no duration, so they must not be labelled as live.
      await expect(queue.locator('.videoDuration.live')).toHaveCount(0)
      await video.evaluate(element => element.dispatchEvent(new Event('ended')))
      await expect(page).toHaveURL(/#\/watch\/offline0003\?downloadId=3/)
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      await expect(video).toHaveAttribute('src', downloadSource(3, 'offline0003', mediaPath))
      await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0.1)).toBe(true)
      await expect(video).not.toHaveAttribute('autoplay')
      await video.evaluate(element => element.pause())
      if (mobile) await page.getByRole('button', { name: 'Queue Playlist video two', exact: true }).click()
      await queue.getByRole('link').filter({ hasText: 'Playlist video two' }).click()
      await expect(page).toHaveURL(/#\/watch\/offline0004\?downloadId=3/)
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      await expect(video).toHaveAttribute('src', downloadSource(3, 'offline0004', mediaPath))
      await expect(queue).toBeHidden()
    })

    // Queue advancement does not depend on the layout; cover it at one width.
    for (const sameDownload of mobile ? [] : [false, true]) {
      test(`starts a queued ${sameDownload ? 'duplicate' : 'copy'} of the current video from the beginning`, async ({ page }) => {
        await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
          window.dispatchEvent(new Event('offline'))
        })
        await goTo(page, 'downloads')
        const row = title => page.locator('.downloadRow').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
        await row(sameDownload ? 'Downloaded audio' : 'Second audio download').getByRole('button', { name: 'Add to Queue', exact: true }).click()
        await row('Downloaded audio').getByRole('button', { name: 'Play download', exact: true }).click()
        const video = page.locator('video').first()
        await expect(video).toHaveAttribute('src', downloadSource(2, 'offline0002', audioPath))
        await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
        const originalVideo = await video.elementHandle()
        const ended = originalVideo.evaluate(element => new Promise(resolve => element.addEventListener('ended', resolve, { once: true })))
        await video.evaluate(element => element.play())
        await ended
        const downloadId = sameDownload ? 2 : 6
        await expect(page).toHaveURL(new RegExp(`#/watch/offline0002\\?downloadId=${downloadId}`))
        await expect(video).toHaveAttribute('src', downloadSource(downloadId, 'offline0002', audioPath))
        await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0.1 && !element.ended)).toBe(true)
        await expect(video).not.toHaveAttribute('autoplay')
        expect(await originalVideo.evaluate(element => element === document.querySelector('video'))).toBe(true)
        await originalVideo.dispose()
      })
    }

    test('clearing a download removes all its queued copies', async ({ app, page }) => {
      if (mobile) {
        await setWindowSize(app, page, { width: 480, height: 850 })
        await page.getByRole('button', { name: 'Quick settings', exact: true }).click()
        await page.getByRole('button', { name: 'Downloads', exact: true }).click()
      } else {
        await goTo(page, 'downloads')
      }
      const audio = page.locator('.downloadRow').filter({ hasText: 'Downloaded audio' })
      await audio.getByRole('button', { name: 'Add to Queue', exact: true }).click()
      await audio.getByRole('button', { name: 'Add to Queue', exact: true }).click()
      await page.locator('.downloadRow').filter({ hasText: 'Downloaded playlist' }).getByRole('button', { name: 'Add to Queue', exact: true }).click()
      const queuedIds = () => page.evaluate(() => window.$store.getters.getWatchQueue.map(video => video.route.query.downloadId))
      await expect.poll(queuedIds).toEqual(['2', '2', '3', '3'])
      await audio.getByRole('button', { name: 'Clear From List', exact: true }).click()
      await expect(audio).toHaveCount(0)
      await expect.poll(queuedIds).toEqual(['3', '3'])
    })
  })
}

test.describe('playlist in the mini player', () => {
  const playlistVideo = (videoId, title, index) => ({
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC0000000000000000000000',
    lengthSeconds: 60,
    timeAdded: 1700000000000 - index,
    playlistItemId: `item-${index}`,
    type: 'video',
  })
  const download = (id, videoId, title) => ({
    id,
    videoId,
    title,
    status: 'completed',
    mode: 'video',
    destination: mediaPath,
    destinations: [mediaPath],
    files: [{ videoId, path: mediaPath, extension: 'webm' }],
  })
  test.use({
    seed: {
      settings: { landingPage: 'history', enableDownloads: true, keepPlayingOnNavigation: true, defaultInterval: 0 },
      playlists: [{
        _id: 'downloaded-playlist',
        playlistName: 'Downloaded playlist',
        protected: false,
        description: '',
        videos: [playlistVideo('offline0001', 'Playlist video one', 0), playlistVideo('offline0002', 'Playlist video two', 1)],
      }],
      downloads: [download(1, 'offline0001', 'Playlist video one'), download(2, 'offline0002', 'Playlist video two')],
    },
  })

  for (const leave of ['navigation', 'back', 'tab switch']) {
    test(`plays the next video after ${leave}`, async ({ page }) => {
      await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
      await goTo(page, 'userplaylists')
      await page.getByText('Downloaded playlist').click()
      await page.locator('.ft-list-video').filter({ hasText: 'Playlist video one' }).locator('.thumbnailLink').click()
      const player = page.locator('.ftVideoPlayer')
      const video = player.locator('video')
      await expect(video).toHaveAttribute('src', /^downloadmedia:\/\/file\/1\/offline0001/)
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      if (leave === 'navigation') {
        await page.getByRole('link', { name: 'Go to History', exact: true }).click()
      } else if (leave === 'back') {
        // Return once through the mini player, so History sits between two
        // entries of this video. Back must keep updating the one it left.
        await page.getByRole('link', { name: 'Go to History', exact: true }).click()
        await player.locator('.scrollMiniScrollTop').click()
        await expect(page).toHaveURL(/#\/watch\/offline0001\?/)
        await page.locator('.navBackButton button').click()
        await expect(page).toHaveURL(/#\/history$/)
      } else {
        await page.locator('.tabBar .newTabButton').click()
      }
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      const url = page.url()
      await video.evaluate(element => {
        element.currentTime = element.duration - 0.2
        return element.play()
      })
      await expect(video).toHaveAttribute('src', /^downloadmedia:\/\/file\/2\/offline0002/)
      await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0.1)).toBe(true)
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      expect(page.url()).toBe(url)
      if (leave === 'back') {
        // Forward returns to the video the mini player plays now.
        await page.getByRole('button', { name: /^Forward/ }).click()
      } else {
        await player.locator('.scrollMiniScrollTop').click()
      }
      await expect(page).toHaveURL(/#\/watch\/offline0002\?/)
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect(video).toHaveAttribute('src', /^downloadmedia:\/\/file\/2\/offline0002/)
    })
  }
})

test.describe('mobile downloaded audio mini player', { tag: '@scale' }, () => {
  const audioPath = path.join(repoRoot, 'e2e/fixtures/media/demo-audio.mp3')
  const audioDownload = (id, videoId, title) => ({
    id,
    videoId,
    title,
    status: 'completed',
    mode: 'audio',
    thumbnail: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="purple"/></svg>',
    files: [{ videoId, path: audioPath, extension: 'mp3' }],
  })
  test.use({
    seed: {
      settings: { landingPage: 'history', enableDownloads: true, scrollPlayerMode: 'mini', keepPlayingOnNavigation: true, enableMobileFullscreenSwipe: false },
      downloads: [audioDownload(1, 'offline0001', 'Downloaded audio'), audioDownload(2, 'offline0002', 'Next audio')],
    },
  })

  /** Shows the phone layout offline and opens Downloads. */
  async function openPhoneDownloads(app, page) {
    await setWindowSize(app, page, { width: 480, height: 850 })
    await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 })
      window.dispatchEvent(new Event('offline'))
      const app = document.querySelector('.app')
      const mobile = () => {
        if (!app.classList.contains('capacitorTabs')) app.classList.add('capacitorTabs')
        if (!app.classList.contains('capacitorPhoneLayout')) app.classList.add('capacitorPhoneLayout')
      }
      new MutationObserver(mobile).observe(app, { attributeFilter: ['class'] })
      mobile()
      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      document.querySelector('.app > .routerView').append(spacer)
    })
    await page.getByRole('button', { name: 'Quick settings', exact: true }).click()
    await page.getByRole('button', { name: 'Downloads', exact: true }).click()
    return title => page.locator('.downloadRow').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  }

  test('advances the queue in the mini player while browsing', async ({ app, page }) => {
    const row = await openPhoneDownloads(app, page)
    await row('Next audio').getByRole('button', { name: 'Add to Queue', exact: true }).click()
    await row('Downloaded audio').getByRole('button', { name: 'Play download', exact: true }).click()
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await expect(video).toHaveAttribute('src', downloadSource(1, 'offline0001', audioPath))
    await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
    await goTo(page, 'subscriptions')
    await expect(player).toHaveClass(/mobileMiniBar/)
    await video.evaluate(element => {
      element.currentTime = element.duration - 0.2
      return element.play()
    })
    await expect(video).toHaveAttribute('src', downloadSource(2, 'offline0002', audioPath))
    await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0.1)).toBe(true)
    await expect(page).toHaveURL(/#\/subscriptions$/)
    await expect(player).toHaveClass(/mobileMiniBar/)
    await expect.poll(() => page.evaluate(() => window.$store.getters.getWatchQueueLength)).toBe(0)
    // The mini player shows the next video, so pausing it saves its progress.
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(1)
    const progress = await video.evaluate(element => { element.pause(); return element.currentTime })
    await expect.poll(() => page.evaluate(() => window.$store.getters.getHistoryCacheById.offline0002?.watchProgress))
      .toBeCloseTo(progress, 1)
    await video.evaluate(element => element.play())
    // Back returns to the video the mini player plays now.
    await page.locator('.navBackButton button').evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/watch\/offline0002\?downloadId=2/)
    await expect(page.locator('.videoTitle:visible')).toHaveText('Next audio')
    await expect.poll(() => video.evaluate(element => !element.paused)).toBe(true)
  })

  test('scrolling, navigation and swiping dock local audio and preserve playback', async ({ app, page }) => {
    const row = await openPhoneDownloads(app, page)
    await row('Downloaded audio').getByRole('button', { name: 'Play download', exact: true }).click()
    await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
    const watch = await watchViewHandle(page)
    await watch.evaluate(vm => {
      vm.adEndTimeUnixMs = Date.now() + 60000
      vm.playbackSourceKey++
    })
    await watch.dispose()
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
    await expect(player.locator('.countdownOverlay')).toHaveCount(0)
    await video.evaluate(element => { element.loop = true; return element.play() })
    const originalVideo = await video.elementHandle()
    const settle = async () => {
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      await expect.poll(() => player.evaluate(element => element.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true)
    }
    await page.evaluate(() => window.scrollTo(0, 1200))
    await expect(player).toHaveClass(/mobileMiniBar/)
    await settle()
    await expect(player.locator('.countdownPoster img')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await settle()
    await goTo(page, 'subscriptions')
    await expect(player).toHaveClass(/mobileMiniBar/)
    await settle()
    await player.locator('.mobileMiniBarReturn').click()
    await expect(page).toHaveURL(/#\/watch\/offline0001\?downloadId=1/)
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await settle()
    const bounds = await player.boundingBox()
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const session = await page.context().newCDPSession(page)
    try {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
      for (const distance of [30, 60, 100, 160]) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(player).toHaveClass(/mobileMiniBar/)
      await expect(page).toHaveURL(/#\/subscriptions/)
      await settle()
      await expect(player.locator('.countdownPoster img')).toBeVisible()
      expect(await originalVideo.evaluate(element => element === document.querySelector('.ftVideoPlayer video') && !element.paused)).toBe(true)
    } finally {
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
      await session.detach()
      await originalVideo.dispose()
    }
  })
})
