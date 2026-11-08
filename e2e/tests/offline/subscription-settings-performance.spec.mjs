import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'
import { test, expect, goToSettingsSection, goTo } from '../../helpers/app.mjs'

const subscriptions = Array.from({ length: 938 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: `Channel ${String(index).padStart(3, '0')}`,
  thumbnail: ''
}))

test.use({
  seed: {
    ...largeSubscriptionsSeed,
    settings: { ...largeSubscriptionsSeed.settings, currentLocale: 'en-US', uiScale: 95 },
    profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions }]
  }
})

test('subscription settings stays responsive with hundreds of channels', async ({ page }) => {
  test.setTimeout(120_000)
  await goTo(page, 'subscriptions')
  await expect(page.locator('.ft-list-video').first()).toBeVisible()
  const settings = await goToSettingsSection(page, 'subscription')
  const opening = await settings.getByRole('button', { name: 'Subscription settings', exact: true }).evaluate(button => new Promise(resolve => {
    const start = performance.now()
    button.click()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)))
  }))
  console.log('Opening settings:', opening)
  // Rendering only the first page keeps opening cheap regardless of channel count.
  await expect(page.locator('.channelSettings')).toHaveCount(24)
  const gaps = await page.evaluate(() => new Promise(resolve => {
    const gaps = []
    let previous = performance.now()
    const start = previous
    const timer = setInterval(() => {
      const now = performance.now()
      gaps.push(now - previous)
      previous = now
      if (now - start > 3000) {
        clearInterval(timer)
        resolve(gaps.sort((a, b) => a - b))
      }
    }, 20)
  }))
  console.log('Settings timer latency:', { p95: gaps[Math.floor(gaps.length * 0.95)], max: gaps.at(-1) })
  // Gross bound only; tighter wall-clock budgets are too noisy on shared runners.
  expect(gaps[Math.floor(gaps.length * 0.95)]).toBeLessThan(500)
})
