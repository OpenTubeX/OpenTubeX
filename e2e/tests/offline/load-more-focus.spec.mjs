import { test, expect, goToSettingsSection, goTo } from '../../helpers/app.mjs'

const subscriptions = Array.from({ length: 51 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: `Channel ${String(index).padStart(3, '0')}`,
  thumbnail: ''
}))

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      fetchSubscriptionsAutomatically: false,
      generalAutoLoadMorePaginatedItemsEnabled: false,
      channelPlaybackSpeeds: JSON.stringify(Object.fromEntries(subscriptions.map(channel => [channel.id, 1.25])))
    },
    profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions }]
  }
})

for (const list of [
  { section: 'playback', button: 'Manage Saved Channels (51)', entry: '.channelEntry', control: 'a, button, input' },
  { section: 'subscription', button: 'Subscription settings', entry: '.channelSettings', control: '.channelSelectionOption' }
]) {
  test(`${list.section} Load more focuses the first new channel, including the final batch`, async ({ page }) => {
    await goToSettingsSection(page, list.section)
    await page.getByRole('button', { name: list.button, exact: true }).click()
    const entries = page.locator(list.entry)
    const loadMore = page.getByRole('button', { name: 'Load more channels', exact: true })
    await expect(entries).toHaveCount(24)
    for (const [index, count] of [[24, 48], [48, 51]]) {
      await loadMore.focus()
      await page.keyboard.press('Enter')
      await expect(entries).toHaveCount(count)
      await expect(entries.nth(index).locator(list.control).first()).toBeFocused()
      await page.keyboard.press('Tab')
      await expect.poll(() => entries.nth(index).evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    await expect(loadMore).toHaveCount(0)
  })
}

for (const hideChannelActions of [false, true]) {
  test(`subscribed channels Load more focuses the final batch with channel actions ${hideChannelActions ? 'hidden' : 'visible'}`, async ({ page }) => {
    await page.evaluate(async hidden => {
      await window.$store.dispatch('updateDisableChannelLinks', hidden)
      await window.$store.dispatch('updateHideUnsubscribeButton', hidden)
      await window.$store.dispatch('updateSubscribedChannelsSortBy', 'name_ascending')
    }, hideChannelActions)
    await goTo(page, 'subscribedchannels')
    const entries = page.locator('#subscribedChannelsList > .channel')
    await expect(entries).toHaveCount(50)
    await page.getByRole('button', { name: 'Load more channels', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(entries).toHaveCount(51)
    await expect(entries.nth(50).locator('.thumbnailContainer')).toBeFocused()
    await expect(page.getByRole('button', { name: 'Load more channels', exact: true })).toHaveCount(0)
  })
}
