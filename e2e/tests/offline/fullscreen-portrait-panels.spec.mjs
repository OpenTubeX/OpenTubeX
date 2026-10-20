import { test, expect, expectScrollAtRenderedEnd, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } }
})

test('every portrait full-window dock uses the shared sheet', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionText: 'Transcript line' })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 420, height: 800 })
  const watch = await page.evaluateHandle(findWatchComponent)
  const player = page.locator('.ftVideoPlayer')
  try {
    await watch.evaluate(component => {
      const watch = component.proxy
      watch.watchingPlaylist = true
      watch.liveChatIsReplay = true
      watch.videoChapters = [{ title: 'Opening', startSeconds: 0, timestamp: '0:00' }]
      watch.recommendedVideos = [{ videoId: 'related0001', title: 'Related video', author: 'Channel', type: 'video' }]
      watch.$store.commit('addVideoToWatchQueue', { video: { videoId: 'queued00001', title: 'Queued video', author: 'Channel' } })
    })
    await page.keyboard.press('s')
    await expect(player).toHaveClass(/fullWindow/)
    const sheet = player.locator('.fullscreenDockSheet[open]')
    for (const [dock, method] of [
      ['Metadata', 'setFullscreenMetadata'],
      ['Transcript', 'toggleFullscreenTranscript'],
      ['SponsorBlock', 'toggleFullscreenSponsorBlock'],
      ['LiveChat', 'setFullscreenLiveChat'],
      ['Comments', 'setFullscreenComments'],
      ['Playlist', 'setFullscreenPlaylist'],
      ['Queue', 'setFullscreenQueue'],
      ['Recommendations', 'setFullscreenRecommendations'],
      ['Chapters', null],
      ['Metadata', 'setFullscreenMetadata'],
    ]) {
      await watch.evaluate((component, method) => {
        const exposed = component.proxy.$refs.player
        const player = exposed.$.setupState
        if (method) (exposed[method] ?? player[method])(true)
        else player.showChaptersOverlay = true
      }, method)
      await expect(sheet).toBeVisible()
      await expect(sheet.locator(dock === 'Chapters' ? '.chapterOverlay' : `.fullscreen${dock}Overlay.open`)).toBeVisible()
      await expect(sheet.locator(':scope > .open, :scope > .chapterOverlay')).toHaveCount(1)
      await expect(sheet.locator('.fullscreenDockResizeHandle')).toHaveCount(0)
      await expect(sheet.locator(':is(.chapterOverlayHeader, .fullscreenMetadataHeader, .transcriptHeader, .sponsorBlockHeader, .liveChatDockHeader, .fullscreenCommentHeader, .playlistDockHeader, .fullscreenDockHeader):visible').first()).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(player).toHaveClass(/fullWindow/)
  } finally {
    await watch.dispose()
  }
})

test('portrait fullscreen docks use bottom panels and return to side docks in landscape', { tag: '@scale' }, async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 420, height: 800 })
  await setPlayerFullscreen(page, true)
  const watch = await page.evaluateHandle(findWatchComponent)
  const player = page.locator('.ftVideoPlayer')
  const screenshot = async () => Buffer.from(await app.electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')), 'base64')
  try {
    await watch.evaluate(component => component.proxy.$refs.player.setFullscreenMetadata(true))
    const sheet = player.locator('.fullscreenDockSheet[open]')
    await expect(sheet).toBeVisible()
    await expect.poll(() => sheet.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.width / window.innerWidth
    })).toBeCloseTo(1, 2)
    await expect(sheet.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await testInfo.attach('portrait-metadata', { body: await screenshot(), contentType: 'image/png' })
    await watch.evaluate(component => {
      for (let index = 0; index < 30; index++) {
        component.proxy.$store.commit('addVideoToWatchQueue', {
          video: { videoId: `queued${String(index).padStart(5, '0')}`, title: `Queued video ${index + 1}`, author: 'Queue channel' }
        })
      }
    })
    await watch.evaluate(component => component.proxy.$refs.player.setFullscreenQueue(true))
    const queue = sheet.locator('.fullscreenQueueOverlay.open')
    await expect(queue).toBeVisible()
    await expect(player.locator('.fullscreenMetadataOverlay.open')).toHaveCount(0)
    await player.hover({ position: { x: 20, y: 20 } })
    await expect.poll(() => player.locator('.fullscreenActions').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const sheetTop = element.parentElement.querySelector('.fullscreenDockSheet').getBoundingClientRect().top
      return bounds.top >= 0 && bounds.bottom <= sheetTop
    })).toBe(true)
    const scroller = queue.locator('.queueItems')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await testInfo.attach('portrait-queue', { body: await screenshot(), contentType: 'image/png' })
    const header = queue.locator('.fullscreenDockHeader')
    const bounds = await header.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 100, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => sheet.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(5)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-visible/)
    await watch.evaluate(component => {
      const store = component.proxy.$store
      for (const item of store.getters.getWatchQueue.slice(3)) {
        store.commit('removeVideoFromWatchQueue', item.queueItemId)
      }
    })
    await expectScrollAtRenderedEnd(scroller)
    await expect.poll(() => scroller.evaluate(element => {
      const overflowing = element.scrollHeight > element.clientHeight + 1
      return element.querySelector(':scope > .os-scrollbar-vertical').classList.contains('os-scrollbar-visible') === overflowing
    })).toBe(true)
    await setWindowSize(app, page, { width: 1000, height: 600 })
    await expect(sheet).toHaveCount(0)
    await expect(player.locator('.fullscreenQueueOverlay.open')).toBeVisible()
    await setWindowSize(app, page, { width: 420, height: 800 })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  } finally {
    await watch.dispose()
  }
})
