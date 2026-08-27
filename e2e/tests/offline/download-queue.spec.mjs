import { chmod, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo } from '../../helpers/app.mjs'

async function configureQueue(page, values) {
  await page.evaluate(async (settings) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (const [key, value] of Object.entries(settings)) {
      await store.dispatch(`update${key[0].toUpperCase()}${key.slice(1)}`, value)
    }
  }, values)
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

test('opens downloads with the default shortcut', async ({ page }) => {
  const downloads = page.getByRole('dialog', { name: 'Downloads', exact: true })
  await expect.poll(async () => {
    if (await downloads.isVisible()) return true
    await page.bringToFront()
    await page.keyboard.press('Control+J')
    return downloads.isVisible()
  }).toBe(true)
  await expect(downloads).toBeVisible()
})

test('separates canceled downloads without offering retry-all', async ({ page }) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('upsertYtDlpDownload', {
      id: 999,
      title: 'Canceled queue download',
      mode: 'video',
      status: 'cancelled',
      retryPayload: { videoId: 'iiiiiiiiiii', title: 'Canceled queue download', mode: 'video' },
      destinations: [],
      files: [],
    })
  })

  await goTo(page, 'downloads')
  await expect(page.getByRole('button', { name: 'Retry all failed downloads' })).toHaveCount(0)
  const canceledSection = page.locator('.downloadSection').filter({
    has: page.getByRole('heading', { name: 'Canceled', exact: true })
  })
  await expect(canceledSection).toContainText('Canceled queue download')
  await expect(canceledSection).not.toContainText('Download canceled')
  await expect(page.getByRole('heading', { name: 'Downloaded', exact: true })).toHaveCount(0)
})

test('controls queue order, running jobs, bandwidth, and retry-all', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'queued-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'queue-starts.txt')
  const failureMarker = path.join(app.userDataDir, 'failed-once')
  await writeFile(executable, [
    '#!/bin/sh',
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
  await configureQueue(page, {
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
  await expect(first).toContainText('0.0%')
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
    (await first.textContent()).includes('0.0%')
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
})

test('clears pause-all after every download is individually resumed', async ({ app, page }) => {
  const executable = path.join(app.userDataDir, 'individual-resume-yt-dlp.sh')
  const startsFile = path.join(app.userDataDir, 'individual-resume-starts.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(page, { ytDlpPath: executable, ytDlpMaxConcurrentDownloads: 1 })

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
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(page, { ytDlpPath: executable, ytDlpMaxConcurrentDownloads: 1 })

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
    ), resumeAllActive.id)) === 'downloading'
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
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)

  await configureQueue(page, {
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
    'for argument do case "$argument" in https://www.youtube.com/watch?v=*) url="$argument" ;; esac; done',
    'id="$' + '{url##*=}"',
    `printf '%s\\n' "$id" >> '${startsFile}'`,
    `while [ ! -f "${app.userDataDir}/release-$id" ]; do sleep 0.05; done`,
  ].join('\n'))
  await chmod(executable, 0o755)
  await configureQueue(page, { ytDlpPath: executable, ytDlpMaxConcurrentDownloads: 1 })

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
