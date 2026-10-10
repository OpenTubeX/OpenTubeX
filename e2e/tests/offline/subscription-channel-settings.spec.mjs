import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  test,
  expect,
  expectScrollAtRenderedEnd,
  goTo,
  goToSettingsSection,
  openNewWindowFromTabBar,
  waitForAppReady,
  setWindowSize
} from '../../helpers/app.mjs'

const CHANNEL_ID = `UC${'0'.repeat(22)}`
const subscriptions = Array.from({ length: 18 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: index === 0 ? 'Alpha Channel' : `Channel ${String(index).padStart(2, '0')}`,
  thumbnail: '',
  ...(index === 0 ? { feedTypes: ['videos'] } : {}),
  ...(index === 1 ? { dailyVideoLimit: 1, showMembersOnly: true } : {})
}))

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      uiScale: 125,
      fetchSubscriptionsAutomatically: false,
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

for (const uiScale of [100, 95, 125]) {
  test(`subscription cards keep equal spacing and readable feed buttons at ${uiScale}%`, async ({ app, page }, testInfo) => {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), uiScale)
    await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 40, y: 40, width: 1400, height: 900 })))
    const settings = await goToSettingsSection(page, 'subscription')
    await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    for (const width of [1600, 480]) {
      await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
      await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(width * 100 / uiScale, 0)
      const card = page.locator('.channelSettings').first()
      await card.scrollIntoViewIfNeeded()
      const gaps = await card.evaluate(element => {
        const feed = element.querySelector('.feedTypeOptions').getBoundingClientRect()
        const members = element.querySelector('.membersOnlySetting').getBoundingClientRect()
        const toggle = element.querySelector('.switch-ctn').getBoundingClientRect()
        const daily = element.querySelector('.dailyLimitSetting').getBoundingClientRect()
        const select = element.querySelector('.select-label').getBoundingClientRect()
        return [members.top - feed.bottom, toggle.top - members.top - 1, daily.top - toggle.bottom, select.top - daily.top - 1]
      })
      for (const gap of gaps) expect.soft(gap).toBeCloseTo(gaps[1], 0)
      for (const label of await card.locator('.feedTypeOption > span').all()) {
        expect.soft(await label.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      }
      expect(await card.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await card.screenshot({ path: testInfo.outputPath(`subscription-card-${width}.png`) })
    }
  })
}

for (const uiScale of [100, 95]) {
  test(`keeps subscription popover controls compact at ${uiScale}%`, async ({ app, page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), uiScale)
    await goTo(page, 'subscribedchannels')
    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.getByRole('button', { name: 'Subscription settings' }).click()
    const popover = page.locator('.profileDropdown')
    for (const width of [1200, 400]) {
      await setWindowSize(app, page, { width, height: width === 1200 ? 800 : 900 })
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        const gap = await popover.evaluate(element => {
          const members = element.querySelector('.membersOnlyPreference button').getBoundingClientRect()
          const label = element.querySelector('.dailyVideoLimitSelect .select-label').getBoundingClientRect()
          return label.top - members.bottom
        })
        expect.soft(gap, `${direction} control spacing at ${width}px`).toBeGreaterThanOrEqual(6.95)
        expect.soft(gap, `${direction} control spacing at ${width}px`).toBeLessThanOrEqual(9.05)
        const bottomGap = await popover.locator('.dailyVideoLimitPreference').evaluate(element => (
          element.getBoundingClientRect().bottom - element.querySelector('.select-text').getBoundingClientRect().bottom
        ))
        expect.soft(bottomGap, `${direction} empty space below the daily limit at ${width}px`).toBeCloseTo(0, 0)
        await expect(popover.getByRole('combobox', { name: 'Videos per day' })).toBeVisible()
      }
      await page.evaluate(() => { document.body.dir = 'ltr' })
      await popover.screenshot({ path: testInfo.outputPath(`subscription-popover-${width}.png`) })
    }
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateYtDlpPlaybackAuthMode', 'none'))
    await expect(popover.getByRole('checkbox', { name: 'Members only' })).toHaveCount(0)
    await expect(popover.getByRole('combobox', { name: 'Videos per day' })).toBeVisible()
    expect(await popover.evaluate(element => {
      const label = element.querySelector('.dailyVideoLimitSelect .select-label').getBoundingClientRect()
      return label.top - element.querySelector('.secondaryPreferences').getBoundingClientRect().top
    })).toBeGreaterThanOrEqual(5)
  })
}

for (const uiScale of [100, 95, 125]) {
  test(`keeps the selection toolbar fixed with equal search and list gaps at ${uiScale}%`, async ({ app, page }, testInfo) => {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), uiScale)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'dark'))
    const settings = await goToSettingsSection(page, 'subscription')
    await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    const toolbar = page.locator('.channelSelectionToolbar')
    const scroller = page.locator('.channelSettingsScroller')
    for (const width of [1600, 480]) {
      await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
      await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(width * 100 / uiScale, 0)
      await scroller.evaluate(element => { element.scrollTop = 0 })
      await expect.poll(() => page.evaluate(() => {
        const search = document.querySelector('.channelSettingsHeader .ft-input').getBoundingClientRect()
        const toolbar = document.querySelector('.channelSelectionToolbar').getBoundingClientRect()
        const card = document.querySelector('.channelSettings').getBoundingClientRect()
        return Math.abs(toolbar.top - search.bottom - (card.top - toolbar.bottom))
      })).toBeLessThanOrEqual(1)
      await page.locator('.settingsWindow').screenshot({ path: testInfo.outputPath(`subscription-settings-${width}.png`) })
      const initialBounds = await toolbar.boundingBox()
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      // IntersectionObserver can round full visibility below 1 at fractional zoom.
      await expect(toolbar).toBeInViewport({ ratio: 0.999 })
      expect((await toolbar.boundingBox()).y).toBeCloseTo(initialBounds.y, 0)
      await expectScrollAtRenderedEnd(scroller)
      await toolbar.getByRole('button', { name: 'Select All' }).click()
      await expect(toolbar).toContainText(`${subscriptions.length} selected`)
      const bulkMembers = toolbar.getByRole('checkbox', { name: 'Members only' })
      expect.soft(await bulkMembers.evaluate(element => element.tagName), 'bulk members setting uses the standard switch').toBe('INPUT')
      const bulkGap = await toolbar.evaluate(element => {
        const buttons = element.querySelector('.bulkFeedTypeOptions').getBoundingClientRect()
        const additional = element.querySelector('.bulkAdditionalSettings').getBoundingClientRect()
        return additional.top - buttons.bottom
      })
      expect.soft(bulkGap, 'bulk controls use the regular 20px settings gap').toBeCloseTo(20, 0)
      await expect(toolbar).toBeInViewport({ ratio: 0.999 })
      await page.locator('.settingsWindow').screenshot({ path: testInfo.outputPath(`subscription-settings-selected-${width}.png`) })
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expectScrollAtRenderedEnd(scroller)
      await toolbar.getByRole('button', { name: 'Select None' }).click()
      await expect(toolbar).toContainText('0 selected')
      await expectScrollAtRenderedEnd(scroller)
    }

    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    const previousRange = await scroller.evaluate(element => element.scrollHeight - element.clientHeight)
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1600, height: 1000 }))
    await expect.poll(async () => Math.abs(await page.evaluate(() => innerWidth) - 1600 * 100 / uiScale)).toBeLessThanOrEqual(1)
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(previousRange)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  })
}

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

test('changes subscription settings for selected channels', async ({ app, attachScreenshot, page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()

  const selectionToolbar = page.locator('.channelSelectionToolbar')
  const selectAll = selectionToolbar.getByRole('button', { name: 'Select All' })
  const selectNone = selectionToolbar.getByRole('button', { name: 'Select None' })
  await expect(selectAll.locator('.channelSelectionActionIcon')).toHaveCount(1)
  await expect(selectNone.locator('.channelSelectionActionIcon')).toHaveCount(1)
  for (const button of [selectAll, selectNone]) {
    await expect.poll(() => button.evaluate(element => {
      const label = element.querySelector(':scope > span')
      const icon = element.querySelector(':scope > .channelSelectionActionIcon')
      return label?.getBoundingClientRect().right <= icon?.getBoundingClientRect().left
    })).toBe(true)
  }
  await expect(selectionToolbar).toContainText('0 selected')
  await expect(page.locator('.bulkFeedTypeSettings')).toHaveCount(0)

  await selectAll.click()
  await expect(selectionToolbar).toContainText(`${subscriptions.length} selected`)
  await expect(page.getByRole('checkbox', { name: 'Alpha Channel' }))
    .toHaveAttribute('aria-checked', 'true')
  await selectNone.click()

  await page.getByRole('checkbox', { name: 'Alpha Channel' }).click()
  await page.getByRole('checkbox', { name: 'Channel 01' }).click()
  await expect(selectionToolbar).toContainText('2 selected')

  const bulkSettings = page.locator('.bulkFeedTypeSettings')
  const bulkVideos = bulkSettings.getByRole('checkbox', { name: 'Videos' })
  const bulkShorts = bulkSettings.getByRole('checkbox', { name: 'Shorts' })
  const bulkMembersOnly = bulkSettings.getByRole('checkbox', { name: 'Members only' })
  const bulkDailyLimit = bulkSettings.getByRole('combobox', { name: 'Videos per day' })
  await expect(bulkVideos).toHaveAttribute('aria-checked', 'true')
  await expect(bulkShorts).toHaveAttribute('aria-checked', 'mixed')
  await expect(bulkMembersOnly).toHaveAttribute('aria-checked', 'mixed')
  await expect(bulkMembersOnly).toHaveJSProperty('indeterminate', true)
  await expect(bulkDailyLimit).toHaveText('Different values')

  await setWindowSize(app, page, { width: 375, height: 700 })
  await expect.poll(() => page.locator('.settingsContent').evaluate(element => (
    element.scrollWidth - element.clientWidth
  ))).toBeLessThanOrEqual(1)
  await attachScreenshot('compact subscription channel selection controls')
  await bulkDailyLimit.scrollIntoViewIfNeeded()
  await expect(bulkMembersOnly).toBeVisible()
  await expect(bulkDailyLimit).toBeVisible()
  await attachScreenshot('compact subscription channel batch settings')

  await bulkVideos.click()
  await bulkShorts.click()
  await bulkMembersOnly.focus()
  await bulkMembersOnly.press('Space')
  await expect(bulkMembersOnly).toBeChecked()
  await expect(bulkMembersOnly).toHaveJSProperty('indeterminate', false)
  await bulkSettings.locator('.bulkMembersOnlySetting .switch-label').click()
  await expect(bulkMembersOnly).not.toBeChecked()
  await bulkMembersOnly.focus()
  await bulkMembersOnly.press('Space')
  await bulkDailyLimit.click()
  await page.getByRole('option', { name: '2', exact: true }).click()
  await expect(bulkVideos).toHaveAttribute('aria-checked', 'false')
  await expect(bulkShorts).toHaveAttribute('aria-checked', 'true')
  await expect(bulkMembersOnly).toBeChecked()
  await expect(bulkMembersOnly).toHaveJSProperty('indeterminate', false)
  await expect(bulkDailyLimit).toHaveText('2')

  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const latestProfiles = new Map(records.map(record => [record._id, record]))
    return ['allChannels', 'profile-1'].map(profileId => (
      latestProfiles.get(profileId).subscriptions
        .filter(channel => [subscriptions[0].id, subscriptions[1].id].includes(channel.id))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(channel => ({
          dailyVideoLimit: channel.dailyVideoLimit,
          feedTypes: channel.feedTypes,
          showMembersOnly: channel.showMembersOnly
        }))
    ))
  }).toEqual([
    [
      { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true },
      { dailyVideoLimit: 2, feedTypes: ['shorts', 'live', 'posts'], showMembersOnly: true }
    ],
    [
      { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true }
    ]
  ])

  const scroller = page.locator('.channelSettingsScroller')
  const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

  await selectNone.evaluate(button => button.click())
  await expect(selectionToolbar).toContainText('0 selected')
  await expect(page.locator('.bulkFeedTypeSettings')).toHaveCount(0)
  await expectScrollAtRenderedEnd(scroller)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  await setWindowSize(app, page, { width: 1600, height: 900 })
  await expectScrollAtRenderedEnd(scroller)
  await expect(page.locator('.channelSettings').last()).toBeInViewport()
  await attachScreenshot('subscription list stays at the bottom after clearing the selection')
})

test('only offers members-only controls when yt-dlp playback cookies are configured', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Members only' })).toHaveCount(subscriptions.length)
  await page.locator('.channelSelectionToolbar').getByRole('button', { name: 'Select All' }).click()
  await expect(page.getByRole('checkbox', { name: 'Members only' })).toHaveCount(subscriptions.length + 1)

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
    hasText: 'Failed to save channel settings'
  })).toBeVisible()
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
})

test('does not carry a failed popover edit into a later update', async ({ app, page }) => {
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  const popover = page.locator('.profileDropdown')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const updateChannelSettings = store._actions.updateChannelSettings[0]
    let updateCount = 0
    store._actions.updateChannelSettings = [payload => {
      updateCount++
      if (updateCount === 1) {
        return new Promise(resolve => {
          window.resolveFirstChannelSettingsWrite = () => resolve(false)
        })
      }
      return updateChannelSettings(payload)
    }]
    window.channelSettingsUpdateCount = () => updateCount
  })

  await popover.getByRole('checkbox', { name: 'Members only' }).click()
  await expect.poll(() => page.evaluate(() => window.channelSettingsUpdateCount())).toBe(1)

  const limit = popover.getByRole('combobox', { name: 'Videos per day' })
  await limit.click()
  await page.getByRole('option', { name: '2', exact: true }).click()
  await page.evaluate(() => window.resolveFirstChannelSettingsWrite())

  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const channel = records.filter(record => record._id === 'allChannels').at(-1).subscriptions
      .find(subscription => subscription.id === CHANNEL_ID)
    return {
      dailyVideoLimit: channel.dailyVideoLimit,
      showMembersOnly: channel.showMembersOnly ?? false
    }
  }).toEqual({ dailyVideoLimit: 2, showMembersOnly: false })
  await expect(page.locator('.toast', {
    hasText: 'Failed to save channel settings'
  })).toBeVisible()
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
    hasText: 'Failed to save channel settings'
  })).toBeVisible()
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
})

test('saves Select All members-only changes together before leaving the manager', async ({ app, page }) => {
  const settings = await goToSettingsSection(page, 'subscription')
  await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await page.locator('.channelSelectionToolbar').getByRole('button', { name: 'Select All' }).click()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.subscriptionSettingsSaves = 0
    store.subscribeAction(({ type }) => {
      if (type === 'updateChannelSettings' || type === 'batchUpdateChannelSettings') {
        window.subscriptionSettingsSaves += 1
      }
    })
  })
  const members = page.locator('.bulkMembersOnlySetting')
  await expect(members.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed')
  await members.locator('.switch-label').click()
  await expect(members.getByRole('checkbox')).toBeChecked()
  await members.locator('.switch-label').click()
  await expect(members.getByRole('checkbox')).not.toBeChecked()
  await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .getters.getProfileList.every(profile => profile.subscriptions.every(channel => channel.showMembersOnly === false))
  ))).toBe(true)
  expect(await page.evaluate(() => window.subscriptionSettingsSaves)).toBe(2)
  ;({ page } = await app.relaunch())
  expect(await page.evaluate(() => (
    document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .getters.getProfileList.every(profile => profile.subscriptions.every(channel => channel.showMembersOnly === false))
  ))).toBe(true)
})

test('keeps queued bulk changes for remaining channels after another window unsubscribes', async ({ app, page }) => {
  const other = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(other)
  const settings = await goToSettingsSection(page, 'subscription')
  await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await page.locator('.channelSelectionToolbar').getByRole('button', { name: 'Select All' }).click()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const save = store._actions.batchUpdateChannelSettings[0]
    let first = true
    store._actions.batchUpdateChannelSettings = [async updates => {
      if (first) {
        first = false
        await new Promise(resolve => { window.releaseBulkSave = resolve })
      }
      return save(updates)
    }]
  })
  const members = page.locator('.bulkMembersOnlySetting')
  await members.locator('.switch-label').click()
  await expect(members.getByRole('checkbox')).toBeChecked()
  await members.locator('.switch-label').click()
  await expect(members.getByRole('checkbox')).not.toBeChecked()
  await other.evaluate(channelId => (
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('removeChannelFromProfiles', {
      channelId, profileIds: ['allChannels', 'profile-1']
    })
  ), CHANNEL_ID)
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveProfile.subscriptions.length
  ))).toBe(subscriptions.length - 1)
  await page.evaluate(() => window.releaseBulkSave())
  for (const window of [page, other]) {
    await expect.poll(() => window.evaluate(() => (
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getProfileList
        .every(profile => profile.subscriptions.every(channel => channel.showMembersOnly === false))
    ))).toBe(true)
  }
  await expect(page.locator('.toast', { hasText: 'Failed to save channel settings' })).toHaveCount(1)
  ;({ page } = await app.relaunch())
  expect(await page.evaluate(() => {
    const channels = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveProfile.subscriptions
    return { count: channels.length, allDisabled: channels.every(channel => channel.showMembersOnly === false) }
  })).toEqual({ count: subscriptions.length - 1, allDisabled: true })
})

test('reports one failure toast for a failed batch update', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    let updateCount = 0
    store._actions.batchUpdateChannelSettings = [() => {
      updateCount += 1
      return Promise.resolve(false)
    }]
    window.channelSettingsUpdateCount = () => updateCount
  })

  const selectionToolbar = page.locator('.channelSelectionToolbar')
  await selectionToolbar.getByRole('button', { name: 'Select All' }).click()
  await page.locator('.bulkFeedTypeSettings')
    .getByRole('checkbox', { name: 'Videos' })
    .click()

  await expect.poll(() => page.evaluate(() => window.channelSettingsUpdateCount()))
    .toBe(1)
  await expect(page.locator('.toast', {
    hasText: 'Failed to save channel settings'
  })).toHaveCount(1)
})

test('preserves the mixed members-only switch after a failed bulk save', async ({ page }) => {
  const settings = await goToSettingsSection(page, 'subscription')
  await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store._actions.batchUpdateChannelSettings = [() => Promise.resolve(false)]
  })
  await page.locator('.channelSelectionToolbar').getByRole('button', { name: 'Select All' }).click()
  const members = page.locator('.bulkFeedTypeSettings').getByRole('checkbox', { name: 'Members only' })
  await expect(members).toHaveJSProperty('indeterminate', true)
  await members.focus()
  await members.press('Space')
  await expect(page.locator('.toast', { hasText: 'Failed to save channel settings' })).toHaveCount(1)
  await expect(members).toHaveJSProperty('indeterminate', true)
  await expect(members).toHaveJSProperty('checked', false)
  await expect(members).toHaveAttribute('aria-checked', 'mixed')
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

  await page.getByLabel('Search channels').fill('Alpha Channel')
  await expect(page.locator('.channelSettings')).toHaveCount(1)
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})

test('records edit times per channel and does not retimestamp received settings', async ({ page }) => {
  const result = await page.evaluate(async (channelId) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const secondChannelId = store.state.profiles.profileList[0].subscriptions[1].id
    const timestamps = () => Object.fromEntries(store.state.profiles.profileList[0].subscriptions.map(channel => [channel.id, channel.subscriptionSettingsUpdatedAt]))
    await store.dispatch('updateChannelSettings', { channelId, settings: { dailyVideoLimit: 2 } })
    const firstEdit = timestamps()
    await store.dispatch('updateChannelSettings', { channelId: secondChannelId, settings: { dailyVideoLimit: 3 } })
    const secondEdit = timestamps()
    await store.dispatch('updateChannelSettings', { channelId, settings: { dailyVideoLimit: 4 }, fromSync: true, updatedAt: 123 })
    return { firstEdit, secondEdit, afterSync: timestamps(), secondChannelId }
  }, CHANNEL_ID)
  expect(result.firstEdit[CHANNEL_ID]).toBeGreaterThan(0)
  expect(result.secondEdit[CHANNEL_ID]).toBe(result.firstEdit[CHANNEL_ID])
  expect(result.secondEdit[result.secondChannelId]).toBeGreaterThan(0)
  expect(result.afterSync).toEqual({ ...result.secondEdit, [CHANNEL_ID]: 123 })
})
