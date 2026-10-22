import { test, expect, sel } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { POST_LIVE_AUDIO_URL, POST_LIVE_VIDEO_URL, routePostLiveMedia } from '../../helpers/media.mjs'

const SEED = { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true }
const SRT = '1\n00:00:05,000 --> 00:00:07,000\nUntertitel aus der Datei\n'

/**
 * Makes the next file picker return the given file instead of opening a native dialog.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {string} contents
 */
function pickFile(page, name, contents) {
  return page.evaluate(([name, contents]) => {
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([contents], name) }]
  }, [name, contents])
}

/**
 * @param {import('@playwright/test').Locator} video
 */
function textTracks(video) {
  return video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks()
    .map(track => ({ label: track.label, active: track.active })))
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openCaptionsMenu(page) {
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  // Keep the controls shown, they can fade out before the click on slow machines
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.getByRole('button', { name: 'More settings' }).click()
  await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Captions' }).click()
  const captionsMenu = player.locator('.shaka-text-languages')
  await expect(captionsMenu).toBeVisible()
  return captionsMenu
}

/** @param {import('@playwright/test').Locator} locator */
async function getVisibleBounds(locator) {
  const bounds = await locator.boundingBox()
  expect(bounds, `Expected visible bounds for ${locator}`).not.toBeNull()
  return bounds
}

/**
 * Checks that the file and timing rows span the captions menu below its options,
 * either side by side or stacked, and returns whether they are side by side.
 * @param {import('@playwright/test').Locator} captionsMenu
 */
async function checkActionRows(captionsMenu) {
  const actions = captionsMenu.locator(':scope > .ft-caption-actions')
  const [menu, row, load, timing] = await Promise.all([
    captionsMenu, actions, actions.locator('.ft-caption-load-file-button'), actions.locator('.ft-caption-timing-button'),
  ].map(getVisibleBounds))
  expect(row.width).toBeGreaterThanOrEqual(menu.width - 16)
  const choices = captionsMenu.locator(':scope > button:not(.shaka-back-to-overflow-button, .ft-caption-options-button)')
  for (const choice of await choices.all()) {
    const bounds = await getVisibleBounds(choice)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(row.y + 1)
  }
  for (const button of [load, timing]) {
    expect(button.y + button.height).toBeLessThanOrEqual(row.y + row.height + 1)
  }
  const sideBySide = Math.abs(load.y - timing.y) <= 1
  if (sideBySide) {
    expect(load.x + load.width).toBeLessThanOrEqual(timing.x + 1)
    expect(load.width + timing.width).toBeGreaterThanOrEqual(row.width - 1)
  } else {
    expect(load.y + load.height).toBeLessThanOrEqual(timing.y + 1)
    expect(Math.min(load.width, timing.width)).toBeGreaterThanOrEqual(row.width - 1)
  }
  return sideBySide
}

/**
 * @param {import('@playwright/test').Locator} video
 * @param {number} time
 */
function pauseAt(video, time) {
  return video.evaluate((element, time) => {
    element.pause()
    element.currentTime = time
  }, time)
}

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`local subtitle files in ${usePlayerMenuGrid ? 'grid' : 'list'} menus`, () => {
    test.use({ seed: { settings: { ...SEED, usePlayerMenuGrid } } })

    test('loads a subtitle file for a video without captions', { tag: '@scale' }, async ({ app, page }, testInfo) => {
      // Opens the captions menu twice and takes screenshots
      test.slow()
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      await pauseAt(video, 6)
      expect(await textTracks(video)).toEqual([])

      const player = page.locator('.ftVideoPlayer')
      const caption = player.locator('.shaka-text-container [translate="no"]')
      let captionsMenu = await openCaptionsMenu(page)
      const loadButton = captionsMenu.getByRole('button', { name: 'Load subtitle file…', exact: true })
      // Side by side next to the timing row in the grid menu, which is wide enough for both labels
      expect(await checkActionRows(captionsMenu)).toBe(usePlayerMenuGrid)
      const iconBounds = await getVisibleBounds(loadButton.locator('.ft-icon__glyph'))
      const labelBounds = await getVisibleBounds(loadButton.locator(':scope > span:last-child'))
      expect(iconBounds.x + iconBounds.width).toBeLessThan(labelBounds.x)
      await captionsMenu.screenshot({ path: testInfo.outputPath('captions-menu-without-tracks.png') })

      await pickFile(page, 'Mein Film.de.srt', SRT)
      await loadButton.click()
      await expect(caption).toHaveText('Untertitel aus der Datei')
      await expect(captionsMenu).toBeHidden()
      expect(await textTracks(video)).toEqual([{ label: 'Mein Film.de.srt', active: true }])
      await player.screenshot({ path: testInfo.outputPath('local-subtitles-shown.png') })

      captionsMenu = await openCaptionsMenu(page)
      await expect(captionsMenu.getByRole('button', { name: 'Mein Film.de.srt', exact: true })).toHaveAttribute('aria-selected', 'true')
      await captionsMenu.screenshot({ path: testInfo.outputPath('captions-menu-with-local-track.png') })
      await captionsMenu.getByRole('button', { name: 'Off', exact: true }).click()
      await expect(caption).toHaveCount(0)
      expect(await textTracks(video)).toEqual([{ label: 'Mein Film.de.srt', active: false }])
    })

    if (usePlayerMenuGrid) {
      test('stacks the grid rows when their labels do not fit side by side', { tag: '@scale' }, async ({ app, page }, testInfo) => {
        await mockPlayableWatchPage(app, page)
        await openMockedVideo(page)
        const captionsMenu = await openCaptionsMenu(page)
        const loadButton = captionsMenu.locator('.ft-caption-load-file-button')
        expect(await checkActionRows(captionsMenu)).toBe(true)

        const longLabel = 'Eine Untertiteldatei vom Gerät laden…'
        await page.evaluate((text) => {
          const app = document.querySelector('#app').__vue_app__
          const i18n = app._context.provides[app.__VUE_I18N_SYMBOL__].global
          i18n.mergeLocaleMessage('de-DE', { Video: { Player: { 'Subtitle File': { Load: text } } } })
          i18n.locale.value = 'de-DE'
        }, longLabel)
        await expect(loadButton).toHaveText(longLabel)
        await expect.poll(() => checkActionRows(captionsMenu)).toBe(false)
        // The full labels fit once each has its own row
        expect(await loadButton.locator(':scope > span:last-child').evaluate(label => label.scrollWidth <= label.clientWidth)).toBe(true)
        await captionsMenu.screenshot({ path: testInfo.outputPath('captions-menu-stacked-rows.png') })

        await page.evaluate(() => {
          const app = document.querySelector('#app').__vue_app__
          app._context.provides[app.__VUE_I18N_SYMBOL__].global.locale.value = 'en-US'
        })
        await expect(loadButton).toHaveText('Load subtitle file…')
        await expect.poll(() => checkActionRows(captionsMenu)).toBe(true)
      })
    }
  })
}

test.describe('local subtitle files', () => {
  test.use({ seed: { settings: SEED } })

  test('stays usable after canceled picks and rejects a file without subtitles', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const captionsMenu = await openCaptionsMenu(page)
    const loadButton = captionsMenu.getByRole('button', { name: 'Load subtitle file…', exact: true })
    const error = page.locator('.toast', { hasText: 'Could not load the subtitle file. Choose an SRT or WebVTT file.' })

    // Android's picker doesn't report when it is canceled, the desktop one throws an AbortError
    await page.evaluate(() => { window.showOpenFilePicker = () => new Promise(() => {}) })
    await loadButton.click()
    await page.evaluate(() => { window.showOpenFilePicker = async () => { throw new DOMException('Canceled', 'AbortError') } })
    await loadButton.click()
    await pickFile(page, 'notes.srt', 'These are not subtitles')
    await loadButton.click()
    await expect(error).toHaveCount(1)
    await expect(captionsMenu).toBeVisible()
    expect(await textTracks(video)).toEqual([])
  })

  test('keeps loaded files next to the video captions when the player reloads', async ({ app, page }) => {
    // Reloads the player twice
    test.slow()
    await mockPlayableWatchPage(app, page, { captionText: 'Video caption' })
    let video = await openMockedVideo(page)
    await pauseAt(video, 6)
    const caption = page.locator(`${activeTab} .ftVideoPlayer .shaka-text-container [translate="no"]`)

    let captionsMenu = await openCaptionsMenu(page)
    await pickFile(page, 'movie.vtt', 'WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nFirst file\n')
    await captionsMenu.getByRole('button', { name: 'Load subtitle file…', exact: true }).click()
    await expect(caption).toHaveText('First file')
    // The same file again, e.g. after fixing it, is listed separately
    captionsMenu = await openCaptionsMenu(page)
    await pickFile(page, 'movie.vtt', 'WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nFixed file\n')
    await captionsMenu.getByRole('button', { name: 'Load subtitle file…', exact: true }).click()
    await expect(caption).toHaveText('Fixed file')
    const expectedTracks = [
      { label: 'English', active: false },
      { label: 'movie.vtt', active: false },
      { label: 'movie.vtt (2)', active: true },
    ]
    expect(await textTracks(video)).toEqual(expectedTracks)

    // Reloading the same source in the current player
    const watchView = await watchViewHandle(page)
    let oldVideo
    try {
      oldVideo = await video.elementHandle()
      await watchView.evaluate(view => { view.playbackSourceKey++ })
      await expect.poll(() => textTracks(video)).toEqual(expectedTracks)
      expect(await video.evaluate((element, before) => element === before, oldVideo)).toBe(true)
      await pauseAt(video, 6)
      await expect(caption).toHaveText('Fixed file')

      // Recovering playback with a new player
      await watchView.evaluate((view) => {
        view.setPlayerReloadState(view.$refs.player.getSabrReloadState())
        view.playerLoadGeneration++
      })
      await expect.poll(() => oldVideo.evaluate(element => element.isConnected)).toBe(false)
      video = page.locator(`${activeTab} .ftVideoPlayer video`)
      await expect.poll(() => textTracks(video).catch(() => [])).toEqual(expectedTracks)
      await pauseAt(video, 6)
      await expect(caption).toHaveText('Fixed file')
    } finally {
      await oldVideo?.dispose()
      await watchView.dispose()
    }

    captionsMenu = await openCaptionsMenu(page)
    await captionsMenu.getByRole('button', { name: 'movie.vtt', exact: true }).click()
    await expect(caption).toHaveText('First file')
  })
})

test.describe('local subtitle files in adaptive streams', () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'yt-dlp', ytDlpPlaybackEngineDefaultMigration: true, defaultVideoFormat: 'dash' } } })

  test('shows a loaded file', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routePostLiveMedia(page)
    await page.route('https://local-captions.test/*.m3u8', (route) => {
      const filename = new URL(route.request().url()).pathname
      const media = filename === '/video.m3u8' ? POST_LIVE_VIDEO_URL : POST_LIVE_AUDIO_URL
      return route.fulfill({
        contentType: 'application/x-mpegurl',
        body: filename === '/master.m3u8'
          ? '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n' +
            '#EXT-X-STREAM-INF:BANDWIDTH=84000,CODECS="avc1.42c00d,mp4a.40.2",RESOLUTION=320x180,AUDIO="audio"\nvideo.m3u8\n'
          : `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-VERSION:7\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="${media}"\n#EXTINF:2,\n${media}\n#EXT-X-ENDLIST\n`
      })
    })
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => ({
        isLive: false,
        liveStatus: 'not_live',
        hlsManifestUrl: 'https://local-captions.test/master.m3u8',
        formats: [],
        duration: 2,
        storyboardVtt: null,
        title: 'Local captions test',
        captions: [],
        captionTranslations: [],
        version: 'test'
      }))
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const video = player.locator('video')
    await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
    expect(await player.evaluate(element => element.ui.getControls().getPlayer().getLoadMode())).toBe(2) // MEDIA_SOURCE
    await pauseAt(video, 1)

    const captionsMenu = await openCaptionsMenu(page)
    await pickFile(page, 'clip.srt', '1\n00:00:00,500 --> 00:00:01,500\nAdaptive stream subtitle\n')
    await captionsMenu.getByRole('button', { name: 'Load subtitle file…', exact: true }).click()
    await expect(player.locator('.shaka-text-container [translate="no"]')).toHaveText('Adaptive stream subtitle')
    expect(await textTracks(video)).toEqual([{ label: 'clip.srt', active: true }])
  })
})
