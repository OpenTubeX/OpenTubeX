import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  latestSettings,
  readDatastore,
  setWindowSize,
} from '../../helpers/app.mjs'

const CHANNEL_ID = `UC${'0'.repeat(22)}`

test.use({
  seed: {
    settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos', 'shorts', 'live', 'posts'] }]
    }]
  }
})

/**
 * Replaces system notifications with a record of them, and decides whether the
 * app counts as in use, since a test window's focus depends on the display.
 * @param {{ electronApp: import('@playwright/test').ElectronApplication }} app
 * @param {{ supported?: boolean, foreground?: boolean }} [options]
 */
function mockSystemNotifications({ electronApp }, { supported = true, foreground = false } = {}) {
  return electronApp.evaluate(({ BrowserWindow, Notification, net }, { supported, foreground }) => {
    globalThis.shownNotifications = []
    // Thumbnails fail right away instead of delaying system notifications.
    const fetch = net.fetch
    net.fetch = (url, ...options) => String(url).includes('/vi/') ? Promise.reject(new Error('No thumbnails offline')) : fetch(url, ...options)
    // CI has no notification server.
    Notification.isSupported = () => supported
    Notification.prototype.show = function () {
      globalThis.shownNotifications.push({ title: this.title, body: this.body })
    }
    BrowserWindow.getFocusedWindow = () => foreground ? BrowserWindow.getAllWindows()[0] : null
  }, { supported, foreground })
}

const shownNotifications = ({ electronApp }) => electronApp.evaluate(() => globalThis.shownNotifications)

/**
 * Reports new uploads from the channel until the main process announces them.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} ids
 * @param {() => Promise<number>} [announced] counts the announced uploads, by default in the bell
 */
async function announceUploads(page, ids, announced) {
  const observe = (feedIds) => page.evaluate(({ channelId, feedIds }) => (
    window.ftElectron.subscriptionAutoRefresh.observeUploads({
      channelId,
      feedType: 'videos',
      entries: feedIds.map(id => ({ id, title: `Upload ${id}`, published: Date.now(), live: false, upcoming: false, membersOnly: false }))
    })
  ), { channelId: CHANNEL_ID, feedIds })
  const historyLength = announced ?? (() => page.evaluate(async () => (await window.ftElectron.notificationHistory.list()).length))

  // The renderer configures the main process once its data is ready. Fresh IDs
  // per attempt keep an attempt that races the configuration from blocking later ones.
  let attempt = 0
  await expect.poll(async () => {
    attempt++
    await observe([`seed${attempt}`])
    await observe([...ids.map(id => `${id}-${attempt}`), `seed${attempt}`])
    return historyLength()
  }).toBe(ids.length)
  return ids.map(id => `${id}-${attempt}`)
}

test('the bell lists system notifications and opens them', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  const [first, second] = await announceUploads(page, ['b', 'a'])
  // The bell keeps a copy; the system still shows every notification, once its thumbnail loaded or failed.
  await expect.poll(() => shownNotifications(app)).toStrictEqual([
    { title: 'New video from Alpha Channel', body: `Upload ${first}` },
    { title: 'New video from Alpha Channel', body: `Upload ${second}` }
  ])

  // Video notifications keep their thumbnails, which follow the thumbnail settings.
  expect((await page.evaluate(() => window.ftElectron.notificationHistory.list())).map(entry => entry.thumbnail)).toStrictEqual([
    `https://i.ytimg.com/vi/${second}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${first}/mqdefault.jpg`
  ])
  const bell = page.locator('.notificationCenter')
  await expect(bell).toHaveAttribute('data-unread-count', '2')
  await page.getByRole('button', { name: 'Notifications (2 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  const entries = dropdown.locator('.notificationEntry')
  const markRead = dropdown.getByRole('button', { name: 'Mark as read', exact: true })
  await expect(entries).toHaveCount(2)
  await expect(entries.locator('.notificationThumbnail')).toHaveCount(2)
  // The newest notification comes first.
  await expect(entries.nth(0)).toContainText('New video from Alpha Channel')
  await expect(entries.nth(0)).toContainText(`Upload ${second}`)
  await expect(entries.nth(1)).toContainText(`Upload ${first}`)
  // Looking at the list leaves its entries unread.
  await expect(markRead).toHaveCount(2)

  // Opening an entry marks it read.
  await entries.nth(1).click()
  await expect(page).toHaveURL(new RegExp(`#/watch/${first}$`))
  await expect(dropdown).toHaveCount(0)
  await expect(bell).toHaveAttribute('data-unread-count', '1')

  await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click()
  await expect(markRead).toHaveCount(1)
  await markRead.click()
  await expect(markRead).toHaveCount(0)
  // The dropdown stays open after its button disappears.
  await expect(entries).toHaveCount(2)
  await expect(bell).not.toHaveAttribute('data-unread-count')
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()

  await dropdown.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(dropdown.getByText('No notifications yet')).toBeVisible()
  await expect(dropdown.getByRole('button', { name: 'Clear all', exact: true })).toHaveCount(0)
})

test('mark all as read keeps the list open', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  await announceUploads(page, ['b', 'a'])

  await page.getByRole('button', { name: 'Notifications (2 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  await dropdown.getByRole('button', { name: 'Mark all as read', exact: true }).click()
  await expect(dropdown.getByRole('button', { name: 'Mark as read', exact: true })).toHaveCount(0)
  await expect(dropdown.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0)
  await expect(dropdown.locator('.notificationEntry')).toHaveCount(2)
  await expect(page.locator('.notificationCenter')).not.toHaveAttribute('data-unread-count')
})

test('notifications appear in the app instead of the system while it is in use', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app, { foreground: true })
  // Notifications the user turned on are not routine, so they stay with only important ones.
  await page.evaluate(() => window.$store.dispatch('updateOnlyShowImportantToasts', true))
  const [upload] = await announceUploads(page, ['a'])
  expect(await shownNotifications(app)).toStrictEqual([])

  const toast = page.locator('.toast', { hasText: `New video from Alpha Channel: Upload ${upload}` })
  await expect(toast).toBeVisible()
  await expect(page.locator('.notificationCenter')).toHaveAttribute('data-unread-count', '1')
  await toast.click()
  await expect(page).toHaveURL(new RegExp(`#/watch/${upload}$`))
  await expect(page.locator('.notificationCenter')).not.toHaveAttribute('data-unread-count')
})

test('system notifications load the video thumbnail through the app session', async ({ app, page }) => {
  await mockSystemNotifications(app)
  await app.electronApp.evaluate(({ nativeImage, net }) => {
    globalThis.fetchedImages = []
    globalThis.createdImages = 0
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    net.fetch = async url => {
      globalThis.fetchedImages.push(String(url))
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    }
    const createFromBuffer = nativeImage.createFromBuffer
    nativeImage.createFromBuffer = (...args) => {
      globalThis.createdImages++
      return createFromBuffer(...args)
    }
  })
  const [upload] = await announceUploads(page, ['a'], async () => (await shownNotifications(app)).length)
  expect(await app.electronApp.evaluate(() => globalThis.fetchedImages)).toStrictEqual([`https://i.ytimg.com/vi/${upload}/mqdefault.jpg`])
  expect(await app.electronApp.evaluate(() => globalThis.createdImages)).toBe(1)
})

test('the bell records notifications the system cannot show', async ({ app, page }) => {
  await mockSystemNotifications(app, { supported: false })
  await announceUploads(page, ['a'])
  expect(await shownNotifications(app)).toStrictEqual([])
  await expect(page.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible()
})

/**
 * Scrolls a filled list to its end, clears it, and checks that the scroll range shrank with it.
 * @param {import('@playwright/test').Locator} container
 * @param {import('@playwright/test').Locator} scroller
 */
async function clearScrolledList(container, scroller) {
  await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  await container.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(container.getByText('No notifications yet')).toBeVisible()
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
}

const UPLOADS = Array.from({ length: 12 }, (_, index) => `upload${index}`)

test('clearing a scrolled list leaves a valid scroll range', { tag: '@scale' }, async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  await setWindowSize(app, page, { width: 1000, height: 760 })
  await announceUploads(page, UPLOADS)

  await page.getByRole('button', { name: 'Notifications (12 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  await clearScrolledList(dropdown, dropdown.locator('.iconDropdownContent'))
})

test('phone layouts show the list in a sheet', { tag: '@scale' }, async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  await setWindowSize(app, page, { width: 420, height: 760 })
  const uploads = await announceUploads(page, UPLOADS)

  const bell = page.getByRole('button', { name: 'Notifications (12 unread)', exact: true })
  await bell.click()
  const sheet = page.getByRole('dialog', { name: 'Notifications', exact: true })
  await sheet.locator('.notificationEntry').first().click()
  await expect(page).toHaveURL(new RegExp(`#/watch/${uploads.at(-1)}$`))
  await expect(sheet).toHaveCount(0)

  await page.getByRole('button', { name: 'Notifications (11 unread)', exact: true }).click()
  await clearScrolledList(sheet, sheet.locator('.notificationSheetScroller'))
})

test('the notification setting turns the bell and the notification options off and on', async ({ app, page }) => {
  await expect(page.locator('.notificationCenter')).toBeVisible()
  const general = await goToSettingsSection(page, 'general')
  const mode = general.locator('.select').filter({ hasText: 'Notifications' }).locator('select')
  await expect(mode).toHaveValue('both')
  await expect(mode.locator('option')).toHaveText(['System and in-app', 'System only', 'Off'])

  await mode.selectOption('off')
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).notificationMode).toBe('off')
  await expect(page.locator('.notificationCenter')).toHaveCount(0)
  const subscriptions = await goToSettingsSection(page, 'subscription')
  await expect(subscriptions.getByText('Notify About New Uploads', { exact: true })).toHaveCount(0)

  await (await goToSettingsSection(page, 'general')).locator('.select').filter({ hasText: 'Notifications' }).locator('select').selectOption('system')
  await expect(page.locator('.notificationCenter')).toHaveCount(0)
  await expect((await goToSettingsSection(page, 'subscription')).getByText('Notify About New Uploads', { exact: true })).toBeVisible()
})

test.describe('with hidden thumbnails', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false, thumbnailPreference: 'hidden' },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos'] }]
      }]
    }
  })

  test('notifications leave out thumbnails', async ({ app, page }) => {
    await mockSystemNotifications(app)
    await announceUploads(page, ['a'])
    expect((await page.evaluate(() => window.ftElectron.notificationHistory.list()))[0]).not.toHaveProperty('thumbnail')
    await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click()
    const entry = page.locator('.notificationCenterDropdown .notificationEntry')
    await expect(entry).toHaveCount(1)
    await expect(entry.locator('.notificationThumbnail')).toHaveCount(0)
    await expect(entry.locator('.notificationKind')).toBeVisible()
  })
})

test.describe('with system notifications only', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false, notificationMode: 'system' },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos'] }]
      }]
    }
  })

  test('the system shows every notification and the app keeps none', async ({ app, page }) => {
    await mockSystemNotifications(app, { foreground: true })
    const [upload] = await announceUploads(page, ['a'], async () => (await shownNotifications(app)).length)
    expect(await shownNotifications(app)).toStrictEqual([{ title: 'New video from Alpha Channel', body: `Upload ${upload}` }])
    expect(await page.evaluate(() => window.ftElectron.notificationHistory.list())).toStrictEqual([])
    await expect(page.locator('.notificationCenter')).toHaveCount(0)
    await expect(page.locator('.toast', { hasText: `Upload ${upload}` })).toHaveCount(0)
  })
})

test.describe('with notifications off', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false, notificationMode: 'off' },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos'] }]
      }]
    }
  })

  test('the app hides every notification option and stays silent', async ({ app, page }) => {
    await mockSystemNotifications(app)
    await expect(page.locator('.notificationCenter')).toHaveCount(0)
    await goTo(page, 'subscribedchannels')
    await expect(page.locator('.channel', { hasText: 'Alpha Channel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Notify about new uploads', exact: true })).toHaveCount(0)

    for (const ids of [['a'], ['b', 'a']]) {
      await page.evaluate(({ channelId, ids }) => window.ftElectron.subscriptionAutoRefresh.observeUploads({
        channelId,
        feedType: 'videos',
        entries: ids.map(id => ({ id, title: `Upload ${id}`, published: Date.now(), live: false, upcoming: false, membersOnly: false }))
      }), { channelId: CHANNEL_ID, ids })
    }
    expect(await shownNotifications(app)).toStrictEqual([])
    expect(await page.evaluate(() => window.ftElectron.notificationHistory.list())).toStrictEqual([])
  })
})
