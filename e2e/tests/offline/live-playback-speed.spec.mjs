import { test, expect, sel } from '../../helpers/app.mjs'
import { activeTab } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { POST_LIVE_VIDEO_URL, routePostLiveMedia } from '../../helpers/media.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'yt-dlp', useQuickPlaybackSpeedBar: true } } })

for (const premiere of [false, true]) {
  test(`DVR ${premiere ? 'premiere' : 'livestream'} offers both playback speed controls`, async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await routePostLiveMedia(page)
    const manifest = 'https://example.invalid/playlist_type/DVR/live.m3u8'
    await page.route(manifest, route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n' +
        Array.from({ length: 20 }, (_, index) =>
          `${index ? '#EXT-X-DISCONTINUITY\n' : ''}#EXTINF:2,\n${POST_LIVE_VIDEO_URL}&segment=${index}\n`
        ).join('')
    }))
    await app.electronApp.evaluate(({ ipcMain }, hlsManifestUrl) => {
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => ({
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl,
        formats: [],
        duration: null,
        storyboardVtt: null,
        captions: [],
        captionTranslations: [],
        version: 'test'
      }))
    }, manifest)
    await page.locator(sel.searchInput).fill('https://youtu.be/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()
    const view = await watchViewHandle(page)
    await expect.poll(() => view.evaluate(view => view.$refs.player?.hasLoaded)).toBe(true)
    await view.evaluate((view, premiere) => { view.isPremiere = premiere }, premiere)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const video = player.locator('video')
    await video.evaluate(element => element.pause())
    expect(await player.evaluate(element => element.ui.getControls().getPlayer().isLive())).toBe(true)
    await player.evaluate(element => {
      const controls = element.ui.getControls()
      controls.getVideo().currentTime = controls.getPlayer().seekRange().start + 5
    })
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    const bar = player.locator('.ft-quick-playback-rate-bar')
    await expect(bar).toBeVisible()
    await bar.locator('[data-rate="1.5"]').click()
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
    await player.getByRole('button', { name: 'More settings', exact: true }).click()
    await expect(player.locator('.shaka-playbackrate-button')).toBeVisible()
    await attachScreenshot('DVR playback speed controls')
    await player.locator('.shaka-playbackrate-button').click()
    await player.locator('.shaka-playback-rates .shaka-playback-rate-preset-btn[data-rate="2"]').click()
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(2)
    await expect(bar.locator('[data-rate="2"]')).toHaveClass(/is-current-rate/)
    await view.evaluate(view => { view.isLiveDvrEnabled = false })
    await expect(bar).toHaveCount(0)
    await expect(player.locator('.shaka-playbackrate-button')).toHaveCount(0)
  })
}
