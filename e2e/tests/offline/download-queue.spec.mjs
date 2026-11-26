import { chmod, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { choosePickerPaths, test, expect, goTo } from '../../helpers/app.mjs'

const PICKER_PATHS = ['ytDlpPath', 'ytDlpDownloadFolderPath', 'ytDlpPlaybackCookiesPath']

async function configureQueue(app, page, values) {
  await choosePickerPaths(app, page, Object.fromEntries(Object.entries(values).filter(([key]) => PICKER_PATHS.includes(key))))
  await page.evaluate(async (settings) => {
    const store = window.$store
    for (const [key, value] of Object.entries(settings)) {
      await store.dispatch(`update${key[0].toUpperCase()}${key.slice(1)}`, value)
    }
  }, Object.fromEntries(Object.entries(values).filter(([key]) => !PICKER_PATHS.includes(key))))
  await page.bringToFront()
  await page.locator('body').click({ position: { x: 1, y: 1 } })
}

async function submitDownloads(page, downloads) {
  const results = []
  for (const download of downloads) {
    let result = null
    await expect.poll(async () => {
      await page.bringToFront()
      result = await page.evaluate(payload => window.ftElectron.ytDlpDownload(payload), download)
      return result !== null
    }).toBe(true)
    results.push(result)
  }
  return results
}

async function clickUntil(page, button, isComplete) {
  await expect.poll(async () => {
    if (await isComplete()) return true
    if (await button.isVisible()) {
      await page.bringToFront()
      await button.click()
    }
    return isComplete()
  }).toBe(true)
}

test('shares one yt-dlp version probe across concurrent downloads and keeps custom runtime opt-outs', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'probed-yt-dlp.sh')
  const probesFile = path.join(app.userDataDir, 'version-probes.txt')
  const argumentsFile = path.join(app.userDataDir, 'probed-arguments.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    `if [ "$1" = "--version" ]; then printf '%s\\n' probe >> '${probesFile}'; sleep 0.5; printf '%s\\n' '2026.08.19'; exit; fi`,
    `printf '%s\\n' "$@" -- >> '${argumentsFile}'`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(app, page, {
    ytDlpPath: executable,
    ytDlpDownloadFolderPath: app.userDataDir,
    ytDlpMaxConcurrentDownloads: 3,
  })

  const results = await page.evaluate(downloads => Promise.all(
    downloads.map(download => window.ftElectron.ytDlpDownload(download))
  ), ['kkkkkkkkkkk', 'lllllllllll', 'mmmmmmmmmmm'].map(videoId => ({ videoId, title: videoId, mode: 'video', customArgs: '--no-js-runtimes' })))
  expect(results.every(result => Number.isInteger(result?.id))).toBe(true)
  expect(await readFile(probesFile, 'utf8')).toBe('probe\n')
  // A custom --no-js-runtimes must come after the automatic runtime so it still disables it.
  await expect.poll(async () => {
    const commands = (await readFile(argumentsFile, 'utf8').catch(() => '')).split('--\n').slice(0, -1)
    return commands.map(command => {
      const lines = command.split('\n')
      return lines.indexOf('--js-runtimes') !== -1 && lines.indexOf('--js-runtimes') < lines.indexOf('--no-js-runtimes')
    })
  }).toEqual([true, true, true])
})

test('downloads a playlist in parallel processes that share the queue limit', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'parallel-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'parallel-starts.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'2026.08.19\'; exit; fi',
    'part=single',
    'previous=',
    'for argument do [ "$previous" = --playlist-items ] && part="$argument"; previous="$argument"; done',
    `printf '%s\\n' "$part" >> '${startsFile}'`,
    'index="$' + '{part%%::*}"',
    'printf \'__OPENTUBEX_PREPARING__:vvvvvvvvvv%s\\t%s\\t2\\t"Video %s"\\n\' "$index" "$index" "$index"',
    'printf \'__OPENTUBEX_DOWNLOAD__:downloading\\t10.0%%\\t1.00MiB/s\\t00:10\\n\'',
    `while [ ! -f "${app.userDataDir}/release-$index" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(app, page, {
    ytDlpPath: executable,
    ytDlpDownloadFolderPath: app.userDataDir,
    ytDlpMaxConcurrentDownloads: 3,
  })

  const [playlist] = await submitDownloads(page, [
    { playlistId: 'PL1234567890', isPlaylist: true, videoCount: 2, title: 'Parallel playlist', mode: 'video' },
    { videoId: 'aaaaaaaaaaa', title: 'Download beside the playlist', mode: 'video' },
    { videoId: 'bbbbbbbbbbb', title: 'Download after the playlist', mode: 'video' },
  ])
  // The playlist takes only the slots its two videos can use, which leaves one for the next download.
  await expect.poll(async () => (await readFile(startsFile, 'utf8').catch(() => '')).split('\n').sort())
    .toEqual(['', '1::2', '2::2', 'single'])

  await goTo(page, 'downloads')
  const row = page.locator('.downloadRow').filter({ hasText: 'Parallel playlist' })
  await expect(row).toContainText('Video 1 of 2')
  await expect(row).toContainText('2.00MiB/s')
  // Each video that downloads at the same time shows its own progress
  await expect(row.locator('.activeVideo')).toHaveText([/^1 • Video 1\s*10\.0%$/, /^2 • Video 2\s*10\.0%$/])

  await writeFile(path.join(app.userDataDir, 'release-1'), '')
  await expect(row).toContainText('Video 2 of 2')
  await expect(row).toContainText('1.00MiB/s')
  await expect(row.locator('.activeVideo')).toHaveCount(0)
  // The finished part frees its slot for the next queued download.
  await expect.poll(async () => (await readFile(startsFile, 'utf8')).split('\n').filter(part => part === 'single').length).toBe(2)
  expect(await page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
  ), playlist.id)).toBe('downloading')

  await writeFile(path.join(app.userDataDir, 'release-2'), '')
  await expect.poll(() => page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
  ), playlist.id)).toBe('completed')
  await writeFile(path.join(app.userDataDir, 'release-single'), '')
})

test.describe('playlist video selection', () => {
  test.use({
    seed: {
      playlists: [{
        _id: 'selection-playlist',
        playlistName: 'Selection playlist',
        description: '',
        protected: false,
        createdAt: 1700000000000,
        lastUpdatedAt: 1700000000000,
        videos: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((videoId, index) => ({
          videoId, playlistItemId: `selection-${index}`, title: `Video ${index + 1}`, author: 'Channel', lengthSeconds: 60, type: 'video'
        }))
      }]
    }
  })

  test('downloads only the selected videos and keeps their playlist positions', async ({ app, page }) => {
    await page.evaluate(() => window.$store.dispatch('updateEnableDownloads', true))
    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.selectionDownloadPayloads = []
      ipcMain.removeHandler('yt-dlp-download')
      ipcMain.handle('yt-dlp-download', (_event, payload) => {
        globalThis.selectionDownloadPayloads.push(payload)
        return null
      })
    })
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Selection playlist', exact: true }).click()
    await page.getByTitle('Download Playlist').click()
    await page.getByRole('menuitem', { name: 'Customize…', exact: true }).click()
    const prompt = page.locator('.downloadPromptCard')
    const download = prompt.getByRole('button', { name: 'Download', exact: true })
    const selection = prompt.locator('.videoSelection')
    await expect(selection.locator('summary')).toHaveText(/\b3\b.*\b3\b/)
    await selection.locator('summary').click()

    const toggle = name => selection.getByText(name, { exact: true }).click()
    await toggle('Select all')
    await expect(selection.getByRole('checkbox', { checked: true })).toHaveCount(0)
    await expect(download).toBeDisabled()
    await toggle('Select all')
    await toggle('2. Video 2')
    await expect(selection.getByRole('checkbox', { name: 'Select all' })).not.toBeChecked()
    await expect(selection.locator('summary')).toHaveText(/\b2\b.*\b3\b/)
    await download.click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.selectionDownloadPayloads.length)).toBe(1)
    const payload = await app.electronApp.evaluate(() => globalThis.selectionDownloadPayloads[0])
    expect(payload).toMatchObject({ isPlaylist: true, videoIds: ['aaaaaaaaaaa', 'ccccccccccc'], playlistIndexes: [1, 3] })
    expect(payload.videoCount).toBeUndefined()

    // Selecting every video again downloads the whole playlist
    await toggle('2. Video 2')
    await download.click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.selectionDownloadPayloads.length)).toBe(2)
    const whole = await app.electronApp.evaluate(() => globalThis.selectionDownloadPayloads[1])
    expect(whole.videoIds).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
    expect(whole.playlistIndexes).toBeUndefined()
  })
})

test('controls queue order, running jobs, bandwidth, and retry-all', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'queued-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'queue-starts.txt')
  const failureMarker = path.join(app.userDataDir, 'failed-once')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'2026.08.19\'; exit; fi',
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `printf '%s\\n' "$@" > "${app.userDataDir}/args-$id.txt"`,
    `if [ "$id" = 'ddddddddddd' ] && [ ! -f '${failureMarker}' ]; then`,
    `  touch '${failureMarker}'`,
    '  exit 1',
    'fi',
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(app, page, {
    ytDlpPath: executable,
    ytDlpDownloadFolderPath: app.userDataDir,
    ytDlpMaxConcurrentDownloads: 1,
    ytDlpDownloadBandwidthLimit: '900',
  })

  const payloads = [
    { videoId: 'aaaaaaaaaaa', title: 'First queued download', mode: 'video' },
    { videoId: 'bbbbbbbbbbb', title: 'Second queued download', mode: 'video' },
    { videoId: 'ccccccccccc', title: 'Moved queue download', mode: 'video' },
    { videoId: 'ddddddddddd', title: 'Retry-all download', mode: 'video' },
    { videoId: 'jjjjjjjjjjj', title: 'Canceled download', mode: 'video' },
  ]
  const results = await submitDownloads(page, payloads)
  expect(results.every(result => Number.isInteger(result?.id))).toBe(true)
  await expect.poll(() => readFile(startsFile, 'utf8').catch(() => '')).toBe('aaaaaaaaaaa\n')
  await expect.poll(async () => (
    (await readdir(app.userDataDir)).filter(name => name.startsWith('.opentubex-download-')).length
  )).toBe(1)

  await goTo(page, 'downloads')
  const first = page.locator('.downloadRow').filter({ hasText: 'First queued download' })
  const second = page.locator('.downloadRow').filter({ hasText: 'Second queued download' })
  const moved = page.locator('.downloadRow').filter({ hasText: 'Moved queue download' })
  const canceled = page.locator('.downloadRow').filter({ hasText: 'Canceled download' })
  await expect(first).toContainText('Preparing…')
  await expect(second).toContainText(/Queued, position/)
  await clickUntil(page, moved.getByTitle('Move earlier'), async () => (
    (await moved.textContent()).includes('Queued, position 1')
  ))
  await expect(second.getByTitle('Move later')).toBeVisible()
  await clickUntil(page, canceled.getByTitle('Cancel Download'), () => (
    page.getByRole('heading', { name: 'Canceled', exact: true }).isVisible()
  ))
  await expect(canceled).not.toContainText('Download canceled')

  await clickUntil(page, page.getByRole('button', { name: 'Pause all' }), async () => (
    (await first.textContent()).includes('Paused') && (await second.textContent()).includes('Paused')
  ))
  await expect(first).toContainText('Paused')
  await expect(second).toContainText('Paused')
  await clickUntil(page, moved.getByTitle('Resume Download'), async () => (
    (await moved.textContent()).includes('Queued, position 1')
  ))
  const [submittedWhilePaused] = await submitDownloads(page, [
    { videoId: 'mmmmmmmmmmm', title: 'Submitted while paused', mode: 'video' },
  ])
  await expect.poll(() => page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
  ), submittedWhilePaused.id)).toBe('paused')
  const submittedWhilePausedRow = page.locator('.downloadRow').filter({ hasText: 'Submitted while paused' })
  await clickUntil(page, submittedWhilePausedRow.getByTitle('Cancel Download'), async () => (
    (await page.evaluate(async id => (
      (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    ), submittedWhilePaused.id)) === 'cancelled'
  ))
  await clickUntil(page, page.getByRole('button', { name: 'Resume all' }), async () => (
    (await first.textContent()).includes('Preparing…')
  ))

  await writeFile(path.join(app.userDataDir, 'release-aaaaaaaaaaa'), '')
  await expect.poll(() => readFile(startsFile, 'utf8')).toBe('aaaaaaaaaaa\nccccccccccc\n')
  const movedDownloadArgs = (await readFile(path.join(app.userDataDir, 'args-ccccccccccc.txt'), 'utf8')).split('\n')
  const rateIndex = movedDownloadArgs.indexOf('--limit-rate')
  expect(movedDownloadArgs[rateIndex + 1]).toBe('900K')

  await writeFile(path.join(app.userDataDir, 'release-ccccccccccc'), '')
  await expect.poll(() => readFile(startsFile, 'utf8')).toContain('bbbbbbbbbbb')
  await writeFile(path.join(app.userDataDir, 'release-bbbbbbbbbbb'), '')
  await expect.poll(() => readFile(startsFile, 'utf8')).toContain('ddddddddddd')
  await expect(page.locator('.downloadRow').filter({ hasText: 'Retry-all download' })).toContainText('Download failed')

  await clickUntil(page, page.getByRole('button', { name: 'Retry all failed downloads' }), async () => (
    /ddddddddddd\nddddddddddd\n$/.test(await readFile(startsFile, 'utf8'))
  ))
  await expect.poll(() => page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
  ), results[4].id)).toBe('cancelled')
  await writeFile(path.join(app.userDataDir, 'release-ddddddddddd'), '')
  await expect.poll(() => page.evaluate(async () => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.title === 'Retry-all download')?.status
  ))).toBe('completed')
  const completed = page.locator('.downloadRow').filter({ hasText: 'Retry-all download' })
  await expect(completed).not.toContainText('Download complete')
  // The bell keeps what became of downloads the user started, once for every
  // tab, without the failure the retry replaced.
  await expect.poll(() => page.evaluate(async () => (await window.ftElectron.notificationHistory.list())
    .filter(entry => entry.body.includes('Retry-all download')).map(entry => entry.kind))).toStrictEqual(['download-completed'])
})

test('clears pause-all after every download is individually resumed', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'individual-resume-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'individual-resume-starts.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'2026.08.19\'; exit; fi',
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(app, page, { ytDlpPath: executable, ytDlpMaxConcurrentDownloads: 1 })

  const [active, pending] = await submitDownloads(page, [
    { videoId: 'rrrrrrrrrrr', title: 'Individually resumed active download', mode: 'video' },
    { videoId: 'sssssssssss', title: 'Individually resumed pending download', mode: 'video' },
  ])
  await expect.poll(() => readFile(startsFile, 'utf8').catch(() => '')).toBe('rrrrrrrrrrr\n')

  await expect.poll(async () => {
    await page.bringToFront()
    return page.evaluate(() => window.ftElectron.ytDlpQueueAction('pause-all'))
  }).toBe(true)
  await expect.poll(() => page.evaluate(async ids => (
    (await window.ftElectron.ytDlpListDownloads())
      .filter(download => ids.includes(download.id))
      .map(download => download.status)
  ), [active.id, pending.id])).toEqual(['paused', 'paused'])

  for (const download of [active, pending]) {
    await expect.poll(async () => {
      await page.bringToFront()
      return page.evaluate(id => window.ftElectron.ytDlpControlDownload(id, 'resume'), download.id)
    }).toBe(true)
  }

  const [submittedAfterResume] = await submitDownloads(page, [
    { videoId: 'ttttttttttt', title: 'Submitted after individual resumes', mode: 'video' },
  ])
  await expect.poll(() => page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
  ), submittedAfterResume.id)).toBe('queued')

  for (const videoId of ['rrrrrrrrrrr', 'sssssssssss', 'ttttttttttt']) {
    await writeFile(path.join(app.userDataDir, `release-${videoId}`), '')
    await expect.poll(() => readFile(startsFile, 'utf8')).toContain(`${videoId}\n`)
  }
})

test('keeps the unsupported active-pause fallback resumable', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'fallback-pause-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'fallback-pause-starts.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'2026.08.19\'; exit; fi',
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(app, page, { ytDlpPath: executable, ytDlpMaxConcurrentDownloads: 1 })

  const originalPlatform = await app.electronApp.evaluate(() => process.platform)
  async function pauseWithoutProcessSupport(id) {
    await app.electronApp.evaluate((_electron, platform) => {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    }, 'win32')
    try {
      await expect.poll(async () => {
        await page.bringToFront()
        return page.evaluate(downloadId => window.ftElectron.ytDlpControlDownload(downloadId, 'pause'), id)
      }).toBe(true)
    } finally {
      await app.electronApp.evaluate((_electron, platform) => {
        Object.defineProperty(process, 'platform', { configurable: true, value: platform })
      }, originalPlatform)
    }
  }

  const [active] = await submitDownloads(page, [
    { videoId: 'kkkkkkkkkkk', title: 'Fallback active download', mode: 'video' },
  ])
  await expect.poll(() => readFile(startsFile, 'utf8').catch(() => '')).toBe('kkkkkkkkkkk\n')

  await pauseWithoutProcessSupport(active.id)
  await expect.poll(async () => {
    await page.bringToFront()
    return page.evaluate(id => window.ftElectron.ytDlpControlDownload(id, 'resume'), active.id)
  }).toBe(true)
  const resumedVideoId = 'nnnnnnnnnnn'
  const [resumedPending] = await submitDownloads(page, [
    { videoId: resumedVideoId, title: 'Pending after fallback resume', mode: 'video' },
  ])
  await expect.poll(() => page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
  ), resumedPending.id)).toBe('queued')

  await writeFile(path.join(app.userDataDir, 'release-kkkkkkkkkkk'), '')
  await expect.poll(() => readFile(startsFile, 'utf8')).toContain(`${resumedVideoId}\n`)
  await writeFile(path.join(app.userDataDir, `release-${resumedVideoId}`), '')

  const [resumeAllActive] = await submitDownloads(page, [
    { videoId: 'ppppppppppp', title: 'Resume-all fallback download', mode: 'video' },
  ])
  await expect.poll(() => readFile(startsFile, 'utf8')).toContain('ppppppppppp\n')
  await pauseWithoutProcessSupport(resumeAllActive.id)
  await goTo(page, 'downloads')
  await clickUntil(page, page.getByRole('button', { name: 'Resume all' }), async () => (
    (await page.evaluate(async id => (
      (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    ), resumeAllActive.id)) === 'preparing'
  ))
  await writeFile(path.join(app.userDataDir, 'release-ppppppppppp'), '')

  const [completedPause] = await submitDownloads(page, [
    { videoId: 'ooooooooooo', title: 'Completed fallback pause', mode: 'video' },
  ])
  await expect.poll(() => readFile(startsFile, 'utf8')).toContain('ooooooooooo\n')
  await pauseWithoutProcessSupport(completedPause.id)
  await writeFile(path.join(app.userDataDir, 'release-ooooooooooo'), '')
  await expect.poll(() => page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
  ), completedPause.id)).toBe('completed')

  await submitDownloads(page, [
    { videoId: 'lllllllllll', title: 'Fallback paused download', mode: 'video' },
  ])
  await goTo(page, 'downloads')
  const paused = page.locator('.downloadRow').filter({ hasText: 'Fallback paused download' })
  await expect(paused).toContainText('Paused')
  await clickUntil(page, page.getByRole('button', { name: 'Resume all' }), async () => (
    (await readFile(startsFile, 'utf8').catch(() => '')).endsWith('lllllllllll\n')
  ))
  await writeFile(path.join(app.userDataDir, 'release-lllllllllll'), '')
})

test('keeps paused downloads queued across a restart', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'persisted-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'persisted-starts.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'2026.08.19\'; exit; fi',
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)

  await configureQueue(app, page, {
    ytDlpPath: executable,
    ytDlpMaxConcurrentDownloads: 1,
  })
  const queued = await submitDownloads(page, [
    { videoId: 'eeeeeeeeeee', title: 'Persisted queue one', mode: 'video' },
    { videoId: 'fffffffffff', title: 'Persisted queue two', mode: 'video' },
  ])
  await expect.poll(() => readFile(startsFile, 'utf8').catch(() => '')).toBe('eeeeeeeeeee\n')
  await expect.poll(async () => {
    await page.bringToFront()
    return page.evaluate(id => window.ftElectron.ytDlpControlDownload(id, 'pause'), queued[1].id)
  }).toBe(true)
  await expect.poll(() => page.evaluate(async () => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.title === 'Persisted queue two')?.status
  ))).toBe('paused')
  await writeFile(path.join(app.userDataDir, 'release-eeeeeeeeeee'), '')
  await expect.poll(() => page.evaluate(async () => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.title === 'Persisted queue one')?.status
  ))).toBe('completed')

  ;({ page } = await app.relaunch())
  await expect.poll(() => readFile(startsFile, 'utf8').catch(() => '')).toBe('eeeeeeeeeee\n')
  await goTo(page, 'downloads')
  const paused = page.locator('.downloadRow').filter({ hasText: 'Persisted queue two' })
  await expect(paused).toContainText('Paused')
  await clickUntil(page, page.getByRole('button', { name: 'Resume all' }), async () => (
    await readFile(startsFile, 'utf8').catch(() => '') === 'eeeeeeeeeee\nfffffffffff\n'
  ))
  await writeFile(path.join(app.userDataDir, 'release-fffffffffff'), '')
})

test.describe('persisted queue with downloads disabled', () => {
  const persistedDownload = {
    id: 1,
    videoId: 'qqqqqqqqqqq',
    title: 'Disabled persisted download',
    mode: 'video',
    template: '',
    retryPayload: { videoId: 'qqqqqqqqqqq', title: 'Disabled persisted download', mode: 'video' },
    status: 'queued',
    queuePosition: 1,
    percent: 0,
    speed: null,
    eta: null,
    destination: null,
    destinations: [],
    files: [],
    errorMessage: null,
  }
  test.use({ seed: { settings: { enableDownloads: false }, downloads: [persistedDownload] } })

  test('keeps persisted downloads queued while downloads are disabled', async ({ page }) => {
    await expect.poll(() => page.evaluate(async id => {
      const downloads = await window.ftElectron.ytDlpListDownloads()
      return downloads.find(download => download.id === id)
    }, persistedDownload.id)).toMatchObject({ status: 'queued', errorMessage: null })
  })
})

test('checks destination space before starting a download', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'space-check-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'space-check-starts.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'2026.08.19\'; exit; fi',
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(app, page, { ytDlpPath: executable, ytDlpMaxConcurrentDownloads: 1 })

  const [oversized] = await submitDownloads(page, [{
    videoId: 'ggggggggggg',
    title: 'Known oversized download',
    mode: 'video',
    estimatedSizeBytes: Number.MAX_SAFE_INTEGER,
  }])
  await expect.poll(() => page.evaluate(async id => (
    (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.errorMessage
  ), oversized.id)).toBe('INSUFFICIENT_SPACE')
  expect(await readFile(startsFile, 'utf8').catch(() => '')).toBe('')

  await submitDownloads(page, [{ videoId: 'hhhhhhhhhhh', title: 'Unknown size download', mode: 'video' }])
  await expect.poll(() => readFile(startsFile, 'utf8').catch(() => '')).toBe('hhhhhhhhhhh\n')
  await goTo(page, 'downloads')
  await expect(page.locator('.downloadRow').filter({ hasText: 'Unknown size download' })).toContainText('Download size is unknown')
  await writeFile(path.join(app.userDataDir, 'release-hhhhhhhhhhh'), '')
})

test('uses cookies for downloads only when Downloads is chosen', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'cookie-yt-dlp.sh')
  const argumentsFile = path.join(app.userDataDir, 'cookie-arguments.txt')
  const cookies = path.join(app.userDataDir, 'session.txt')
  const passedCookies = path.join(app.userDataDir, 'passed-cookies.txt')
  const session = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t4102444800\tSID\tsession\n'
  await writeFile(cookies, session)
  // The cookie file is a copy that is removed after yt-dlp exits.
  await writeFile(executable, [
    '#!/bin/sh',
    'previous=',
    `for argument do [ "$previous" = --cookies ] && cp "$argument" '${passedCookies}'; previous="$argument"; done`,
    `printf '%s\\n' "$@" > '${argumentsFile}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(app, page, {
    enableDownloads: true,
    ytDlpSource: 'system',
    ytDlpPath: executable,
    ytDlpFfmpegSource: 'system',
    ytDlpPlaybackAuthMode: 'file',
    ytDlpPlaybackCookiesPath: cookies
  })
  for (const [uses, mode] of [[[], 'file'], [['playback', 'subtitles'], 'file'], [['downloads'], 'file'], [['downloads'], 'none']]) {
    const enabled = uses.includes('downloads')
    await configureQueue(app, page, { ytDlpCookieUses: uses, ytDlpPlaybackAuthMode: mode })
    await writeFile(argumentsFile, '')
    await submitDownloads(page, [{ videoId: 'iiiiiiiiiii', title: 'Cookie download', mode: 'video' }])
    await expect.poll(async () => (await readFile(argumentsFile, 'utf8')).includes('https://www.youtube.com/watch?v=iiiiiiiiiii')).toBe(true)
    const args = (await readFile(argumentsFile, 'utf8')).trim().split('\n')
    expect(args.includes('--cookies')).toBe(enabled && mode === 'file')
    if (enabled && mode === 'file') {
      expect(args[args.indexOf('--cookies') + 1]).not.toBe(cookies)
      expect(await readFile(passedCookies, 'utf8')).toBe(session)
    }
  }
  await configureQueue(app, page, { ytDlpPlaybackAuthMode: 'file', ytDlpCookieUses: ['downloads'] })
  await writeFile(argumentsFile, '')
  await submitDownloads(page, [{ externalUrl: 'http://example.org/video.mp4', title: 'External download', mode: 'video' }])
  await expect.poll(async () => (await readFile(argumentsFile, 'utf8')).includes('http://example.org/video.mp4')).toBe(true)
  expect((await readFile(argumentsFile, 'utf8')).trim().split('\n')).not.toContain('--cookies')
  await configureQueue(app, page, { ytDlpPlaybackAuthMode: 'browser', ytDlpPlaybackCookiesBrowser: 'firefox' })
  await writeFile(argumentsFile, '')
  await submitDownloads(page, [{ externalUrl: 'https://example.org/video.mp4', title: 'External browser download', mode: 'video' }])
  await expect.poll(async () => (await readFile(argumentsFile, 'utf8')).includes('https://example.org/video.mp4')).toBe(true)
  expect((await readFile(argumentsFile, 'utf8')).trim().split('\n')).not.toContain('--cookies-from-browser')
})
