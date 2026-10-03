import path from 'node:path'

import { test, expect, goTo, repoRoot, setWindowSize, waitForAppReady } from '../../helpers/app.mjs'

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

      if (mobile) await page.getByRole('button', { name: 'Queue Downloaded audio', exact: true }).click()
      const queue = page.locator('.watchQueue')
      await expect(queue.locator('.queueVideoTitle')).toHaveText(['Downloaded audio', 'Playlist video one', 'Playlist video two'])
      await queue.getByRole('link').filter({ hasText: 'Downloaded audio' }).click()
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
  })
}
