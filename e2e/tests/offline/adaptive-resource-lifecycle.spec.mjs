import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { POST_LIVE_AUDIO_URL, POST_LIVE_VIDEO_URL, routePostLiveMedia } from '../../helpers/media.mjs'

for (const format of ['dash', 'audio']) {
  for (const usePlayerMenuGrid of [true, false]) {
    test.describe(`${format} quality in ${usePlayerMenuGrid ? 'grid' : 'list'} menus`, () => {
      test.use({
        seed: {
          settings: {
            videoPlaybackEngine: 'yt-dlp',
            ytDlpPlaybackEngineDefaultMigration: true,
            defaultVideoFormat: format,
            defaultQuality: 'auto',
            usePlayerMenuGrid,
            useSponsorBlock: false,
            playNextVideo: false,
            fetchSubscriptionsAutomatically: false,
          }
        }
      })

      test('releases quality choices after track and submenu updates', async ({ app, page }) => {
        test.setTimeout(120_000)
        await mockPlayableWatchPage(app, page)
        await routePostLiveMedia(page)
        await page.route('https://quality-resources.test/*.m3u8', route => {
          const filename = new URL(route.request().url()).pathname
          const media = filename === '/audio.m3u8' ? POST_LIVE_AUDIO_URL : POST_LIVE_VIDEO_URL
          return route.fulfill({
            contentType: 'application/x-mpegurl',
            body: filename === '/master.m3u8'
              ? `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=84000,CODECS="avc1.42c00d,mp4a.40.2",RESOLUTION=320x180,AUDIO="audio"
video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=168000,CODECS="avc1.42c00d,mp4a.40.2",RESOLUTION=640x360,AUDIO="audio"
high.m3u8
`
              : `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${media}"
#EXTINF:2,
${media}
#EXT-X-ENDLIST
`
          })
        })
        await app.electronApp.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('yt-dlp-get-playback-info')
          ipcMain.handle('yt-dlp-get-playback-info', () => ({
            isLive: false,
            liveStatus: 'not_live',
            hlsManifestUrl: 'https://quality-resources.test/master.m3u8',
            formats: [],
            duration: 2,
            storyboardVtt: null,
            title: 'Quality resources',
            captions: [],
            captionTranslations: [],
            version: 'test'
          }))
        })
        const video = await openMockedVideo(page)
        await video.evaluate(element => element.pause())
        const player = page.locator('.ftVideoPlayer')
        await expect(player.locator('.shaka-resolutions .explicit-resolution').first()).toBeAttached()
        await page.evaluate(() => { window.__discardedQualityChoices = [] })
        const session = await page.context().newCDPSession(page)
        try {
          for (const scale of [1, 1.25]) {
            await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
            for (let index = 0; index < 40; index++) {
              await player.evaluate(element => {
                const controls = element.ui.getControls()
                for (const type of ['adaptation', 'trackschanged', 'variantchanged', 'abrstatuschanged', 'submenuopen', 'submenuclose']) {
                  for (const button of element.querySelectorAll('.shaka-resolutions button:not(.shaka-back-to-overflow-button)')) {
                    window.__discardedQualityChoices.push(new WeakRef(button))
                  }
                  const target = type.startsWith('submenu') ? controls : controls.getPlayer()
                  target.dispatchEvent({ type })
                }
              })
            }
            await session.send('HeapProfiler.collectGarbage')
            const retained = await page.evaluate(() => window.__discardedQualityChoices.filter(ref => ref.deref() && !ref.deref().isConnected).length)
            console.log('Retained discarded quality choices:', { format, usePlayerMenuGrid, scale, retained })
            expect.soft(retained).toBe(0)
          }
          await player.hover()
          await player.locator('.shaka-overflow-menu-button').click()
          await player.locator('.shaka-resolution-button').click()
          await player.locator('.shaka-resolutions .explicit-resolution').first().click()
          await expect.poll(() => player.evaluate(element => element.ui.getControls().getPlayer().getConfiguration().abr.enabled)).toBe(false)
          await player.locator('.shaka-resolution-button').click()
          await player.locator('.shaka-resolutions .shaka-enable-abr-button').click()
          await expect.poll(() => player.evaluate(element => element.ui.getControls().getPlayer().getConfiguration().abr.enabled)).toBe(true)
        } finally {
          await session.detach()
        }
      })
    })
  }
}
