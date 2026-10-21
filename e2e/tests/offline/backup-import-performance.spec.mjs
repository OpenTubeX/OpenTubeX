import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { createUnifiedBackup } from '../../../src/renderer/helpers/unifiedBackup.js'

const historyCount = 100_000
const playlistCount = 20_000
const now = Date.now()
const historyRecord = (index, timeWatched) => ({
  _id: `backup-history-${index}`,
  videoId: `backup${String(index).padStart(6, '0')}`,
  title: `Backup performance video ${index}`,
  author: `Channel ${index % 500}`,
  authorId: `UCbackupPerformance${index % 500}`,
  type: 'video',
  lengthSeconds: 600,
  published: now - index * 86_400_000,
  watchProgress: 120,
  isWatched: false,
  timeWatched,
})
const history = Array.from({ length: historyCount }, (_, index) => historyRecord(index, now - index * 60_000))
const playlistVideo = index => ({
  videoId: `backup${String(index).padStart(6, '0')}`,
  title: `Backup performance video ${index}`,
  author: `Channel ${index % 500}`,
  authorId: `UCbackupPerformance${index % 500}`,
  lengthSeconds: 600,
  published: now - index * 86_400_000,
  timeAdded: now - index,
  playlistItemId: `backup-item-${index}`,
  type: 'video',
})
const playlist = {
  _id: 'backup-performance-playlist',
  playlistName: 'Backup performance playlist',
  protected: false,
  description: '',
  createdAt: now,
  lastUpdatedAt: now,
  videos: Array.from({ length: playlistCount }, (_, index) => playlistVideo(index)),
}
// Half of the backup updates saved videos, the other half adds new ones.
const backup = createUnifiedBackup({
  history: Array.from({ length: historyCount }, (_, index) => historyRecord(index + historyCount / 2, now + index)),
  playlists: [{
    ...playlist,
    videos: Array.from({ length: playlistCount }, (_, index) => playlistVideo(index + playlistCount / 2)),
  }],
})

test.use({
  seed: {
    settings: {
      landingPage: 'trending',
      fetchSubscriptionsAutomatically: false,
      enableHomeRecommendations: false,
      historyWatchedStatusMigrated: true,
    },
    history,
    playlists: [playlist],
  },
})

/** Samples the longest frame gap in the window until `stop()` is called. */
function trackFrames(page) {
  return page.evaluate(() => {
    const frames = window.__importFrames = { active: true, last: performance.now(), longest: 0 }
    const sampleFrame = (timestamp) => {
      if (!frames.active) return
      frames.longest = Math.max(frames.longest, timestamp - frames.last)
      frames.last = timestamp
      requestAnimationFrame(sampleFrame)
    }
    requestAnimationFrame(sampleFrame)
  })
}

function stopFrames(page) {
  return page.evaluate(() => {
    const frames = window.__importFrames
    frames.active = false
    return Math.max(frames.longest, performance.now() - frames.last)
  })
}

function waitForText(page, selector, text) {
  return page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)]
    .some(element => element.textContent.includes(text)), { selector, text }, { polling: 250, timeout: 180_000 })
}

async function trackMainEventLoop(app) {
  await app.electronApp.evaluate(() => {
    const { monitorEventLoopDelay } = process.getBuiltinModule('node:perf_hooks')
    globalThis.__importEventLoopDelay?.disable()
    globalThis.__importEventLoopDelay = monitorEventLoopDelay({ resolution: 10 })
    globalThis.__importEventLoopDelay.enable()
  })
  return () => app.electronApp.evaluate(() => {
    globalThis.__importEventLoopDelay.disable()
    return globalThis.__importEventLoopDelay.max / 1e6
  })
}

test('importing a large backup keeps the window and the main process responsive', { tag: '@performance' }, async ({ app, page }) => {
  test.setTimeout(300_000)
  await expect.poll(() => page.evaluate(() => [
    window.$store.getters.getHistoryCacheSorted.length,
    window.$store.getters.getAllPlaylists.find(saved => saved._id === 'backup-performance-playlist')?.videos.length,
  ]), { timeout: 90_000 }).toEqual([historyCount, playlistCount])
  await page.route('https://backup-import.test/backup.zip', async route => route.fulfill({
    status: 200, contentType: 'application/zip', body: Buffer.from(await backup.arrayBuffer())
  }))
  await page.evaluate(async () => {
    const archive = await (await fetch('https://backup-import.test/backup.zip')).blob()
    window.showOpenFilePicker = async () => [{
      getFile: async () => new File([archive], 'large-backup.zip', { type: 'application/zip' }),
    }]
  })
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow'))
  await expect(page.locator('.settingsWindow')).toBeVisible()
  const dataSection = await goToSettingsSection(page, 'data')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  await page.evaluate(() => {
    window.__importToasts = []
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('.toast')) {
        if (!window.__importToasts.includes(toast.textContent)) window.__importToasts.push(toast.textContent)
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  const previewMain = await trackMainEventLoop(app)
  let startedAt = Date.now()
  await trackFrames(page)
  await dataSection.getByRole('button', { name: 'Import backup' }).click()
  const subpage = page.locator('.settingsSubpageContent', { hasText: 'Select the data to import' })
  // Locator assertions snapshot the page on every retry, which itself blocks
  // the busy window, so wait with a plain check instead.
  await waitForText(page, '.settingsSubpageContent', 'large-backup.zip')
  const preview = { elapsed: Date.now() - startedAt, longestFrame: await stopFrames(page), mainDelay: await previewMain() }

  const importMain = await trackMainEventLoop(app)
  startedAt = Date.now()
  await trackFrames(page)
  await subpage.getByRole('button', { name: 'Import selected data' }).click({ timeout: 120_000 })
  // The toast can disappear while the throttled window is busy, so wait for
  // the import to finish instead.
  await page.waitForFunction(() => window.__importToasts.length > 0, null, { polling: 250, timeout: 180_000 })
  const imported = { elapsed: Date.now() - startedAt, longestFrame: await stopFrames(page), mainDelay: await importMain() }
  for (const [type, result] of Object.entries({ 'backup preview': preview, 'backup import': imported })) {
    test.info().annotations.push({
      type,
      description: `elapsed ${result.elapsed} ms, longest renderer frame ${result.longestFrame.toFixed(0)} ms, longest main event-loop delay ${result.mainDelay.toFixed(0)} ms`
    })
  }

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  expect(await page.evaluate(() => window.__importToasts)).toEqual([expect.stringContaining('Backup imported successfully')])
  expect(await page.evaluate(() => [
    window.$store.getters.getHistoryCacheSorted.length,
    window.$store.getters.getAllPlaylists.find(saved => saved._id === 'backup-performance-playlist')?.videos.length,
  ])).toEqual([historyCount * 1.5, playlistCount * 1.5])
  // Comparing every imported playlist video with every saved one froze the
  // window for over half a minute here.
  expect(imported.longestFrame).toBeLessThan(15_000)
})
