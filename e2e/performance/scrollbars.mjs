import { rm, writeFile } from 'node:fs/promises'
import { createUserDataDir, launchApp, expect } from '../helpers/app.mjs'

// Run on a private X server. Compare the same workload and CPU throttle across
// separately packed variants; TaskDuration includes observer and layout work.
async function collectSample(appRoot) {
  const userDataDir = await createUserDataDir()
  let app
  try {
    app = await launchApp(userDataDir, ['--js-flags=--expose-gc', '--enable-precise-memory-info'], {
      appRoot
    })
    const { page } = app
    const tutorial = page.locator('.tutorialOverlay')
    await tutorial.locator('.tutorialActions').getByRole('button').last().click()
    await expect(tutorial).toBeHidden()
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await session.send('Performance.enable')
    const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
    const measure = async action => {
      const before = await metrics()
      const timing = await page.evaluate(action)
      const after = await metrics()
      return {
        ...(typeof timing === 'number' ? { elapsedMs: timing } : timing),
        taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
        scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
        layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
        styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
        layouts: after.LayoutCount - before.LayoutCount
      }
    }
    await page.evaluate(() => {
      window.__scrollbarBenchmark = {
        app: document.querySelector('#app').__vue_app__,
        viewports: [],
        counters: [],
        settle: () => new Promise(resolve => setTimeout(resolve, 200)),
        async scrollFrames(move) {
          const started = performance.now()
          let previous = await new Promise(resolve => requestAnimationFrame(resolve))
          let worstFrameMs = 0
          let slowFrames = 0
          for (let frame = 0; frame < 120; frame++) {
            move(100 + frame * 30)
            const timestamp = await new Promise(resolve => requestAnimationFrame(resolve))
            const gap = timestamp - previous
            worstFrameMs = Math.max(worstFrameMs, gap)
            if (gap > 25) slowFrames++
            previous = timestamp
          }
          await this.settle()
          return { elapsedMs: performance.now() - started, worstFrameMs, slowFrames }
        }
      }
    })
    await page.evaluate(() => { window.gc?.() })
    const initialHeapBytes = await page.evaluate(() => performance.memory.usedJSHeapSize)
    const mounting = await measure(async () => {
      const bench = window.__scrollbarBenchmark
      const started = performance.now()
      // Ten retained tab panels, four scrollers each, with 250 video-like rows.
      for (let tab = 0; tab < 10; tab++) {
        const panel = document.createElement('div')
        panel.dataset.scrollbarBenchmark = ''
        Object.assign(panel.style, { position: 'fixed', inset: '100px 80px', display: tab === 0 ? 'flex' : 'none' })
        document.body.append(panel)
        for (let index = 0; index < 4; index++) {
          const viewport = document.createElement('div')
          Object.assign(viewport.style, { position: 'relative', height: '350px', width: '200px', overflow: 'auto' })
          const content = document.createElement('div')
          for (let row = 0; row < 250; row++) {
            const card = document.createElement('div')
            card.style.height = '48px'
            card.textContent = `Video ${row} — playback position: `
            const counter = document.createElement('span')
            counter.textContent = '00:00'
            card.append(counter)
            content.append(card)
            bench.counters.push(counter.firstChild)
          }
          viewport.append(content)
          panel.append(viewport)
          bench.app._context.directives['overlay-scrollbars'].mounted(viewport, { value: true })
          bench.viewports.push(viewport)
        }
      }
      const feed = document.createElement('div')
      feed.dataset.scrollbarBenchmarkFeed = ''
      for (let row = 0; row < 250; row++) {
        const card = document.createElement('div')
        card.style.height = '48px'
        card.textContent = `Main feed video ${row}`
        feed.append(card)
      }
      document.body.append(feed)
      await bench.settle()
      return performance.now() - started
    })
    await page.evaluate(() => { window.gc?.() })
    const heapBytes = await page.evaluate(() => performance.memory.usedJSHeapSize) - initialHeapBytes
    const contentUpdates = await measure(async () => {
      const bench = window.__scrollbarBenchmark
      const started = performance.now()
      for (let frame = 0; frame < 12; frame++) {
        // One changing row per scroller: progress/unread indicators in retained
        // panels, without artificially rewriting all 10,000 video titles.
        for (let index = 0; index < bench.counters.length; index += 250) {
          bench.counters[index].data = `00:${String(frame).padStart(2, '0')}`
        }
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      await bench.settle()
      return performance.now() - started
    })
    const scrolling = await measure(async () => {
      const bench = window.__scrollbarBenchmark
      return bench.scrollFrames(position => { bench.viewports[0].scrollTop = position })
    })
    const pageScrolling = await measure(async () => {
      const bench = window.__scrollbarBenchmark
      return bench.scrollFrames(position => window.scrollTo(0, position))
    })
    const visibilityToggle = await measure(async () => {
      const bench = window.__scrollbarBenchmark
      const started = performance.now()
      const store = bench.app.config.globalProperties.$store
      for (const enabled of [true, false, true, false]) {
        store.commit('setAlwaysShowScrollbars', enabled)
        await bench.settle()
      }
      return performance.now() - started
    })
    const tabSwitching = await measure(async () => {
      const bench = window.__scrollbarBenchmark
      const panels = [...document.querySelectorAll('[data-scrollbar-benchmark]')]
      const started = performance.now()
      for (let tab = 0; tab < panels.length; tab++) {
        for (let index = 0; index < panels.length; index++) panels[index].style.display = index === tab ? 'flex' : 'none'
        await new Promise(resolve => requestAnimationFrame(resolve))
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      await bench.settle()
      return performance.now() - started
    })
    const destroying = await measure(async () => {
      const bench = window.__scrollbarBenchmark
      const started = performance.now()
      for (const viewport of bench.viewports) bench.app._context.directives['overlay-scrollbars'].unmounted(viewport)
      document.querySelectorAll('[data-scrollbar-benchmark]').forEach(panel => panel.remove())
      document.querySelector('[data-scrollbar-benchmark-feed]').remove()
      await bench.settle()
      return performance.now() - started
    })
    return { mounting, contentUpdates, scrolling, pageScrolling, visibilityToggle, tabSwitching, destroying, heapBytes }
  } finally {
    await app?.electronApp.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
}
const label = process.argv[2] ?? 'current'
const output = process.argv[3] ?? `/tmp/opentubex-scrollbars-${label}.json`
const targets = label === 'compare'
  ? JSON.parse(process.argv[4])
  : [{ label, appRoot: process.argv[4] }]
const samplesByTarget = new Map(targets.map(target => [target.label, []]))
for (let sample = 0; sample < 6; sample++) {
  // Rotate order to limit bias from temperature and changing host load.
  const offset = sample % targets.length
  for (const target of [...targets.slice(offset), ...targets.slice(0, offset)]) {
    const result = await collectSample(target.appRoot)
    if (sample > 0) samplesByTarget.get(target.label).push(result)
    console.log(`${target.label}: sample ${sample} complete${sample === 0 ? ' (warmup)' : ''}`)
  }
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const results = targets.map(({ label }) => {
  const samples = samplesByTarget.get(label)
  const medians = Object.fromEntries(Object.keys(samples[0]).map(key => [key,
    key === 'heapBytes'
      ? median(samples.map(sample => sample[key]))
      : Object.fromEntries(Object.keys(samples[0][key]).map(metric => [metric, median(samples.map(sample => sample[key][metric]))]))
  ]))
  return { label, cpuThrottle: 4, samples, medians }
})
await writeFile(output, `${JSON.stringify(results, null, 2)}\n`)
console.log(JSON.stringify(results.map(({ label, medians }) => ({ label, medians })), null, 2))
