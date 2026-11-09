import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { IpcChannels } from '../../../src/constants.js'
import { chooseSelectOption, test, expect, sel, goTo, goToSettingsSection, openPlaylistMenuItem, setWindowSize, readDatastore } from '../../helpers/app.mjs'
import { DEMO_MEDIA_URL, routeDemoMedia } from '../../helpers/media.mjs'

const seededPremiereStart = Date.now() + 86_400_000

async function dispatchStoreAction(page, action, payload) {
  await page.evaluate(async ({ action, payload }) => {
    const store = window.$store
    await store.dispatch(action, payload)
  }, { action, payload })
}

async function allThumbnailsInclude(playlistCard, expectedUrlPart) {
  const sources = await playlistCard.locator('.thumbnailImage:not(.retryImagePlaceholder)').evaluateAll(images => images.map(image => image.src))
  return sources.length > 0 && sources.every(source => source.includes(expectedUrlPart))
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'Yes' | 'No'} answer
 */
async function answerPlaylistPreloadPrompt(page, answer) {
  const prompt = page.getByRole('dialog', { name: 'Preload all videos?' })
  await expect(prompt).toContainText('temporarily blocked by YouTube')
  await prompt.getByRole('button', { name: answer, exact: true }).click()
  await expect(prompt).toHaveCount(0)
}

test.describe('playlist creation', () => {
  test('a playlist can be created through the UI', async ({ page }) => {
    await goTo(page, 'userplaylists')

    await page.getByTitle('Create New Playlist').click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible()
    expect(await createDialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)')
    await expect(createDialog.getByText('Quick bookmark icon')).toHaveCount(0)
    await createDialog.locator('.playlistNameInput input').fill('Created via UI')
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(page.getByRole('link', { name: 'Created via UI' })).toBeVisible()
  })
})

test.describe('seeded playlists', () => {
  test.use({
    seed: {
      settings: {
        hideUpcomingPremieres: true,
        quickBookmarkTargetPlaylistId: 'favorites',
        videoPlaybackEngine: 'yt-dlp',
        ytDlpPlaybackEngineDefaultMigration: true
      },
      playlists: [
        {
          _id: 'favorites',
          playlistName: 'Favorites',
          protected: true,
          description: 'Quick bookmark target',
          videos: [],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        },
        {
          _id: 'e2eseeded',
          playlistName: 'My seeded playlist',
          protected: false,
          description: 'Playlist created by the E2E seed',
          videos: [
            {
              videoId: 'ccccccccccc',
              title: 'Seeded video one',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: Date.now() - 86_400_000,
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-1',
              type: 'video'
            },
            {
              videoId: 'ddddddddddd',
              title: 'Upcoming seeded premiere',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: seededPremiereStart,
              isUpcoming: true,
              isPremiere: true,
              premiereDate: new Date(seededPremiereStart).toISOString(),
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-2',
              type: 'video'
            }
          ],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        },
        {
          _id: 'secondary',
          playlistName: 'Secondary preload playlist',
          protected: false,
          description: 'Playlist used to test switching during preloading',
          videos: [
            {
              videoId: 'eeeeeeeeeee',
              title: 'Secondary seeded video',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: Date.now() - 86_400_000,
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-3',
              type: 'video'
            }
          ],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        }
      ]
    }
  })

  test('a seeded playlist with videos renders and opens', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await expect(page.getByText('My seeded playlist')).toBeVisible()

    await page.getByText('My seeded playlist').click()
    await expect(page).toHaveURL(/#\/playlist\//)
    await expect(page.getByText('Seeded video one')).toBeVisible()
    // Local playlists intentionally ignore the global hide-upcoming setting.
    await expect(page.getByText('Upcoming seeded premiere')).toBeVisible()
  })

  test('updates a playlist card video count while the list remains open', async ({ page }) => {
    await goTo(page, 'userplaylists')

    const playlistCard = page.locator('.ft-list-video', {
      has: page.getByRole('link', { name: 'My seeded playlist', exact: true })
    })
    const thumbnail = playlistCard.locator('.thumbnailImage:not(.retryImagePlaceholder)')
    const displayedVideoCounts = async () => {
      const counts = await playlistCard.locator('.videoCountContainer').allTextContents()
      return [...new Set(counts)]
    }
    await expect.poll(displayedVideoCounts).toEqual(['2'])
    await expect(thumbnail).toHaveAttribute('src', /ccccccccccc/)

    await dispatchStoreAction(page, 'removeAllVideos', 'e2eseeded')
    await expect.poll(displayedVideoCounts).toEqual(['0'])
    await expect(thumbnail).toHaveAttribute('src', /thumbnail_placeholder/)

    await dispatchStoreAction(page, 'addVideo', {
      _id: 'e2eseeded',
      videoData: {
        videoId: 'fffffffffff',
        title: 'New playlist video',
        playlistItemId: 'e2e-item-4',
        type: 'video'
      }
    })
    await expect.poll(displayedVideoCounts).toEqual(['1'])
    await expect.poll(() => allThumbnailsInclude(playlistCard, 'fffffffffff')).toBe(true)

    await dispatchStoreAction(page, 'removeVideo', {
      _id: 'e2eseeded',
      videoId: 'fffffffffff',
      playlistItemId: 'e2e-item-4'
    })
    await expect.poll(displayedVideoCounts).toEqual(['0'])
    await expect.poll(() => allThumbnailsInclude(playlistCard, 'thumbnail_placeholder')).toBe(true)
  })

  test('asks before preloading a large playlist', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      globalThis.__ytDlpPreloadVideoIds = []
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => {
        globalThis.__ytDlpPreloadVideoIds.push(videoId)
        return { error: 'mock failure' }
      })
    }, IpcChannels.YT_DLP_GET_PLAYBACK_INFO)
    await dispatchStoreAction(page, 'addPlaylist', {
      _id: 'large-preload',
      playlistName: 'Large preload playlist',
      videos: Array.from({ length: 51 }, (_, index) => ({
        videoId: `large${String(index).padStart(6, '0')}`,
        title: `Large playlist video ${index}`,
        author: 'Test Channel',
        authorId: 'UC-test-channel-id',
        lengthSeconds: 120,
        published: Date.now() - 86_400_000,
        timeAdded: Date.now(),
        playlistItemId: `large-item-${index}`,
        type: 'video'
      }))
    })

    await goTo(page, 'userplaylists')
    await page.getByText('Large preload playlist').click()
    await (await openPlaylistMenuItem(page, 'Preload all videos')).click()
    await answerPlaylistPreloadPrompt(page, 'No')

    await expect(await openPlaylistMenuItem(page, 'Preload all videos')).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpPreloadVideoIds)).toEqual([])

    await (await openPlaylistMenuItem(page, 'Preload all videos')).click()
    await answerPlaylistPreloadPrompt(page, 'Yes')
    await expect(page.getByText(
      'Preloaded 0 of 51 videos. 51 could not be preloaded.'
    )).toBeVisible()
    expect(await app.electronApp.evaluate(() => new Set(globalThis.__ytDlpPreloadVideoIds).size)).toBe(51)
  })

  test('preloads every video in a user playlist with yt-dlp', async ({ app, page }) => {
    await dispatchStoreAction(page, 'updateYtDlpPreloadEnabled', true)
    await dispatchStoreAction(page, 'updateYtDlpPreloadCount', 0)
    await dispatchStoreAction(page, 'updateYtDlpPreloadConcurrency', 1)
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      globalThis.__ytDlpPreloadVideoIds = []
      globalThis.__ytDlpPreloadResolvers = []
      const requestCounts = new Map()
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => {
        globalThis.__ytDlpPreloadVideoIds.push(videoId)
        const requestCount = (requestCounts.get(videoId) ?? 0) + 1
        requestCounts.set(videoId, requestCount)
        if (requestCount === 1) {
          return new Promise(resolve => globalThis.__ytDlpPreloadResolvers.push(resolve))
        }
        return { error: 'mock failure' }
      })
    }, IpcChannels.YT_DLP_GET_PLAYBACK_INFO)

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await (await openPlaylistMenuItem(page, 'Preload all videos')).click()

    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc'])

    await expect(page.getByRole('dialog', { name: 'Preload all videos?' })).toHaveCount(0)
    await expect(await openPlaylistMenuItem(page, 'Preloading all videos...')).toBeDisabled()
    await page.keyboard.press('Escape')

    const progressToast = page.getByTestId('progress-toast')
    await expect(progressToast).toContainText('Preloading videos: 0 of 2')
    await expect(progressToast.locator('.progress-indicator')).toHaveAttribute('data-progress', '0')

    await app.electronApp.evaluate(() => globalThis.__ytDlpPreloadResolvers.shift()({ error: 'mock failure' }))
    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc', 'ddddddddddd'])
    await expect(progressToast).toContainText('Preloading videos: 0 of 2')
    await expect(progressToast.locator('.progress-indicator')).toHaveAttribute('data-progress', '0')

    await app.electronApp.evaluate(() => globalThis.__ytDlpPreloadResolvers.shift()({ error: 'mock failure' }))
    await expect(page.getByText(
      'Preloaded 0 of 2 videos. 2 could not be preloaded.'
    )).toBeVisible()
    await expect(progressToast).toHaveCount(0)
    await expect(await openPlaylistMenuItem(page, 'Preload all videos')).toBeEnabled()
  })

  test('recovers full playlist metadata after repeated partial yt-dlp timeouts', async ({ app, page }) => {
    test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

    const executable = path.join(app.userDataDir, 'playlist-timeout-yt-dlp.sh')
    const callsFile = path.join(app.userDataDir, 'playlist-timeout-calls.txt')
    const metadata = height => ({
      title: `Playlist video ${height}p`,
      is_live: false,
      live_status: 'not_live',
      duration: 60,
      manifest_url: `https://example.invalid/${height}.m3u8?expire=4102444800`,
      formats: [{
        protocol: 'm3u8_native',
        url: `https://example.invalid/${height}.m3u8?expire=4102444800`,
        height,
      }],
    })
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      'for arg do videoUrl="$arg"; done',
      'case "$videoUrl" in *ccccccccccc)',
      `count=$(cat '${callsFile}' 2>/dev/null || printf 0)`,
      'count=$((count + 1))',
      `printf '%s' "$count" > '${callsFile}'`,
      'if [ "$count" -le 6 ]; then',
      "printf '%s\\n' 'WARNING: [youtube] Unable to download web client API page: The read operation timed out' >&2",
      `printf '%s\\n' '${JSON.stringify(metadata(360))}'`,
      'exit; fi;; esac',
      `printf '%s\\n' '${JSON.stringify(metadata(1080))}'`,
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.route('https://example.invalid/**', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n',
    }))
    await dispatchStoreAction(page, 'updateYtDlpSource', 'system')
    await dispatchStoreAction(page, 'updateYtDlpPath', executable)
    await dispatchStoreAction(page, 'updateYtDlpPreloadConcurrency', 32)

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await (await openPlaylistMenuItem(page, 'Preload all videos')).click()

    await expect(page.getByText('Preloaded videos: 2.')).toBeVisible()
    await expect(await openPlaylistMenuItem(page, 'All playlist videos are already preloaded')).toBeDisabled()
    expect(Number(await readFile(callsFile, 'utf8'))).toBe(7)
    const entries = JSON.parse(await readFile(path.join(app.userDataDir, 'yt-dlp-playback-cache.json'), 'utf8'))
    expect(entries).toHaveLength(2)
    expect(entries.every(entry => entry.source.manifestSrc.includes('/1080.m3u8'))).toBe(true)
  })

  test('retries timed-out stream format probes before completing a playlist preload', async ({ app, page, attachScreenshot }) => {
    await dispatchStoreAction(page, 'updateYtDlpPreloadConcurrency', 1)
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      globalThis.__ytDlpProbeExtractions = []
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => {
        globalThis.__ytDlpProbeExtractions.push(videoId)
        return {
          isLive: false,
          liveStatus: 'not_live',
          hlsManifestUrl: null,
          duration: 60,
          storyboardVtt: null,
          captions: [],
          captionTranslations: [],
          title: videoId,
          version: 'test',
          incomplete: false,
          formats: [
            { formatId: '18', width: 640, height: 360, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2' },
            { formatId: '137', width: 1920, height: 1080, vcodec: 'avc1.640028', acodec: 'none' },
            { formatId: '140', width: null, height: null, vcodec: 'none', acodec: 'mp4a.40.2' },
          ].map(format => ({
            ...format,
            protocol: 'https',
            ext: 'mp4',
            url: `https://playlist-probe.test/${videoId}/${format.formatId}?expire=4102444800`,
            fps: 30,
            bitrate: 100_000,
            audioSampleRate: 44_100,
            audioChannels: 2,
            language: null,
            dynamicRange: 'SDR',
            availableAt: null,
          })),
        }
      })
    }, IpcChannels.YT_DLP_GET_PLAYBACK_INFO)
    await page.route('https://playlist-probe.test/**', route => route.fulfill({
      contentType: 'video/mp4',
      // Minimal moov and sidx boxes provide the DASH initialization and index ranges.
      body: Buffer.from('000000086d6f6f760000000873696478', 'hex'),
    }))
    await page.evaluate(() => {
      const originalFetch = window.fetch
      let attempts = 0
      window.fetch = (input, options) => {
        if (String(input).includes('playlist-probe.test/ccccccccccc/137?') && ++attempts <= 3) {
          return Promise.reject(new DOMException('signal timed out', 'TimeoutError'))
        }
        return originalFetch(input, options)
      }
    })

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await (await openPlaylistMenuItem(page, 'Preload all videos')).click()

    await expect(page.getByText('Preloaded videos: 2.')).toBeVisible()
    await expect(await openPlaylistMenuItem(page, 'All playlist videos are already preloaded')).toBeDisabled()
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpProbeExtractions)).toEqual([
      'ccccccccccc', 'ccccccccccc', 'ccccccccccc', 'ddddddddddd', 'ccccccccccc',
    ])
    await expect(async () => {
      const entries = JSON.parse(await readFile(path.join(app.userDataDir, 'yt-dlp-playback-cache.json'), 'utf8'))
      expect(entries).toHaveLength(2)
      expect(entries.every(entry => !entry.source.incomplete && decodeURIComponent(entry.source.manifestSrc).includes('height="1080"'))).toBe(true)
    }).toPass({ timeout: 15_000 })
    await attachScreenshot('Playlist preload recovered all formats')
  })

  test('keeps a successfully preloaded playlist disabled', async ({ app, page }) => {
    await routeDemoMedia(page)
    await app.electronApp.evaluate(({ ipcMain }, { channel, mediaUrl }) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => ({
        isLive: false,
        liveStatus: 'not_live',
        hlsManifestUrl: null,
        formats: [{
          formatId: '43',
          url: `${mediaUrl}&expire=4102444800`,
          manifestUrl: null,
          protocol: 'https',
          ext: 'webm',
          container: 'webm',
          vcodec: 'vp9',
          acodec: 'opus',
          width: 640,
          height: 360,
          fps: 15,
          bitrate: 200_000,
          audioSampleRate: 48_000,
          audioChannels: 2,
          language: null,
          formatNote: '360p',
          dynamicRange: 'SDR',
          availableAt: null,
        }],
        duration: 30,
        storyboardVtt: null,
        captions: [],
        captionTranslations: [],
        title: videoId,
        version: 'test',
      }))
    }, {
      channel: IpcChannels.YT_DLP_GET_PLAYBACK_INFO,
      mediaUrl: DEMO_MEDIA_URL,
    })

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await (await openPlaylistMenuItem(page, 'Preload all videos')).click()

    await expect(page.getByText('Preloaded videos: 2.')).toBeVisible()
    await expect(await openPlaylistMenuItem(page, 'All playlist videos are already preloaded')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await expect(await openPlaylistMenuItem(page, 'All playlist videos are already preloaded')).toBeDisabled()
    await page.keyboard.press('Escape')

    await app.electronApp.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel)
    }, IpcChannels.YT_DLP_BINARY_UPDATED)
    await expect(await openPlaylistMenuItem(page, 'Preload all videos')).toBeEnabled()
  })

  test('releases stale preload UI when switching playlists', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      globalThis.__ytDlpPreloadVideoIds = []
      globalThis.__ytDlpPreloadResolvers = []
      const requestCounts = new Map()
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => {
        globalThis.__ytDlpPreloadVideoIds.push(videoId)
        const requestCount = (requestCounts.get(videoId) ?? 0) + 1
        requestCounts.set(videoId, requestCount)
        if (requestCount === 1) {
          return new Promise(resolve => globalThis.__ytDlpPreloadResolvers.push({ videoId, resolve }))
        }
        return { error: 'mock failure' }
      })
    }, IpcChannels.YT_DLP_GET_PLAYBACK_INFO)

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await (await openPlaylistMenuItem(page, 'Preload all videos')).click()

    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc', 'ddddddddddd'])

    await page.locator(sel.searchInput).fill(
      'https://www.youtube.com/playlist?list=secondary&playlistType=user'
    )
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByRole('heading', { name: 'Secondary preload playlist' })).toBeVisible()
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)

    const secondaryPreloadButton = await openPlaylistMenuItem(page, 'Preload all videos')
    await expect(secondaryPreloadButton).toBeEnabled()
    await secondaryPreloadButton.click()
    await expect(page.getByTestId('progress-toast')).toContainText('Preloading videos: 0 of 1')

    await app.electronApp.evaluate(() => {
      for (const entry of globalThis.__ytDlpPreloadResolvers.splice(0)) {
        entry.resolve({ error: 'mock failure' })
      }
    })
    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'])

    await app.electronApp.evaluate(() => {
      for (const entry of globalThis.__ytDlpPreloadResolvers.splice(0)) {
        entry.resolve({ error: 'mock failure' })
      }
    })
    await expect(page.getByText(
      'Preloaded 0 of 1 videos. 1 could not be preloaded.'
    )).toBeVisible()
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)
  })

  test('keeps the playlist title when switching tabs', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await expect(page.locator(sel.activeTab)).toContainText('My seeded playlist')

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    // Wait for the new tab to settle on its landing page before switching back.
    // Clicking while its title is still resolving races the tab bar re-render,
    // and the switch can be lost on a loaded machine.
    await expect(page.locator(sel.activeTab)).toContainText('Subscriptions')
    await expect(page.locator(sel.activeTab)).not.toContainText('My seeded playlist')
    await page.locator(sel.tabs).filter({ hasText: 'My seeded playlist' }).click()

    await expect(page.locator(sel.activeTab)).toContainText('My seeded playlist')
  })

  test('playlist edits and deletion persist across restarts', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()

    await page.getByTitle('Edit Playlist Info').click()
    await page.getByRole('textbox', { name: 'Playlist name' }).fill('Renamed seeded playlist')
    await page.locator('.descriptionInput input').fill('Updated through E2E')
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(page.locator('.playlistTitle')).toHaveText('Renamed seeded playlist')
    await expect(page.locator('.playlistDescription')).toHaveText('Updated through E2E')

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Renamed seeded playlist').click()
    await expect(page.locator('.playlistDescription')).toHaveText('Updated through E2E')

    await (await openPlaylistMenuItem(page, 'Delete Playlist')).click()
    await page.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect(page).toHaveURL(/#\/userplaylists\/?$/)
    await expect(page.locator(sel.activeTab).locator('[data-icon="bookmark"]')).toBeVisible()
    await expect(page.getByText('Renamed seeded playlist')).toHaveCount(0)

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'playlists')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return records.some(record => record._id === 'e2eseeded')
    }).toBe(false)
  })

  test('a custom quick bookmark emoji persists across restarts', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()

    await page.getByTitle('Edit Playlist Info').click()
    expect((await page.getByLabel('Custom emoji').boundingBox()).width).toBeLessThanOrEqual(64)
    await expect(page.locator('.customEmojiPlaceholder')).toHaveCSS('filter', 'grayscale(1)')
    await page.getByLabel('Custom emoji').fill('❤️‍🔥')
    await expect(page.locator('.customEmojiPlaceholder')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save Changes' }).click()

    const quickBookmarkItem = await openPlaylistMenuItem(page, 'Quick Bookmark Enabled')
    await expect(quickBookmarkItem.locator('.ft-custom-icon__emoji')).toHaveText('❤️‍🔥')

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()
    await expect((await openPlaylistMenuItem(page, 'Quick Bookmark Enabled')).locator('.ft-custom-icon__emoji')).toHaveText('❤️‍🔥')
  })
})

test.describe('playlist cleanup', () => {
  const video = (videoId, playlistItemId) => ({
    videoId,
    playlistItemId,
    title: videoId,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    lengthSeconds: 60,
    type: 'video',
    timeAdded: Date.now(),
  })
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        backendFallback: false,
        defaultInvidiousInstance: 'https://playlist-cleanup.test',
      },
      playlists: [{
        _id: 'cleanup',
        playlistName: 'Cleanup test',
        description: '',
        sourcePlaylistId: 'source-playlist',
        quickBookmarkIcon: 'clock',
        protected: false,
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        videos: [
          video('dead0000000', 'dead-1'), video('live0000000', 'live-1'),
          video('dead0000000', 'dead-2'), video('unknown00000', 'unknown-1'),
        ],
      }],
      history: [{
        _id: 'live0000000',
        videoId: 'live0000000',
        title: 'Watched video',
        author: 'Test Channel',
        authorId: 'UC-test-channel-id',
        isWatched: true,
        watchProgress: 60,
        lengthSeconds: 60,
        timeWatched: Date.now(),
        type: 'video',
      }],
    }
  })

  test('removes confirmed unavailable entries, then watched entries, without changing history', async ({ page }) => {
    await page.route('https://playlist-cleanup.test/api/v1/videos/**', route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)
      if (id === 'dead0000000') return route.fulfill({ status: 404, json: { error: 'This video has been removed' } })
      if (id === 'unknown00000') return route.fulfill({ status: 503, json: { error: 'Instance unavailable' } })
      return route.fulfill({ json: { videoId: id } })
    })
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Cleanup test', exact: true }).click()

    await (await openPlaylistMenuItem(page, 'Remove Unavailable Videos')).click()
    const result = page.locator('.toast').filter({ hasText: 'Cleanup test: Remove unavailable videos?' })
    await expect(result).toContainText('Found: 2')
    await expect(result).toContainText('Could not check: 1')
    await result.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect(page.getByText('dead0000000')).toHaveCount(0)
    await expect(page.locator('.toast').filter({ hasText: 'Cleanup test: 2 videos have been removed' })).toBeVisible()

    await (await openPlaylistMenuItem(page, 'Remove Watched Videos')).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('remove 1 watched video')
    await dialog.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect(page.getByText('live0000000')).toHaveCount(0)
    const state = await page.evaluate(() => {
      const store = window.$store
      return {
        ids: store.getters.getPlaylist('cleanup').videos.map(video => video.videoId),
        watched: store.getters.getHistoryCacheById.live0000000?.isWatched,
        sourcePlaylistId: store.getters.getPlaylist('cleanup').sourcePlaylistId,
        quickBookmarkIcon: store.getters.getPlaylist('cleanup').quickBookmarkIcon,
      }
    })
    expect(state).toEqual({
      ids: ['unknown00000'],
      watched: true,
      sourcePlaylistId: 'source-playlist',
      quickBookmarkIcon: 'clock',
    })
  })

  test('checks private videos with the Local API and keeps videos whose check fails', async ({ page }) => {
    await page.route('**/youtubei/v1/player*', route => {
      const id = JSON.parse(route.request().postData()).videoId
      if (id === 'dead0000000') return route.fulfill({ json: { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Private video' } } })
      if (id === 'unknown00000') return route.fulfill({ status: 503, body: 'Service unavailable' })
      return route.fulfill({ json: { videoDetails: { videoId: id }, playabilityStatus: { status: 'OK' } } })
    })
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Cleanup test', exact: true }).click()
    await dispatchStoreAction(page, 'updateBackendPreference', 'local')

    await (await openPlaylistMenuItem(page, 'Remove Unavailable Videos')).click()
    const result = page.locator('.toast').filter({ hasText: 'Cleanup test: Remove unavailable videos?' })
    await expect(result).toContainText('Found: 2')
    await expect(result).toContainText('Could not check: 1')
    await result.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylist('cleanup').videos.map(video => video.videoId)))
      .toEqual(['live0000000', 'unknown00000'])
  })

  test('keeps checking for unavailable videos after leaving the playlist', async ({ page }) => {
    let release
    const held = new Promise(resolve => { release = resolve })
    await page.route('https://playlist-cleanup.test/api/v1/videos/**', async route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)
      if (id === 'dead0000000') {
        await held
        return route.fulfill({ status: 404, json: { error: 'This video has been removed' } })
      }
      return route.fulfill({ json: { videoId: id } })
    })
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Cleanup test', exact: true }).click()

    await (await openPlaylistMenuItem(page, 'Remove Unavailable Videos')).click()
    await expect(page.locator('.playlistOptions').filter({ visible: true }).getByRole('button', { name: 'Cancel (2/3)' })).toBeVisible()
    const progressToast = page.getByTestId('progress-toast')
    await expect(progressToast).toContainText('Checking Cleanup test for unavailable videos (2/3)')

    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Cleanup test', exact: true }).click()
    // Returning to the playlist shows the running check instead of starting another one
    await expect(page.locator('.playlistOptions').filter({ visible: true }).getByRole('button', { name: 'Cancel (2/3)' })).toBeVisible()
    await goTo(page, 'userplaylists')
    release()

    const result = page.locator('.toast').filter({ hasText: 'Cleanup test: Remove unavailable videos?' })
    await expect(result).toContainText('Found: 2')
    await expect(result).toContainText('Could not check: 0')
    await expect(progressToast).toHaveCount(0)
    await result.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylist('cleanup').videos.map(video => video.videoId)))
      .toEqual(['live0000000', 'unknown00000'])
  })

  test('cancels the unavailable video check from the playlist', async ({ page }) => {
    await page.route('https://playlist-cleanup.test/api/v1/videos/**', () => {})
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Cleanup test', exact: true }).click()

    await (await openPlaylistMenuItem(page, 'Remove Unavailable Videos')).click()
    const cancel = page.locator('.playlistOptions').filter({ visible: true }).getByRole('button', { name: 'Cancel (0/3)' })
    await cancel.click()
    await expect(cancel).toHaveCount(0)
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)
    await expect(await openPlaylistMenuItem(page, 'Remove Unavailable Videos')).toBeEnabled()
  })

  test('keeps adding missing videos after leaving the playlist', async ({ page }) => {
    let release
    const held = new Promise(resolve => { release = resolve })
    await page.route(/https:\/\/playlist-cleanup\.test\/api\/v1\/playlists\/source-playlist\?/, async route => {
      await held
      return route.fulfill({
        json: {
          title: 'Source playlist',
          description: '',
          playlistId: 'source-playlist',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          authorThumbnails: [],
          videoCount: 2,
          viewCount: 1,
          updated: 1_700_000_000,
          videos: ['live0000000', 'new00000000'].map((videoId, index) => ({
            type: 'video', title: videoId, videoId, author: 'Test Channel', authorId: 'UC-test-channel-id', authorUrl: '/channel/UC-test-channel-id', videoThumbnails: [], index, lengthSeconds: 60,
          })),
        },
      })
    })
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Cleanup test', exact: true }).click()

    await (await openPlaylistMenuItem(page, 'Add missing videos from source playlist')).click()
    await expect(page.locator('.playlistOptions').filter({ visible: true }).getByRole('button', { name: 'More', exact: true }))
      .toHaveAttribute('aria-busy', 'true')
    await expect(await openPlaylistMenuItem(page, 'Add missing videos from source playlist')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('progress-toast')).toContainText('Adding missing videos to Cleanup test')

    await goTo(page, 'userplaylists')
    release()
    await expect(page.locator('.toast').filter({ hasText: 'Cleanup test: Playlist has been updated.' })).toBeVisible()
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)
    expect(await page.evaluate(() => window.$store.getters.getPlaylist('cleanup').videos.map(video => video.videoId)))
      .toEqual(['dead0000000', 'live0000000', 'dead0000000', 'unknown00000', 'new00000000'])
  })
})

test.describe('saved playlist metadata', () => {
  test.use({
    seed: {
      settings: {
        playlistBookmarks: [{
          playlist: {
            id: 'saved-playlist',
            title: 'Saved playlist',
            description: '',
            thumbnail_url: 'https://i.ytimg.com/vi/ggggggggggg/mqdefault.jpg',
            video_count: 4
          },
          uploader: {
            id: 'UC-saved-playlist',
            name: 'Saved channel',
            avatar: null,
            verified: false
          },
          savedAt: 1
        }]
      }
    }
  })

  test('updates saved playlist card metadata while the list remains open', async ({ page }) => {
    await goTo(page, 'userplaylists')

    const playlistCard = page.locator('.ft-list-video', {
      has: page.locator('a.title[href*="/playlist/saved-playlist"]')
    })
    await expect(playlistCard.locator('.h3Title')).toHaveText('Saved playlist')
    await expect(playlistCard.locator('.channelNameText')).toHaveText('Saved channel')
    await expect(playlistCard.locator('.thumbnailImage:not(.retryImagePlaceholder)')).toHaveAttribute('src', /ggggggggggg/)
    await expect(playlistCard.locator('.videoCountContainer')).toHaveText('4')

    await dispatchStoreAction(page, 'savePlaylistBookmark', {
      playlist: {
        id: 'saved-playlist',
        title: 'Saved playlist updated',
        description: 'Updated metadata',
        thumbnail_url: 'https://i.ytimg.com/vi/hhhhhhhhhhh/mqdefault.jpg',
        video_count: 5
      },
      uploader: {
        id: 'UC-updated-saved-playlist',
        name: 'Updated saved channel',
        avatar: null,
        verified: false
      },
      savedAt: 1
    })

    await expect(playlistCard.locator('.h3Title')).toHaveText('Saved playlist updated')
    await expect(playlistCard.locator('.channelNameText')).toHaveText('Updated saved channel')
    await expect(playlistCard.locator('.thumbnailImage:not(.retryImagePlaceholder)')).toHaveAttribute('src', /hhhhhhhhhhh/)
    await expect(playlistCard.locator('.videoCountContainer')).toHaveText('5')
    await expect(playlistCard.locator('.channelName')).toHaveAttribute('href', '#/channel/UC-updated-saved-playlist')
  })
})

test.describe('playlist view type', () => {
  test.use({
    seed: {
      settings: {
        listType: 'list'
      },
      playlists: [{
        _id: 'playlist-view-type',
        playlistName: 'Playlist view type',
        protected: false,
        description: '',
        videos: [{
          videoId: 'eeeeeeeeeee',
          title: 'Playlist view video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          lengthSeconds: 120,
          published: Date.now() - 86_400_000,
          timeAdded: Date.now(),
          playlistItemId: 'playlist-view-item',
          type: 'video'
        }],
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now()
      }]
    }
  })

  test('defaults to grid independently and persists list view', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Playlist view type').click()
    await expect(page.locator('.playlistPage')).toHaveClass(/grid/)

    const appearance = await goToSettingsSection(page, 'appearance')
    const playlistViewSetting = appearance.locator('.select').filter({
      has: page.getByRole('combobox', { name: 'Playlist View Type' })
    })
    const playlistViewSelect = playlistViewSetting.locator('select')
    await expect(playlistViewSelect).toHaveValue('grid')
    await chooseSelectOption(playlistViewSelect, 'list')
    await page.locator('.settingsCloseButton').click()

    await expect(page.locator('.playlistPage')).toHaveClass(/list/)
    await expect(page.locator('.playlistItems')).toBeVisible()

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Playlist view type').click()
    await expect(page.locator('.playlistPage')).toHaveClass(/list/)
  })
})

test.describe('custom playlists overview order', () => {
  const seededPlaylist = (name, ageDays) => ({
    _id: `custom-overview-${name.toLowerCase()}`,
    playlistName: `Overview ${name}`,
    protected: false,
    description: '',
    videos: [],
    createdAt: Date.now() - ageDays * 86_400_000,
    lastUpdatedAt: Date.now()
  })

  test.use({
    seed: {
      settings: { userPlaylistsSortBy: 'custom' },
      playlists: [seededPlaylist('A', 3), seededPlaylist('B', 2), seededPlaylist('C', 1)]
    }
  })

  for (const layout of ['list']) {
    test(`reorders ${layout} playlists by keyboard and drag and drop @scale`, async ({ app, page }) => {
      await dispatchStoreAction(page, 'updateListType', layout)
      await goTo(page, 'userplaylists')

      const titles = page.locator('.playlistList [data-playlist-drag-item] .h3Title')
      const handleOf = name => page.locator('.playlistList [data-playlist-drag-item]')
        .filter({ hasText: `Overview ${name}` })
        .getByRole('button', { name: 'Drag or use the arrow keys to reorder' })
      // Playlists without a saved position start newest first.
      await expect(titles).toHaveText(['Overview C', 'Overview B', 'Overview A'])

      await handleOf('C').focus()
      await page.keyboard.press('ArrowDown')
      await expect(titles).toHaveText(['Overview B', 'Overview C', 'Overview A'])
      await expect(handleOf('C')).toBeFocused()
      await page.keyboard.press('End')
      await expect(titles).toHaveText(['Overview B', 'Overview A', 'Overview C'])
      await expect(handleOf('C')).toBeFocused()
      await page.keyboard.press('Home')
      await expect(titles).toHaveText(['Overview C', 'Overview B', 'Overview A'])
      await page.keyboard.press('ArrowUp')
      await expect(titles).toHaveText(['Overview C', 'Overview B', 'Overview A'])
      // Repeated keys build on the unsaved order instead of repeating the first move.
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await expect(titles).toHaveText(['Overview B', 'Overview A', 'Overview C'])
      await expect.poll(() => page.evaluate(() => window.$store.getters.getUserPlaylistsCustomOrder))
        .toEqual(['custom-overview-b', 'custom-overview-a', 'custom-overview-c'])
      await page.keyboard.press('Home')
      await expect(titles).toHaveText(['Overview C', 'Overview B', 'Overview A'])

      // DOM order updates before the cards finish gliding to their new positions.
      await expect.poll(() => page.locator('.playlistList').evaluate(list =>
        list.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).length
      )).toBe(0)
      await handleOf('A').dragTo(handleOf('C'))
      await expect(titles).toHaveText(['Overview A', 'Overview C', 'Overview B'])
      await expect.poll(() => page.evaluate(() => window.$store.getters.getUserPlaylistsCustomOrder))
        .toEqual(['custom-overview-a', 'custom-overview-c', 'custom-overview-b'])

      // Reordering is unavailable while the list is filtered.
      await page.locator('.playlistSearch input').fill('Overview')
      await expect(page.locator('.playlistList .grabBar')).toHaveCount(0)
      await page.locator('.playlistSearch input').fill('')
      await expect(page.locator('.playlistList .grabBar')).toHaveCount(3)

      ;({ page } = await app.relaunch())
      await goTo(page, 'userplaylists')
      await expect(page.locator('.playlistList [data-playlist-drag-item] .h3Title'))
        .toHaveText(['Overview A', 'Overview C', 'Overview B'])
    })
  }

  test('slides playlist cards aside while dragging and lets Escape cancel the drag', { tag: '@scale' }, async ({ page }) => {
    await goTo(page, 'userplaylists')
    const cards = page.locator('.playlistList [data-playlist-drag-item]')
    const titles = cards.locator('.h3Title')
    const card = name => cards.filter({ hasText: `Overview ${name}` })
    const order = () => page.evaluate(() => window.$store.getters.getUserPlaylistsCustomOrder)
    await expect(titles).toHaveText(['Overview C', 'Overview B', 'Overview A'])
    const savedOrder = await order()
    const slots = await cards.evaluateAll(elements => elements.map(element => {
      const { x, y } = element.getBoundingClientRect()
      return { x, y }
    }))
    const handle = await card('C').locator('.grabBar').boundingBox()
    const target = await card('A').boundingBox()
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    const end = { x: start.x + target.x - slots[0].x, y: start.y + target.y - slots[0].y }
    const position = name => card(name).evaluate(element => {
      const { x, y } = element.getBoundingClientRect()
      return { x, y }
    })

    async function dragCToA() {
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      // A click on the handle does not start a drag.
      await page.mouse.move(start.x + 2, start.y)
      await expect(page.locator('.reorderDragged')).toHaveCount(0)
      await page.mouse.move(end.x, end.y, { steps: 12 })
      await expect(page.locator('.reorderDragged')).toHaveText(/Overview C/)
      // The cards keep their DOM order and slide into the proposed one.
      await expect(titles).toHaveText(['Overview C', 'Overview B', 'Overview A'])
      await expect.poll(() => position('B')).toEqual(expect.objectContaining({ x: expect.closeTo(slots[0].x, 0), y: expect.closeTo(slots[0].y, 0) }))
      await expect.poll(() => position('A')).toEqual(expect.objectContaining({ x: expect.closeTo(slots[1].x, 0), y: expect.closeTo(slots[1].y, 0) }))
      // The dragged card stays visible under the pointer.
      await expect(card('C')).toHaveCSS('opacity', '1')
      const dragged = await position('C')
      expect(dragged.x).toBeCloseTo(slots[2].x, 0)
    }

    await dragCToA()
    await page.keyboard.press('Escape')
    await expect(page.locator('.reorderDragged, .reorderActive')).toHaveCount(0)
    for (const [index, name] of ['C', 'B', 'A'].entries()) {
      await expect.poll(() => position(name)).toEqual({ x: expect.closeTo(slots[index].x, 0), y: expect.closeTo(slots[index].y, 0) })
    }
    await page.mouse.up()
    await expect(titles).toHaveText(['Overview C', 'Overview B', 'Overview A'])
    expect(await order()).toEqual(savedOrder)

    await dragCToA()
    await page.mouse.up()
    await expect(titles).toHaveText(['Overview B', 'Overview A', 'Overview C'])
    await expect(page.locator('.reorderDragged, .reorderActive')).toHaveCount(0)
    // The dropped card rests in its slot once the order is committed.
    for (const [index, name] of ['B', 'A', 'C'].entries()) {
      await expect.poll(() => position(name)).toEqual({ x: expect.closeTo(slots[index].x, 0), y: expect.closeTo(slots[index].y, 0) })
    }
    await expect(cards.first()).not.toHaveAttribute('style', /translate/)
    await expect.poll(order).toEqual(['custom-overview-b', 'custom-overview-a', 'custom-overview-c'])
  })

  test('reorders playlist cards by touch without opening the card actions', async ({ page }) => {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await goTo(page, 'userplaylists')
    const cards = page.locator('.playlistList [data-playlist-drag-item]')
    await expect(cards.locator('.h3Title')).toHaveText(['Overview C', 'Overview B', 'Overview A'])
    const handle = await cards.filter({ hasText: 'Overview A' }).locator('.grabBar').boundingBox()
    const target = await cards.first().locator('.grabBar').boundingBox()
    const touch = (type, x, y) => session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: x == null ? [] : [{ x, y, id: 0 }]
    })

    await touch('touchStart', handle.x + handle.width / 2, handle.y + handle.height / 2)
    // Outlast the long-press delay to prove the handle does not open the card actions.
    await page.waitForTimeout(600)
    await expect(page.locator('.mobileLinkActionsBackdrop')).toHaveCount(0)
    await touch('touchMove', (handle.x + target.x) / 2, target.y + target.height / 2)
    await touch('touchMove', target.x + target.width / 2, target.y + target.height / 2)
    await expect(page.locator('.reorderDragged')).toHaveText(/Overview A/)
    await touch('touchEnd')
    await expect(cards.locator('.h3Title')).toHaveText(['Overview A', 'Overview C', 'Overview B'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getUserPlaylistsCustomOrder))
      .toEqual(['custom-overview-a', 'custom-overview-c', 'custom-overview-b'])
    await expect(page.locator('.mobileLinkActionsBackdrop')).toHaveCount(0)
  })

  test('pins playlists to the side navigation in the overview order', async ({ app, page }) => {
    const pinned = page.locator('.sideNav .pinnedPlaylists .navChannel')
    const pinnedTitles = () => pinned.evaluateAll(links => links.map(link => link.title))
    async function togglePin(name, action) {
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: `Overview ${name}` }).first().click()
      await (await openPlaylistMenuItem(page, action)).click()
      await expect(await openPlaylistMenuItem(page, action === 'Pin to Navigation' ? 'Unpin from Navigation' : 'Pin to Navigation')).toBeVisible()
      await page.keyboard.press('Escape')
    }

    await expect(pinned).toHaveCount(0)
    await togglePin('A', 'Pin to Navigation')
    await togglePin('B', 'Pin to Navigation')
    // Playlists without a saved position start newest first.
    await expect.poll(pinnedTitles).toEqual(['Overview B', 'Overview A'])

    await goTo(page, 'userplaylists')
    await page.locator('.playlistList [data-playlist-drag-item]')
      .filter({ hasText: 'Overview A' })
      .getByRole('button', { name: 'Drag or use the arrow keys to reorder' })
      .focus()
    await page.keyboard.press('Home')
    await expect.poll(pinnedTitles).toEqual(['Overview A', 'Overview B'])

    await goTo(page, 'history')
    await page.locator('.sideNav .pinnedPlaylists .navChannel[title="Overview B"]').click()
    await expect(page).toHaveURL(/#\/playlist\/custom-overview-b\?playlistType=user/)
    await expect(page.locator('.playlistInfo')).toContainText('Overview B')

    await togglePin('A', 'Unpin from Navigation')
    await expect.poll(pinnedTitles).toEqual(['Overview B'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getPinnedPlaylistIds))
      .toEqual(['custom-overview-b'])

    ;({ page } = await app.relaunch())
    await expect.poll(() => page.locator('.sideNav .pinnedPlaylists .navChannel').evaluateAll(links => links.map(link => link.title)))
      .toEqual(['Overview B'])

    // Quick successive pins build on each other before the first save finishes.
    expect(await page.evaluate(async () => {
      const store = window.$store
      const pin = id => store.dispatch('updatePinnedPlaylistIds', [...store.getters.getPinnedPlaylistIds, id])
      await Promise.all([pin('custom-overview-c'), pin('custom-overview-a')])
      return store.getters.getPinnedPlaylistIds
    })).toEqual(['custom-overview-b', 'custom-overview-c', 'custom-overview-a'])

    // Deleting a pinned playlist also removes it from the synced setting.
    await dispatchStoreAction(page, 'removePlaylist', 'custom-overview-b')
    await expect.poll(() => page.evaluate(() => window.$store.getters.getPinnedPlaylistIds))
      .toEqual(['custom-overview-c', 'custom-overview-a'])
    await expect(page.locator('.sideNav .pinnedPlaylists .navChannel[title="Overview B"]')).toHaveCount(0)
  })
})

test.describe('playlists pinned to the top', () => {
  const seededPlaylist = (name, updatedDaysAgo) => ({
    _id: `top-pin-${name.toLowerCase()}`,
    playlistName: `Top pin ${name}`,
    protected: false,
    description: '',
    videos: [],
    createdAt: Date.now() - (10 + updatedDaysAgo) * 86_400_000,
    lastUpdatedAt: Date.now() - updatedDaysAgo * 86_400_000
  })

  test.use({
    seed: {
      settings: { userPlaylistsSortBy: 'latest_updated_first' },
      playlists: [seededPlaylist('A', 3), seededPlaylist('B', 2), seededPlaylist('C', 1)]
    }
  })

  test('keeps pinned playlists above the sorted ones', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    let titles = page.locator('.playlistList .h3Title')
    let menu = page.getByRole('menu', { name: 'Context menu', exact: true })
    async function choose(name, action) {
      await page.locator('.playlistList .title').filter({ hasText: `Top pin ${name}` }).click({ button: 'right' })
      await menu.getByRole('menuitem', { name: action, exact: true }).click()
      await expect(menu).toBeHidden()
    }

    await expect(titles).toHaveText(['Top pin C', 'Top pin B', 'Top pin A'])
    await choose('A', 'Pin to Top')
    await expect(titles).toHaveText(['Top pin A', 'Top pin C', 'Top pin B'])
    await expect(titles.first().getByRole('img', { name: 'Pinned to Top' })).toBeVisible()
    // Pinned playlists follow the chosen sort among themselves.
    await choose('B', 'Pin to Top')
    await expect(titles).toHaveText(['Top pin B', 'Top pin A', 'Top pin C'])

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    titles = page.locator('.playlistList .h3Title')
    menu = page.getByRole('menu', { name: 'Context menu', exact: true })
    await expect(titles).toHaveText(['Top pin B', 'Top pin A', 'Top pin C'])

    // Custom order moves stay within the pinned or unpinned group.
    await dispatchStoreAction(page, 'updateUserPlaylistsSortBy', 'custom')
    const savedOrder = () => page.evaluate(() => window.$store.getters.getUserPlaylistsCustomOrder)
    const handleOf = name => page.locator('.playlistList [data-playlist-drag-item]')
      .filter({ hasText: `Top pin ${name}` })
      .getByRole('button', { name: 'Drag or use the arrow keys to reorder' })
    await expect(titles).toHaveText(['Top pin B', 'Top pin A', 'Top pin C'])
    await handleOf('A').focus()
    await page.keyboard.press('Home')
    await expect.poll(savedOrder).toEqual(['top-pin-a', 'top-pin-b', 'top-pin-c'])
    await choose('B', 'Unpin from Top')
    await handleOf('C').focus()
    await page.keyboard.press('Home')
    await expect(titles).toHaveText(['Top pin A', 'Top pin C', 'Top pin B'])
    await expect.poll(savedOrder).toEqual(['top-pin-a', 'top-pin-c', 'top-pin-b'])

    // Deleting a pinned playlist also removes it from the synced setting.
    await dispatchStoreAction(page, 'removePlaylist', 'top-pin-a')
    await expect.poll(() => page.evaluate(() => window.$store.getters.getUserPlaylistsPinnedIds)).toEqual([])
  })
})

test.describe('long custom playlists overview', () => {
  test.use({
    seed: {
      settings: { userPlaylistsSortBy: 'custom', listType: 'list' },
      playlists: Array.from({ length: 30 }, (_, index) => ({
        _id: `long-overview-${index}`,
        playlistName: `Long overview ${index}`,
        protected: false,
        description: '',
        videos: [],
        createdAt: Date.now() - index * 86_400_000,
        lastUpdatedAt: Date.now()
      }))
    }
  })

  test('scrolls while a dragged playlist card nears the window edge', { tag: '@scale' }, async ({ page }) => {
    await goTo(page, 'userplaylists')
    const titles = page.locator('.playlistList [data-playlist-drag-item] .h3Title')
    await expect(titles.first()).toHaveText('Long overview 0')
    const handle = await page.locator('.playlistList .grabBar').first().boundingBox()
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, viewportHeight - 4, { steps: 8 })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600)
    await page.mouse.move(handle.x + handle.width / 2, viewportHeight / 2, { steps: 4 })
    const stoppedScroll = await page.evaluate(() => window.scrollY)
    await page.mouse.up()
    await expect(page.locator('.reorderDragged')).toHaveCount(0)
    // The card lands where it was dropped, below the rows scrolled past.
    const index = (await titles.allTextContents()).indexOf('Long overview 0')
    expect(index).toBeGreaterThan(2)
    await expect.poll(() => page.evaluate(() => window.$store.getters.getUserPlaylistsCustomOrder?.indexOf('long-overview-0'))).toBe(index)
    const dropped = await page.locator('.playlistList [data-playlist-drag-item]').nth(index).boundingBox()
    expect(Math.abs(dropped.y + dropped.height / 2 - viewportHeight / 2)).toBeLessThan(dropped.height)
    expect(await page.evaluate(() => window.scrollY)).toBe(stoppedScroll)
  })
})

test.describe('switching between pinned playlists', () => {
  const pinnedPlaylist = (name, titles) => ({
    _id: `pinned-${name.toLowerCase()}`,
    playlistName: `Pinned ${name}`,
    protected: false,
    description: '',
    videos: titles.map((title, index) => ({
      videoId: `pinned${name}${index}`.padEnd(11, '0'),
      title,
      author: 'Test Channel',
      authorId: 'UC-test-channel-id',
      lengthSeconds: 120,
      timeAdded: Date.now() - index,
      playlistItemId: `pinned-${name}-${index}`,
      type: 'video'
    })),
    createdAt: Date.now(),
    lastUpdatedAt: Date.now()
  })

  test.use({
    seed: {
      settings: { pinnedPlaylistIds: ['pinned-a', 'pinned-b'] },
      playlists: [pinnedPlaylist('A', ['Linux news', 'Cooking show']), pinnedPlaylist('B', ['Garden tour', 'Bike repair'])]
    }
  })

  test('a search typed on one playlist does not filter the next one', async ({ page }) => {
    await page.locator('.sideNav .pinnedPlaylists .navChannel[title="Pinned A"]').click()
    const search = page.locator('.playlistInfo').getByRole('searchbox', { name: 'Search for Videos' })
    await search.fill('linux')
    await expect(page).toHaveURL(/searchQueryText=linux/)
    await expect(page.getByText('Cooking show')).toHaveCount(0)

    await page.locator('.sideNav .pinnedPlaylists .navChannel[title="Pinned B"]').click()
    await expect(page.locator('.playlistInfo')).toContainText('Pinned B')
    await expect(search).toHaveValue('')
    await expect(page.getByText('Garden tour')).toBeVisible()
    await expect(page.getByText('Bike repair')).toBeVisible()
  })
})

test.describe('custom playlist order with hidden videos', () => {
  const video = (index, extra = {}) => ({
    videoId: `hiddenorder${index}`,
    title: `Hidden order video ${index}`,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    lengthSeconds: 120,
    published: Date.now() - 86_400_000,
    timeAdded: Date.now() - index,
    playlistItemId: `hidden-order-item-${index}`,
    type: 'video',
    ...extra
  })

  test.use({
    seed: {
      settings: { userPlaylistSortOrder: 'custom', playlistViewType: 'grid', hideLiveStreams: true },
      playlists: [{
        _id: 'hidden-order-playlist',
        playlistName: 'Hidden order playlist',
        protected: false,
        description: '',
        videos: [video(1), video(2, { isUpcoming: true }), video(3), video(4)],
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now()
      }]
    }
  })

  test('drops a grid video next to the video shown before it', { tag: '@scale' }, async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Hidden order playlist').click()
    const cards = page.locator('.playlistItemsCard [data-playlist-drag-item]')
    // The upcoming video is hidden, so the grid shows videos 1, 3 and 4.
    await expect(cards.locator('.h3Title')).toHaveText(['Hidden order video 1', 'Hidden order video 3', 'Hidden order video 4'])
    const handle = await cards.first().locator('.grabBar').boundingBox()
    const first = await cards.first().boundingBox()
    const last = await cards.last().boundingBox()
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + last.x - first.x, start.y + last.y - first.y, { steps: 8 })
    await page.mouse.up()
    await expect(cards.locator('.h3Title')).toHaveText(['Hidden order video 3', 'Hidden order video 4', 'Hidden order video 1'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylist('hidden-order-playlist').videos.map(video => video.videoId)))
      .toEqual(['hiddenorder2', 'hiddenorder3', 'hiddenorder4', 'hiddenorder1'])
  })
})

test.describe('custom playlist order', () => {
  test.use({
    seed: {
      settings: {
        listType: 'grid',
        userPlaylistSortOrder: 'custom'
      },
      playlists: [
        {
          _id: 'large-custom-playlist',
          playlistName: 'Large custom playlist',
          protected: false,
          description: '',
          videos: Array.from({ length: 101 }, (_, index) => ({
            videoId: String(index).padStart(11, '0'),
            title: `Custom playlist video ${index + 1}`,
            author: 'Test Channel',
            authorId: 'UC-test-channel-id',
            lengthSeconds: 120,
            published: Date.now() - 86_400_000,
            timeAdded: Date.now() - index,
            playlistItemId: `custom-playlist-item-${index}`,
            type: 'video'
          })),
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        }
      ]
    }
  })

  for (const layout of ['list']) {
    test(`touch reorders ${layout} playlists without hiding the row`, { tag: '@scale' }, async ({ page, uiScale }) => {
      await page.setViewportSize({ width: layout === 'grid' ? 900 : 430, height: 1000 })
      await dispatchStoreAction(page, 'updatePlaylistViewType', layout)
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await goTo(page, 'userplaylists')
      await page.getByText('Large custom playlist').click()

      const rows = page.locator('.playlistItemsCard [data-playlist-drag-item]')
      const grip = rows.first().locator('.grabBar')
      await expect(grip).toBeVisible()
      const from = await grip.boundingBox()
      const first = await rows.first().boundingBox()
      const to = await rows.nth(1).boundingBox()
      const touch = (type, x, y) => session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x == null ? [] : [{ x, y, id: 0 }]
      })
      const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      await touch('touchStart', start.x, start.y)
      // Outlast the long-press delay to prove the drag does not open the link actions sheet.
      await page.waitForTimeout(600)
      await expect(page.locator('.mobileLinkActionsBackdrop')).toHaveCount(0)
      await touch('touchMove', start.x + (to.x - first.x) / 2, start.y + (to.y - first.y) / 2)
      await touch('touchMove', start.x + to.x - first.x, start.y + to.y - first.y)
      await expect(rows.first()).toHaveClass(/reorderDragged/)
      await expect(rows.first()).toHaveCSS('opacity', '1')
      // The rows keep their DOM order and slide aside until the drop.
      await expect(rows.first().locator('.h3Title')).toHaveText('Custom playlist video 1')
      await expect.poll(async () => (await rows.nth(1).boundingBox()).y).toBeCloseTo(first.y, 0)
      await touch('touchEnd')
      await expect(page.locator('.reorderDragged, .reorderActive')).toHaveCount(0)
      await expect(rows.first().locator('.h3Title')).toHaveText('Custom playlist video 2')
      await expect.poll(() => page.evaluate(() => {
        return window.$store
          .getters.getPlaylist('large-custom-playlist').videos[0].title
      })).toBe('Custom playlist video 2')

      // Cancelling a subsequent gesture releases capture and leaves reordering usable.
      const next = await rows.first().locator('.grabBar').boundingBox()
      await touch('touchStart', next.x + next.width / 2, next.y + next.height / 2)
      await touch('touchMove', next.x + next.width / 2, next.y + next.height / 2 + 40)
      await expect(page.locator('.reorderDragged')).toHaveCount(1)
      await touch('touchCancel')
      await expect(page.locator('.reorderDragged, .reorderActive')).toHaveCount(0)
      await expect(rows.first().locator('.h3Title')).toHaveText('Custom playlist video 2')
      await goTo(page, 'userplaylists')
      await page.getByText('Large custom playlist').click()
      await expect(rows.first().locator('.h3Title')).toHaveText('Custom playlist video 2')
      if (layout === 'list' && uiScale === 100) {
        const handle = await rows.first().locator('.grabBar').boundingBox()
        const initialScroll = await page.evaluate(() => window.scrollY)
        await touch('touchStart', handle.x + handle.width / 2, handle.y + handle.height / 2)
        await touch('touchMove', handle.x + handle.width / 2, 990)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScroll + 100)
        // The dragged row stays under the finger while the page scrolls.
        await expect.poll(async () => (await page.locator('.reorderDragged').boundingBox()).y).toBeGreaterThan(990 - first.height - 1)
        await touch('touchCancel')
        await expect(page.locator('.reorderDragged, .reorderActive')).toHaveCount(0)
        const stoppedScroll = await page.evaluate(() => window.scrollY)
        await page.waitForTimeout(150)
        expect(await page.evaluate(() => window.scrollY)).toBe(stoppedScroll)
      }
    })
  }

  for (const layout of ['grid']) {
    test(`keyboard reorders ${layout} playlists and keeps the handle focused`, async ({ page }) => {
      await dispatchStoreAction(page, 'updatePlaylistViewType', layout)
      await goTo(page, 'userplaylists')
      await page.getByText('Large custom playlist').click()

      const titles = page.locator('.playlistItemsCard [data-playlist-drag-item] .h3Title')
      const handle = page.getByRole('button', { name: 'Drag or use the arrow keys to reorder' }).first()
      const storedTitle = index => page.evaluate(index => {
        return window.$store.getters.getPlaylist('large-custom-playlist').videos.at(index).title
      }, index)
      await handle.focus()

      await page.keyboard.press('ArrowDown')
      await expect(titles.first()).toHaveText('Custom playlist video 2')
      await expect.poll(() => storedTitle(1)).toBe('Custom playlist video 1')
      await expect(page.locator(':focus')).toHaveAccessibleName('Drag or use the arrow keys to reorder')
      await expect(page.locator('[data-playlist-drag-item]:focus-within .h3Title')).toHaveText('Custom playlist video 1')

      await page.keyboard.press('ArrowUp')
      await expect(titles.first()).toHaveText('Custom playlist video 1')
      await expect(page.locator('[data-playlist-drag-item]:focus-within .h3Title')).toHaveText('Custom playlist video 1')

      await page.locator('.playlistItemsCard [data-playlist-drag-item]')
        .filter({ has: page.getByText('Custom playlist video 3', { exact: true }) })
        .getByRole('button', { name: 'Drag or use the arrow keys to reorder' })
        .focus()
      await page.keyboard.press('Home')
      await expect(titles.first()).toHaveText('Custom playlist video 3')
      await expect(page.locator('[data-playlist-drag-item]:focus-within .h3Title')).toHaveText('Custom playlist video 3')

      // The bottom is beyond the first page, so only the saved order is observable.
      await page.keyboard.press('End')
      await expect.poll(() => storedTitle(-1)).toBe('Custom playlist video 3')
    })
  }

  test('a drag keeps a video added to the playlist during the drag', async ({ app, page }) => {
    await dispatchStoreAction(page, 'updatePlaylistViewType', 'list')
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()
    const titles = page.locator('.playlistItemsCard [data-playlist-drag-item] .h3Title')
    await expect(titles.first()).toHaveText('Custom playlist video 1')

    const rows = page.locator('.playlistItemsCard [data-playlist-drag-item]')
    const handle = await rows.first().locator('.videoIndexArea').boundingBox()
    const first = await rows.first().boundingBox()
    const second = await rows.nth(1).boundingBox()
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y + second.y - first.y, { steps: 6 })
    await expect(page.locator('.reorderDragged')).toHaveCount(1)
    // Another window adds a video while the drag is still in progress
    await page.evaluate(() => window.$store.dispatch('addVideo', {
      _id: 'large-custom-playlist',
      videoData: { videoId: 'addedduring', title: 'Added during the drag', author: 'Test Channel', authorId: 'UC-test-channel-id', lengthSeconds: 60 }
    }))
    await expect(page.locator('.reorderDragged')).toHaveCount(1)
    await page.mouse.up()

    await expect(titles.first()).toHaveText('Custom playlist video 2')
    const expected = ['Custom playlist video 2', 'Custom playlist video 1', 'Custom playlist video 3']
    await expect.poll(() => page.evaluate(() => {
      const { videos } = window.$store.getters.getPlaylist('large-custom-playlist')
      return [videos.length, ...videos.slice(0, 3).map(video => video.title), videos.at(-1).title]
    })).toEqual([102, ...expected, 'Added during the drag'])
    await expect.poll(async () => {
      const { videos } = readDatastore(app.userDataDir, 'playlists').trim().split('\n').map(line => JSON.parse(line))
        .find(playlist => playlist._id === 'large-custom-playlist')
      return [videos.length, ...videos.slice(0, 3).map(video => video.title), videos.at(-1).title]
    }).toEqual([102, ...expected, 'Added during the drag'])

    // The saved order replaces the one shown during the drag, so later moves still show.
    await rows.first().locator('.videoIndexArea').press('ArrowDown')
    await expect(titles.first()).toHaveText('Custom playlist video 1')
  })

  test('a drag continues while the next page of videos loads', { tag: '@scale' }, async ({ page }) => {
    await dispatchStoreAction(page, 'updatePlaylistViewType', 'list')
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()
    const rows = page.locator('.playlistItemsCard [data-playlist-drag-item]')
    await expect(rows).toHaveCount(100)
    const handle = await rows.first().locator('.videoIndexArea').boundingBox()
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y + 40, { steps: 4 })
    await expect(page.locator('.reorderDragged')).toHaveCount(1)
    // Reaching the end of the first page loads the next one under the drag.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(rows).toHaveCount(101)
    await expect(page.locator('.reorderDragged')).toHaveCount(1)
    await page.mouse.move(start.x, start.y + 60, { steps: 2 })
    await page.mouse.up()
    await expect(page.locator('.reorderDragged, .reorderActive')).toHaveCount(0)
    // The video lands under the pointer, far below where the drag started.
    await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylist('large-custom-playlist').videos
      .findIndex(video => video.title === 'Custom playlist video 1'))).toBeGreaterThan(50)
    const dropped = await rows.filter({ has: page.getByText('Custom playlist video 1', { exact: true }) }).boundingBox()
    expect(Math.abs(dropped.y + dropped.height / 2 - (start.y + 60))).toBeLessThan(dropped.height)
  })

  test('touch honors a fast final destination before release', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 1000 })
    await dispatchStoreAction(page, 'updatePlaylistViewType', 'list')
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()
    const rows = page.locator('.playlistItemsCard [data-playlist-drag-item]')
    const from = await rows.first().locator('.grabBar').boundingBox()
    const second = await rows.nth(1).boundingBox()
    const third = await rows.nth(2).boundingBox()
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const touch = (type, point) => session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: point ? [{ x: point.x + point.width / 2, y: point.y + point.height / 2, id: 0 }] : []
    })
    await touch('touchStart', from)
    await touch('touchMove', second)
    await touch('touchMove', third)
    await touch('touchEnd')
    await expect(rows.nth(2).locator('.h3Title')).toHaveText('Custom playlist video 1')
    await expect.poll(() => page.evaluate(() => window.$store
      .getters.getPlaylist('large-custom-playlist').videos[2].title)).toBe('Custom playlist video 1')
  })

  test('keeps the grid grab bars in place during the removal undo period', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const secondVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 2', { exact: true })
    })
    await expect(secondVideo.locator('.grabBar')).toBeVisible()
    await secondVideo.getByTitle('Remove from Playlist').click()

    await expect(secondVideo).toHaveCount(0)
    await expect(page.locator('.playlistItemsCard .grid.draggable .grabBar').first()).toBeVisible()

    const thirdVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 3', { exact: true })
    })
    await thirdVideo.getByTitle('Move Video Up').click()
    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 3')
  })

  test('keeps the playlist header below the navigation while scrolling the grid', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const expectHeaderBelowNavigation = async () => {
      const playlistHeader = page.locator('.playlistInfoContainer')
      await expect(playlistHeader).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, Number.MAX_SAFE_INTEGER))
      await expect.poll(async () => page.evaluate(() => {
        const previousScrollY = window.scrollY
        window.scrollTo(0, Number.MAX_SAFE_INTEGER)
        return window.scrollY - previousScrollY
      })).toBe(0)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

      await expect.poll(async () => {
        const [header, navigation, viewportHeight] = await Promise.all([
          playlistHeader.boundingBox(),
          page.locator('.topNav').boundingBox(),
          page.evaluate(() => window.innerHeight)
        ])
        return header != null && navigation != null &&
          header.y >= navigation.y + navigation.height &&
          header.y < viewportHeight && header.y + header.height > 0
      }).toBe(true)
    }

    await expectHeaderBelowNavigation()

    await page.keyboard.press('F1')
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
    await expectHeaderBelowNavigation()
  })

  for (const position of ['top', 'bottom']) {
    test(`list playlist header clears overflowing ${position} tabs`, { tag: '@scale' }, async ({ app, page }) => {
      await setWindowSize(app, page, { width: 1350, height: 750 })
      await goTo(page, 'userplaylists')
      await page.getByText('Large custom playlist').click()
      await page.evaluate(async (position) => {
        const store = window.$store
        store.commit('setPlaylistViewType', 'list')
        store.commit('setTabBarPosition', position)
        store.commit('setScrollbarThumbWidth', 20)
        for (let index = 0; index < 18; index++) {
          await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
        }
      }, position)
      await expect(page.locator('.tabsContainer > .os-scrollbar-horizontal')).toHaveClass(/os-scrollbar-visible/)
      await page.evaluate(() => window.scrollTo(0, Number.MAX_SAFE_INTEGER))
      const header = page.locator('.playlistInfoContainer')
      await expect.poll(() => header.evaluate((element, position) => {
        const box = element.getBoundingClientRect()
        const navigation = document.querySelector('.topNav').getBoundingClientRect()
        const boundary = position === 'bottom' ? document.querySelector('.tabBar').getBoundingClientRect().top : innerHeight
        return {
          belowNavigation: box.top >= navigation.bottom - 1,
          clearOfBottom: box.bottom <= boundary - 35
        }
      }, position)).toEqual({ belowNavigation: true, clearOfBottom: true })
    })
  }

  test('moves a video to the top from its options menu', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const thirdVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 3', { exact: true })
    })
    await thirdVideo.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move Video to the Top' }).click()

    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 3')
  })
})
