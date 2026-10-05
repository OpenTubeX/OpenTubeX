import path from 'node:path'

import { test, expect, goTo, repoRoot, setWindowSize, waitForAppReady } from '../../helpers/app.mjs'
import { watchViewHandle } from '../../helpers/watch.mjs'

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
        settings: { landingPage: 'history', enableDownloads: true, uiScale: mobile ? 95 : 100, iconPack: mobile ? 'remix' : 'material' },
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
      await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength)).toBe(3)
      const downloadsDialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
      await expect(downloadsDialog).toBeVisible()
      await downloadsDialog.screenshot({ path: testInfo.outputPath('download-queue.png') })
      await downloadsDialog.getByRole('button', { name: 'Close', exact: true }).click()

      await goTo(page, 'home')
      const homeQueue = page.locator('[data-home-section="watchQueue"]')
      await expect(homeQueue.getByRole('link').filter({ hasText: 'Downloaded audio' })).toHaveAttribute('href', '#/watch/offline0002?downloadId=2')
      await homeQueue.getByRole('link').filter({ hasText: 'Downloaded audio' }).click()
      await expect(page).toHaveURL(/#\/watch\/offline0002\?downloadId=2/)
      const video = page.locator('video').first()
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      await expect(video).toHaveAttribute('src', 'downloadmedia://file/2/offline0002')
      await video.evaluate(element => element.pause())

      if (mobile) await page.getByRole('button', { name: 'Queue Playlist video one', exact: true }).click()
      const queue = page.locator('.watchQueue')
      await expect(queue.locator('.queueVideoTitle')).toHaveText(['Playlist video one', 'Playlist video two'])
      await video.evaluate(element => element.dispatchEvent(new Event('ended')))
      await expect(page).toHaveURL(/#\/watch\/offline0003\?downloadId=3/)
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      await expect(video).toHaveAttribute('src', 'downloadmedia://file/3/offline0003')
      await video.evaluate(element => element.pause())
      if (mobile) await page.getByRole('button', { name: 'Queue Playlist video two', exact: true }).click()
      await queue.getByRole('link').filter({ hasText: 'Playlist video two' }).click()
      await expect(page).toHaveURL(/#\/watch\/offline0004\?downloadId=3/)
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      await expect(video).toHaveAttribute('src', 'downloadmedia://file/3/offline0004')
      await expect(queue).toBeHidden()
    })

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
      const queuedIds = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueue.map(video => video.route.query.downloadId))
      await expect.poll(queuedIds).toEqual(['2', '2', '3', '3'])
      await audio.getByRole('button', { name: 'Clear From List', exact: true }).click()
      await expect(audio).toHaveCount(0)
      await expect.poll(queuedIds).toEqual(['3', '3'])
    })
  })
}

for (const uiScale of [100, 125]) {
  test.describe(`mobile downloaded audio mini player at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: { landingPage: 'history', enableDownloads: true, uiScale, scrollMiniPlayerEnabled: true, keepPlayingOnNavigation: true, enableMobileFullscreenSwipe: false },
        downloads: [{
          id: 1,
          videoId: 'offline0001',
          title: 'Downloaded audio',
          status: 'completed',
          mode: 'audio',
          thumbnail: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="purple"/></svg>',
          files: [{ videoId: 'offline0001', path: path.join(repoRoot, 'e2e/fixtures/media/demo-audio.mp3'), extension: 'mp3' }],
        }],
      },
    })
    test('scrolling, navigation and swiping dock local audio and preserve playback', async ({ app, page }) => {
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
      await page.getByRole('button', { name: 'Play download', exact: true }).click()
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
}
