import { test, expect } from '../../helpers/app.mjs'
import {
  largeSubscriptionsSeed,
  runLargeSubscriptionsBenchmark
} from '../../performance/subscriptions.mjs'

test.use({
  seed: largeSubscriptionsSeed
})

test('switches a production-profile-sized cached feed without repeating expensive work', async ({ page }) => {
  const metrics = await runLargeSubscriptionsBenchmark(page)

  expect(metrics.firstSwitchLongestFrameMs).toBeLessThan(200)
  expect(metrics.firstSwitchElapsedMs).toBeLessThan(250)
  expect(metrics.repeatedSwitchLongestFrameMs).toBeLessThan(100)
  expect(metrics.repeatedSwitchElapsedMs).toBeLessThan(150)
})
