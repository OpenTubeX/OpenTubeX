import { test, expect, sel, setWindowSize } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

for (const { zoom, throttle, width, direction } of [
  { zoom: 1, throttle: 1, width: 1600, direction: 'ltr' },
  { zoom: 1.25, throttle: 4, width: 900, direction: 'ltr' },
  { zoom: 0.95, throttle: 4, width: 520, direction: 'rtl' }
]) {
  test(`loading skeletons composite at ${zoom} UI scale, ${width}px ${direction} layout and ${throttle}x CPU slowdown`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    let releaseMetadata
    const metadataPending = new Promise(resolve => { releaseMetadata = resolve })
    await page.route(/\/youtubei\/v1\/player|www\.youtube\.com\/watch\?/, async route => {
      await metadataPending
      await route.fallback()
    })

    const session = await page.context().newCDPSession(page)
    try {
      await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator(sel.searchInput).press('Enter')
      await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toBeVisible()
      await expect(page.locator('.recommendationsSkeleton')).toBeVisible()
      if (width !== 1600) await setWindowSize(app, page, { width, height: 950 })
      await page.evaluate(factor => window.ftElectron.setZoomFactor(factor), zoom)
      await page.locator('.videoPlayerPlaceholder').evaluate((element, direction) => { element.dir = direction }, direction)
      await session.send('Emulation.setCPUThrottlingRate', { rate: throttle })
      await session.send('Performance.enable')
      // Wait for the animation to start and render before sampling.
      await page.locator('.videoPlayerPlaceholder').evaluate(async element => {
        const animation = element.getAnimations({ subtree: true }).find(animation => animation.animationName === 'ft-shimmer')
        await animation.ready
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      const events = []
      session.on('Tracing.dataCollected', ({ value }) => events.push(...value))
      await session.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
      const before = await session.send('Performance.getMetrics')
      // Use a fixed measurement window to compare rendering work.
      await page.waitForTimeout(1500)
      const after = await session.send('Performance.getMetrics')
      const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve))
      await session.send('Tracing.end')
      await complete
      const taskDuration = metrics => metrics.metrics.find(metric => metric.name === 'TaskDuration').value
      const measurement = {
        paints: events.filter(event => event.name === 'Paint').length,
        styleUpdates: events.filter(event => event.name === 'UpdateLayoutTree').length,
        mainThreadMilliseconds: (taskDuration(after) - taskDuration(before)) * 1000
      }
      await testInfo.attach('skeleton rendering cost', { body: JSON.stringify(measurement), contentType: 'application/json' })
      console.log('Skeleton rendering cost:', measurement)
      expect(await page.locator('.videoPlayerPlaceholder').evaluate(element =>
        element.getAnimations({ subtree: true }).some(animation =>
          animation.animationName === 'ft-shimmer' && animation.playState === 'running'
        )
      ), 'The shimmer must still animate').toBe(true)
      expect(measurement.paints, 'A settled skeleton should composite its animation without continuous paint').toBeLessThan(10)

      // The oversized gradient must cover the placeholder even at the start of
      // its sweep, including in RTL layouts and at fractional UI scales.
      await page.locator('.videoPlayerPlaceholder').evaluate(element => {
        const animation = element.getAnimations({ subtree: true }).find(animation => animation.animationName === 'ft-shimmer')
        animation.pause()
        animation.currentTime = 0
      })
      const { root } = await session.send('DOM.getDocument')
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.videoPlayerPlaceholder' })
      const { node } = await session.send('DOM.describeNode', { nodeId })
      const gradient = node.pseudoElements.find(element => element.pseudoType === 'before')
      const { model: placeholderBox } = await session.send('DOM.getBoxModel', { nodeId })
      const { model: gradientBox } = await session.send('DOM.getBoxModel', { backendNodeId: gradient.backendNodeId })
      const horizontalBounds = box => box.content.filter((_, index) => index % 2 === 0)
      expect(Math.min(...horizontalBounds(gradientBox))).toBeLessThanOrEqual(Math.min(...horizontalBounds(placeholderBox)) + 1)
      expect(Math.max(...horizontalBounds(gradientBox))).toBeGreaterThanOrEqual(Math.max(...horizontalBounds(placeholderBox)) - 1)

      await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'reduce' })
      await expect.poll(() => page.locator('.videoPlayerPlaceholder').evaluate(element =>
        getComputedStyle(element, '::before').animationName
      )).toBe('none')
    } finally {
      await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      releaseMetadata()
      await session.detach()
    }
  })
}
