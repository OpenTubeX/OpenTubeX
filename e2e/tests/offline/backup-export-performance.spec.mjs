import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { readUnifiedBackup } from '../../../src/renderer/helpers/unifiedBackup.js'

const historyCount = 100_000
const playlistCount = 20_000
const now = Date.now()
const history = Array.from({ length: historyCount }, (_, index) => ({
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
  timeWatched: now - index * 60_000,
}))
const playlist = {
  _id: 'backup-performance-playlist',
  playlistName: 'Backup performance playlist',
  protected: false,
  description: '',
  createdAt: now,
  lastUpdatedAt: now,
  videos: history.slice(0, playlistCount).map((record, index) => ({
    videoId: record.videoId,
    title: record.title,
    author: record.author,
    authorId: record.authorId,
    lengthSeconds: record.lengthSeconds,
    published: record.published,
    timeAdded: now - index,
    playlistItemId: `backup-item-${index}`,
    type: 'video',
  })),
}

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

test('exporting a large library keeps the window and the main process responsive', { tag: '@performance' }, async ({ app, page }) => {
  test.setTimeout(180_000)
  // The first launch imports and loads the whole library.
  await expect.poll(() => page.evaluate(() => [
    window.$store.getters.getHistoryCacheSorted.length,
    window.$store.getters.getAllPlaylists.find(saved => saved._id === 'backup-performance-playlist')?.videos.length,
  ]), { timeout: 90_000 }).toEqual([historyCount, playlistCount])
  // Opened like the /settings route does: the quick settings menu can take
  // seconds to appear while the busy renderer finishes startup work.
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow'))
  await expect(page.locator('.settingsWindow')).toBeVisible()
  const dataSection = await goToSettingsSection(page, 'data')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => {
    // The longest gap between frames from the click until the archive is
    // written. Closing the dialog afterwards is ordinary UI work.
    const frames = window.__exportFrames = { active: false, last: 0, longest: 0 }
    const sampleFrame = (timestamp) => {
      if (!frames.active) return
      frames.longest = Math.max(frames.longest, timestamp - frames.last)
      frames.last = timestamp
      requestAnimationFrame(sampleFrame)
    }
    window.__startExportFrames = () => {
      frames.active = true
      frames.last = performance.now()
      requestAnimationFrame(sampleFrame)
    }
    window.backupArchive = null
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (blob) => {
          frames.longest = Math.max(frames.longest, performance.now() - frames.last)
          frames.active = false
          window.backupArchive = blob
        },
        close: async () => {},
      }),
    })
  })
  await app.electronApp.evaluate(() => {
    const { monitorEventLoopDelay } = process.getBuiltinModule('node:perf_hooks')
    globalThis.__exportEventLoopDelay = monitorEventLoopDelay({ resolution: 10 })
    globalThis.__exportEventLoopDelay.enable()
  })

  await dataSection.getByRole('button', { name: 'Export backup' }).click()
  const exportButton = page.getByRole('button', { name: 'Export selected data' })
  await expect(exportButton).toBeEnabled()
  const startedAt = Date.now()
  await page.evaluate(() => window.__startExportFrames())
  await exportButton.click()
  await expect.poll(() => page.evaluate(() => window.backupArchive?.size ?? 0), { timeout: 120_000 }).toBeGreaterThan(0)
  const elapsed = Date.now() - startedAt

  const mainDelay = await app.electronApp.evaluate(() => {
    globalThis.__exportEventLoopDelay.disable()
    return globalThis.__exportEventLoopDelay.max / 1e6
  })
  const longestFrame = await page.evaluate(() => window.__exportFrames.longest)
  test.info().annotations.push({
    type: 'backup export',
    description: `elapsed ${elapsed} ms, longest renderer frame ${longestFrame.toFixed(0)} ms, longest main event-loop delay ${mainDelay.toFixed(0)} ms`
  })

  const bytes = await page.evaluate(async () => [...new Uint8Array(await window.backupArchive.arrayBuffer())])
  const { data } = await readUnifiedBackup(new Blob([new Uint8Array(bytes)]))
  expect(data.history).toHaveLength(historyCount)
  expect(data.playlists.find(saved => saved._id === playlist._id).videos).toHaveLength(playlistCount)

  // Serializing and compressing this library takes seconds of uninterrupted
  // work, so either process doing it would stall far beyond these limits.
  expect(longestFrame).toBeLessThan(1000)
  expect(mainDelay).toBeLessThan(250)
})
