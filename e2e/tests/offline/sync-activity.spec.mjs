import { test, expect, expectScrollAtRenderedEnd, goToSettingsSection, openNewWindowFromTabBar, setWindowSize, waitForAppReady } from '../../helpers/app.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'

async function seedActivity(page, count = 30, serverUrl = '') {
  await page.evaluate(({ count, serverUrl }) => {
    const store = window.$store
    store.commit('setSyncServerUrl', serverUrl)
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
  }, { count, serverUrl })
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

test.describe('account activity labels', () => {
  test.use({ seed: { settings: { syncServerUrl: '' } } })

  test('an older confirmation cannot restore activity cleared in another window', async ({ app, page }) => {
    const sync = await goToSettingsSection(page, 'sync')
    await seedActivity(page, 3)
    const firstCard = sync.locator('.syncActivity')
    const secondPage = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(secondPage)
    const secondSync = await goToSettingsSection(secondPage, 'sync')
    await seedActivity(secondPage)
    await firstCard.getByRole('button', { name: 'Clear on this device' }).click()
    await secondSync.locator('.syncActivity').getByRole('button', { name: 'Clear on this device' }).click()
    await secondPage.getByRole('dialog', { name: 'Clear on this device', exact: true })
      .getByRole('button', { name: 'Clear on this device' }).click()
    await expect(firstCard.locator('.activityList li')).toHaveCount(0)
    await page.getByRole('dialog', { name: 'Clear on this device', exact: true })
      .getByRole('button', { name: 'Clear on this device' }).click()
    await seedActivity(page)
    await expect(firstCard).toContainText('No recent activity')
  })
})

test.describe('account activity', () => {
  test.use({ seed: { settings: { syncServerUrl: '' } } })

  test('keeps translated activity actions inside narrow cards', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    const sync = await goToSettingsSection(page, 'sync')
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
    await seedActivity(page, 3)
    const card = sync.locator('.syncActivity')
    await page.evaluate(() => window.$store
      .dispatch('updateUseAITranslationCompletions', true))
    for (const [locale, label] of [
      ['en-US', 'Clear on this device'],
      ['el', 'Εκκαθάριση σε αυτή τη συσκευή'],
    ]) {
      // Wait for the setting and rendered label instead of returning a Vuex
      // promise that Chromium can collect while Playwright awaits it.
      await page.evaluate(locale => {
        window.$store
          .dispatch('updateCurrentLocale', locale)
      }, locale)
      await expect.poll(() => page.evaluate(() => window.$store.getters.getCurrentLocale)).toBe(locale)
      await expect(card.locator('.activityClear')).toHaveAccessibleName(label)
      for (const width of [600, 375, 320]) {
        await setWindowSize(app, page, { width, height: 700 + width })
        await card.scrollIntoViewIfNeeded()
        await expect.poll(() => card.evaluate(element => {
          const bounds = element.querySelector('.activityHeader').getBoundingClientRect()
          const viewport = element.closest('.settingsContent').getBoundingClientRect()
          const tolerance = 2 / devicePixelRatio
          const buttons = [...element.querySelectorAll('.activityClear, .activityAction button')]
          const title = element.querySelector('.activityTitle h3')
          const clear = element.querySelector('.activityClear').getBoundingClientRect()
          const titleRect = title.getBoundingClientRect()
          const titleRange = document.createRange()
          titleRange.selectNode(title.firstChild)
          const titleLines = [...titleRange.getClientRects()]
          const stacked = clear.top >= titleRect.bottom
          return (stacked || (titleLines.length === 1 && titleRect.right <= clear.left + tolerance)) &&
            buttons.length === 2 && buttons.every(button => {
            const rect = button.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(button.querySelector('.activityClearLabel') ?? button)
            const content = range.getBoundingClientRect()
            return rect.left >= bounds.left - tolerance && rect.right <= bounds.right + tolerance &&
              rect.left >= viewport.left - tolerance && rect.right <= viewport.right + tolerance &&
              content.left >= rect.left - tolerance && content.right <= rect.right + tolerance
          })
        }), { message: `${locale} actions fit at ${width}px and ${uiScale}% scale` }).toBe(true)
      }
    }
    await captureAppFramebuffer(app, testInfo, 'translated-activity-actions')
  })

  test('clears activity locally after confirmation and keeps it hidden after restart', { tag: '@scale' }, async ({ app, page }) => {
    const sync = await goToSettingsSection(page, 'sync')
    await seedActivity(page, 30, 'https://sync.example')
    const card = sync.locator('.syncActivity')
    const clear = card.getByRole('button', { name: 'Clear on this device' })
    await card.locator('.activityDisclosure').click()
    await scrollActivityToBottom(card.locator('.activityScroller'))
    const pageScroller = page.locator('.settingsContent')
    await pageScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await clear.click()
    const dialog = page.getByRole('dialog', { name: 'Clear on this device', exact: true })
    await expect(dialog).toContainText('Activity on the server and other devices stays unchanged')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(card.locator('.activityList li')).toHaveCount(30)
    await clear.click()
    await dialog.getByRole('button', { name: 'Clear on this device' }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toContainText('No recent activity')
    await expect(clear).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Refresh', exact: true })).toBeFocused()
    await expect(card.locator('.activityScroller')).toBeHidden()
    await expect(card.locator('.activityDisclosure')).toBeHidden()
    await expectScrollAtRenderedEnd(pageScroller)

    const { page: restartedPage } = await app.relaunch()
    const reloadedSync = await goToSettingsSection(restartedPage, 'sync')
    await seedActivity(restartedPage, 30, 'https://sync.example')
    const reloadedCard = reloadedSync.locator('.syncActivity')
    await expect(reloadedCard).toContainText('No recent activity')
    await restartedPage.evaluate(() => {
      const store = window.$store
      store.commit('setSyncServerActivity', [{
        id: 'new:0',
        deviceName: 'Laptop',
        collection: 'subscriptions',
        action: 'added',
        item: 'New channel',
        createdAt: Date.now(),
      }])
    })
    await expect(reloadedCard.locator('.activityList li')).toHaveCount(1)
    await expect(reloadedCard).toContainText('New channel')
    await setWindowSize(app, restartedPage, { width: 480, height: 700 })
    await expect(reloadedCard.getByRole('button', { name: 'Clear on this device' })).toBeVisible()
    expect(await reloadedCard.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  })

  test('keeps expanded activity in its own bounded themed scroll area', { tag: '@scale' }, async ({ page }) => {
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

  test('clamps activity after resize, replacement, removal, collapse and refresh', { tag: '@scale' }, async ({ app, page }) => {
    const sync = await goToSettingsSection(page, 'sync')
    await seedActivity(page)
    const card = sync.locator('.syncActivity')
    const disclosure = card.locator('.activityDisclosure')
    await disclosure.click()
    const scroller = card.locator('.activityScroller')
    await page.evaluate(() => {
      window.$store.commit('setScrollbarThumbWidth', 20)
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
      const store = window.$store
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
      const store = window.$store
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

  test('clamps after collapse and retains activity after a refresh error', { tag: '@scale' }, async ({ page }) => {
    const sync = await goToSettingsSection(page, 'sync')
    await page.evaluate(() => {
      const store = window.$store
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
      const store = window.$store
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
