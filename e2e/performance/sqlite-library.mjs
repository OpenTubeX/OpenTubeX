import assert from 'node:assert/strict'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, homedir, loadavg, release, totalmem } from 'node:os'
import path from 'node:path'
import { createUserDataDir, launchApp, expect, goTo, goToSettingsSection, repoRoot } from '../helpers/app.mjs'

// Run after packing both checkouts, under a private X server. Profiles are
// synthetic; caches are warm and not flushed. Migration is measured separately.
const baselineRoot = path.resolve(process.argv[2] ?? '/tmp/opentubex1841-baseline')
const counts = process.argv.slice(3).map(Number)
if (!counts.length) counts.push(0, 100000, 1000000)
const samples = Number(process.env.LIBRARY_BENCH_SAMPLES ?? 7)
assert.ok(Number.isSafeInteger(samples) && samples > 0)
assert.ok(counts.every(count => Number.isSafeInteger(count) && count >= 0))
const parentDirectory = path.join(homedir(), '.cache', 'opentubex-library-benchmarks')
await mkdir(parentDirectory, { recursive: true })
const output = {
  node: process.version,
  platform: process.platform,
  machine: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: totalmem() / 1073741824, release: release(), uiScale: 95 },
  samples,
  warmups: 1,
  baselineRoot,
  candidateRoot: repoRoot,
  datasets: [],
  boundaries: 'Warm OS caches; startup includes process/worker creation through 100 rendered history cards. Timer gaps start when automation attaches. IPC sizes are UTF-8 JSON equivalents, measured after wall timing. Backup discards output without retaining bytes; PSS is Linux smaps_rollup after renderer GC. Migration and synthetic seeding excluded from steady startup.'
}
const profiles = []
const percentile = (values, quantile) => values.length ? values.toSorted((a, b) => a - b)[Math.ceil(values.length * quantile) - 1] : 0
const median = values => percentile(values, 0.5)

function record(index) {
  return {
    _id: `h${String(index).padStart(10, '0')}`,
    videoId: `v${String(index).padStart(10, '0')}`,
    title: `Practical troubleshooting episode ${index}`,
    author: `Example channel ${index % 100}`,
    authorId: `channel-${index % 100}`,
    type: 'video',
    lengthSeconds: 300,
    watchProgress: index % 300,
    isWatched: index % 2 === 0,
    timeWatched: 1600000000000 + index
  }
}

async function profile(count) {
  const directory = await createUserDataDir({
    settings: {
      landingPage: 'history',
      historyWatchedStatusMigrated: true,
      uiScale: 95,
      generalAutoLoadMorePaginatedItemsEnabled: false,
      enableHomeRecommendations: false,
      subscriptionsAutoFetch: false,
      rememberHistory: true,
      historyRetentionDays: 0
    },
    watchStats: [{ _id: 'history-watch-time-v1' }]
  }, parentDirectory)
  profiles.push(directory)
  const file = await open(path.join(directory, 'history.db'), 'w', 0o600)
  try {
    for (let offset = 0; offset < count; offset += 1000) {
      await file.write(Array.from({ length: Math.min(1000, count - offset) }, (_, index) => JSON.stringify(record(offset + index))).join('\n') + '\n')
    }
  } finally { await file.close() }
  if (count) {
    await writeFile(path.join(directory, 'playlists.db'), JSON.stringify({
      _id: 'large',
      playlistName: 'Large benchmark playlist',
      protected: false,
      createdAt: 1,
      lastUpdatedAt: 1,
      videos: Array.from({ length: 20000 }, (_, index) => ({ ...record(index), playlistItemId: `member-${index}`, timeAdded: index })),
    }) + '\n')
  }
  return directory
}

function startRendererMetrics() {
  const metric = { gaps: [], previous: performance.now() }
  metric.timer = setInterval(() => { const now = performance.now(); metric.gaps.push(now - metric.previous); metric.previous = now }, 5)
  window.__libraryBench = metric
}

async function startMainMetrics(app) {
  await app.evaluate(() => {
    const metric = { gaps: [], previous: performance.now() }
    metric.timer = setInterval(() => { const now = performance.now(); metric.gaps.push(now - metric.previous); metric.previous = now }, 5)
    globalThis.__libraryBench = metric
  })
}

async function stopMetrics(app, page) {
  const main = await app.evaluate(() => {
    const metric = globalThis.__libraryBench
    clearInterval(metric.timer)
    metric.gaps.push(performance.now() - metric.previous)
    return metric.gaps
  })
  const renderer = await page.evaluate(() => {
    const metric = window.__libraryBench
    clearInterval(metric.timer)
    if (!metric.stopped) metric.gaps.push(performance.now() - metric.previous)
    return metric.gaps
  })
  return { mainMaxGapMs: Math.max(...main), mainP95GapMs: percentile(main, 0.95), rendererMaxGapMs: Math.max(...renderer), rendererP95GapMs: percentile(renderer, 0.95) }
}

async function memory(app, page) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('HeapProfiler.collectGarbage')
    await cdp.send('Performance.enable')
    const { metrics } = await cdp.send('Performance.getMetrics')
    const heapBytes = metrics.find(metric => metric.name === 'JSHeapUsedSize').value
    const pids = await app.evaluate(({ app }) => app.getAppMetrics().map(metric => metric.pid))
    let pssKiB = 0
    for (const pid of pids) {
      try { pssKiB += Number((await readFile(`/proc/${pid}/smaps_rollup`, 'utf8')).match(/^Pss:\s+(\d+)/m)?.[1] ?? 0) } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error }
    }
    return { rendererHeapMiB: heapBytes / 1048576, processPssMiB: pssKiB / 1024 }
  } finally { await cdp.detach() }
}

async function collect(target, directory, count, { tabs = false } = {}) {
  let app
  const systemLoadAverage = loadavg()
  const started = performance.now()
  try {
    const launched = await launchApp(directory, ['--js-flags=--expose-gc'], {
      appRoot: target.root,
      startupTimeoutMs: 600000,
      onPhase: async (phase, page, electronApp) => {
        if (phase === 'electronConnected') { app = electronApp; await startMainMetrics(app) }
        if (phase === 'windowCreated') await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '{}' }))
        if (phase === 'routeCommitted') await page.evaluate(startRendererMetrics)
      }
    })
    const page = launched.page
    await expect(page).toHaveURL(/#\/history/)
    if (count) await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(100, { timeout: 60000 })
    const startupMs = performance.now() - started
    const startup = { startupMs, ...await stopMetrics(app, page), ...await memory(app, page) }
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      await tutorial.locator('.tutorialActions').getByRole('button').last().click()
      await expect(tutorial).toBeHidden()
    }

    await startMainMetrics(app)
    await page.evaluate(startRendererMetrics)
    const query = await page.evaluate(async candidate => {
      const start = performance.now()
      const result = candidate ? await window.ftElectron.libraryQuery('historyPage', { limit: 50 }) : await window.ftElectron.dbHistory(1)
      const elapsedMs = performance.now() - start
      window.__libraryBench.gaps.push(performance.now() - window.__libraryBench.previous)
      clearInterval(window.__libraryBench.timer)
      window.__libraryBench.stopped = true
      return {
        elapsedMs,
        jsonBytes: new TextEncoder().encode(JSON.stringify(result)).length,
        retainedRows: document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history.historyCacheSorted.length
      }
    }, target.name === 'candidate')
    const queryGaps = await stopMetrics(app, page)
    const section = await goToSettingsSection(page, 'data')
    await page.evaluate(() => {
      window.__libraryBackup = { bytes: 0, done: false }
      window.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async data => { window.__libraryBackup.bytes += data.byteLength ?? data.size ?? new TextEncoder().encode(data).length },
          close: async () => { window.__libraryBackup.done = true },
          abort: async () => { throw new Error('Backup aborted') },
        })
      })
    })
    await startMainMetrics(app)
    await page.evaluate(startRendererMetrics)
    const exportStarted = performance.now()
    await section.getByRole('button', { name: 'Export backup' }).click()
    await expect.poll(() => page.evaluate(() => window.__libraryBackup.done), { timeout: 180000 }).toBe(true)
    const backup = {
      elapsedMs: performance.now() - exportStarted,
      ...await stopMetrics(app, page),
      bytes: await page.evaluate(() => window.__libraryBackup.bytes)
    }
    let twentyTabs
    if (tabs) {
      await page.keyboard.press('Escape')
      await goTo(page, 'history')
      for (let index = 1; index < 20; index++) {
        await page.locator('.newTabButton').click()
        await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(100)
      }
      twentyTabs = await memory(app, page)
    }
    return { startup, query: { ...query, ...queryGaps }, backup, twentyTabs, systemLoadAverage, runtime: await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite })) }
  } finally { await app?.close().catch(() => {}) }
}

try {
  for (const count of counts) {
    console.log(`Seeding ${count} history records and ${count ? 20000 : 0} playlist members`)
    const directories = { baseline: await profile(count), candidate: await profile(count) }
    const targets = [{ name: 'baseline', root: baselineRoot }, { name: 'candidate', root: repoRoot }]
    const result = { count, playlistMembers: count ? 20000 : 0, baseline: [], candidate: [] }
    for (const target of targets) {
      console.log(`First open / warmup ${target.name} ${count}`)
      const warmup = await collect(target, directories[target.name], count)
      if (target.name === 'candidate') result.firstMigrationStartupMs = warmup.startup.startupMs
    }
    for (let iteration = 0; iteration < samples; iteration++) {
      for (const target of iteration % 2 ? targets.toReversed() : targets) {
        console.log(`Sample ${iteration + 1}/${samples} ${target.name} ${count}`)
        result[target.name].push(await collect(target, directories[target.name], count, { tabs: count === 100000 && iteration === 0 }))
      }
    }
    result.medians = Object.fromEntries(targets.map(target => {
      const values = result[target.name]
      return [target.name, {
        startupMs: median(values.map(value => value.startup.startupMs)),
        queryMs: median(values.map(value => value.query.elapsedMs)),
        rendererHeapMiB: median(values.map(value => value.startup.rendererHeapMiB)),
        processPssMiB: median(values.map(value => value.startup.processPssMiB)),
        backupMs: median(values.map(value => value.backup.elapsedMs)),
        backupMainMaxGapMs: median(values.map(value => value.backup.mainMaxGapMs)),
        backupRendererMaxGapMs: median(values.map(value => value.backup.rendererMaxGapMs)),
        ipcJsonBytes: values[0].query.jsonBytes,
      }]
    }))
    output.datasets.push(result)
    console.log(JSON.stringify(result.medians))
    await writeFile('/tmp/opentubex1841-integrated-benchmark.json', JSON.stringify(output, null, 2) + '\n')
    for (const directory of Object.values(directories)) await rm(directory, { recursive: true, force: true })
  }
} finally { for (const directory of profiles) await rm(directory, { recursive: true, force: true }) }
