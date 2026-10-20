import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, repoRoot, sel, test } from '../../helpers/app.mjs'
import { activeTab } from '../../helpers/player.mjs'
import { mapExternalPlaybackMetadata } from '../../../src/ytDlpMetadata.js'

for (const quality of ['1080', '480', 'auto']) {
  test.describe(`external HLS with ${quality} default quality`, () => {
    test.use({ seed: { settings: { defaultQuality: quality } } })

    test('uses the configured default quality for Twitch playback', async ({ app, page }, testInfo) => {
      const masterUrl = 'https://quality.example.test/master.m3u8'
      const segmentUrl = 'https://quality.example.test/segment.mp4'
      const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42c028"
360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.42c028"
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.42c028"
1080.m3u8
`
      await page.route('https://quality.example.test/*.m3u8', route => route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: route.request().url() === masterUrl
          ? master
          : `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${segmentUrl}"
#EXTINF:2,
${segmentUrl}
#EXT-X-ENDLIST
`
      }))
      await page.route(segmentUrl, async route => route.fulfill({
        contentType: 'video/mp4',
        body: await readFile(path.join(repoRoot, 'e2e/fixtures/media/hls-1080.mp4'))
      }))
      await app.electronApp.evaluate(({ ipcMain }, info) => {
        ipcMain.removeHandler('yt-dlp-get-playback-info')
        ipcMain.handle('yt-dlp-get-playback-info', () => info)
      }, {
        title: 'Example quality test',
        isLive: false,
        liveStatus: 'was_live',
        hlsManifestUrl: masterUrl,
        formats: [],
        duration: 2,
        storyboardVtt: null,
        captions: [],
        captionTranslations: [],
        externalMetadata: mapExternalPlaybackMetadata({})
      })

      await page.locator(sel.searchInput).fill('https://www.twitch.tv/videos/123456789')
      await page.locator(sel.searchInput).press('Enter')
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      await expect.poll(() => player.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)
      await expect.poll(() => player.evaluate(element => {
        const shakaPlayer = element.ui.getControls().getPlayer()
        return {
          auto: shakaPlayer.getConfiguration().abr.enabled,
          height: shakaPlayer.getVariantTracks().find(track => track.active)?.height
        }
      })).toEqual(quality === 'auto'
        ? { auto: true, height: expect.any(Number) }
        : { auto: false, height: quality === '1080' ? 1080 : 360 })

      if (quality === '1080') {
        await player.hover()
        await player.locator('.shaka-overflow-menu-button').click()
        await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Resolution' }).click()
        await player.locator('.shaka-resolutions').screenshot({ path: testInfo.outputPath('default-quality-1080.png') })
      }
    })
  })
}
