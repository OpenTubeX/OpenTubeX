import { test, expect, goToSettingsSection, setWindowSize, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

const subscriptions = Array.from({ length: 50 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: `Channel ${String(index).padStart(3, '0')}`,
  thumbnail: ''
}))

test.describe('channel settings incremental loading', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false, generalAutoLoadMorePaginatedItemsEnabled: false },
      profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions }]
    }
  })

  test('keeps selection while loading more and resets scrolling for shorter results', async ({ app, page, attachScreenshot, uiScale }) => {
    const settings = await goToSettingsSection(page, 'subscription')
    await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    const loadMore = page.getByRole('button', { name: 'Load more channels', exact: true })
    const scroller = page.locator('.channelSettingsScroller')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    const toolbar = page.locator('.channelSelectionToolbar')
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
    await attachScreenshot(`channel settings incremental loading at ${uiScale}%`)
    await expect(page.locator('.channelSettings')).toHaveCount(24)
    await expect(page.locator('.channelSettingsPagination')).toHaveCount(0)
    await scrollToBottom()
    await page.getByLabel('Search channels').fill('Channel 00')
    await expect(page.locator('.channelSettings')).toHaveCount(10)
    await expectAtTop()
    await page.getByLabel('Search channels').fill('')
    await page.getByRole('checkbox', { name: 'Channel 000', exact: true }).click()
    await scrollToBottom()
    await loadMore.click()
    await expect(page.locator('.channelSettings')).toHaveCount(48)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(page.getByRole('checkbox', { name: 'Channel 000', exact: true })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Channel 024', exact: true }).click()
    await expect(toolbar).toContainText('2 selected')
    await page.locator('.bulkFeedTypeSettings').getByRole('checkbox', { name: 'Videos', exact: true }).click()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getProfileList[0].subscriptions
        .filter(channel => channel.feedTypes && !channel.feedTypes.includes('videos'))
        .map(channel => channel.name)
    })).toEqual(['Channel 000', 'Channel 024'])
    await scrollToBottom()
    await loadMore.click()
    await expect(page.locator('.channelSettings')).toHaveCount(50)
    await expect(loadMore).toHaveCount(0)

    await scrollToBottom()
    await setWindowSize(app, page, { width: 1600, height: 900 })
    // Resizing may clamp through intermediate layouts; only an offset past
    // the final content end is invalid. Bottom anchoring is not required.
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.querySelector(':scope > div')
      const contentEnd = content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      return element.scrollTop - Math.max(0, contentEnd - element.clientHeight)
    })).toBeLessThanOrEqual(1)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expectScrollAtRenderedEnd(scroller)
    if (await scroller.evaluate(element => element.scrollHeight > element.clientHeight)) {
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      await expect.poll(() => scrollbar.evaluate(element => {
        const track = element.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const handle = element.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return Math.abs(track.bottom - handle.bottom)
      })).toBeLessThanOrEqual(1)
    } else {
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    }
    await toolbar.getByRole('button', { name: 'Select All' }).click()
    await expect(toolbar).toContainText('50 selected')
    await toolbar.getByRole('button', { name: 'Select None' }).click()
    await expect(toolbar).toContainText('0 selected')
    await scrollToBottom()
    await page.getByLabel('Search channels').fill('Channel 049')
    await expect(page.locator('.channelSettings')).toHaveCount(1)
    await expectAtTop()
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    await expect(loadMore).toHaveCount(0)

    await page.getByLabel('Search channels').fill('')
    await expect(page.locator('.channelSettings')).toHaveCount(24)
    await loadMore.click()
    await scrollToBottom()
    await page.evaluate(() => {
      const store = window.$store
      const profile = store.state.profiles.profileList[0]
      profile.subscriptions = profile.subscriptions.filter(channel => channel.name === 'Channel 000')
    })
    await expect(page.locator('.channelSettings')).toHaveCount(1)
    await expect(page.getByRole('checkbox', { name: 'Channel 000', exact: true })).toBeVisible()
    await expectAtTop()
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })
})
