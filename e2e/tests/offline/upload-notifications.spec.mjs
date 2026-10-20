import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  readDatastore,
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
  await bell.click()
  await expect(bell).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => readNotificationTypes(app.userDataDir)).toStrictEqual({
    'Alpha Channel': ['videos', 'shorts', 'live', 'posts'],
    'Beta Channel': undefined
  })

  // The popover keeps feed settings only.
  await page.locator('.channel', { hasText: 'Alpha Channel' }).getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await expect(page.locator('.profileDropdown')).toBeVisible()
  await expect(page.locator('.profileDropdown').getByText('Notify about new uploads')).toHaveCount(0)
  await page.keyboard.press('Escape')

  const settings = await goToSettingsSection(page, 'subscription')
  await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  const alpha = page.getByRole('group', { name: 'Alpha Channel' })
  await alpha.getByRole('group', { name: 'Notify about new uploads' }).getByRole('checkbox', { name: 'Shorts' }).click()
  await expect.poll(() => readNotificationTypes(app.userDataDir)).toStrictEqual({
    'Alpha Channel': ['videos', 'live', 'posts'],
    'Beta Channel': undefined
  })
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
