import { test, expect, goTo, abortUnmockedRequest } from '../../helpers/app.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'

const cache = largeSubscriptionsSeed.subscriptionCache.map(channel => ({
  ...channel,
  shorts: channel.videos.map(video => ({ ...video, videoId: `short-${video.videoId}`, title: `Short ${video.title}` }))
}))
test.use({
  seed: {
    ...largeSubscriptionsSeed,
    settings: { ...largeSubscriptionsSeed.settings, hideSubscriptionsShorts: false, newSubscriptionFeedView: 'tabbed' },
    subscriptionCache: cache
  }
})

test('batches New category leave layouts under CPU load', async ({ page }) => {
  test.setTimeout(120000)
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await goTo(page, 'subscriptions')
  await expect(page.locator('.ft-list-video').first()).toBeVisible()
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await session.send('Performance.enable')
  const measurements = []
  for (const selector of [
    '[data-subscription-feed-tab="shorts"]',
    '[data-subscription-feed-tab="videos"]',
    '[data-subscription-feed-tab="all"]',
    '[data-new-feed-tab="shorts"]',
    '[data-new-feed-tab="videos"]',
    '[data-new-feed-tab="shorts"]',
    '[data-subscription-feed-tab="videos"]',
    '[data-subscription-feed-tab="shorts"]'
  ]) {
    await expect(page.locator('.feed-enter-active, .feed-leave-active, .feed-move')).toHaveCount(0)
    const before = await session.send('Performance.getMetrics')
    const result = await page.evaluate(async selector => {
      const started = performance.now()
      const frames = []
      let previous = started
      const sample = time => { frames.push(time - previous); previous = time }
      const target = document.querySelector(selector)
      const expectedTitle = selector.includes('shorts') ? 'Short Video 0-0' : 'Video 0-0'
      let rendered = false
      target.click()
      while (performance.now() - started < 10000) {
        sample(await new Promise(resolve => requestAnimationFrame(resolve)))
        rendered = target.getAttribute('aria-selected') === 'true' &&
          [...document.querySelectorAll('#subscriptionsPanel .ft-list-video .title')]
            .some(link => link.textContent.trim() === expectedTitle)
        if (rendered) break
      }
      const elapsed = performance.now() - started
      await new Promise(resolve => requestAnimationFrame(resolve))
      return { selector, elapsed, longestFrame: Math.max(...frames), rendered }
    }, selector)
    measurements.push(result)
    const after = await session.send('Performance.getMetrics')
    result.layouts = after.metrics.find(metric => metric.name === 'LayoutCount').value -
      before.metrics.find(metric => metric.name === 'LayoutCount').value
    console.log(JSON.stringify(result))
  }
  expect(measurements.every(result => result.rendered)).toBe(true)
  // A per-card reflow needs at least 100 layouts. Allow unrelated windowing
  // observer deliveries while still requiring that the leaving batch is cheap.
  expect(measurements.slice(3, 6).every(result => result.layouts < 60)).toBe(true)
  await session.detach()
})
