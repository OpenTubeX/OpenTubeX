import { test, expect, expectScrollAtRenderedEnd, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

async function seedActivity(page, count = 30) {
  await page.evaluate(count => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSyncServerToken', 'test-token')
    store.commit('setSyncServerActivity', Array.from({ length: count }, (_, index) => ({
      id: String(index),
      deviceName: 'Laptop',
      collection: 'subscriptions',
      action: 'added',
      item: `Channel ${index + 1}`,
      createdAt: Date.now() - index * 60000,
    })))
    store.commit('setSyncServerLiveSupported', true)
    store.commit('setSyncServerEnabled', true)
  }, count)
}

async function scrollActivityToBottom(scroller) {
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
}

async function expectActivityScrollbarGap(scroller) {
  await expect.poll(() => scroller.evaluate(element => {
    const card = element.querySelector('.activityList li').getBoundingClientRect()
    const track = element.querySelector('.os-scrollbar-vertical').getBoundingClientRect()
    return track.left - card.right
  })).toBeGreaterThanOrEqual(4)
}

async function expectActivityRange(scroller, atEnd = true) {
  await expect.poll(() => scroller.evaluate((element, atEnd) => {
    const list = element.querySelector('.activityList')
    const viewport = element.getBoundingClientRect()
    const content = list.getBoundingClientRect()
    const maximum = Math.max(0, content.height - element.clientHeight)
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    if (!scrollbar || element.scrollTop < 0 || element.scrollTop > maximum + 2 / devicePixelRatio) return false
    if (maximum <= 1) {
      return element.scrollTop === 0 && scrollbar.classList.contains('os-scrollbar-unusable')
    }
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const handle = scrollbar.querySelector('.os-scrollbar-handle')
    const thumb = handle.getBoundingClientRect()
    const minimumThumbHeight = Number.parseFloat(getComputedStyle(handle).minHeight) || 0
    const expectedThumbHeight = Math.max(minimumThumbHeight, track.height * element.clientHeight / content.height)
    return !scrollbar.classList.contains('os-scrollbar-unusable') &&
      content.bottom >= viewport.bottom - 2 / devicePixelRatio &&
      Math.abs(thumb.height - expectedThumbHeight) * devicePixelRatio <= 2 &&
      (!atEnd || (Math.abs(content.bottom - viewport.bottom) * devicePixelRatio <= 2 &&
        Math.abs(track.bottom - thumb.bottom) * devicePixelRatio <= 2))
  }, atEnd)).toBe(true)
}

for (const uiScale of [100, 125]) {
  test.describe(`account activity at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, syncServerUrl: '' } } })

    test('keeps expanded activity in its own bounded themed scroll area', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await seedActivity(page)
      const card = sync.locator('.syncActivity')
      await card.locator('.activityDisclosure').click()
      await expect(card.locator('.activityList li')).toHaveCount(30)
      const scroller = card.locator('.activityScroller')
      await expect(scroller).toBeVisible()
      await expect.poll(() => scroller.evaluate(element =>
        element.clientHeight <= window.innerHeight * 0.5 + 1 && element.scrollHeight > element.clientHeight
      )).toBe(true)
      await expect(scroller.locator('.os-scrollbar-vertical')).toHaveCount(1)
      await expectActivityScrollbarGap(scroller)
      await expect(card.locator('.activityList li').nth(3)).toBeFocused()
      await card.scrollIntoViewIfNeeded()
      const pageScroller = page.locator('.settingsContent')
      const pageScrollTop = await pageScroller.evaluate(element => element.scrollTop)
      const headerTop = await card.locator('.activityHeader').evaluate(element => element.getBoundingClientRect().top)
      const disclosureTop = await card.locator('.activityDisclosure').evaluate(element => element.getBoundingClientRect().top)
      await scroller.hover()
      const initialTop = await scroller.evaluate(element => element.scrollTop)
      await page.mouse.wheel(0, 400)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(initialTop)
      expect(await pageScroller.evaluate(element => element.scrollTop)).toBe(pageScrollTop)
      expect(await card.locator('.activityHeader').evaluate(element => element.getBoundingClientRect().top)).toBe(headerTop)
      expect(await card.locator('.activityDisclosure').evaluate(element => element.getBoundingClientRect().top)).toBe(disclosureTop)
      await scrollActivityToBottom(scroller)
      await expectActivityRange(scroller)
      await page.mouse.wheel(0, 400)
      // Wheel dispatch can finish before Chromium applies scrolling.
      await page.evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }))
      expect(await pageScroller.evaluate(element => element.scrollTop)).toBe(pageScrollTop)
      await card.locator('.activityDisclosure').click()
      await pageScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      const collapsedPageScrollTop = await pageScroller.evaluate(element => element.scrollTop)
      await scroller.hover()
      await page.mouse.wheel(0, -400)
      await expect.poll(() => pageScroller.evaluate(element => element.scrollTop)).toBeLessThan(collapsedPageScrollTop)
    })

    test('clamps activity after resize, replacement, removal, collapse and refresh', async ({ app, page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await seedActivity(page)
      const card = sync.locator('.syncActivity')
      const disclosure = card.locator('.activityDisclosure')
      await disclosure.click()
      const scroller = card.locator('.activityScroller')
      await page.evaluate(() => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setScrollbarThumbWidth', 20)
      })
      for (const [width, height] of [[480, 700], [1000, 1000], [1580, 1080]]) {
        await scrollActivityToBottom(scroller)
        await setWindowSize(app, page, { width, height })
        await expectActivityRange(scroller, width !== 480)
        await expectActivityScrollbarGap(scroller)
        expect(await scroller.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      }
      await scrollActivityToBottom(scroller)
      await seedActivity(page, 8)
      await expectActivityRange(scroller)
      await scrollActivityToBottom(scroller)
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerActivity', store.getters.getSyncServerActivity.slice(0, 2))
      })
      await expectActivityRange(scroller)
      await expect(disclosure).toBeHidden()

      await seedActivity(page)
      await scrollActivityToBottom(scroller)
      await disclosure.click()
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await expectActivityRange(scroller)
      await disclosure.click()
      await scrollActivityToBottom(scroller)
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const dispatch = store.dispatch.bind(store)
        store.dispatch = (...args) => args[0] === 'refreshSyncServerEvents'
          ? new Promise(resolve => setTimeout(() => {
              store.commit('setSyncServerActivity', store.getters.getSyncServerActivity.slice(0, 2))
              resolve()
            }, 100))
          : dispatch(...args)
      })
      await card.locator('.activityAction').click()
      await expect(card.locator('.activityList li')).toHaveCount(2)
      await expectActivityRange(scroller)
    })

    test('shows named changes across synced collections and settings', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: '1', deviceName: 'Laptop', collection: 'subscriptions', action: 'added', item: 'Alpha', createdAt: Date.now() },
          { id: '2', deviceName: 'Laptop', collection: 'playlists', action: 'removed', item: 'Video A', parent: 'Favorites', createdAt: Date.now() - 1 },
          { id: '3', deviceName: 'Laptop', collection: 'profiles', action: 'renamed', item: 'Old profile', value: 'New profile', createdAt: Date.now() - 2 },
          { id: '4', deviceName: 'Laptop', collection: 'playlistBookmarks', action: 'added', item: 'Saved mix', createdAt: Date.now() - 3 },
          { id: '5', deviceName: 'Laptop', key: 'subscriptionChannelSettings', detail: 'dailyVideoLimit', item: 'Alpha', value: 3, createdAt: Date.now() - 4 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const card = sync.locator('.syncActivity')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await expect(card.locator('.activityList li').nth(0)).toContainText('Laptop added Alpha to Subscriptions')
      await expect(card.locator('.activityList li').nth(1)).toContainText('Laptop removed Video A from Favorites')
      await expect(card.locator('.activityList li').nth(2)).toContainText('Laptop renamed Old profile to New profile')
      await card.locator('.activityDisclosure').click()
      await expect(card.locator('.activityList li').nth(3)).toContainText('Laptop added Saved mix to Saved playlists')
      await expect(card.locator('.activityList li').nth(4)).toContainText('Laptop changed Subscription settings · Alpha · Videos per day to 3')
    })

    test('uses a readable label for a saved setting choice', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: 'focus', deviceName: 'Laptop', key: 'tabCloseFocus', value: 'nextTab', createdAt: Date.now() },
          { id: 'theme', deviceName: 'Laptop', key: 'baseTheme', value: 'catppuccinMocha', createdAt: Date.now() - 1 },
          { id: 'format', deviceName: 'Laptop', key: 'screenshotFormat', value: 'jpeg', createdAt: Date.now() - 2 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const activity = sync.locator('.syncActivity .activityList li')
      await expect(activity.nth(0)).toContainText(
        'Laptop changed After Closing the Active Tab to Next tab in tab order'
      )
      await expect(activity.nth(1)).toContainText(/Laptop changed Base [Tt]heme to Catppuccin Mocha/)
      await expect(activity.nth(2)).toContainText(/Laptop changed Screenshot [Ff]ormat to JPEG/)
    })

    test('shows shortcut bindings as shortcuts and summarizes older JSON entries', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: 'shortcut', deviceName: 'Laptop', key: 'keyboardShortcuts', detail: 'TOGGLE_SKIP_SILENCE', value: 'h', createdAt: Date.now() },
          { id: 'legacy-shortcut', deviceName: 'Laptop', key: 'keyboardShortcuts', value: '{"VIDEO_PLAYER":{"PLAYBACK":{"TOGGLE_SKIP_SILENCE":"h"}}}', createdAt: Date.now() - 1 },
          { id: 'unassigned', deviceName: 'Laptop', key: 'keyboardShortcuts', detail: 'TOGGLE_SKIP_SILENCE', value: '', createdAt: Date.now() - 2 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const activity = sync.locator('.syncActivity .activityList li p')
      await expect(activity.nth(0)).toHaveText('Laptop changed Keyboard Shortcuts · Toggle skip silence to h')
      await expect(activity.nth(1)).toHaveText('Laptop updated Keyboard Shortcuts')
      await expect(activity.nth(2)).toHaveText('Laptop changed Keyboard Shortcuts · Toggle skip silence to Unassigned')
      await expect(sync.locator('.syncActivity')).not.toContainText('VIDEO_PLAYER')
    })

    test('uses the shortcut editor labels for action codes with nontrivial names', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', ['RESTORE_CLOSED_TAB', 'NAVIGATE_TO_SETTINGS', 'PICTURE_IN_PICTURE'].map((detail, index) => ({
          id: String(index), deviceName: 'Laptop', key: 'keyboardShortcuts', detail, value: 'ctrl+h', createdAt: Date.now() - index,
        })))
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const activity = sync.locator('.syncActivity .activityList li p')
      await expect(activity.nth(0)).toContainText(/Keyboard Shortcuts · Reopen.*tab/i)
      await expect(activity.nth(1)).toContainText(/Keyboard Shortcuts · Navigate to the Settings page/i)
      await expect(activity.nth(2)).toContainText(/Keyboard Shortcuts · Toggle Picture-in-Picture mode/i)
    })

    test('labels desktop-only shortcuts in cross-device activity', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: 'desktop-shortcut', deviceName: 'Desktop', key: 'keyboardShortcuts', detail: 'FULLWINDOW', value: 's', createdAt: Date.now() },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      await expect(sync.locator('.syncActivity .activityList li p')).toHaveText('Desktop changed Keyboard Shortcuts · Toggle full window to s')
    })

    test('keeps malformed caption anchors readable', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: 'anchor', deviceName: 'Laptop', key: 'defaultCaptionSettings', detail: 'Anchor.Anchor', value: 'top-', createdAt: Date.now() },
          { id: 'known-anchor', deviceName: 'Laptop', key: 'defaultCaptionSettings', detail: 'Anchor.Anchor', value: 'bottom-right', createdAt: Date.now() - 1 },
          { id: 'unknown-anchor', deviceName: 'Laptop', key: 'defaultCaptionSettings', detail: 'Anchor.Anchor', value: 'diagonal', createdAt: Date.now() - 2 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      await expect(sync.locator('.syncActivity .activityList li')).toContainText(['top-', 'Bottom Right', 'diagonal'])
    })

    test('names custom themes once and describes an empty subscription feed', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: 'theme', deviceName: 'Laptop', key: 'customThemes', action: 'added', item: 'Ocean', createdAt: Date.now() },
          { id: 'removed-theme', deviceName: 'Laptop', key: 'customThemes', action: 'removed', item: 'Sunset', createdAt: Date.now() - 1 },
          { id: 'feed', deviceName: 'Laptop', key: 'subscriptionChannelSettings', detail: 'feedTypes', item: 'Alpha', value: '', createdAt: Date.now() - 2 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const activity = sync.locator('.syncActivity .activityList li')
      await expect(activity.nth(0).locator('p')).toHaveText(/Laptop added Ocean to Custom theme creator$/i)
      await expect(activity.nth(1).locator('p')).toHaveText(/Laptop removed Sunset from Custom theme creator$/i)
      await expect(activity.nth(2)).toContainText('No feed types')
    })

    test('clamps after collapse and retains activity after a refresh error', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', Array.from({ length: 12 }, (_, index) => ({
          id: String(index), deviceName: 'Laptop', collection: 'subscriptions', createdAt: Date.now() - index * 60000,
        })))
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const card = sync.locator('.syncActivity')
      const disclosure = card.locator('.activityDisclosure')
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await expect(disclosure).toHaveText('Show more')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
      await expect(disclosure).toHaveText('Show less')
      await expect(card.locator('.activityList li')).toHaveCount(12)

      const scroller = page.locator('.settingsContent')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await expect(disclosure).toHaveText('Show more')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await expectScrollAtRenderedEnd(scroller)
      await expect.poll(() => scroller.evaluate(element => {
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        if (scrollbar.classList.contains('os-scrollbar-unusable')) return element.scrollTop === 0
        const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return Math.abs(track.bottom - thumb.bottom) <= 1
      })).toBe(true)

      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const dispatch = store.dispatch.bind(store)
        store.dispatch = (...args) => args[0] === 'refreshSyncServerEvents'
          ? Promise.reject(new Error('Activity refresh failed'))
          : dispatch(...args)
      })
      await card.locator('.activityAction').click()
      await expect(card.getByRole('alert')).toHaveText('Activity refresh failed')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await expect(disclosure).toBeVisible()
    })
  })
}
