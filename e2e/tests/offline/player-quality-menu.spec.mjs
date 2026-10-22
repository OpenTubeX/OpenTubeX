import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { POST_LIVE_VIDEO_URL, routePostLiveMedia } from '../../helpers/media.mjs'

const TRACKS = [
  { id: 1, codecs: 'av01.0.12M.08', width: 3840, height: 2160, frameRate: 60, bandwidth: 18e6 },
  { id: 2, codecs: 'av01.0.09M.08', width: 1920, height: 1080, frameRate: 60, bandwidth: 4e6 },
  { id: 3, codecs: 'av01.0.08M.08', width: 1280, height: 720, frameRate: 60, bandwidth: 2e6 },
  { id: 4, codecs: 'vp09.00.51.08', width: 3840, height: 2160, frameRate: 60, bandwidth: 20e6 },
  { id: 5, codecs: 'vp09.00.41.08', width: 1920, height: 1080, frameRate: 60, bandwidth: 5e6 },
  { id: 6, codecs: 'vp09.00.41.08', width: 1920, height: 1080, frameRate: 60, bandwidth: 9e6 },
  { id: 7, codecs: 'vp09.00.40.08', width: 1280, height: 720, frameRate: 60, bandwidth: 2.5e6 },
  { id: 8, codecs: 'avc1.64002a', width: 1920, height: 1080, frameRate: 60, bandwidth: 6e6 },
  { id: 9, codecs: 'avc1.4d4020', width: 1280, height: 720, frameRate: 60, bandwidth: 3e6 },
  { id: 10, codecs: 'avc1.4d401e', width: 640, height: 360, frameRate: 30, bandwidth: 7e5 },
]

/**
 * Opens a video that Shaka plays adaptively, so it builds the resolution menu.
 *
 * @param {{ electronApp: import('@playwright/test').ElectronApplication }} app
 * @param {import('@playwright/test').Page} page
 */
async function openAdaptiveVideo(app, page) {
  await mockPlayableWatchPage(app, page)
  await routePostLiveMedia(page)
  await page.route('https://quality-menu.test/*.m3u8', route => route.fulfill({
    contentType: 'application/x-mpegurl',
    body: route.request().url().endsWith('/master.m3u8')
      ? `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=84000,CODECS="avc1.42c00d",RESOLUTION=320x180
video.m3u8
`
      : `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${POST_LIVE_VIDEO_URL}"
#EXTINF:2,
${POST_LIVE_VIDEO_URL}
#EXT-X-ENDLIST
`
  }))
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', () => ({
      isLive: false,
      liveStatus: 'not_live',
      hlsManifestUrl: 'https://quality-menu.test/master.m3u8',
      formats: [],
      duration: 2,
      storyboardVtt: null,
      title: 'Quality menu',
      captions: [],
      captionTranslations: [],
      version: 'test'
    }))
  })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
}

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`quality in ${usePlayerMenuGrid ? 'grid' : 'list'} menus`, { tag: '@scale' }, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'yt-dlp',
          ytDlpPlaybackEngineDefaultMigration: true,
          defaultVideoFormat: 'dash',
          defaultQuality: 'auto',
          usePlayerMenuGrid,
          useSponsorBlock: false,
          playNextVideo: false,
          fetchSubscriptionsAutomatically: false,
        }
      }
    })

    test('phone options keep a submenu that Shaka rebuilds while it is open', async ({ app, page }, testInfo) => {
      await openAdaptiveVideo(app, page)
      await setWindowSize(app, page, { width: 360, height: 760 })
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      await player.hover()
      await player.locator('.shaka-overflow-menu-button').click({ force: true })
      const dialog = player.locator('.phonePlayerOptions[open]')
      await dialog.locator('.shaka-resolution-button').click()
      const menu = dialog.locator('.shaka-resolutions')
      const header = dialog.locator(':scope > .shaka-back-to-overflow-button')
      await expect(menu.locator('.shaka-enable-abr-button')).toBeVisible()

      // Shaka rebuilds the open menu whenever automatic quality switches tracks
      await player.evaluate(element => element.ui.getControls().getPlayer().dispatchEvent({ type: 'adaptation' }))
      await expect(menu.locator('.explicit-resolution')).toHaveCount(1)
      await expect(menu.locator('.shaka-enable-abr-button')).toBeVisible()
      await expect(header).toHaveText('Resolution')
      // Submenu titles follow the back icon at the start of the header
      const headerBounds = await header.boundingBox()
      const titleBounds = await header.locator('span').boundingBox()
      expect(titleBounds.x - headerBounds.x).toBeLessThan(64)

      await header.click()
      await expect(menu).toBeHidden()
      await dialog.locator('.shaka-playbackrate-button').click()
      await expect(header).toHaveText('Playback speed')
      await dialog.screenshot({ path: testInfo.outputPath('phone-speed.png') })
      await dialog.press('Escape')
      await expect(dialog.locator('.shaka-resolution-button')).toBeVisible()
    })

    test('labels Dolby Vision, LCEVC and non-square pixels like Shaka', async ({ app, page }) => {
      await openAdaptiveVideo(app, page)
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      await player.evaluate(element => {
        const shakaPlayer = element.ui.getControls().getPlayer()
        shakaPlayer.getVideoTracks = () => [
          { id: 1, codecs: 'avc1.64002a', width: 1920, height: 1080, frameRate: 30, bandwidth: 4e6, active: true },
          { id: 2, codecs: 'dvh1.05.06', width: 3840, height: 2160, frameRate: 30, bandwidth: 20e6, hdr: 'PQ' },
          // Displayed as 1920x1080, so it's not portrait video
          { id: 3, codecs: 'vp09.00.40.08', width: 960, height: 1080, frameRate: 30, bandwidth: 2e6, pixelAspectRatio: '2:1' },
          { id: 4, codecs: 'lvc1.vvi1.01', width: 1280, height: 720, frameRate: 30, bandwidth: 1e6 },
        ].map(track => ({ hdr: 'SDR', roles: [], videoLayout: null, active: false, ...track }))
        shakaPlayer.dispatchEvent({ type: 'trackschanged' })
      })
      const menu = player.locator('.shaka-resolutions')
      const codecs = menu.locator('.ft-quality-codecs')
      await player.hover()
      await player.locator('.shaka-overflow-menu-button').click()
      await player.locator('.shaka-resolution-button').click()
      await codecs.getByRole('button', { name: 'DVH1' }).click()
      await expect(menu.locator('.explicit-resolution > span')).toHaveText(['2160p Dolby Vision'])
      await codecs.getByRole('button', { name: 'VP9' }).click()
      await expect(menu.locator('.explicit-resolution > span')).toHaveText(['1080p'])
      await codecs.getByRole('button', { name: 'LVC1' }).click()
      await expect(menu.locator('.explicit-resolution > span')).toHaveText(['720p LCEVC'])
    })

    test('lists the resolutions of the codec picked in the header', async ({ app, page }, testInfo) => {
      await openAdaptiveVideo(app, page)
      const player = page.locator(`${activeTab} .ftVideoPlayer`)

      // A single test stream can't be played in several codecs, so the
      // resolution menu gets YouTube-like tracks to list instead.
      await player.evaluate((element, tracks) => {
        const shakaPlayer = element.ui.getControls().getPlayer()
        let activeId = 8
        window.__selectedQualityTracks = []
        shakaPlayer.getVideoTracks = () => tracks.map(track => ({
          ...track,
          active: track.id === activeId,
          roles: [],
          hdr: 'SDR',
          videoLayout: null,
        }))
        shakaPlayer.selectVideoTrack = (track) => {
          activeId = track.id
          window.__selectedQualityTracks.push(track.id)
          shakaPlayer.dispatchEvent({ type: 'variantchanged' })
        }
        shakaPlayer.configure({ abr: { enabled: false } })
        shakaPlayer.dispatchEvent({ type: 'trackschanged' })
      }, TRACKS)

      const menu = player.locator('.shaka-resolutions')
      const codecs = menu.locator('.ft-quality-codecs')
      const tiles = menu.locator('.explicit-resolution')
      const openMenu = async () => {
        await player.hover()
        await player.locator('.shaka-overflow-menu-button').click()
        await player.locator('.shaka-resolution-button').click()
        await expect(menu).toBeVisible()
      }

      await openMenu()
      await expect(codecs).toHaveAccessibleName('Video Codec')
      await expect(codecs.getByRole('button')).toHaveText(['AV1', 'VP9', 'H.264'])
      await expect(codecs.getByRole('button', { name: 'H.264' })).toHaveAttribute('aria-pressed', 'true')
      await expect(tiles.locator('> span')).toHaveText(['1080p60', '720p60', '360p'])
      await expect(tiles.first()).toHaveAttribute('aria-selected', 'true')
      await menu.screenshot({ path: testInfo.outputPath('h264.png') })
      if (usePlayerMenuGrid) {
        const title = await menu.locator('.shaka-back-to-overflow-button > span').boundingBox()
        const switcher = await codecs.boundingBox()
        expect(title.x + title.width).toBeLessThanOrEqual(switcher.x)
      }

      await codecs.getByRole('button', { name: 'VP9' }).click()
      await expect(menu).toBeVisible()
      await expect(codecs.getByRole('button', { name: 'VP9' })).toHaveAttribute('aria-pressed', 'true')
      await expect(tiles.locator('> span')).toHaveText(['2160p60', '1080p60 (9 Mbps)', '1080p60 (5 Mbps)', '720p60'])
      await expect(tiles.locator('> .shaka-quality-mark')).toHaveText(['4K', 'HD', 'HD'])
      await expect(tiles.locator('[aria-selected="true"]')).toHaveCount(0)
      await menu.screenshot({ path: testInfo.outputPath('vp9.png') })

      // Playback events rebuild the open menu
      await player.evaluate(element => element.ui.getControls().getPlayer().dispatchEvent({ type: 'adaptation' }))
      await expect(codecs.getByRole('button', { name: 'VP9' })).toHaveAttribute('aria-pressed', 'true')
      await expect(tiles).toHaveCount(4)

      await tiles.filter({ hasText: '1080p60 (5 Mbps)' }).click()
      await expect.poll(() => page.evaluate(() => window.__selectedQualityTracks)).toEqual([5])
      await expect(player.locator('.shaka-resolution-button')).toHaveAttribute('shaka-status', '1080p60 (5 Mbps)')

      await page.keyboard.press('Escape')
      await openMenu()
      await expect(codecs.getByRole('button', { name: 'VP9' })).toHaveAttribute('aria-pressed', 'true')
      await expect(tiles.filter({ hasText: '1080p60 (5 Mbps)' })).toHaveAttribute('aria-selected', 'true')

      // The phone layout shows the header above the menu, with the codecs
      // beside its title while they fit
      await page.keyboard.press('Escape')
      await setWindowSize(app, page, { width: 450, height: 700 })
      await openMenu()
      const dialog = player.locator('.phonePlayerOptions[open]')
      const header = dialog.locator(':scope > .shaka-back-to-overflow-button')
      await codecs.getByRole('button', { name: 'AV1' }).click()
      await expect(codecs.getByRole('button', { name: 'AV1' })).toHaveAttribute('aria-pressed', 'true')
      await expect(tiles.locator('> span')).toHaveText(['2160p60', '1080p60', '720p60'])
      await expect(dialog).toHaveAttribute('data-header-action', '')
      const headerBox = await header.boundingBox()
      const headerSwitcher = await codecs.boundingBox()
      expect(headerSwitcher.y).toBeGreaterThanOrEqual(headerBox.y)
      expect(headerSwitcher.y + headerSwitcher.height).toBeLessThanOrEqual(headerBox.y + headerBox.height)
      await dialog.screenshot({ path: testInfo.outputPath('phone-header.png') })

      // Otherwise they're as far from the header as from the options, and in
      // the grid as far from the options as those are from the end of the menu
      await menu.locator('.shaka-back-to-overflow-button > span').evaluate(span => { span.textContent = 'Resolution '.repeat(3).trim() })
      await expect(dialog).not.toHaveAttribute('data-header-action')
      await expect.poll(async () => {
        const headerBounds = await header.boundingBox()
        const menuBounds = await dialog.locator(':scope > .shaka-overflow-menu').boundingBox()
        const switcher = await codecs.boundingBox()
        const firstTile = await tiles.first().boundingBox()
        const lastTile = await menu.locator('.shaka-enable-abr-button').boundingBox()
        const above = switcher.y - (headerBounds.y + headerBounds.height)
        const between = firstTile.y - (switcher.y + switcher.height)
        const end = menuBounds.y + menuBounds.height - (lastTile.y + lastTile.height)
        return above > 0 && Math.abs(above - between) < 1 && (!usePlayerMenuGrid || Math.abs(above - end) < 1)
      }).toBe(true)
      await dialog.screenshot({ path: testInfo.outputPath('phone.png') })

      // Leaving the phone layout restores the regular placement
      await dialog.locator('.phonePlayerOptionsClose').click()
      await expect(dialog).toHaveCount(0)
      expect(await codecs.evaluate(element => element.style.marginBlock)).toBe('')
      await setWindowSize(app, page, { width: 1280, height: 800 })
      await openMenu()
      const menuBox = await menu.boundingBox()
      const desktopSwitcher = await codecs.boundingBox()
      if (usePlayerMenuGrid) {
        expect(desktopSwitcher.y - menuBox.y).toBeLessThan(10)
      } else {
        expect(desktopSwitcher.y - menuBox.y).toBeGreaterThan(20)
      }
      await page.keyboard.press('Escape')

      await player.evaluate((element, tracks) => {
        const shakaPlayer = element.ui.getControls().getPlayer()
        shakaPlayer.getVideoTracks = () => tracks
          .filter(track => track.codecs.startsWith('avc1'))
          .map(track => ({ ...track, active: track.id === 8, roles: [], hdr: 'SDR', videoLayout: null }))
        shakaPlayer.dispatchEvent({ type: 'trackschanged' })
      }, TRACKS)
      await expect(codecs).toHaveCount(0)
    })
  })
}

test.describe('quality codecs with classic controls', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'yt-dlp',
        ytDlpPlaybackEngineDefaultMigration: true,
        defaultVideoFormat: 'dash',
        defaultQuality: 'auto',
        useFrostedGlassPlayerUi: false,
        useSponsorBlock: false,
        playNextVideo: false,
        fetchSubscriptionsAutomatically: false,
      }
    }
  })

  test('keeps the codecs in the phone header without the frosted dialog', async ({ app, page }) => {
    await openAdaptiveVideo(app, page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    await expect(player).toHaveClass(/\bclassicPlayerControls\b/)
    await player.evaluate((element, tracks) => {
      const shakaPlayer = element.ui.getControls().getPlayer()
      shakaPlayer.getVideoTracks = () => tracks.map(track => ({ ...track, active: track.id === 8, roles: [], hdr: 'SDR', videoLayout: null }))
      shakaPlayer.dispatchEvent({ type: 'trackschanged' })
    }, TRACKS)
    await setWindowSize(app, page, { width: 450, height: 700 })
    await player.hover()
    await player.locator('.shaka-overflow-menu-button').click({ force: true })
    const dialog = player.locator('.phonePlayerOptions[open]')
    await dialog.locator('.shaka-resolution-button').click()
    await expect(dialog).toHaveAttribute('data-header-action', '')
    const header = await dialog.locator(':scope > .shaka-back-to-overflow-button').boundingBox()
    // Away from the top of the window, where the viewport would place it
    expect(header.y).toBeGreaterThan(20)
    const switcher = await dialog.locator('.ft-quality-codecs').boundingBox()
    expect(switcher.y).toBeGreaterThanOrEqual(header.y)
    expect(switcher.y + switcher.height).toBeLessThanOrEqual(header.y + header.height)
  })
})
