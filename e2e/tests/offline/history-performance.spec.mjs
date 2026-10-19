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
      await goTo(page, 'history')
      await expect(page.locator('.ft-list-video').first()).toBeVisible()
      // Only the selected "All channels" value is in the hidden native select.
      await expect(page.locator('.historyChannelFilter option')).toHaveCount(1)

      const dropdown = await openChannelPicker(page)
      const options = dropdown.getByRole('option')
      await expect(options.first()).toBeVisible()
      await expect(options).toHaveCount(100)

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

const sortedChannelNames = history.map(entry => entry.author).sort(new Intl.Collator('en-US').compare)

test('reopens the channel picker at a late selection without rendering earlier pages', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  const selected = sortedChannelNames.at(-150)
  await goTo(page, 'history')
  let dropdown = await openChannelPicker(page)
  await page.locator('.mobileSheet[open]').getByRole('searchbox', { name: 'Search', exact: true }).fill(selected)
  await dropdown.getByRole('option', { name: selected, exact: true }).click()
  const picker = page.getByRole('combobox', { name: 'Channel', exact: true })
  await expect(picker).toContainText(selected)
  await expect(page.locator('.mobileSheet[open]')).toHaveCount(0)

  await picker.click()
  dropdown = page.locator(`#${await picker.getAttribute('aria-controls')}`)
  const options = dropdown.getByRole('option')
  await expect(dropdown.getByRole('option', { name: selected, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dropdown.getByRole('option', { name: selected, exact: true })).toBeInViewport()
  const renderedCount = await options.count()
  expect(renderedCount).toBeLessThanOrEqual(300)

  // Earlier pages load above the visible rows without moving them.
  await dropdown.evaluate(menu => { menu.scrollTop = 0 })
  await expect.poll(() => options.count()).toBeGreaterThan(renderedCount)
  await expect.poll(() => dropdown.evaluate(menu => menu.scrollTop)).toBeGreaterThan(0)
})

test('End reaches the last channel in the phone picker', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await goTo(page, 'history')
  const dropdown = await openChannelPicker(page)
  await expect(dropdown).toBeFocused()
  await page.keyboard.press('End')
  await expect(dropdown.getByRole('option', { name: sortedChannelNames.at(-1), exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(dropdown.getByRole('option', { name: 'All channels', exact: true })).toBeFocused()
})
