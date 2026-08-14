import { chmod, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, goToSettingsSection, waitForAppReady } from '../../helpers/app.mjs'
import { DEMO_MEDIA_LENGTH, DEMO_MEDIA_PATH } from '../../helpers/media.mjs'
import { DBActions, PlaylistVideoAddResult } from '../../../src/constants.js'

function historyEntry(videoId, title) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: '',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched: false,
    timeWatched: Date.now() - 1000,
    isLive: false,
    type: 'video'
  }
}

const SEED = {
  settings: { quickBookmarkTargetPlaylistId: 'favorites' },
  playlists: [
    {
      _id: 'favorites',
      playlistName: 'Favorites',
      protected: true,
      description: '',
      quickBookmarkIcon: 'clock',
      videos: [],
      createdAt: Date.now() - 86_400_000,
      lastUpdatedAt: Date.now() - 86_400_000
    },
    {
      _id: 'saved-videos',
      playlistName: 'Saved videos',
      protected: false,
      description: '',
      videos: [historyEntry('eeeeeeeeeee', 'Bookmarkable video')],
      createdAt: Date.now() - 86_400_000,
      lastUpdatedAt: Date.now() - 86_400_000
    }
  ],
  history: [historyEntry('eeeeeeeeeee', 'Bookmarkable video')]
}

test.use({ seed: SEED })

test('persists the yt-dlp playback cache across app restarts', async ({ app, page }) => {
  const expiryTime = Date.now() + 60 * 60 * 1000
  const source = {
    manifestSrc: 'data:application/dash+xml;charset=UTF-8,manifest',
    manifestMimeType: 'application/dash+xml',
    legacyFormats: [],
    isLive: false,
    version: '2026.08.13'
  }

  expect(await page.evaluate(({ expiryTime, source }) => {
    return window.ftElectron.ytDlpPlaybackCacheSet('eeeeeeeeeee', 'settings', expiryTime, source)
  }, { expiryTime, source })).toBe(true)

  ;({ page } = await app.relaunch())

  expect(await page.evaluate(() => {
    return window.ftElectron.ytDlpPlaybackCacheGet('eeeeeeeeeee', 'settings')
  })).toEqual({ expiryTime, source })
  expect(await page.evaluate(() => {
    return window.ftElectron.ytDlpPlaybackCacheGet('eeeeeeeeeee', 'other-settings')
  })).toBeNull()
})

test('limits persisted yt-dlp playback entries by UTF-8 byte size', async ({ page }) => {
  const source = {
    manifestSrc: `data:application/dash+xml;charset=UTF-8,${'€'.repeat(700_000)}`,
    manifestMimeType: 'application/dash+xml',
    legacyFormats: [],
    isLive: false,
    version: '2026.08.13'
  }

  expect(await page.evaluate(source => {
    return window.ftElectron.ytDlpPlaybackCacheSet(
      'eeeeeeeeeee',
      'settings',
      Date.now() + 60 * 60 * 1000,
      source
    )
  }, source)).toBe(false)
})

async function readPlaylist(app, id) {
  const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
  const records = contents.trim().split('\n').map((line) => JSON.parse(line))
  return records.filter((record) => record._id === id).at(-1)
}

test.describe('rounded action popovers', () => {
  test.use({
    seed: {
      ...SEED,
      settings: { ...SEED.settings, uiRoundness: 0 }
    }
  })

  test('applies UI roundness to icon-button dropdowns', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    await expect(video.locator('.addToPlaylistIcon .iconDropdown')).toHaveCSS('border-radius', '0px')
  })
})

test.describe('video downloads', () => {
  test.use({
    seed: {
      ...SEED,
      settings: {
        ...SEED.settings,
        ytDlpSource: 'system',
        ytDlpPath: '/bin/false',
        ytDlpFfmpegSource: 'system',
        ytDlpFfmpegPath: '/bin/false'
      }
    }
  })

  test('sends plain download options over IPC', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()
    await page.getByRole('button', { name: 'Download', exact: true }).click()

    await expect(page.getByText('Download failed', { exact: true })).toBeVisible()
    await expect(page.locator('.downloadProgressBarTrack')).toHaveCount(0)
  })

  test('can retry playback extraction with yt-dlp default clients', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'capture-yt-dlp-playback-args.sh')
    const capturedArgs = path.join(app.userDataDir, 'captured-yt-dlp-playback-args.txt')
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "${capturedArgs}"`,
      'printf \'%s\\n\' \'{"formats":[{"format_id":"140","available_at":123}]}\''
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await page.bringToFront()
    await page.evaluate(() => window.ftElectron.ytDlpGetPlaybackInfo('eeeeeeeeeee'))

    let passedArguments = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
    const extractorArgsIndex = passedArguments.indexOf('--extractor-args')
    expect(passedArguments[extractorArgsIndex + 1]).toBe('youtube:player_client=web_embedded,default,-android_vr')

    const info = await page.evaluate(() => window.ftElectron.ytDlpGetPlaybackInfo('eeeeeeeeeee', true))

    passedArguments = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
    expect(passedArguments).not.toContain('--extractor-args')
    expect(info.formats[0].availableAt).toBe(123)
  })

  test('disables media download actions and rejects direct requests', async ({ page }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateExtraThumbnailAction', 'download')
    })

    await goTo(page, 'history')
    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()
    await expect(page.locator('.downloadPromptCard')).toBeVisible()
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateEnableDownloads', false)
    })
    await expect(page.locator('.downloadPromptCard')).toHaveCount(0)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateEnableDownloads', true)
    })
    await expect(page.locator('.downloadPromptCard')).toHaveCount(0)

    const downloadSection = await goToSettingsSection(page, 'download')
    const toggle = downloadSection.getByRole('checkbox', { name: 'Enable Downloads' })
    await expect(toggle).toBeChecked()
    await downloadSection.locator('label.switch-label').filter({ hasText: 'Enable Downloads' }).click()
    await expect(toggle).not.toBeChecked()
    await expect(downloadSection.getByLabel('Download Folder')).toHaveCount(0)

    await page.locator('.settingsMenu [data-section="general"]').click()
    const generalSection = page.locator('.settingsContent > [data-section="general"]')
    await expect(generalSection.getByRole('combobox', { name: 'Extra Thumbnail Action Button' })).toHaveText('None')
    await page.locator('.settingsCloseButton').click()

    await expect(page.locator('.topNav .downloadsButton')).toHaveCount(0)
    await video.hover()
    await expect(video.locator('.extraThumbnailActionIcon')).toHaveCount(0)
    await video.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Download Video' })).toHaveCount(0)

    await page.bringToFront()
    const result = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      mode: 'video'
    }))
    expect(result).toEqual({ error: 'downloads-disabled' })
  })

  test('rejects custom arguments that can execute external code', async ({ page }) => {
    const customArguments = [
      '--exec "echo unsafe"',
      '--config-location=/tmp/yt-dlp.conf',
      '--external-downloader custom-binary',
      '--plugin-dirs /tmp/plugins',
      '--remote-components ejs:github'
    ]
    await page.bringToFront()
    const results = await page.evaluate((args) => Promise.all(args.map(customArgs => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      mode: 'video',
      customArgs
    }))), customArguments)
    expect(results).toEqual(customArguments.map(() => ({ error: 'unsupported-custom-argument' })))
  })

  test('escapes percent signs in local playlist folder names', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'capture-yt-dlp-args.sh')
    const capturedArgs = path.join(app.userDataDir, 'captured-yt-dlp-args.txt')
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > "${capturedArgs}"\n`)
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await page.bringToFront()
    await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoIds: ['eeeeeeeeeee'],
      isPlaylist: true,
      title: 'Top 100%(title)s',
      mode: 'video'
    }))

    await expect.poll(async () => readFile(capturedArgs, 'utf8').catch(() => '')).toContain('Top 100%%(title)s')
  })

  test('prefixes Windows reserved local playlist folder names', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'capture-yt-dlp-args.sh')
    const capturedArgs = path.join(app.userDataDir, 'captured-yt-dlp-args.txt')
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > "${capturedArgs}"\n`)
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await page.bringToFront()
    await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoIds: ['eeeeeeeeeee'],
      isPlaylist: true,
      title: 'CON.txt',
      mode: 'video'
    }))

    await expect.poll(async () => readFile(capturedArgs, 'utf8').catch(() => '')).toContain('_CON.txt/%(autonumber)03d')
  })

  test('rejects invalid and oversized local playlist video lists', async ({ page }) => {
    await page.bringToFront()
    const results = await page.evaluate(() => Promise.all([
      window.ftElectron.ytDlpDownload({
        videoIds: ['eeeeeeeeeee', 'invalid', 'fffffffffff'],
        isPlaylist: true,
        mode: 'video'
      }),
      window.ftElectron.ytDlpDownload({
        videoIds: Array.from({ length: 501 }, () => 'eeeeeeeeeee'),
        isPlaylist: true,
        mode: 'video'
      })
    ]))

    expect(results).toEqual([
      { error: 'invalid-video-ids' },
      { error: 'too-many-videos' }
    ])
  })

  test('keeps untitled multi-video downloads in history', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-yt-dlp.sh')
    await writeFile(executable, '#!/bin/sh\nsleep 0.2\n')
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await page.bringToFront()
    const result = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoId: 42,
      videoIds: ['eeeeeeeeeee'],
      isPlaylist: true,
      mode: 'video'
    }))
    await expect.poll(() => page.evaluate(async (id) => {
      const downloads = await window.ftElectron.ytDlpListDownloads()
      return downloads.find(download => download.id === id)
    }, result.id)).toMatchObject({ title: '', status: 'completed' })
  })

  test('plays a downloaded video locally and reconciles it after external deletion', async ({ app, page }) => {
    const downloadedFile = path.join(app.userDataDir, 'downloaded-demo.webm')
    const downloadThumbnail = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Cpath fill="%23b00020" d="M0 0h640v360H0z"/%3E%3C/svg%3E'
    const executable = path.join(app.userDataDir, 'fake-yt-dlp.sh')
    const argumentsFile = path.join(app.userDataDir, 'yt-dlp-arguments.txt')
    await copyFile(DEMO_MEDIA_PATH, downloadedFile)
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '%s\\n' "$@" >> '${argumentsFile}'`,
      `printf '__OPENTUBEX_FILE__:eeeeeeeeeee\\t30\\t640\\t360\\t${downloadedFile}\\n'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const result = await page.evaluate((thumbnail) => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      title: 'Downloaded demo',
      thumbnail,
      mode: 'video'
    }), downloadThumbnail)
    await expect.poll(() => page.evaluate(async (id) => {
      const downloads = await window.ftElectron.ytDlpListDownloads()
      return downloads.find(download => download.id === id)
    }, result.id)).toMatchObject({
      status: 'completed',
      availability: 'available',
      files: [{
        videoId: 'eeeeeeeeeee',
        path: downloadedFile,
        duration: 30,
        width: 640,
        height: 360,
        available: true
      }]
    })

    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 12,
        y: 12,
        width: 400,
        height: 650
      }))
    })
    await goTo(page, 'downloads')
    await expect(page.getByText('Total size: 140 KiB', { exact: true })).toBeVisible()
    expect(await page.evaluate(async (id) => {
      const download = (await window.ftElectron.ytDlpListDownloads()).find(record => record.id === id)
      return download.sizeBytes
    }, result.id)).toBe(DEMO_MEDIA_LENGTH)
    const audioResult = await page.evaluate((thumbnail) => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      title: 'Downloaded audio alternative',
      thumbnail,
      mode: 'audio'
    }), downloadThumbnail)
    await expect.poll(() => page.evaluate(async (id) => {
      return (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    }, audioResult.id)).toBe('completed')
    const temporaryPaths = (await readFile(argumentsFile, 'utf8'))
      .split('\n')
      .filter(argument => argument.startsWith('temp:'))
    expect(temporaryPaths).toHaveLength(2)
    expect(new Set(temporaryPaths).size).toBe(2)
    const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Downloaded demo' })
    await expect(downloadRow.locator('.downloadSummary')).toContainText('140 KiB')
    await expect(page.locator('.settingsBackButton')).toHaveCount(0)
    await expect(downloadRow).toHaveCSS('flex-direction', 'column')
    await expect(downloadRow.locator('.downloadMain')).toHaveCSS('flex-direction', 'column')
    await expect.poll(async () => {
      const [mainBounds, thumbnailBounds] = await Promise.all([
        downloadRow.locator('.downloadMain').boundingBox(),
        downloadRow.locator('.downloadThumbnail').boundingBox()
      ])
      return thumbnailBounds.x + thumbnailBounds.width / 2 - (mainBounds.x + mainBounds.width / 2)
    }).toBeCloseTo(0, 0)
    await downloadRow.getByTitle('Play download').click()
    await expect(page).toHaveURL(new RegExp(`/watch/eeeeeeeeeee\\?downloadId=${result.id}`))
    await expect(page.locator('.infoArea .videoTitle')).toContainText('Downloaded demo')
    await expect.poll(() => page.locator('video.player').evaluate(video => video.currentTime), {
      timeout: 30_000
    }).toBeGreaterThan(0)
    await expect.poll(() => page.locator('video.player').evaluate(video => video.duration)).toBeGreaterThan(30)
    await expect(page.locator('.legacy-quality-button')).toHaveAttribute('shaka-status', '640×360 • Local file')
    const sourceSwitchLoadGeneration = await page.evaluate(() => {
      const findWatchView = (vnode) => {
        if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
        if (vnode?.component?.subTree) {
          const match = findWatchView(vnode.component.subTree)
          if (match) return match
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = findWatchView(child)
            if (match) return match
          }
        }
        return null
      }
      const watchView = findWatchView(document.querySelector('#app').__vue_app__._container._vnode)
      // This offline fixture cannot fetch an online source. Preserve a known
      // playable source so this test isolates in-place source routing instead
      // of exercising the separate unavailable-online fallback.
      watchView.onlinePlaybackSource = {
        manifestSrc: watchView.manifestSrc,
        manifestMimeType: watchView.manifestMimeType,
        sabrData: watchView.sabrData,
        legacyFormats: watchView.legacyFormats,
        streamingDataExpiryDate: watchView.streamingDataExpiryDate,
        activeFormat: watchView.activeFormat,
        activePlaybackEngine: watchView.activePlaybackEngine,
        activePlaybackEngineVersion: watchView.activePlaybackEngineVersion,
        hasBeenLoaded: true
      }
      return watchView.videoLoadGeneration
    })
    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    const formatPrompt = page.getByRole('dialog', { name: 'Change Media Formats' })
    await expect(formatPrompt.locator('.engineBadge')).toHaveText('Local file')
    await expect(formatPrompt.getByText('Stream extraction method', { exact: true })).toHaveCount(0)
    await expect(formatPrompt.getByRole('button', { name: /Local video file/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(formatPrompt.getByText('Use Legacy Formats', { exact: true })).toHaveCount(0)
    await formatPrompt.getByRole('button', { name: /Local video file/ }).click()
    await page.locator('video.player').evaluate(video => { video.currentTime = 15 })
    await expect.poll(() => page.locator('video.player').evaluate(video => video.currentTime)).toBeGreaterThan(14)

    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    await formatPrompt.getByRole('button', { name: /Online video/ }).click()
    await expect(page).not.toHaveURL(/downloadId=/)
    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    await expect(formatPrompt.locator('.engineBadge')).not.toHaveText('Local file')
    await expect(formatPrompt.getByRole('button', { name: /Local video file/ })).toBeVisible()
    await expect(formatPrompt.getByRole('button', { name: /Local audio file/ })).toBeVisible()
    await formatPrompt.getByRole('button', { name: /Local audio file/ }).click()
    await expect(page).toHaveURL(new RegExp(`downloadId=${audioResult.id}`))
    await expect(page.locator('.audioPoster')).toBeVisible()
    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    await expect(formatPrompt.getByRole('button', { name: /Local audio file/ })).toHaveAttribute('aria-pressed', 'true')
    await formatPrompt.getByRole('button', { name: /Online video/ }).click()
    await expect(page).not.toHaveURL(/downloadId=/)
    expect(await page.evaluate(() => {
      const findWatchView = (vnode) => {
        if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
        if (vnode?.component?.subTree) {
          const match = findWatchView(vnode.component.subTree)
          if (match) return match
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = findWatchView(child)
            if (match) return match
          }
        }
        return null
      }
      return findWatchView(document.querySelector('#app').__vue_app__._container._vnode).videoLoadGeneration
    })).toBe(sourceSwitchLoadGeneration)
    await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toHaveCount(0)
    await expect(page.locator('.tab.active .tabTitleText')).toHaveText('Downloaded demo')

    await unlink(downloadedFile)
    await page.locator('.topNav .downloadsButton').click()
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
    await expect(downloadRow).toContainText('Download unavailable')
    await expect(downloadRow).toContainText('The downloaded file is no longer available on the filesystem.')
    await expect(downloadRow.getByTitle('Play download')).toHaveCount(0)
    await expect(downloadRow.getByTitle('Show in Folder')).toHaveCount(0)
    await expect(downloadRow.getByTitle('Remove File')).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear failed, canceled, and missing' }).click()
    await expect(downloadRow).toHaveCount(0)
    await expect(page.locator('.downloadRow').filter({ hasText: 'Downloaded audio alternative' })).toHaveCount(0)
  })

  test('plays an audio download in the normal player', async ({ app, page }) => {
    const downloadedFile = path.join(app.userDataDir, 'downloaded-audio.wav')
    const executable = path.join(app.userDataDir, 'fake-audio-yt-dlp.sh')
    const sampleRate = 8_000
    const duration = 2
    const samples = sampleRate * duration
    const wav = Buffer.alloc(44 + samples * 2)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(sampleRate, 24)
    wav.writeUInt32LE(sampleRate * 2, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(samples * 2, 40)
    await writeFile(downloadedFile, wav)
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '__OPENTUBEX_FILE__:eeeeeeeeeee\\t${duration}\\tNA\\tNA\\t${downloadedFile}\\n'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const result = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      title: 'Downloaded audio',
      mode: 'audio'
    }))
    await expect.poll(() => page.evaluate(async (id) => {
      const downloads = await window.ftElectron.ytDlpListDownloads()
      return downloads.find(download => download.id === id)
    }, result.id)).toMatchObject({
      status: 'completed',
      files: [{ videoId: 'eeeeeeeeeee', duration, available: true }]
    })

    await goTo(page, 'downloads')
    const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Downloaded audio' })
    await expect(downloadRow.locator('.downloadSummary')).toContainText('31 KiB')
    await downloadRow.getByTitle('Play download').click()
    await expect(page).toHaveURL(new RegExp(`/watch/eeeeeeeeeee\\?downloadId=${result.id}`))
    await expect.poll(() => page.locator('video.player').evaluate(video => video.currentTime), {
      timeout: 30_000
    }).toBeGreaterThan(0)
    await expect.poll(() => page.locator('video.player').evaluate(video => video.duration)).toBe(duration)
  })

  test('serves an empty downloaded file without failing the protocol request', async ({ app, page }) => {
    const downloadedFile = path.join(app.userDataDir, 'empty-audio.wav')
    const executable = path.join(app.userDataDir, 'fake-empty-audio-yt-dlp.sh')
    await writeFile(downloadedFile, '')
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '__OPENTUBEX_FILE__:eeeeeeeeeee\\t1\\tNA\\tNA\\t${downloadedFile}\\n'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const result = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      title: 'Empty audio',
      mode: 'audio'
    }))
    await expect.poll(() => page.evaluate(async (id) => {
      return (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    }, result.id)).toBe('completed')

    const response = await page.evaluate(async (id) => {
      const result = await fetch(`downloadmedia://file/${id}/eeeeeeeeeee`)
      return {
        status: result.status,
        contentLength: result.headers.get('content-length'),
        contentType: result.headers.get('content-type'),
        bodyLength: (await result.arrayBuffer()).byteLength
      }
    }, result.id)
    expect(response).toEqual({
      status: 200,
      contentLength: '0',
      contentType: 'audio/wav',
      bodyLength: 0
    })
  })

  test('rejects a downloaded media path that is not a file', async ({ app, page }) => {
    const downloadedDirectory = path.join(app.userDataDir, 'download-directory.webm')
    const executable = path.join(app.userDataDir, 'fake-directory-yt-dlp.sh')
    await mkdir(downloadedDirectory)
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '__OPENTUBEX_FILE__:eeeeeeeeeee\\t1\\tNA\\tNA\\t${downloadedDirectory}\\n'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const result = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      title: 'Directory download',
      mode: 'video'
    }))
    await expect.poll(() => page.evaluate(async (id) => {
      return (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    }, result.id)).toBe('completed')

    expect(await page.evaluate(async (id) => {
      return (await fetch(`downloadmedia://file/${id}/eeeeeeeeeee`)).status
    }, result.id)).toBe(404)
  })

  test('maps playlist files to video IDs and reports partial availability', async ({ app, page }) => {
    const availableFile = path.join(app.userDataDir, 'available.webm')
    const missingFile = path.join(app.userDataDir, 'missing.webm')
    const executable = path.join(app.userDataDir, 'fake-playlist-yt-dlp.sh')
    await copyFile(DEMO_MEDIA_PATH, availableFile)
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '__OPENTUBEX_FILE__:eeeeeeeeeee\\t${availableFile}\\n'`,
      `printf '__OPENTUBEX_FILE__:fffffffffff\\t${missingFile}\\n'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const result = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      playlistId: 'PL1234567890',
      playlistKey: 'PL1234567890',
      isPlaylist: true,
      title: 'Partially available playlist',
      mode: 'video'
    }))
    await expect.poll(() => page.evaluate(async (id) => {
      const downloads = await window.ftElectron.ytDlpListDownloads()
      return downloads.find(download => download.id === id)
    }, result.id)).toMatchObject({
      status: 'completed',
      availability: 'partial',
      availableDestinationCount: 1,
      destinationCount: 2,
      files: [
        { videoId: 'eeeeeeeeeee', path: availableFile, available: true },
        { videoId: 'fffffffffff', path: missingFile, available: false }
      ]
    })

    await goTo(page, 'downloads')
    const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Partially available playlist' })
    await expect(downloadRow).toContainText('1 of 2 downloaded files are available.')
    await expect(downloadRow.getByTitle('Play download')).toBeVisible()
    await expect(downloadRow.getByTitle('Show in Folder')).toBeVisible()
    await expect(downloadRow.getByTitle('Remove File')).toBeVisible()
  })

  test('broadcasts active downloads to other windows', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-yt-dlp.sh')
    await writeFile(executable, '#!/bin/sh\nprintf "[download] 10.0%% at 1MiB/s ETA 00:10\\n"\nexec sleep 30\n')
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const [otherWindow] = await Promise.all([
      app.electronApp.waitForEvent('window'),
      page.locator('.topNav .navNewWindowButton').click()
    ])
    await waitForAppReady(otherWindow)
    await otherWindow.locator('.topNav .downloadsButton').click()

    await page.bringToFront()
    await goTo(page, 'history')
    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()
    await page.getByRole('button', { name: 'Download', exact: true }).click()

    const otherDownload = otherWindow.locator('.downloadRow').filter({ hasText: 'Bookmarkable video' })
    await expect(otherDownload).toContainText('0.0%')

    const [lateWindow] = await Promise.all([
      app.electronApp.waitForEvent('window'),
      otherWindow.locator('.topNav .navNewWindowButton').click()
    ])
    await waitForAppReady(lateWindow)
    await lateWindow.locator('.topNav .downloadsButton').click()
    const hydratedDownload = lateWindow.locator('.downloadRow').filter({ hasText: 'Bookmarkable video' })
    await expect(hydratedDownload).toContainText('0.0%')

    await hydratedDownload.getByTitle('Cancel Download').click()
    await expect(otherDownload).toContainText('Download canceled')

    await hydratedDownload.getByTitle('Retry download').click()
    await expect(otherDownload).toContainText('0.0%')
    await expect(hydratedDownload.getByTitle('Cancel Download')).toBeVisible()
    await hydratedDownload.getByTitle('Cancel Download').click()
    await expect(otherDownload).toContainText('Download canceled')

    await lateWindow.getByRole('button', { name: 'Clear failed, canceled, and missing' }).click()
    await expect(otherDownload).toHaveCount(0)
  })

  test('flushes completed download history before quitting', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-yt-dlp.sh')
    await writeFile(executable, '#!/bin/sh\nprintf "[download] 100.0%% at 1MiB/s ETA 00:00\\n"\nsleep 0.2\n')
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await goTo(page, 'history')
    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await expect(page.getByText('Download complete', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open Downloads', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
    await expect(page.locator('.downloadRow').filter({ hasText: 'Bookmarkable video' })).toBeVisible()

    const { page: relaunchedPage } = await app.relaunch()
    await goTo(relaunchedPage, 'downloads')
    await expect(relaunchedPage.locator('.downloadRow').filter({ hasText: 'Bookmarkable video' })).toBeVisible()
  })

  test('downloads subtitles on their own and lists the files they wrote', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-yt-dlp.sh')
    const argumentsFile = path.join(app.userDataDir, 'yt-dlp-arguments.txt')
    // yt-dlp announces subtitle files on stdout instead of the `--print` output
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > ${argumentsFile}`,
      'printf "[info] Writing video subtitles to: /tmp/subtitles.en.srt\\n"',
      'printf "[info] Writing video subtitles to: /tmp/subtitles.de.srt\\n"'
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await goTo(page, 'history')
    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()

    // the prompt animates in with a scale transform, so measure the layout box
    const promptCard = page.locator('.downloadPromptCard')
    const heightWithVideoOptions = await promptCard.evaluate(card => card.offsetHeight)

    const templateSelect = page.getByRole('combobox', { name: 'Template' })
    await templateSelect.click()
    await page.getByRole('listbox', { name: 'Template' })
      .getByRole('option', { name: 'Subtitles - SRT', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Subtitle Format' })).toContainText('SRT')
    // hiding the options that don't apply to subtitles would resize the modal
    expect(await promptCard.evaluate(card => card.offsetHeight)).toBe(heightWithVideoOptions)

    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await expect(page.getByText('Download complete', { exact: true })).toBeVisible()

    const passedArguments = (await readFile(argumentsFile, 'utf8')).split('\n')
    expect(passedArguments).toContain('--skip-download')
    // `--print` implies quiet mode, which would hide the written subtitle files
    expect(passedArguments).toContain('--no-quiet')
    expect(passedArguments).toContain('srt/best')
    expect(passedArguments).toContain('youtube:skip=translated_subs')
    expect(passedArguments).not.toContain('--embed-subs')

    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await goTo(page, 'downloads')
    const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Bookmarkable video' })
    await expect(downloadRow.locator('.downloadSummary')).toHaveText('Subtitles • Template: Subtitles - SRT')
    await expect(downloadRow.locator('.destination')).toHaveText([
      '/tmp/subtitles.en.srt',
      '/tmp/subtitles.de.srt'
    ])
  })

  test('keeps the source subtitle destination when conversion fails', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-yt-dlp.sh')
    const attemptMarker = path.join(app.userDataDir, 'subtitle-retry-attempted')
    await writeFile(executable, [
      '#!/bin/sh',
      'printf "[info] Writing video subtitles to: /tmp/subtitles.en.vtt\\n"',
      `if [ -f ${attemptMarker} ]; then exit 0; fi`,
      `printf retried > ${attemptMarker}`,
      'printf "Subtitle conversion failed\\n" >&2',
      'sleep 0.2',
      'exit 1'
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await goTo(page, 'history')
    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()
    await page.getByRole('combobox', { name: 'Template' }).click()
    await page.getByRole('listbox', { name: 'Template' })
      .getByRole('option', { name: 'Subtitles - SRT', exact: true }).click()
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await expect(page.getByText('Download failed', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await goTo(page, 'downloads')
    const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Bookmarkable video' })
    await expect(downloadRow.locator('.destination')).toHaveText('/tmp/subtitles.en.vtt')
    await expect(downloadRow.locator('.downloadError')).toContainText('Subtitle conversion failed')
    await downloadRow.getByTitle('Retry download').click()
    await expect.poll(() => page.evaluate(async () => {
      return (await window.ftElectron.ytDlpListDownloads())
        .filter(download => download.title === 'Bookmarkable video')
        .map(download => download.status)
    })).toEqual(['completed'])
    await expect(downloadRow.getByTitle('Retry download')).toHaveCount(0)
  })

  test('starts only one retry when its button is activated twice', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'slow-failing-yt-dlp.sh')
    const attemptsFile = path.join(app.userDataDir, 'retry-attempts.txt')
    await writeFile(executable, [
      '#!/bin/sh',
      `printf 'retry\\n' >> '${attemptsFile}'`,
      'sleep 0.5',
      'exit 1'
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const result = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoId: 'eeeeeeeeeee',
      title: 'Retry once',
      mode: 'video'
    }))
    await expect.poll(() => page.evaluate(async (id) => {
      return (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    }, result.id)).toBe('failed')
    await writeFile(attemptsFile, '')

    await goTo(page, 'downloads')
    const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Retry once' }).first()
    await downloadRow.getByTitle('Retry download').dblclick()

    await expect.poll(() => page.evaluate(async (originalId) => {
      const matchingDownloads = (await window.ftElectron.ytDlpListDownloads())
        .filter(download => download.title === 'Retry once' && download.status === 'failed')
      return matchingDownloads.length === 1 && matchingDownloads[0].id !== originalId
    }, result.id)).toBe(true)
    expect(await readFile(attemptsFile, 'utf8')).toBe('retry\n')
  })

  test('serializes retry requests in the main process', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'concurrent-retry-yt-dlp.sh')
    const attemptsFile = path.join(app.userDataDir, 'concurrent-retry-attempts.txt')
    await writeFile(executable, [
      '#!/bin/sh',
      `printf 'retry\\n' >> '${attemptsFile}'`,
      'sleep 0.5',
      'exit 1'
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const original = await page.evaluate(() => window.ftElectron.ytDlpDownload({
      videoId: 'ffffffffffg',
      title: 'Concurrent retry',
      mode: 'video'
    }))
    await expect.poll(() => page.evaluate(async (id) => {
      return (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    }, original.id)).toBe('failed')
    await writeFile(attemptsFile, '')

    const results = await page.evaluate(async (id) => {
      const record = (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)
      return Promise.all([
        window.ftElectron.ytDlpDownload(record.retryPayload, id),
        window.ftElectron.ytDlpDownload(record.retryPayload, id)
      ])
    }, original.id)

    expect(results.filter(result => result && 'id' in result)).toHaveLength(1)
    expect(results.filter(result => result?.error === 'download-already-retrying')).toHaveLength(1)
    await expect.poll(() => readFile(attemptsFile, 'utf8')).toBe('retry\n')
  })
})

test('asks for confirmation before removing a downloaded file', async ({ page }) => {
  await goTo(page, 'downloads')
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('upsertYtDlpDownload', {
      id: 42,
      title: 'Finished download',
      status: 'completed',
      percent: 100,
      thumbnail: 'https://i.ytimg.com/vi/eeeeeeeeeee/mqdefault.jpg',
      destination: '/tmp/finished-download.mp4'
    })
  })

  const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Finished download' })
  await expect(downloadRow.locator('.downloadThumbnail')).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/eeeeeeeeeee/mqdefault.jpg'
  )
  const rowLayout = await downloadRow.evaluate((row) => ({
    thumbnailRight: row.querySelector('.downloadThumbnail').getBoundingClientRect().right,
    detailsLeft: row.querySelector('.downloadDetails').getBoundingClientRect().left
  }))
  expect(rowLayout.thumbnailRight).toBeLessThanOrEqual(rowLayout.detailsLeft)

  await page.getByTitle('Remove File').click()
  const removePrompt = page.getByRole('dialog', { name: 'Remove downloaded file?' })
  await expect(removePrompt).toContainText('Remove downloaded file?')
  await expect(removePrompt).toContainText('Finished download')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Finished download')).toBeVisible()
})

test.describe('list video actions', () => {
  test('does not attach to an unrelated active download with the same title', async ({ page }) => {
    await goTo(page, 'history')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertYtDlpDownload', {
        id: 41,
        videoId: 'differentId',
        title: 'Bookmarkable video',
        status: 'downloading',
        percent: 50
      })
    })

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()

    await expect(page.getByText('Media Type', { exact: true })).toBeVisible()
    await expect(page.getByText('50.0%', { exact: true })).toHaveCount(0)
  })

  test('does not attach to an unrelated active playlist with the same title', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Saved videos', { exact: true }).click()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertYtDlpDownload', {
        id: 43,
        playlistKey: 'different-playlist',
        title: 'Saved videos',
        status: 'downloading',
        percent: 50
      })
    })

    await page.getByTitle('Download Playlist').click()

    await expect(page.getByText('Media Type', { exact: true })).toBeVisible()
    await expect(page.getByText('50.0%', { exact: true })).toHaveCount(0)
  })

  test('reattaches to a changed local playlist by its stable id', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Saved videos', { exact: true }).click()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertYtDlpDownload', {
        id: 44,
        playlistKey: 'saved-videos',
        title: 'Old playlist title',
        status: 'downloading',
        percent: 50
      })
    })

    await page.getByTitle('Download Playlist').click()

    await expect(page.getByText('50.0%', { exact: true })).toBeVisible()
    await expect(page.getByText('Media Type', { exact: true })).toHaveCount(0)
  })

  test('does not overflow horizontally in a narrow download modal', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 940 })
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()

    for (const locator of [page.locator('.downloadPromptCard'), page.locator('.downloadOptions')]) {
      await expect.poll(() => locator.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
    }

    const templateSection = page.locator('.fixedTemplateSection')
    await page.waitForTimeout(200)
    const templateTop = await templateSection.evaluate(element => element.getBoundingClientRect().top)
    await page.locator('.downloadOptions').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => page.locator('.downloadOptions').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => templateSection.evaluate(element => element.getBoundingClientRect().top)).toBe(templateTop)
  })

  test('disabled download inputs do not fade their tooltips', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()

    const metadataSection = page.locator('.optionSection').filter({
      has: page.getByRole('heading', { name: 'Subtitles and Metadata' })
    })
    await expect(metadataSection.locator('.switch-label-text')).toHaveText([
      'Embed thumbnail as cover art',
      'Embed title, author, description, and chapters',
      'Include subtitles',
      'Embed subtitles in the media file'
    ])

    const subtitleLanguages = page.locator('.subtitleLanguages')
    await expect(subtitleLanguages.locator('input')).toBeDisabled()
    await subtitleLanguages.locator('.selectTooltip button').hover()
    const tooltip = page.locator('body > [role="tooltip"]:visible')
    await expect(tooltip).toBeVisible()

    const opacity = await subtitleLanguages.evaluate((field) => ({
      label: getComputedStyle(field.querySelector('.selectLabel')).opacity,
      labelText: getComputedStyle(field.querySelector('.selectLabelText')).opacity
    }))
    expect(opacity).toEqual({ label: '1', labelText: '0.4' })
    await expect(tooltip).toHaveCSS('opacity', '1')
  })

  test('the options dropdown shows readable single-column actions with icons', async ({ page }) => {
    await goTo(page, 'history')
    await page.setViewportSize({ width: 1200, height: 360 })

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()

    const actions = page.getByRole('option')
    const dropdown = video.locator('.optionsButton .iconDropdown')
    await expect(actions).not.toHaveCount(0)
    await expect(actions.locator('.optionIconColumn svg')).toHaveCount(await actions.count())
    await expect(dropdown).toHaveCSS('font-size', '14px')
    await expect(dropdown).not.toHaveCSS('box-shadow', 'none')
    await expect(actions.first()).toHaveCSS('text-align', 'start')
    await expect(actions.first()).toHaveCSS('justify-content', 'flex-start')
    expect(await actions.locator('span').evaluateAll((labels) => {
      return labels.every((label) => label.scrollWidth <= label.clientWidth)
    })).toBe(true)
    const actionRows = await actions.evaluateAll((items) => items.map((item) => item.offsetTop))
    expect(new Set(actionRows).size).toBe(actionRows.length)

    const dropdownBounds = await dropdown.boundingBox()
    expect(dropdownBounds.y).toBeGreaterThanOrEqual(0)
    expect(dropdownBounds.y + dropdownBounds.height).toBeLessThanOrEqual(360)
    expect(await dropdown.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect(actions.last()).toBeVisible()

    await page.setViewportSize({ width: 1000, height: 300 })
    await expect.poll(async () => {
      const bounds = await dropdown.boundingBox()
      return bounds.y >= 0 && bounds.y + bounds.height <= 300
    }).toBe(true)
  })

  test('a tall options dropdown stays below the horizontal tab bar', async ({ page }) => {
    await goTo(page, 'history')
    await page.setViewportSize({ width: 1200, height: 400 })

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()

    const dropdown = video.locator('.optionsButton .iconDropdown')
    await expect(dropdown).toBeVisible()

    // Clamping to the viewport edge let a menu that is too tall for the space
    // below it cover the tabs and the top navigation instead of scrolling.
    const [dropdownBounds, chromeBottom] = await Promise.all([
      dropdown.boundingBox(),
      page.evaluate(() => {
        return Math.max(
          document.querySelector('.topNav').getBoundingClientRect().bottom,
          document.querySelector('.tabBar:not(.vertical)').getBoundingClientRect().bottom
        )
      })
    ])

    expect(chromeBottom).toBeGreaterThan(0)
    expect(dropdownBounds.y).toBeGreaterThanOrEqual(chromeBottom)
    expect(dropdownBounds.y + dropdownBounds.height).toBeLessThanOrEqual(400)
    expect(await dropdown.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

    // Repositioning alone cannot keep up with a fast scroll, so the chrome also
    // has to paint above the dropdown.
    const stackingOrder = await dropdown.evaluate((element) => ({
      dropdown: Number(getComputedStyle(element).zIndex),
      tabBar: Number(getComputedStyle(document.querySelector('.tabBar:not(.vertical)')).zIndex),
      topNav: Number(getComputedStyle(document.querySelector('.topNav')).zIndex)
    }))
    expect(stackingOrder.tabBar).toBeGreaterThan(stackingOrder.dropdown)
    expect(stackingOrder.topNav).toBeGreaterThan(stackingOrder.dropdown)
  })

  test('an open options dropdown crosses vertical tabs without lifting its feed card', async ({ page }) => {
    await goTo(page, 'history')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setTabBarPosition', 'left')
    })

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()

    await expect(video.locator('.optionsButton .iconDropdown')).toBeVisible()
    const stackingOrder = await video.evaluate((listVideo) => ({
      topNav: Number(getComputedStyle(document.querySelector('.topNav')).zIndex),
      tabBar: Number(getComputedStyle(document.querySelector('.tabBar.vertical')).zIndex),
      dropdown: Number(getComputedStyle(listVideo.querySelector('.iconDropdown')).zIndex),
      listVideo: getComputedStyle(listVideo).zIndex
    }))
    expect(stackingOrder.topNav).toBeGreaterThan(stackingOrder.dropdown)
    expect(stackingOrder.dropdown).toBeGreaterThan(stackingOrder.tabBar)
    expect(stackingOrder.listVideo).toBe('auto')

    await video.locator('.optionsButton').click()
    await video.locator('.addToPlaylistIcon .iconButton').click()
    const thumbnailDropdown = video.locator('.addToPlaylistIcon .iconDropdown')
    await expect(thumbnailDropdown).toBeVisible()
    // A mid-flight opacity fade on the icon would make it a stacking context and
    // trap the dropdown below the tab bar, so let the hover transition settle first
    await expect(video.locator('.addToPlaylistIcon')).toHaveCSS('opacity', '1')
    const dropdownCoversVerticalTabs = await thumbnailDropdown.evaluate((dropdown) => {
      // Stretch the (fixed, so reflow-free) tab bar over the dropdown instead of
      // moving the dropdown: its inline transform belongs to FtIconButton's
      // viewport keeping, which would overwrite ours on its next frame
      const tabBar = document.querySelector('.tabBar.vertical')
      const dropdownRect = dropdown.getBoundingClientRect()
      const previousInlineSize = tabBar.style.inlineSize
      tabBar.style.inlineSize = `${dropdownRect.left + dropdownRect.width / 2}px`

      try {
        const tabBarRect = tabBar.getBoundingClientRect()
        const overlapLeft = Math.max(tabBarRect.left, dropdownRect.left)
        const overlapRight = Math.min(tabBarRect.right, dropdownRect.right)
        if (overlapLeft >= overlapRight) {
          return false
        }

        const elementAtOverlap = document.elementFromPoint(
          overlapLeft + (overlapRight - overlapLeft) / 2,
          Math.max(tabBarRect.top, dropdownRect.top) + 10
        )
        return dropdown.contains(elementAtOverlap)
      } finally {
        tabBar.style.inlineSize = previousInlineSize
      }
    })
    expect(dropdownCoversVerticalTabs).toBe(true)
  })

  test('shows a filled playlist icon when the video is already in a playlist', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await expect(video.locator('.addToPlaylistIcon [data-prefix="fac"][data-icon="playlist-check"]')).toBeVisible()
  })

  test('add to playlist dropdown shows membership and toggles it', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const dropdown = video.locator('.addToPlaylistIcon .iconDropdown')
    const favoritesRow = dropdown.locator('.playlistRow', { hasText: 'Favorites' })
    const savedVideosRow = dropdown.locator('.playlistRow', { hasText: 'Saved videos' })

    // The video is seeded into "Saved videos" but not "Favorites"
    await expect(savedVideosRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect(favoritesRow.locator('[data-prefix="far"][data-icon="bookmark"]')).toBeVisible()
    await expect(favoritesRow.locator('.playlistThumbnail')).toBeVisible()

    // Clicking a row adds the video, keeps the dropdown open and names the playlist in the toast
    await favoritesRow.click()
    await expect(favoritesRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()

    // The toast shows the video's thumbnail, not just the message
    await expect(page.locator('.toast.hasImage .image')).toHaveAttribute('src', /eeeeeeeeeee/)
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])

    // Playlist entries must not carry the attributes the store strips
    const saved = (await readPlaylist(app, 'favorites')).videos[0]
    expect(saved).not.toHaveProperty('description')
    expect(saved).not.toHaveProperty('viewCount')

    // Clicking it again removes the video
    await favoritesRow.click()
    await expect(favoritesRow.locator('[data-prefix="far"][data-icon="bookmark"]')).toBeVisible()
    await expect(page.locator('.toast .message', { hasText: 'Video has been removed from Favorites' })).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(0)
  })

  test('rapidly clicking a playlist row does not add duplicate entries', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })

    // Two activations before the first write can commit must still only add one entry
    await favoritesRow.dblclick()

    await expect(favoritesRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(1)
  })

  test('the dropdown and quick bookmark cannot both add the same video', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })
    await expect(favoritesRow).toBeVisible()

    // "Favorites" is also the quick bookmark target, so activating both controls
    // in the same tick races two adds against the same playlist
    await page.evaluate(() => {
      const listVideo = document.querySelector('.ft-list-video')
      const row = [...listVideo.querySelectorAll('.addToPlaylistIcon .iconDropdown .playlistRow')]
        .find((element) => element.textContent.includes('Favorites'))

      row.click()
      listVideo.querySelector('.quickBookmarkVideoIcon .iconButton').click()
    })

    await expect(video.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(1)
  })

  test('two windows adding the same video only store it once', async ({ app, page }) => {
    const [secondWindow] = await Promise.all([
      app.electronApp.waitForEvent('window'),
      page.locator('.topNav .navNewWindowButton').click()
    ])
    await waitForAppReady(secondWindow)

    // Issue the add both windows' playlist controls make, rather than clicking
    // them: a click is a toggle, so whichever window has already been told about
    // the other's write would remove the video instead of racing to add it.
    const addFromWindow = (window, playlistItemId) => window.evaluate(
      ([action, playlistItemId]) => window.ftElectron.dbPlaylists(action, {
        _id: 'favorites',
        lastUpdatedAt: Date.now(),
        videoData: {
          videoId: 'eeeeeeeeeee',
          playlistItemId,
          title: 'Bookmarkable video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          lengthSeconds: 60,
          published: Date.now(),
          timeAdded: Date.now(),
          type: 'video'
        }
      }),
      [DBActions.PLAYLISTS.UPSERT_VIDEO, playlistItemId]
    )

    const written = await Promise.all([
      addFromWindow(page, 'from-first-window'),
      addFromWindow(secondWindow, 'from-second-window')
    ])

    // Exactly one of them wrote, and the other was told the video was already there
    expect(written.filter((result) => result === PlaylistVideoAddResult.ADDED)).toHaveLength(1)
    expect(written.filter((result) => result === PlaylistVideoAddResult.ALREADY_PRESENT)).toHaveLength(1)

    const favorites = await readPlaylist(app, 'favorites')
    expect(favorites.videos.map((entry) => entry.videoId)).toEqual(['eeeeeeeeeee'])
  })

  test('adding to a playlist that no longer exists is not reported as saved', async ({ page }) => {
    await goTo(page, 'history')

    // A write that changes nothing is ambiguous, so a deleted playlist has to be
    // told apart from the video already being there
    const result = await page.evaluate((action) => window.ftElectron.dbPlaylists(action, {
      _id: 'playlist-deleted-in-another-window',
      lastUpdatedAt: Date.now(),
      videoData: {
        videoId: 'eeeeeeeeeee',
        playlistItemId: 'orphaned',
        title: 'Bookmarkable video',
        author: 'Test Channel',
        authorId: 'UC-test-channel-id',
        lengthSeconds: 60,
        published: Date.now(),
        timeAdded: Date.now(),
        type: 'video'
      }
    }), DBActions.PLAYLISTS.UPSERT_VIDEO)

    expect(result).toBe(PlaylistVideoAddResult.PLAYLIST_MISSING)
  })

  test('creating a playlist from the dropdown puts the video in it', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()
    await video.locator('.addToPlaylistIcon .createRow').click()

    await page.locator('.playlistNameInput input').fill('Cool clips')
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const created = records.filter((record) => record.playlistName === 'Cool clips').at(-1)
      return created?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])
  })

  test('quick bookmark saves the video to the target playlist', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await expect(video.locator('.quickBookmarkVideoIcon [data-icon="clock"]')).toBeVisible()
    await video.locator('.quickBookmarkVideoIcon').click()

    // Once saved, the button keeps the configured icon and indicates state with color.
    await expect(video.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await expect(video.locator('.quickBookmarkVideoIcon [data-icon="clock"]')).toBeVisible()
    await expect(video.locator('.quickBookmarkVideoIcon .overlayIcon')).toHaveCount(0)
    await expect(video.locator('.quickBookmarkVideoIcon .iconButton')).toHaveCSS('color', 'rgb(110, 170, 115)')
    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()

    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])
  })

  test('the options dropdown toggles watched status separately from removing history', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark As Watched' }).click()

    // The watched action changes independently and keeps the history entry.
    await video.hover()
    await video.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Remove From History' })).toBeVisible()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(page.getByText('Bookmarkable video')).toBeVisible()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'eeeeeeeeeee').at(-1)?.isWatched
    }).toBe(false)

    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Remove From History' }).click()

    await expect(page.getByText('Bookmarkable video')).toBeHidden()
    await expect(page.getByText('Your history list is currently empty.')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'eeeeeeeeeee').at(-1)?.$$deleted
    }).toBe(true)
  })
})

test.describe('toast icons', () => {
  test.use({
    seed: {
      ...SEED,
      settings: { ...SEED.settings, thumbnailPreference: 'hidden' }
    }
  })

  test('falls back to an icon when the video has no thumbnail', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })
    await favoritesRow.click()

    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()
    await expect(page.locator('.toast .image')).toBeHidden()
    await expect(page.locator('.toast .icon[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
  })

  test('shows a fitting icon on toasts that have no thumbnail at all', async ({ page }) => {
    await goTo(page, 'history')

    await page.getByRole('button', { name: 'Mark All As Watched' }).click()
    await page.getByRole('button', { name: 'Mark All As Watched', exact: true }).last().click()

    await expect(page.locator('.toast .message', { hasText: 'All videos in your history have been marked as watched' })).toBeVisible()
    await expect(page.locator('.toast .icon[data-prefix="fas"][data-icon="eye"]')).toBeVisible()
  })
})
