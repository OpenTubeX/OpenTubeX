import { chmod, readFile, writeFile } from 'node:fs/promises'
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
  return page.evaluate((payloads) => Promise.all(payloads.map(payload => window.ftElectron.ytDlpDownload(payload))), downloads)
}

test('opens downloads with the default shortcut', async ({ page }) => {
  await page.keyboard.press('Control+J')
  await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
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

  await goTo(page, 'downloads')
  const first = page.locator('.downloadRow').filter({ hasText: 'First queued download' })
  const second = page.locator('.downloadRow').filter({ hasText: 'Second queued download' })
  const moved = page.locator('.downloadRow').filter({ hasText: 'Moved queue download' })
  const canceled = page.locator('.downloadRow').filter({ hasText: 'Canceled download' })
  await expect(first).toContainText('0.0%')
  await expect(second).toContainText(/Queued, position/)
  await moved.getByTitle('Move earlier').click()
  await expect(moved).toContainText('Queued, position 1')
  await expect(second.getByTitle('Move later')).toBeVisible()
  await canceled.getByTitle('Cancel Download').click()
  await expect(canceled).not.toContainText('Download canceled')
  await expect(page.getByRole('heading', { name: 'Canceled', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Pause all' }).click()
  await expect(first).toContainText('Paused')
  await expect(second).toContainText('Paused')
  await page.getByRole('button', { name: 'Resume all' }).click()
  await expect(first).toContainText('0.0%')

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

  await page.getByRole('button', { name: 'Retry all failed downloads' }).click()
  await expect.poll(() => readFile(startsFile, 'utf8')).toMatch(/ddddddddddd\nddddddddddd\n$/)
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
  await page.evaluate(id => window.ftElectron.ytDlpControlDownload(id, 'pause'), queued[1].id)
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
  await page.getByRole('button', { name: 'Resume all' }).click()
  await expect.poll(() => readFile(startsFile, 'utf8').catch(() => '')).toBe('eeeeeeeeeee\nfffffffffff\n')
  await writeFile(path.join(app.userDataDir, 'release-fffffffffff'), '')
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
