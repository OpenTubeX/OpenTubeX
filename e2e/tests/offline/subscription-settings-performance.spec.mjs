import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'
import { test, expect, goToSettingsSection, goTo, setWindowSize, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

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
  expect(opening).toBeLessThan(500)
  expect(gaps[Math.floor(gaps.length * 0.95)]).toBeLessThan(100)
})

for (const uiScale of [95, 125]) {
  test.describe(`channel settings pagination at ${uiScale}% scale`, () => {
    test.use({
      seed: {
        settings: { currentLocale: 'en-US', uiScale, fetchSubscriptionsAutomatically: false },
        profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: subscriptions.slice(0, 50) }]
      }
    })

    test('keeps selection across pages and resets scrolling for shorter results', async ({ app, page, attachScreenshot }) => {
      const settings = await goToSettingsSection(page, 'subscription')
      await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
      const pagination = page.locator('.channelSettingsPagination')
      const scroller = page.locator('.channelSettingsScroller')
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      const toolbar = page.locator('.channelSelectionToolbar')
      const next = pagination.getByRole('button', { name: 'Next', exact: true })
      const previous = pagination.getByRole('button', { name: 'Previous', exact: true })
      const scrollToBottom = async () => {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      }
      const expectAtTop = async () => {
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      }

      await setWindowSize(app, page, { width: 375, height: 700 })
      await expect.poll(() => page.locator('.channelSettingsHeader').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await attachScreenshot(`channel settings pagination at ${uiScale}%`)
      await expect(pagination).toContainText('1-24 / 50')
      await expect(previous).toBeDisabled()
      await scrollToBottom()
      await page.getByPlaceholder('Search channels').fill('Channel 00')
      await expect(page.locator('.channelSettings')).toHaveCount(10)
      await expectAtTop()
      await page.getByPlaceholder('Search channels').fill('')
      await page.getByRole('checkbox', { name: 'Channel 000', exact: true }).click()
      await scrollToBottom()
      await next.click()
      await expect(pagination).toContainText('25-48 / 50')
      await expectAtTop()
      await page.getByRole('checkbox', { name: 'Channel 024', exact: true }).click()
      await expect(toolbar).toContainText('2 selected')
      await page.locator('.bulkFeedTypeSettings').getByRole('checkbox', { name: 'Videos', exact: true }).click()
      await expect.poll(() => page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.getters.getProfileList[0].subscriptions
          .filter(channel => channel.feedTypes && !channel.feedTypes.includes('videos'))
          .map(channel => channel.name)
      })).toEqual(['Channel 000', 'Channel 024'])
      await scrollToBottom()
      await next.click()
      await expect(pagination).toContainText('49-50 / 50')
      await expect(page.locator('.channelSettings')).toHaveCount(2)
      await expect(next).toBeDisabled()
      await expectAtTop()

      await scrollToBottom()
      await setWindowSize(app, page, { width: 1600, height: 900 })
      await expectScrollAtRenderedEnd(scroller)
      await toolbar.getByRole('button', { name: 'Select All' }).click()
      await expect(toolbar).toContainText('50 selected')
      await previous.click()
      await toolbar.getByRole('button', { name: 'Select None' }).click()
      await expect(toolbar).toContainText('0 selected')
      await scrollToBottom()
      await page.getByPlaceholder('Search channels').fill('Channel 049')
      await expect(page.locator('.channelSettings')).toHaveCount(1)
      await expectAtTop()
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
      await expect(pagination).toHaveCount(0)

      await page.getByPlaceholder('Search channels').fill('')
      await expect(pagination).toContainText('1-24 / 50')
      await next.click()
      await scrollToBottom()
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const profile = store.state.profiles.profileList[0]
        profile.subscriptions = profile.subscriptions.filter(channel => channel.name === 'Channel 000')
      })
      await expect(page.locator('.channelSettings')).toHaveCount(1)
      await expect(page.getByRole('checkbox', { name: 'Channel 000', exact: true })).toBeVisible()
      await expectAtTop()
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    })
  })
}
