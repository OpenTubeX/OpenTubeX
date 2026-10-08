import { test, expect, abortUnmockedRequest, goTo } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { measureLargeFeedScroll, measurePlaybackHeapGrowth, mockPerformanceServices } from '../../performance/scenarios.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'
import { comparePerformanceSamples, performanceMetrics } from '../../performance/report.mjs'

test.use({
  seed: largeSubscriptionsSeed,
  launchArgs: ['--js-flags=--expose-gc', '--enable-precise-memory-info']
})

test('unmocked performance services do not put later playback into network backoff', async ({ page }) => {
  await mockPerformanceServices(page)
  // A transport failure marks the entire YouTube origin unavailable. A later
  // watch fixture would then wait behind the shared five-second retry queue.
  const result = await page.evaluate(async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      const response = await fetch('https://www.youtube.com/youtubei/v1/browse?performance-fixture=unmocked', {
        method: 'POST', signal: controller.signal, body: '{}'
      })
      return { status: response.status }
    } catch (error) {
      return { error: error.name }
    } finally {
      clearTimeout(timeout)
    }
  })
  expect(result).toEqual({ status: 404 })
})

function sample(overrides) {
  return { ...Object.fromEntries(performanceMetrics.map(metric => [metric.key, 1])), ...overrides }
}

async function prepareScrollableScene(page) {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await goTo(page, 'trending')
  // Keep this detector check below a frame's CPU budget. The full comparison
  // separately exercises the large cached feed; here isolate added work from
  // its layout and image loading costs using a steady, scrollable page.
  await page.evaluate(() => {
    const content = document.createElement('div')
    content.style.height = '5000px'
    document.body.append(content)
  })
  await page.waitForTimeout(1000)
}

async function collectScrollSamples(page, injectFault) {
  const samples = { base: [], candidate: [] }
  const measurements = []
  for (let index = 0; index < 7; index++) {
    for (const target of index % 2 === 0 ? ['base', 'candidate'] : ['candidate', 'base']) {
      await page.evaluate(injectFault, target === 'candidate')
      const measurement = await measureLargeFeedScroll(page)
      measurements.push({ target, ...measurement })
      samples[target].push(sample({
        largeFeedScrollTaskMs: measurement.taskMs,
        largeFeedScrollElapsedMs: measurement.elapsed,
        largeFeedScrollLongestFrameMs: measurement.longestFrame
      }))
    }
  }
  return { samples, measurements }
}

test('detects extra scroll CPU work that still fits within animation frames', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await prepareScrollableScene(page)
  const { samples, measurements } = await collectScrollSamples(page, inject => {
    window.removeEventListener('scroll', window.__performanceScrollWork)
    window.__performanceScrollWork = () => {
      const start = performance.now()
      while (performance.now() - start < 6) { /* Simulate repeated per-frame work. */ }
    }
    if (inject) window.addEventListener('scroll', window.__performanceScrollWork)
  })
  await page.evaluate(() => window.removeEventListener('scroll', window.__performanceScrollWork))
  const comparison = comparePerformanceSamples(samples)
  console.log('Scroll fault injection:', measurements)
  await testInfo.attach('scroll CPU fault injection', {
    body: JSON.stringify({ measurements, comparison }, null, 2), contentType: 'application/json'
  })
  expect(comparison.metrics.find(metric => metric.key === 'largeFeedScrollTaskMs').passed).toBe(false)
  expect(comparison.metrics.find(metric => metric.key === 'largeFeedScrollLongestFrameMs').passed).toBe(true)
})

test('detects sustained slower frame delivery below the longest-frame noise floor', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await prepareScrollableScene(page)
  const { samples } = await collectScrollSamples(page, inject => {
    window.__performanceOriginalAnimationFrame ??= window.requestAnimationFrame.bind(window)
    const original = window.__performanceOriginalAnimationFrame
    // Deliver each benchmark frame at half the display's normal cadence.
    window.requestAnimationFrame = inject
      ? callback => original(() => original(callback))
      : original
  })
  await page.evaluate(() => { window.requestAnimationFrame = window.__performanceOriginalAnimationFrame })
  const comparison = comparePerformanceSamples(samples)
  console.log('Frame delivery fault injection:', comparison.metrics
    .filter(metric => metric.key.startsWith('largeFeedScroll'))
    .map(({ key, baseMedian, candidateMedian, passed }) => ({ key, baseMedian, candidateMedian, passed })))
  await testInfo.attach('frame delivery fault injection', {
    body: JSON.stringify(comparison, null, 2), contentType: 'application/json'
  })
  expect(comparison.metrics.find(metric => metric.key === 'largeFeedScrollElapsedMs').passed).toBe(false)
  expect(comparison.metrics.find(metric => metric.key === 'largeFeedScrollLongestFrameMs').passed).toBe(true)
})

test('detects retained players across complete playback and tab disposal cycles', async ({ app, page }, testInfo) => {
  test.setTimeout(120_000)
  await mockPlayableWatchPage(app, page)
  const base = await measurePlaybackHeapGrowth(page)
  await page.evaluate(() => {
    window.__performanceLeakedPlayers = []
    const seen = new WeakSet()
    document.addEventListener('playing', event => {
      if (!(event.target instanceof HTMLVideoElement) || seen.has(event.target)) return
      seen.add(event.target)
      // Model a per-player listener retaining its DOM and ordinary JS data.
      window.__performanceLeakedPlayers.push({ video: event.target, data: Array(2_000_000).fill(123) })
    }, true)
  })
  const candidate = await measurePlaybackHeapGrowth(page)
  console.log('Player retention fault injection:', { base, candidate })
  await testInfo.attach('player retention fault injection', {
    body: JSON.stringify({ base, candidate }), contentType: 'application/json'
  })
  // Bounded background work must have released disposed baseline players.
  // Otherwise its transient heap growth can hide the deliberately retained data.
  expect(base).toBeLessThan(8)
  expect(candidate - base).toBeGreaterThan(20)
  expect(candidate).toBeGreaterThan(24)
})
