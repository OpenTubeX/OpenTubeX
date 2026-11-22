import { test, expect, goToSettingsSection, setWindowSize, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

const subscriptions = Array.from({ length: 938 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: `Channel ${String(index).padStart(3, '0')}`,
  thumbnail: ''
}))

function channelSettingsSeed(count) {
  const savedChannels = subscriptions.slice(0, count)
  const values = value => JSON.stringify(Object.fromEntries(savedChannels.map(channel => [channel.id, value])))
  return {
    settings: {
      currentLocale: 'en-US',
      fetchSubscriptionsAutomatically: false,
      channelPlaybackSpeeds: values(1.25),
      channelVideoQualities: values('720'),
      channelSubtitlesStates: values(true),
      channelVolumes: values(0.5)
    },
    profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: subscriptions.slice(0, count + 1).map(channel => ({ ...channel })) }]
  }
}

test.describe('large subscribed channel picker', { tag: '@scale' }, () => {
  const seed = channelSettingsSeed(1)
  seed.profiles[0].subscriptions = subscriptions.map(channel => ({ ...channel }))
  test.use({ seed })

  test('mounts subscriptions in batches and starts over for each search and opening', async ({ page }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()
    const openPicker = async () => {
      await page.getByRole('button', { name: 'Add subscribed channel', exact: true }).click()
      return page.getByRole('dialog', { name: 'Add subscribed channel', exact: true })
    }
    let picker = await openPicker()
    const options = picker.locator('.addSubscribedChannelOption')
    const scroller = picker.locator('.promptContentScroller')
    const search = picker.getByLabel('Search channels')

    await expect(options).toHaveCount(50)
    await expect(options.first()).toHaveText('Channel 001')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(options).toHaveCount(100)

    await search.fill('Channel 9')
    await expect(options).toHaveCount(38)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await search.fill('')
    await expect(options).toHaveCount(50)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(options).toHaveCount(100)

    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    picker = await openPicker()
    await expect(picker.locator('.addSubscribedChannelOption')).toHaveCount(50)

    await picker.getByLabel('Search channels').fill('Channel 937')
    await picker.getByRole('button', { name: 'Channel 937', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(page.locator('.channelEntry', { hasText: 'Channel 937' })).toBeInViewport()
  })
})

test.describe('channel settings scroll layout', { tag: '@scale' }, () => {
  const seed = channelSettingsSeed(49)
  seed.settings.generalAutoLoadMorePaginatedItemsEnabled = false
  seed.settings.alwaysShowScrollbars = true
  seed.profiles[0].subscriptions = subscriptions.slice(0, 99)
  test.use({ seed })

  test('keeps the subscribed channel search above scrolling results and clamps shorter lists', async ({ app, page, attachScreenshot }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (49)', exact: true }).click()
    await page.getByRole('button', { name: 'Add subscribed channel', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add subscribed channel', exact: true })
    const scroller = picker.locator('.promptContentScroller')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    const search = picker.getByLabel('Search channels')
    const expectShortResults = async () => {
      await expectScrollAtRenderedEnd(scroller)
      // Fractional zoom can leave subpixel overflow even when all results fit.
      await expect.poll(() => scroller.evaluate(element => (
        Math.max(element.scrollTop, element.scrollHeight - element.clientHeight) * devicePixelRatio
      ))).toBeLessThanOrEqual(2)
      await expect.poll(() => scrollbar.evaluate(element => {
        const track = element.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const handle = element.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return (track.height - handle.height) * devicePixelRatio
      })).toBeLessThanOrEqual(2)
    }

    for (const size of [{ width: 1500, height: 800 }, { width: 650, height: 400 }]) {
      await setWindowSize(app, page, size)
      await search.fill('')
      await expect(picker.locator('.addSubscribedChannelOption')).toHaveCount(50)
      // The dialog's entry transform moves its fixed search field too.
      await expect(picker).toHaveCSS('transform', 'none')
      const searchTop = await search.evaluate(element => element.getBoundingClientRect().top)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect(search).toBeInViewport()
      expect(await search.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(searchTop, 1)
      const searchBottom = await search.evaluate(element => element.getBoundingClientRect().bottom)
      expect(await scroller.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(searchBottom)
      await attachScreenshot(`Fixed channel search at ${size.width}px`)
      await search.fill('Channel 098')
      await expect(picker.locator('.addSubscribedChannelOption')).toHaveCount(1)
      await expectShortResults()
      await search.fill('No matching channel')
      await expect(picker.locator('.addSubscribedChannelOption')).toHaveCount(0)
      await expectShortResults()
    }

    await search.fill('')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await setWindowSize(app, page, { width: 1600, height: 1000 })
    await expectScrollAtRenderedEnd(scroller)
  })
})

test.describe('saved channel incremental loading', { tag: '@scale' }, () => {
  const seed = channelSettingsSeed(49)
  seed.settings.generalAutoLoadMorePaginatedItemsEnabled = false
  test.use({ seed })

  test('preserves edits, reveals added channels, and clamps shorter results', async ({ app, page }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (49)' }).click()
    const loadMore = page.getByRole('button', { name: 'Load more channels', exact: true })
    const scroller = page.locator('.channelListContainer')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    const search = page.locator('.channelSearch input')
    const scrollToBottom = async () => {
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    }
    const expectAtTop = async () => {
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    }

    await expect(page.locator('.channelEntry')).toHaveCount(24)
    await expect(page.locator('.channelSettingsPagination')).toHaveCount(0)
    await scrollToBottom()
    await search.fill('Channel 00')
    await expect(page.locator('.channelEntry')).toHaveCount(10)
    await expectAtTop()
    await search.fill('')
    await scrollToBottom()
    await loadMore.click()
    await expect(page.locator('.channelEntry')).toHaveCount(48)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const editedChannel = page.locator('.channelEntry', { hasText: 'Channel 024' })
    await editedChannel.getByRole('slider', { name: /Playback Speed/ }).fill('1.5')
    await scrollToBottom()
    await loadMore.click()
    await expect(page.locator('.channelEntry')).toHaveCount(49)
    await expect(editedChannel.getByRole('slider', { name: /Playback Speed/ })).toHaveValue('1.5')
    await expect(loadMore).toHaveCount(0)
    await scrollToBottom()
    await search.fill('Channel 048')
    await expect(page.locator('.channelEntry')).toHaveCount(1)
    await expectAtTop()

    // Narrow enough that the remaining preferences stack and one card still overflows at every UI scale
    await setWindowSize(app, page, { width: 480, height: 380 })
    await scrollToBottom()
    await page.locator('.channelEntry').getByRole('button', { name: 'Forget this setting', exact: true }).first().evaluate(button => button.click())
    await expect(page.locator('.channelPreference')).toHaveCount(3)
    await expectScrollAtRenderedEnd(scroller)
    await scrollToBottom()
    await page.locator('.channelEntry').getByRole('button', { name: 'Forget this setting', exact: true }).first().evaluate(button => button.click())
    await expect(page.locator('.channelPreference')).toHaveCount(2)
    await expectScrollAtRenderedEnd(scroller)
    await scrollToBottom()
    await setWindowSize(app, page, { width: 1600, height: 1000 })
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

    await page.getByRole('button', { name: 'Forget all settings for this channel', exact: true }).click()
    await expect(page.locator('.channelEntry')).toHaveCount(0)
    await expectAtTop()
    await page.getByRole('button', { name: 'Add subscribed channel', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add subscribed channel', exact: true })
    await picker.getByLabel('Search channels').fill('Channel 049')
    await picker.getByRole('button', { name: 'Channel 049', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(page.locator('.channelEntry')).toHaveCount(49)
    await expect(page.locator('.channelEntry', { hasText: 'Channel 049' })).toBeInViewport()

    await scrollToBottom()
    await search.fill('Channel 000')
    await expect(page.locator('.channelEntry')).toHaveCount(1)
    await expect(page.locator('.channelEntry')).toContainText('Channel 000')
    await expectAtTop()
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    await expect(loadMore).toHaveCount(0)
    await search.fill('No matching channel')
    await expect(page.locator('.channelEntry')).toHaveCount(0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    await search.fill('')
    await expect(page.locator('.channelEntry')).toHaveCount(24)
  })
})
