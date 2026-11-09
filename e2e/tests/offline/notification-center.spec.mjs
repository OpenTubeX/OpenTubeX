import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  latestSettings,
  readDatastore,
  sel,
  setWindowSize,
} from '../../helpers/app.mjs'

const shortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

const CHANNEL_ID = `UC${'0'.repeat(22)}`

const seed = {
  settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false },
  profiles: [{
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions: [{ id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos', 'shorts', 'live', 'posts'] }]
  }]
}

test.use({ seed })

/**
 * Replaces system notifications with a record of them, and decides whether the
 * app counts as in use, since a test window's focus depends on the display.
 * @param {{ electronApp: import('@playwright/test').ElectronApplication }} app
 * @param {{ supported?: boolean, foreground?: boolean }} [options]
 */
function mockSystemNotifications({ electronApp }, { supported = true, foreground = false } = {}) {
  return electronApp.evaluate(({ BrowserWindow, Notification, net }, { supported, foreground }) => {
    globalThis.shownNotifications = []
    globalThis.systemNotifications = []
    // Thumbnails fail right away instead of delaying system notifications.
    const fetch = net.fetch
    net.fetch = (url, ...options) => String(url).includes('/vi/') ? Promise.reject(new Error('No thumbnails offline')) : fetch(url, ...options)
    // CI has no notification server.
    Notification.isSupported = () => supported
    Notification.prototype.show = function () {
      globalThis.shownNotifications.push({ title: this.title, body: this.body })
      globalThis.systemNotifications.push(this)
    }
    Notification.prototype.close = function () {
      this.closedByApp = true
    }
    BrowserWindow.getFocusedWindow = () => foreground ? BrowserWindow.getAllWindows()[0] : null
  }, { supported, foreground })
}

const shownNotifications = ({ electronApp }) => electronApp.evaluate(() => globalThis.shownNotifications)

/**
 * The bodies of the system notifications the app closed.
 * @param {{ electronApp: import('@playwright/test').ElectronApplication }} app
 */
const closedNotifications = ({ electronApp }) => electronApp.evaluate(() => (
  globalThis.systemNotifications.filter(notification => notification.closedByApp).map(notification => notification.body)
))

/**
 * Acts on a system notification as the user would.
 * @param {{ electronApp: import('@playwright/test').ElectronApplication }} app
 * @param {string} body
 * @param {'click' | 'close'} event
 * @param {{ reason?: string }} [details]
 */
const emitSystemNotification = ({ electronApp }, body, event, details = {}) => electronApp.evaluate((_electron, { body, event, details }) => {
  globalThis.systemNotifications.find(notification => notification.body === body).emit(event, details)
}, { body, event, details })

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

test('middle and Ctrl clicks open notifications in new tabs', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  const [first, second] = await announceUploads(page, ['b', 'a'])
  const bell = page.locator('.notificationCenter')
  await page.getByRole('button', { name: 'Notifications (2 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  const entries = dropdown.locator('.notificationEntry')
  const startUrl = page.url()

  await entries.nth(1).click({ button: 'middle' })
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })).toBe(`/watch/${first}`)
  expect(page.url()).toBe(startUrl)
  // The list stays open for more background tabs, and the opened entry is read.
  await expect(entries).toHaveCount(2)
  await expect(bell).toHaveAttribute('data-unread-count', '1')

  // The list opens the tab itself instead of leaving it to Chromium's new-window fallback.
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    globalThis.windowOpenRequests = 0
    BrowserWindow.getAllWindows()[0].webContents.setWindowOpenHandler(() => {
      globalThis.windowOpenRequests++
      return { action: 'deny' }
    })
  })
  await entries.nth(0).click({ modifiers: [shortcutModifier] })
  await expect(page.locator(sel.tabs)).toHaveCount(3)
  expect(await app.electronApp.evaluate(() => globalThis.windowOpenRequests)).toBe(0)
  await expect(page).toHaveURL(new RegExp(`#/watch/${second}$`))
  await expect(dropdown).toHaveCount(0)
  await expect(bell).not.toHaveAttribute('data-unread-count')
})

test('Ctrl clicks on notifications close the settings window like plain clicks', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  const [upload] = await announceUploads(page, ['a'])
  await goToSettingsSection(page, 'general')
  const settings = page.locator('.settingsWindow')
  await expect(settings).toBeVisible()

  await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click()
  await page.locator('.notificationCenterDropdown .notificationEntry').click({ modifiers: [shortcutModifier] })
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page).toHaveURL(new RegExp(`#/watch/${upload}$`))
  await expect(settings).toHaveCount(0)
})

test('read notifications can be cleared one at a time', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  const [first] = await announceUploads(page, ['b', 'a'])

  await page.getByRole('button', { name: 'Notifications (2 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  const entries = dropdown.locator('.notificationEntry')
  const clear = dropdown.getByRole('button', { name: 'Clear', exact: true })
  // Unread entries offer marking them read instead.
  await expect(clear).toHaveCount(0)
  await dropdown.getByRole('button', { name: 'Mark as read', exact: true }).first().click()
  await expect(clear).toHaveCount(1)

  await clear.click()
  // The dropdown stays open after the entry and its button disappear.
  await expect(entries).toHaveCount(1)
  await expect(entries).toContainText(`Upload ${first}`)
  await expect(dropdown.getByRole('button', { name: 'Mark as read', exact: true })).toHaveCount(1)
  await expect.poll(async () => (await page.evaluate(() => window.ftElectron.notificationHistory.list())).map(entry => entry.body))
    .toStrictEqual([`Upload ${first}`])
})

// Hot Pink turns hovered rows white, the color of its icons and secondary text.
for (const baseTheme of ['system', 'hotPink']) {
  test.describe(`${baseTheme} theme`, () => {
    test.use({ seed: { ...seed, settings: { ...seed.settings, baseTheme } } })

    test('hovering a notification highlights its whole row, and its action on top', { tag: '@scale' }, async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await mockSystemNotifications(app)
      await announceUploads(page, ['b', 'a'])

      await page.getByRole('button', { name: 'Notifications (2 unread)', exact: true }).click()
      const dropdown = page.locator('.notificationCenterDropdown')
      await dropdown.getByRole('button', { name: 'Mark as read', exact: true }).first().click()
      await expect(dropdown.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(1)
      const style = (locator) => locator.evaluate(element => {
        const { backgroundColor, color } = getComputedStyle(element)
        return { backgroundColor, color }
      })

      // One read and one unread row.
      for (const row of await dropdown.locator('.notificationRow').all()) {
        const action = row.locator('.entryAction')
        await page.mouse.move(0, 0)
        const idle = await style(row)
        const rowBox = await row.boundingBox()
        const actionBox = await action.boundingBox()
        // The action column below the button belongs to the row's hover area.
        expect(rowBox.y + rowBox.height - (actionBox.y + actionBox.height)).toBeGreaterThan(8)
        await page.mouse.move(actionBox.x + actionBox.width / 2, rowBox.y + rowBox.height - 4)
        const hovered = await style(row)
        expect(hovered.backgroundColor).not.toBe(idle.backgroundColor)
        const actionStyle = await style(action)
        expect(actionStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(actionStyle.color).not.toBe(hovered.backgroundColor)
        expect((await style(row.locator('time'))).color).not.toBe(hovered.backgroundColor)

        // The action keeps a highlight of its own over the row's.
        await action.hover()
        expect((await style(row)).backgroundColor).toBe(hovered.backgroundColor)
        expect((await style(action)).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      }
    })
  })
}

test('dismissed notifications slide out before the rows below move up', { tag: '@scale' }, async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await mockSystemNotifications(app)
  await announceUploads(page, ['c', 'b', 'a'])

  await page.getByRole('button', { name: 'Notifications (3 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  await dropdown.getByRole('button', { name: 'Mark all as read', exact: true }).click()
  await dropdown.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)))
  const rows = dropdown.locator('.notificationRow')
  // Zero-height rows count as hidden for Playwright's bounding boxes.
  const rect = locator => locator.evaluate(element => element.getBoundingClientRect().toJSON())
  const [first, second] = await Promise.all([rect(rows.nth(0)), rect(rows.nth(1))])

  // Pause each dismissal as it starts to inspect it.
  await dropdown.evaluate(element => {
    window.dismissals = []
    element.addEventListener('animationstart', (event) => {
      const animation = event.target.getAnimations().find(animation => animation.animationName === event.animationName)
      animation.pause()
      window.dismissals.push(animation)
    })
  })
  // Scoped styles suffix keyframe names with a hash.
  const dismissalNames = () => page.evaluate(() => window.dismissals.map(animation => animation.animationName.replace(/-[\da-f]+$/, '')).toSorted())
  /** @param {number} progress */
  const seek = progress => page.evaluate(progress => window.dismissals.forEach(animation => {
    animation.currentTime = animation.effect.getComputedTiming().duration * progress
  }), progress)

  await dropdown.getByRole('button', { name: 'Clear', exact: true }).first().click()
  await expect.poll(dismissalNames).toEqual(['notification-dismiss'])
  // Rows stay until their animations finish, however long the Animation Speed setting makes them.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
  await expect(rows).toHaveCount(3)
  // Leaving rows can no longer be focused or clicked.
  await expect(rows.nth(0)).toHaveJSProperty('inert', true)
  // The row slides out first, keeping its place.
  await seek(0.5)
  let [dismissed, below] = await Promise.all([rect(rows.nth(0)), rect(rows.nth(1))])
  expect(Math.abs(dismissed.x - (first.x + first.width))).toBeLessThan(1)
  expect(Math.abs(dismissed.height - first.height)).toBeLessThan(1)
  expect(Math.abs(below.y - second.y)).toBeLessThan(1)
  // Then its space closes, gap included, moving the rows below into its place.
  // Seeking to the very end would end the animation and remove the row.
  await seek(0.999)
  ;[dismissed, below] = await Promise.all([rect(rows.nth(0)), rect(rows.nth(1))])
  expect(dismissed.height).toBeLessThan(1)
  expect(Math.abs(below.y - first.y)).toBeLessThan(1)
  await page.evaluate(() => window.dismissals.splice(0).forEach(animation => animation.finish()))
  await expect(rows).toHaveCount(2)

  // Clearing every row slides them out together before the empty state appears.
  await dropdown.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect.poll(dismissalNames).toEqual(['notification-list-dismiss', 'notification-list-row-dismiss', 'notification-list-row-dismiss'])
  await expect(rows).toHaveCount(2)
  await expect(dropdown.locator('.notificationList')).toHaveJSProperty('inert', true)
  await expect(dropdown.getByText('No notifications yet')).toHaveCount(0)
  await page.evaluate(() => window.dismissals.splice(0).forEach(animation => animation.finish()))
  await expect(rows).toHaveCount(0)
  await expect.poll(dismissalNames).toEqual(['notification-empty-enter'])
  await page.evaluate(() => window.dismissals.forEach(animation => animation.finish()))
  await expect(dropdown.getByText('No notifications yet')).toBeVisible()
})

test('the bell icon follows the notifications and wiggles for new ones', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await mockSystemNotifications(app)
  const bell = page.locator('.notificationCenter')
  const bellIcon = bell.locator('.iconButton > .icon')
  await expect(bellIcon).toHaveAttribute('data-icon', 'bell-outline')
  await page.evaluate(() => {
    window.bellWiggles = 0
    document.addEventListener('animationstart', (event) => {
      if (event.animationName.startsWith('notification-bell-wiggle')) window.bellWiggles++
    })
  })
  const historyLength = () => page.evaluate(async () => (await window.ftElectron.notificationHistory.list()).length)

  await announceUploads(page, ['a'])
  await expect(bellIcon).toHaveAttribute('data-icon', 'bell')
  await expect.poll(() => page.evaluate(() => window.bellWiggles)).toBe(1)
  // The wiggle ends, so the next notification starts it again.
  await expect(bell).not.toHaveClass(/\bwiggle\b/)
  await announceUploads(page, ['b'], async () => await historyLength() - 1)
  await expect.poll(() => page.evaluate(() => window.bellWiggles)).toBe(2)

  await page.getByRole('button', { name: 'Notifications (2 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  await dropdown.getByRole('button', { name: 'Mark all as read', exact: true }).click()
  await expect(bellIcon).toHaveAttribute('data-icon', 'bell-plain')
  await dropdown.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(bellIcon).toHaveAttribute('data-icon', 'bell-outline')
  // Reading and clearing are not new notifications.
  expect(await page.evaluate(() => window.bellWiggles)).toBe(2)
})

test('the list opens and closes with the quick settings animation', { tag: '@scale' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const bell = page.getByRole('button', { name: 'Notifications', exact: true })
  const dropdown = page.locator('.notificationCenterDropdown')
  await page.evaluate(() => {
    window.dropdownTransitions = []
    document.addEventListener('transitionrun', (event) => {
      if (event.target instanceof Element && event.target.matches('.notificationCenterDropdown')) window.dropdownTransitions.push(event.propertyName)
    })
  })

  await bell.click()
  await expect.poll(() => page.evaluate(() => window.dropdownTransitions.toSorted())).toEqual(['opacity', 'transform'])
  await dropdown.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  // The menu is placed while it is still scaled down, but ends up aligned with the bell.
  const [bellBox, dropdownBox] = await Promise.all([bell.boundingBox(), dropdown.boundingBox()])
  expect(Math.abs(dropdownBox.x + dropdownBox.width - (bellBox.x + bellBox.width))).toBeLessThan(1)

  // Pause the close animation as it starts to inspect the closing menu.
  await dropdown.evaluate(element => {
    window.dropdownLeave = []
    element.addEventListener('transitionrun', (event) => {
      const animation = element.getAnimations().find(animation => animation.transitionProperty === event.propertyName)
      animation.pause()
      window.dropdownLeave.push(animation)
    })
  })
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.dropdownLeave.map(animation => animation.transitionProperty).toSorted()))
    .toEqual(['opacity', 'transform'])
  // The closing menu stays where it was, attached to the bell, instead of
  // disappearing with the anchor of the closed button.
  await page.evaluate(() => window.dropdownLeave.forEach(animation => { animation.currentTime = 0 }))
  const closingBox = await dropdown.boundingBox()
  expect(Math.abs(closingBox.x + closingBox.width - (bellBox.x + bellBox.width))).toBeLessThan(1)
  expect(Math.abs(closingBox.y - dropdownBox.y)).toBeLessThan(1)
  // Clicks reach the page below while it closes, and removal waits for the animation.
  await expect(dropdown).toHaveCSS('pointer-events', 'none')
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
  await expect(dropdown).toHaveCount(1)
  await page.evaluate(() => window.dropdownLeave.forEach(animation => animation.play()))
  await expect(dropdown).toHaveCount(0)
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

test('system notifications follow thumbnail settings changed after a reminder was set', async ({ app, page }) => {
  await mockSystemNotifications(app)
  await app.electronApp.evaluate(({ net }) => {
    globalThis.fetchedImages = []
    net.fetch = async url => {
      globalThis.fetchedImages.push(String(url))
      throw new Error('No thumbnails offline')
    }
  })
  const videoId = 'abcdefghijk'
  await page.evaluate(videoId => window.ftElectron.liveReminder.schedule({
    videoId,
    startTimestamp: Date.now() + 2000,
    notificationTitle: 'Premiere starting',
    notificationBody: 'Starting now',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  }), videoId)
  await page.evaluate(() => window.$store.dispatch('updateBlurThumbnails', true))

  await expect.poll(async () => (await shownNotifications(app)).map(notification => notification.title)).toStrictEqual(['Premiere starting'])
  expect(await app.electronApp.evaluate(() => globalThis.fetchedImages)).toStrictEqual([])
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

/**
 * Scrolls a list of read entries to its end, clears the last one, and checks
 * that the list still ends at the bottom of the shrunk scroll range.
 * @param {import('@playwright/test').Locator} container
 * @param {import('@playwright/test').Locator} scroller
 */
async function clearLastOfScrolledList(container, scroller) {
  await container.getByRole('button', { name: 'Mark all as read', exact: true }).click()
  const entries = container.locator('.notificationEntry')
  const count = await entries.count()
  await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  await container.getByRole('button', { name: 'Clear', exact: true }).last().click()
  await expect(entries).toHaveCount(count - 1)
  // Fractional UI scales leave subpixel offsets that scrollTop rounds.
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThan(2)
  const [last, viewport] = await Promise.all([entries.last().boundingBox(), scroller.boundingBox()])
  expect(last.y + last.height).toBeLessThan(viewport.y + viewport.height + 2)
  expect(viewport.y + viewport.height - (last.y + last.height)).toBeLessThan(last.height)
}

const UPLOADS = Array.from({ length: 12 }, (_, index) => `upload${index}`)

test('clearing a scrolled list leaves a valid scroll range', { tag: '@scale' }, async ({ app, page }) => {
  // Dismissals shrink the range gradually.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await mockSystemNotifications(app)
  await setWindowSize(app, page, { width: 1000, height: 760 })
  await announceUploads(page, UPLOADS)

  await page.getByRole('button', { name: 'Notifications (12 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  await clearScrolledList(dropdown, dropdown.locator('.iconDropdownContent'))
})

test('clearing one entry of a scrolled list leaves a valid scroll range', { tag: '@scale' }, async ({ app, page }) => {
  // Dismissals shrink the range gradually.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await mockSystemNotifications(app)
  await setWindowSize(app, page, { width: 1000, height: 760 })
  await announceUploads(page, UPLOADS)

  await page.getByRole('button', { name: 'Notifications (12 unread)', exact: true }).click()
  const dropdown = page.locator('.notificationCenterDropdown')
  await clearLastOfScrolledList(dropdown, dropdown.locator('.iconDropdownContent'))
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
  await clearLastOfScrolledList(sheet, sheet.locator('.notificationSheetScroller'))
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

test('system notifications and the bell stay in step', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockSystemNotifications(app)
  const [dismissed, timedOut, clicked, readInApp] = await announceUploads(page, ['d', 'c', 'b', 'a'])
  await expect.poll(async () => (await shownNotifications(app)).length).toBe(4)
  const bell = page.locator('.notificationCenter')
  await expect(bell).toHaveAttribute('data-unread-count', '4')

  // Dismissing or opening a system notification marks its entry read, while one that only timed out stays unread.
  await emitSystemNotification(app, `Upload ${dismissed}`, 'close', { reason: 'userCanceled' })
  await emitSystemNotification(app, `Upload ${timedOut}`, 'close', { reason: 'timedOut' })
  await emitSystemNotification(app, `Upload ${clicked}`, 'click')
  await expect(bell).toHaveAttribute('data-unread-count', '2')

  // Reading or removing an entry in the app closes its system notification.
  await page.getByRole('button', { name: 'Notifications (2 unread)', exact: true }).click()
  const rows = page.locator('.notificationCenterDropdown .notificationRow')
  await rows.filter({ hasText: `Upload ${readInApp}` }).getByRole('button', { name: 'Mark as read', exact: true }).click()
  await expect.poll(() => closedNotifications(app)).toStrictEqual([`Upload ${readInApp}`])
  await page.locator('.notificationCenterDropdown').getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect.poll(async () => (await closedNotifications(app)).toSorted()).toStrictEqual([`Upload ${timedOut}`, `Upload ${readInApp}`].toSorted())
})

test.describe('with notification sync', () => {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  test.use({
    seed: {
      ...seed,
      settings: {
        ...seed.settings,
        syncServerEnabled: false,
        syncServerAutoSync: false,
        syncServerUrl: 'https://sync-notifications.example',
        syncServerToken: 'test-token',
        syncServerPrivacyMode: 'enhanced',
        syncServerPrivacyKey: key,
        syncServerPrivacySalt: salt,
        syncServerSyncSubscriptions: false,
        syncServerSyncPlaylists: false,
        syncServerSyncHistory: false,
        syncServerSyncProfiles: false,
        syncServerSyncSettings: false,
        syncServerSyncSessions: false,
        syncServerSyncWatchStats: false,
        syncServerSyncLiveReminders: false,
      }
    }
  })

  test('notifications read or removed on another device are handled here, and the other way around', async ({ app, page }) => {
    const { encryptSyncDocument, decryptSyncDocument } = await import('../../../src/renderer/helpers/sync-server-privacy.js')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mockSystemNotifications(app)
    const [removedElsewhere, readElsewhere, readHere] = await announceUploads(page, ['c', 'b', 'a'])
    await expect.poll(async () => (await shownNotifications(app)).length).toBe(3)

    const now = Date.now()
    let remote = {
      revision: 1,
      payload: await encryptSyncDocument({
        readThrough: 0,
        clearedThrough: 0,
        dismissals: [
          { key: `video:/watch/${removedElsewhere}`, removed: true, at: now },
          { key: `video:/watch/${readElsewhere}`, removed: false, at: now }
        ]
      }, key, salt)
    }
    await page.route('https://sync-notifications.example/**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      let json
      if (path === '/health') json = { capabilities: { encrypted_sync: 1, live_sync: 1, notification_dismissals: 1 } }
      else if (path === '/v1/account/sessions') json = { sessions: [] }
      else if (path === '/v1/encrypted_sync/events') json = []
      else if (path === '/v1/encrypted_sync') json = { collections: [{ collection: 'notificationDismissals', revision: remote.revision }], legacy_data: false }
      else if (path === '/v1/encrypted_sync/notificationDismissals') {
        if (request.method() === 'PUT') {
          const { revision, payload } = request.postDataJSON()
          expect(revision).toBe(remote.revision)
          remote = { revision: revision + 1, payload }
        }
        json = remote
      } else {
        json = { revision: 0, payload: null }
      }
      await route.fulfill({ json })
    })
    const sync = () => page.evaluate(async () => {
      await window.$store.dispatch('syncWithSyncServer')
      return window.$store.state.syncServer.syncServerStatus
    })
    await page.evaluate(() => window.$store.dispatch('updateSyncServerEnabled', true))
    expect(await sync()).toBe('success')

    const bell = page.locator('.notificationCenter')
    await expect(bell).toHaveAttribute('data-unread-count', '1')
    await expect.poll(async () => (await closedNotifications(app)).toSorted()).toStrictEqual([`Upload ${removedElsewhere}`, `Upload ${readElsewhere}`].toSorted())
    await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click()
    const rows = page.locator('.notificationCenterDropdown .notificationRow')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: `Upload ${removedElsewhere}` })).toHaveCount(0)

    // Reading one here reaches the other devices.
    await rows.filter({ hasText: `Upload ${readHere}` }).getByRole('button', { name: 'Mark as read', exact: true }).click()
    await expect(bell).not.toHaveAttribute('data-unread-count')
    expect(await sync()).toBe('success')
    expect(remote.revision).toBe(2)
    const uploaded = await decryptSyncDocument(remote.payload, key)
    expect(uploaded.dismissals.map(({ key, removed }) => [key, removed]).toSorted()).toStrictEqual([
      [`video:/watch/${readHere}`, false],
      [`video:/watch/${readElsewhere}`, false],
      [`video:/watch/${removedElsewhere}`, true]
    ].toSorted())
  })
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

test.describe('with blurred thumbnails', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false, blurThumbnails: true },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Alpha Channel', thumbnail: '', notificationFeedTypes: ['videos'] }]
      }]
    }
  })

  test('notifications leave out thumbnails, which toasts and the system cannot blur', async ({ app, page }) => {
    await mockSystemNotifications(app, { foreground: true })
    const [upload] = await announceUploads(page, ['a'])
    expect((await page.evaluate(() => window.ftElectron.notificationHistory.list()))[0]).not.toHaveProperty('thumbnail')
    const toast = page.locator('.toast', { hasText: `Upload ${upload}` })
    await expect(toast).toBeVisible()
    await expect(toast.locator('.image')).toHaveCount(0)
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
