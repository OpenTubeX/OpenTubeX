import { test, expect, goTo } from '../../helpers/app.mjs'

const channelCount = 5000
const now = Date.now()
const history = Array.from({ length: channelCount }, (_, index) => ({
  _id: `v${String(index).padStart(10, '0')}`,
  videoId: `v${String(index).padStart(10, '0')}`,
  title: `History performance video ${index}`,
  author: `Channel ${index}`,
  authorId: `UC-history-performance-${index}`,
  type: 'video',
  lengthSeconds: 120,
  watchProgress: 10,
  isWatched: false,
  timeWatched: now - index * 60_000,
}))

test.use({
  seed: {
    settings: {
      landingPage: 'trending',
      fetchSubscriptionsAutomatically: false,
      enableHomeRecommendations: false,
      historyWatchedStatusMigrated: true,
    },
    history,
  },
})

/** Counts collator comparisons, which sorting the channel list performs. */
async function countCollatorComparisons(page) {
  await page.evaluate(() => {
    window.__collatorComparisons = 0
    if (window.__collatorComparisonsInstalled) return
    window.__collatorComparisonsInstalled = true
    const descriptor = Object.getOwnPropertyDescriptor(Intl.Collator.prototype, 'compare')
    Object.defineProperty(Intl.Collator.prototype, 'compare', {
      ...descriptor,
      get() {
        const compare = descriptor.get.call(this)
        return (a, b) => {
          window.__collatorComparisons++
          return compare(a, b)
        }
      },
    })
  })
  return () => page.evaluate(() => window.__collatorComparisons)
}

async function openChannelPicker(page) {
  await page.locator('.historyFilterToggleRow').getByRole('button', { name: /^Search filters$/i }).click()
  const picker = page.getByRole('combobox', { name: 'Channel', exact: true })
  await picker.click()
  return page.locator(`#${await picker.getAttribute('aria-controls')}`)
}

test('opening History does not collect or render its channels across relaunches with a throttled renderer', async ({ app, page }) => {
  test.setTimeout(120000)
  for (let launch = 0; launch < 2; launch++) {
    if (launch > 0) ({ page } = await app.relaunch())
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    try {
      const comparisons = await countCollatorComparisons(page)
      await goTo(page, 'history')
      await expect(page.locator('.ft-list-video').first()).toBeVisible()
      // Only the selected "All channels" value is in the hidden native select.
      await expect(page.locator('.historyChannelFilter option')).toHaveCount(1)
      await page.locator('.historyFilterToggleRow').getByRole('button', { name: /^Search filters$/i }).click()
      // Sorting the channels takes tens of thousands of comparisons; History
      // must not collect them until the picker is used.
      expect(await comparisons()).toBeLessThan(1000)

      const picker = page.getByRole('combobox', { name: 'Channel', exact: true })
      await picker.click()
      const dropdown = page.locator(`#${await picker.getAttribute('aria-controls')}`)
      const options = dropdown.getByRole('option')
      await expect(options.first()).toBeVisible()
      await expect(options).toHaveCount(100)
      expect(await comparisons()).toBeGreaterThan(channelCount)

      await dropdown.evaluate(menu => { menu.scrollTop = menu.scrollHeight })
      await expect(options).toHaveCount(200)
      await expect(page.locator('.historyChannelFilter option')).toHaveCount(1)
    } finally {
      await cdp.detach().catch(() => {})
    }
  }
})

test('searches channels beyond the rendered page on phones', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await goTo(page, 'history')
  const dropdown = await openChannelPicker(page)
  const sheet = page.locator('.mobileSheet[open]').filter({ has: dropdown })
  await expect(dropdown.getByRole('option')).toHaveCount(100)

  await sheet.getByRole('searchbox', { name: 'Search', exact: true }).fill('Channel 4999')
  await expect(dropdown.getByRole('option')).toHaveCount(1)
  await dropdown.getByRole('option', { name: 'Channel 4999', exact: true }).click()
  await expect(page.locator('.ft-list-video')).toHaveCount(1)
  await expect(page.getByText('History performance video 4999', { exact: true })).toBeVisible()
})
