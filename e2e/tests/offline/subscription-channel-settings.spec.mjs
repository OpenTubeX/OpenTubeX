import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'

const CHANNEL_ID = `UC${'0'.repeat(22)}`
const subscriptions = Array.from({ length: 18 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: index === 0 ? 'Alpha Channel' : `Channel ${String(index).padStart(2, '0')}`,
  thumbnail: '',
  ...(index === 0 ? { feedTypes: ['videos'] } : {})
}))

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      uiScale: 125,
      ytDlpPlaybackAuthMode: 'browser',
      ytDlpPlaybackCookiesBrowser: 'firefox'
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions
      },
      {
        _id: 'profile-1',
        name: 'Profile 1',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [subscriptions[0]]
      }
    ]
  }
})

test('keeps the popover and Subscription Settings manager in sync', async ({ app, page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.querySelector('.channelSettingsScroller')
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scroller.scrollWidth - scroller.clientWidth
    )
  })).toBeLessThanOrEqual(1)

  const alphaSettings = page.getByRole('group', { name: 'Alpha Channel' })
  const videos = alphaSettings.getByRole('checkbox', { name: 'Videos' })
  const shorts = alphaSettings.getByRole('checkbox', { name: 'Shorts' })
  await expect(videos).toHaveAttribute('aria-checked', 'true')
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
  await shorts.click()
  await videos.click()
  const membersOnly = alphaSettings.getByRole('checkbox', { name: 'Members only' })
  await expect(membersOnly).not.toBeChecked()
  await alphaSettings.locator('label', { hasText: 'Members only' }).click()
  await expect(membersOnly).toBeChecked()

  const alphaLimit = alphaSettings
    .getByRole('combobox', { name: 'Videos per day' })
  await expect(alphaLimit).toHaveText('Use global setting')
  await alphaLimit.click()
  await page.getByRole('option', { name: '2', exact: true }).click()

  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const latestProfiles = new Map(records.map(record => [record._id, record]))
    return ['allChannels', 'profile-1'].map(profileId => {
      const channel = latestProfiles.get(profileId).subscriptions
        .find(subscription => subscription.id === CHANNEL_ID)
      return {
        dailyVideoLimit: channel.dailyVideoLimit,
        feedTypes: channel.feedTypes,
        showMembersOnly: channel.showMembersOnly
      }
    })
  }).toEqual([
    { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true },
    { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true }
  ])

  ;({ page } = await app.relaunch())
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  const popover = page.locator('.profileDropdown')
  await expect(popover).toHaveClass(/profileDropdownPositioned/)
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(1)
  const [popoverBounds, viewport] = await Promise.all([
    popover.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  ])
  expect(popoverBounds.x).toBeGreaterThanOrEqual(0)
  expect(popoverBounds.y).toBeGreaterThanOrEqual(0)
  expect(popoverBounds.x + popoverBounds.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(popoverBounds.y + popoverBounds.height).toBeLessThanOrEqual(viewport.height + 1)
  const popoverScroller = popover.locator('.profileDropdownScroller')
  await expect(popoverScroller).toHaveAttribute('data-overlayscrollbars-viewport')
  await expect(popoverScroller.locator(':scope > .os-scrollbar-vertical'))
    .toHaveClass(/os-scrollbar-unusable/)
  const popoverVideos = popover.getByRole('checkbox', { name: 'Videos' })
  const popoverShorts = popover.getByRole('checkbox', { name: 'Shorts' })
  await expect.poll(async () => {
    const [videosBounds, shortsBounds] = await Promise.all([
      popoverVideos.boundingBox(),
      popoverShorts.boundingBox()
    ])
    return Math.abs(videosBounds.y - shortsBounds.y) <= 1 &&
      shortsBounds.x > videosBounds.x
  }).toBe(true)
  await expect(popoverVideos)
    .toHaveAttribute('aria-checked', 'false')
  await expect(popoverShorts)
    .toHaveAttribute('aria-checked', 'true')
  const popoverMembersOnly = popover.getByRole('checkbox', { name: 'Members only' })
  await expect(popoverMembersOnly).toHaveAttribute('aria-checked', 'true')
  await popoverMembersOnly.click()
  await expect(popoverMembersOnly).toHaveAttribute('aria-checked', 'false')
  await popover.getByRole('checkbox', { name: 'Live' }).click()
  const popoverLimit = page.locator('.profileDropdown')
    .getByRole('combobox', { name: 'Videos per day' })
  await expect(popoverLimit).toHaveText('2')

  await popoverLimit.click()
  await page.getByRole('option', { name: 'Unlimited' }).click()
  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const channel = records.filter(record => record._id === 'allChannels').at(-1).subscriptions
      .find(subscription => subscription.id === CHANNEL_ID)
    return {
      dailyVideoLimit: channel.dailyVideoLimit,
      showMembersOnly: channel.showMembersOnly
    }
  }).toEqual({ dailyVideoLimit: null, showMembersOnly: false })

  const reopenedSubscriptionSettings = await goToSettingsSection(page, 'subscription')
  await reopenedSubscriptionSettings
    .getByRole('button', { name: 'Subscription settings', exact: true })
    .click()
  const syncedAlphaSettings = page.getByRole('group', { name: 'Alpha Channel' })
  await expect(syncedAlphaSettings.getByRole('checkbox', { name: 'Live' }))
    .toHaveAttribute('aria-checked', 'true')
  await expect(syncedAlphaSettings.getByRole('checkbox', { name: 'Members only' }))
    .not.toBeChecked()
  await expect(syncedAlphaSettings
    .getByRole('combobox', { name: 'Videos per day' })).toHaveText('Unlimited')
})

test('only offers members-only controls when yt-dlp playback cookies are configured', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Members only' })).toHaveCount(subscriptions.length)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'none')
  })

  await expect(page.getByRole('checkbox', { name: 'Members only' })).toHaveCount(0)

  await page.locator('.settingsWindow').getByRole('button', { name: 'Close' }).click()
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  await expect(page.locator('.profileDropdown')
    .getByRole('checkbox', { name: 'Members only' })).toHaveCount(0)
})

test('reports subscription setting write failures from the channel popover', async ({ page }) => {
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  const popover = page.locator('.profileDropdown')
  const shorts = popover.getByRole('checkbox', { name: 'Shorts' })
  await expect(shorts).toHaveAttribute('aria-checked', 'false')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store._actions.updateChannelSettings = [() => Promise.resolve(false)]
  })
  await shorts.click()

  await expect(page.locator('.toast', {
    hasText: 'Failed to save subscription settings'
  })).toBeVisible()
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
})

test('reports subscription setting write failures from the settings manager', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  const alphaSettings = page.getByRole('group', { name: 'Alpha Channel' })
  const shorts = alphaSettings.getByRole('checkbox', { name: 'Shorts' })
  await expect(shorts).toHaveAttribute('aria-checked', 'false')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store._actions.updateChannelSettings = [() => Promise.resolve(false)]
  })
  await shorts.click()

  await expect(page.locator('.toast', {
    hasText: 'Failed to save subscription settings'
  })).toBeVisible()
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
})

test('reports a partial write when a requested profile no longer exists', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.state.profiles.profileList.push({
      _id: 'removed-profile',
      name: 'Removed profile',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{
        id: 'UC0000000000000000000000',
        name: 'Alpha Channel',
        thumbnail: '',
        feedTypes: ['videos']
      }]
    })

    const saved = await store.dispatch('updateChannelSettings', {
      channelId: 'UC0000000000000000000000',
      settings: { feedTypes: ['shorts'] }
    })

    return {
      saved,
      feedTypesByProfile: Object.fromEntries(store.getters.getProfileList.map(profile => [
        profile._id,
        profile.subscriptions.find(channel => channel.id === 'UC0000000000000000000000')
          ?.feedTypes
      ]))
    }
  })

  expect(result).toEqual({
    saved: false,
    feedTypesByProfile: {
      allChannels: ['shorts'],
      'profile-1': ['shorts'],
      'removed-profile': ['videos']
    }
  })
})

test('clamps the channel list after searching', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()

  const scroller = page.locator('.channelSettingsScroller')
  const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
  await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

  await page.getByPlaceholder('Search channels').fill('Alpha Channel')
  await expect(page.locator('.channelSettings')).toHaveCount(1)
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})
