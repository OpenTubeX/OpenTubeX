import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  readDatastore,
  setWindowSize,
} from '../../helpers/app.mjs'

const CHANNEL_ID = `UC${'0'.repeat(22)}`
const OTHER_CHANNEL_ID = `UC${'1'.repeat(22)}`
const profile = subscriptions => [{
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#000000',
  textColor: '#FFFFFF',
  subscriptions
}]

test.use({
  seed: {
    settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false },
    profiles: profile([
      { id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '' },
      { id: OTHER_CHANNEL_ID, name: 'Beta Channel', thumbnail: '' }
    ])
  }
})

function readNotificationTypes(userDataDir) {
  const records = readDatastore(userDataDir, 'profiles').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const subscriptions = new Map(records.map(record => [record._id, record])).get('allChannels').subscriptions
  return Object.fromEntries(subscriptions.map(channel => [channel.name, channel.notificationFeedTypes]))
}

test('the bell is off per channel until turned on, which selects every type', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await goTo(page, 'subscribedchannels')
  const bell = page.locator('.channel', { hasText: 'Alpha Channel' }).getByRole('button', { name: 'Notify about new uploads', exact: true })
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  // Like the settings page, the popover lists notified types only while notifications are on.
  await page.locator('.channel', { hasText: 'Alpha Channel' }).getByRole('button', { name: 'Subscription settings', exact: true }).click()
  const popover = page.locator('.profileDropdown')
  const popoverNotifications = popover.getByRole('group', { name: 'Notify about new uploads', exact: true })
  await expect(popover).toBeVisible()
  await expect(popoverNotifications).toHaveCount(0)
  await bell.click()
  await expect(bell).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => readNotificationTypes(app.userDataDir)).toStrictEqual({
    'Alpha Channel': ['videos', 'shorts', 'live', 'posts'],
    'Beta Channel': undefined
  })

  await expect(popover).toBeVisible()
  await popoverNotifications.getByRole('checkbox', { name: 'Shorts' }).click()
  await expect.poll(() => readNotificationTypes(app.userDataDir)).toStrictEqual({
    'Alpha Channel': ['videos', 'live', 'posts'],
    'Beta Channel': undefined
  })
  const popoverLive = popoverNotifications.getByRole('checkbox', { name: 'Live' })
  await popover.getByRole('group', { name: 'Show in subscription feed', exact: true }).getByRole('checkbox', { name: 'Live' }).click()
  await expect(popoverLive).toBeDisabled()
  await expect(popoverLive).toHaveAttribute('aria-checked', 'false')
  await popover.getByRole('group', { name: 'Show in subscription feed', exact: true }).getByRole('checkbox', { name: 'Live' }).click()
  await expect(popoverLive).toBeEnabled()
  await expect(popoverLive).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  const settings = await goToSettingsSection(page, 'subscription')
  await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  const alpha = page.getByRole('group', { name: 'Alpha Channel' })
  await expect(alpha.getByRole('group', { name: 'Notify about new uploads' }).getByRole('checkbox', { name: 'Shorts' })).toHaveAttribute('aria-checked', 'false')
  // Feed types hidden from the subscription feed are not fetched, so they cannot notify.
  const liveNotification = alpha.getByRole('group', { name: 'Notify about new uploads' }).getByRole('checkbox', { name: 'Live' })
  await alpha.getByRole('group', { name: 'Show in subscription feed', exact: true }).getByRole('checkbox', { name: 'Live' }).click()
  await expect(liveNotification).toBeDisabled()
  await expect(liveNotification).toHaveAttribute('aria-checked', 'false')
  await alpha.getByRole('group', { name: 'Show in subscription feed', exact: true }).getByRole('checkbox', { name: 'Live' }).click()
  await expect(liveNotification).toBeEnabled()
  await expect(liveNotification).toHaveAttribute('aria-checked', 'true')
  const beta = page.getByRole('group', { name: 'Beta Channel' })
  await expect(beta.getByRole('checkbox', { name: 'Notify about new uploads' })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Alpha Channel' }).click()
  await page.getByRole('checkbox', { name: 'Beta Channel' }).click()
  const bulk = page.locator('.bulkFeedTypeSettings')
  await expect(bulk.getByRole('checkbox', { name: 'Notify about new uploads' })).toHaveAttribute('aria-checked', 'mixed')
  await bulk.locator('label', { hasText: 'Notify about new uploads' }).click()
  await expect.poll(() => readNotificationTypes(app.userDataDir)).toStrictEqual({
    'Alpha Channel': ['videos', 'live', 'posts'],
    'Beta Channel': ['videos', 'shorts', 'live', 'posts']
  })

  // Bulk notification changes skip channels that hide the feed type.
  await alpha.getByRole('group', { name: 'Show in subscription feed', exact: true }).getByRole('checkbox', { name: 'Posts' }).click()
  const bulkPosts = bulk.getByRole('group', { name: 'Notify about new uploads', exact: true }).getByRole('checkbox', { name: 'Posts' })
  await expect(bulkPosts).toHaveAttribute('aria-checked', 'true')
  await bulkPosts.click()
  await expect.poll(() => readNotificationTypes(app.userDataDir)).toStrictEqual({
    'Alpha Channel': ['videos', 'live', 'posts'],
    'Beta Channel': ['videos', 'shorts', 'live']
  })
})

test.describe('with a channel notification turned on', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false },
      profiles: profile([
        { id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos', 'live'] },
        { id: OTHER_CHANNEL_ID, name: 'Beta Channel', thumbnail: '' }
      ])
    }
  })

  test('refresh results notify only about new uploads of turned-on channels and types', async ({ app, page }) => {
    await app.electronApp.evaluate(({ Notification }) => {
      globalThis.shownUploadNotifications = []
      // CI has no notification server.
      Notification.isSupported = () => true
      Notification.prototype.show = function () {
        globalThis.shownUploadNotifications.push({ title: this.title, body: this.body })
      }
    })
    const shown = () => app.electronApp.evaluate(() => globalThis.shownUploadNotifications)
    const observe = (channelId, feedType, ids) => page.evaluate(({ channelId, feedType, ids }) => (
      window.ftElectron.subscriptionAutoRefresh.observeUploads({
        channelId,
        feedType,
        entries: ids.map(id => ({ id, title: `Upload ${id}`, published: Date.now(), live: false, upcoming: false, membersOnly: false }))
      })
    ), { channelId, feedType, ids })

    // The renderer configures the main process once its data is ready. Fresh IDs
    // per attempt keep an attempt that races the configuration from blocking later ones.
    let attempt = 0
    await expect.poll(async () => {
      attempt++
      await observe(CHANNEL_ID, 'videos', [`seed${attempt}`])
      await observe(CHANNEL_ID, 'videos', [`probe${attempt}`, `seed${attempt}`])
      return (await shown()).length
    }).toBe(1)

    await observe(CHANNEL_ID, 'videos', ['b', `probe${attempt}`, `seed${attempt}`])
    await observe(CHANNEL_ID, 'posts', ['p1'])
    await observe(CHANNEL_ID, 'posts', ['p2', 'p1'])
    await observe(OTHER_CHANNEL_ID, 'videos', ['x1'])
    await observe(OTHER_CHANNEL_ID, 'videos', ['x2', 'x1'])
    expect(await shown()).toStrictEqual([
      { title: 'New video from Alpha Channel', body: `Upload probe${attempt}` },
      { title: 'New video from Alpha Channel', body: 'Upload b' }
    ])
  })
})

test.describe('in a short window', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false },
      profiles: [
        ...profile([{ id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos', 'shorts', 'live', 'posts'] }]),
        ...['Profile 1', 'Profile 2', 'Profile 3'].map((name, index) => ({
          _id: `profile-${index}`, name, bgColor: '#000000', textColor: '#FFFFFF', subscriptions: []
        }))
      ]
    }
  })

  test('the popover keeps every preference reachable and its scroll range valid', { tag: '@scale' }, async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setWindowSize(app, page, { width: 1000, height: 380 })
    await goTo(page, 'subscribedchannels')
    await page.locator('.channel', { hasText: 'Alpha Channel' }).getByRole('button', { name: 'Subscription settings', exact: true }).click()
    const popover = page.locator('.profileDropdown')
    await expect(popover).toHaveClass(/profileDropdownPositioned/)
    const preferences = popover.locator('.feedTypePreferences')
    await expect(preferences).toHaveAttribute('data-overlayscrollbars-viewport')
    // The profile list keeps at least one row.
    expect((await popover.locator('.profileDropdownScroller').boundingBox()).height).toBeGreaterThanOrEqual(45.5)

    await preferences.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => preferences.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const limit = popover.getByRole('combobox', { name: 'Videos per day' })
    const [limitBox, preferencesBox] = await Promise.all([limit.boundingBox(), preferences.boundingBox()])
    expect(limitBox.y + limitBox.height).toBeLessThanOrEqual(preferencesBox.y + preferencesBox.height + 0.5)

    // The bell hides the notification group while the preferences stay scrolled to the bottom.
    await page.locator('.channel', { hasText: 'Alpha Channel' }).getByRole('button', { name: 'Notify about new uploads', exact: true }).click()
    await expect(popover.getByRole('group', { name: 'Notify about new uploads', exact: true })).toHaveCount(0)
    const scrollbar = preferences.locator(':scope > .os-scrollbar-vertical')
    await expect.poll(() => preferences.evaluate(element => (
      element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1
    ))).toBe(true)
    const overflows = await preferences.evaluate(element => element.scrollHeight > element.clientHeight + 1)
    await expect(scrollbar).toHaveClass(overflows ? /^(?!.*os-scrollbar-unusable)/ : /os-scrollbar-unusable/)
  })
})
