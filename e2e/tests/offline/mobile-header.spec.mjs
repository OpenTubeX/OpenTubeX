import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

// Fractional UI scales round innerWidth, so try neighbouring device widths
// until the window reaches the requested CSS width.
async function resizeToCssWidth(app, page, width, height, zoom) {
  const base = Math.round(width * zoom)
  for (const offset of [0, 1, -1, 2, -2]) {
    await app.electronApp.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ ...window.getBounds(), ...size })
    }, { width: base + offset, ...height ? { height: Math.round(height * zoom) } : {} })
    try {
      await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 2000 }).toBe(width)
      return
    } catch {}
  }
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}

test.describe('centered desktop header', { tag: '@scale' }, () => {
  test('centers search with space on both sides and removes logo text before collapsing search', async ({ app, page, uiScale }, testInfo) => {
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    for (const [tabPosition, extraActions] of [['top', false], ['left', false], ['right', true]]) {
      await page.evaluate(({ tabPosition, extraActions }) => {
        const store = window.$store
        store.commit('setTabBarPosition', tabPosition)
        store.commit('setVerticalTabBarWidth', 220)
        store.commit('setEnableDownloads', extraActions)
        store.commit('setMoveDownloadsToAppHeader', extraActions)
        store.commit('setMoveSettingsToAppHeader', extraActions)
        store.commit('setHideHeaderSyncIndicator', !extraActions)
        store.commit('setSyncServerStatus', extraActions ? 'syncing' : 'idle')
      }, { tabPosition, extraActions })
      for (const width of [1000, 1280, 1080, 960, 900, 800, 735, 681, 680]) {
        await resizeToCssWidth(app, page, width, 820, uiScale / 100)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const header = page.locator('.topNav')
        const search = header.locator('.searchContainer')
        if (tabPosition === 'top' && width === 735) {
          await expect(header.locator('.logoText')).toBeHidden()
          await expect(search).toBeVisible()
        }
        if (tabPosition === 'top' && width === 1280) await expect(header.locator('.logoText')).toBeVisible()
        if (await search.isVisible()) {
          await expect.poll(() => header.evaluate(element => {
            const header = element.getBoundingClientRect()
            const field = element.querySelector('.searchContainer').getBoundingClientRect()
            return Math.abs((field.left + field.right) / 2 - (header.left + header.right) / 2)
          }), { message: `search is centered at ${width}px with ${tabPosition} tabs` }).toBeLessThan(1)
          const gaps = await header.evaluate(element => {
            const field = element.querySelector('.searchContainer').getBoundingClientRect()
            const visibleBounds = selector => [...element.querySelector(selector).children]
              .map(child => child.getBoundingClientRect()).filter(bounds => bounds.width > 0)
            const left = visibleBounds('.side:first-child')
            const right = visibleBounds('.profiles')
            return {
              left: field.left - Math.max(...left.map(bounds => bounds.right)),
              right: Math.min(...right.map(bounds => bounds.left)) - field.right
            }
          })
          expect(gaps.left).toBeGreaterThanOrEqual(12)
          expect(gaps.right).toBeGreaterThanOrEqual(12)
        } else {
          await expect(header.locator('.logoText')).toBeHidden()
          await header.locator('.navSearchButton').click()
          await expect(header.locator('.ft-input')).toBeFocused()
          await expect(header.locator('.profiles')).toBeHidden()
          await header.locator('.ft-input').press('Escape')
        }
        if (tabPosition === 'top' && width === 735) {
          const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => (
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
          ))
          await testInfo.attach('centered search after hiding logo text', {
            body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
          })
        }
      }
    }
    expect(pageErrors).toEqual([])
  })
})

async function enablePhoneHeader(page) {
  await page.evaluate(() => {
    document.querySelector('.app').classList.add('capacitorTabs')
    const seen = new Set()
    const visit = vnode => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      if (vnode.component) {
        if (vnode.component.type?.__name === 'CapacitorPhoneTabSwitcher') vnode.component.props.enabled = true
        visit(vnode.component.subTree)
      }
      if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
      if (Array.isArray(vnode.dynamicChildren)) vnode.dynamicChildren.forEach(visit)
    }
    visit(document.querySelector('#app')._vnode)
  })
}

test('phone header honors settings and downloads placement', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 390, height: 850 })
  const header = page.locator('.topNav')
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setEnableDownloads', true)
    store.commit('setMoveDownloadsToAppHeader', true)
    store.commit('setMoveSettingsToAppHeader', true)
  })
  await enablePhoneHeader(page)
  await expect(header.locator('.downloadsButton')).toBeVisible()
  await expect(header.locator('.settingsButton')).toBeVisible()
  // Reach the smaller phone viewport below Electron's minimum window width.
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  for (const width of [280, 390]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ ...window.getBounds(), width })
    }, Math.round(width * 1.25))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
    await expect(header.locator('.downloadsButton, .settingsButton')).toHaveCount(width === 280 ? 0 : 2)
  }
  await header.locator('.downloadsButton').click()
  await expect(page.locator('.settingsWindow')).toBeVisible()
  await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.settingsWindow')).toBeHidden()
  await header.locator('.settingsButton').click()
  await expect(page.locator('.settingsWindow')).toBeVisible()
  await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.settingsWindow')).toBeHidden()
  await page.locator('.profileTrigger').click()
  await expect(page.locator('.downloadsShortcut')).toHaveCount(0)
  await expect(page.locator('.allSettingsShortcut')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setMoveDownloadsToAppHeader', false)
    store.commit('setMoveSettingsToAppHeader', false)
  })
  await expect(header.locator('.downloadsButton')).toHaveCount(0)
  await expect(header.locator('.settingsButton')).toHaveCount(0)
  await page.locator('.profileTrigger').click()
  await expect(page.locator('.downloadsShortcut')).toBeVisible()
  await expect(page.locator('.allSettingsShortcut')).toBeVisible()
})

for (const pinned of [true]) {
  test(`crowded phone header keeps actions reachable with pinned search ${pinned}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 850 })
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
    await page.evaluate(pinned => {
      const store = window.$store
      store.commit('setEnableDownloads', true)
      store.commit('setMoveDownloadsToAppHeader', true)
      store.commit('setMoveSettingsToAppHeader', true)
      store.commit('setAlwaysShowMobileSearchBar', pinned)
      store.commit('setHideHeaderSyncIndicator', false)
      store.commit('setSyncServerStatus', 'syncing')
      store.commit('setSettingsWindowView', 'about')
      store.commit('setSettingsWindowMinimized', true)
    }, pinned)
    await enablePhoneHeader(page)
    const header = page.locator('.topNav')
    await expect.poll(() => header.evaluate(element => {
      const controls = [...element.querySelectorAll('button, .logo')]
        .map(control => control.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
      return controls.every(rect => rect.left >= 0 && rect.right <= window.innerWidth + 0.1) &&
        controls.every((rect, index) => controls.slice(index + 1).every(other => rect.right <= other.left + 0.1 || other.right <= rect.left + 0.1))
    })).toBe(true)
    if (pinned) await expect.poll(() => page.locator('.pinnedSearchTrigger').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(48)
    await page.locator('.profileTrigger').click()
    if (await header.locator('.downloadsButton').isVisible()) {
      await expect(header.locator('.settingsButton')).toBeVisible()
      await expect(page.locator('.downloadsShortcut')).toHaveCount(0)
      await expect(page.locator('.allSettingsShortcut')).toHaveCount(0)
    } else {
      await expect(page.locator('.downloadsShortcut')).toBeVisible()
      await expect(page.locator('.allSettingsShortcut')).toBeVisible()
    }
    await expect(page.locator('.phoneOverflowSync')).toBeVisible()
    await expect(page.locator('.phoneOverflowRestore')).toBeVisible()
    await page.locator('.phoneOverflowRestore').click()
    await expect(page.locator('.settingsWindow')).toBeVisible()
  })
}

for (const [width, pinned] of [[375, true], [480, false]]) {
  test(`tablet header at ${width}px preserves history and full-width search with pinned search ${pinned}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width, height: 850 })
    await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), width === 375 ? 1.25 : 1)
    await page.evaluate(pinned => {
      const store = window.$store
      store.commit('setAlwaysShowMobileSearchBar', pinned)
      store.commit('setMoveDownloadsToAppHeader', true)
      store.commit('setEnableDownloads', true)
      store.commit('setMoveSettingsToAppHeader', true)
      store.commit('setSyncServerStatus', 'syncing')
      store.commit('setHideHeaderSyncIndicator', false)
      store.commit('setSettingsWindowView', 'about')
      store.commit('setSettingsWindowMinimized', true)
    }, pinned)
    await enablePhoneHeader(page)
    await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabletLayout'))
    const header = page.locator('.topNav')
    await expect(header.locator('.navBackButton')).toBeVisible()
    await expect(header.locator('.navForwardButton')).toBeVisible()
    await expect(page.locator('.capacitorPhoneTabSwitcherButton')).toBeHidden()
    await expect.poll(() => header.evaluate(element => {
      const controls = [...element.querySelectorAll('button, .logo')]
        .map(control => control.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
      return controls.every(rect => rect.left >= 0 && rect.right <= window.innerWidth + 0.1) &&
      controls.every((rect, index) => controls.slice(index + 1).every(other => rect.right <= other.left + 0.1 || other.right <= rect.left + 0.1))
    })).toBe(true)
    const search = header.locator(pinned ? '.pinnedSearchTrigger' : '.navSearchButton')
    await expect.poll(() => search.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(48)
    await search.click()
    await expect(header.locator('.ft-input')).toBeFocused()
    await expect.poll(() => header.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const search = element.querySelector('.searchContainer').getBoundingClientRect()
      return Math.abs((search.left - bounds.left) - (bounds.right - search.right)) < 0.1
    })).toBe(true)
    await header.locator('.ft-input').press('Escape')
    await expect(header.locator('.navBackButton')).toBeVisible()
    if (!await header.locator('.downloadsButton').isVisible()) {
      await page.locator('.profileTrigger').click()
      await expect(page.locator('.downloadsShortcut')).toBeVisible()
      await expect(page.locator('.allSettingsShortcut')).toBeVisible()
    } else {
      await expect(header.locator('.downloadsButton')).toBeVisible()
      await expect(header.locator('.settingsButton')).toBeVisible()
    }
  })
}
test('phone header keeps the brand and replaces its row with balanced search', { tag: '@scale' }, async ({ app, page }) => {
  // Wide enough at every UI scale for the brand beside the actions, including the notification bell.
  await setWindowSize(app, page, { width: 480, height: 850 })
  await enablePhoneHeader(page)
  const header = page.locator('.topNav')
  await expect(header.locator('.navBackButton')).toBeHidden()
  await expect(header.locator('.navForwardButton')).toBeHidden()
  await expect(header.locator('.logoText')).toBeVisible()
  await expect(header.locator('.searchContainer')).toBeHidden()
  await header.locator('.navSearchButton').click()
  const input = header.locator('.ft-input')
  await expect(input).toBeFocused()
  await expect(header.locator('.logo')).toBeHidden()
  await expect(header.locator('.profiles')).toBeHidden()
  await expect.poll(() => header.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const search = element.querySelector('.searchContainer').getBoundingClientRect()
    return Math.abs((search.left - bounds.left) - (bounds.right - search.right)) < 0.1 &&
      search.top >= bounds.top && search.bottom <= bounds.bottom
  })).toBe(true)
  await input.fill('my draft')
  await header.locator('.closeMobileSearch').click()
  await expect(input).toBeHidden()
  await expect(header.locator('.navSearchButton')).toBeFocused()
  await header.locator('.navSearchButton').click()
  await expect(input).toHaveValue('my draft')
  await input.press('Escape')
  await expect(header.locator('.logo')).toBeVisible()
  await expect(input).toBeHidden()
  await page.keyboard.press('Control+l')
  await expect(input).toBeFocused()
})

// Returns how far the pill's space before the first header action is from its
// expected value. A filled action gets the header's edge padding. An icon-only
// action's glyph already sits 14px inside its 48px target, so the targets touch.
function pinnedSearchSpacing(pill) {
  return pill.evaluate(element => {
    const pill = element.getBoundingClientRect()
    const header = document.querySelector('.topNav').getBoundingClientRect()
    const action = document.querySelector('.topNav .profiles > *')
    const expected = action.matches('.quickSettings') ? pill.left - header.left : 0
    return Math.abs(action.getBoundingClientRect().left - pill.right - expected)
  })
}

test('always-visible phone search returns to its pill and persists', { tag: '@scale' }, async ({ app, page, attachScreenshot, uiScale }) => {
  await setWindowSize(app, page, { width: 375, height: 850 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enablePhoneHeader(page)
  await expect(page.locator('.pinnedSearchTrigger')).toHaveCount(0)
  await page.evaluate(async theme => {
    const store = window.$store
    await store.dispatch('updateBaseTheme', theme)
    await store.dispatch('updateAlwaysShowMobileSearchBar', true)
  }, uiScale === 100 ? 'dark' : 'light')
  const pill = page.locator('.pinnedSearchTrigger')
  await expect(pill).toBeVisible()
  await expect(page.locator('.topNav .logo')).toBeHidden()
  await expect(page.locator('.capacitorPhoneTabSwitcherButton')).toBeVisible()
  await expect(page.locator('.profileTrigger')).toBeVisible()
  await expect.poll(() => pill.evaluate(element => {
    const pill = element.getBoundingClientRect()
    const tabs = document.querySelector('.capacitorPhoneTabSwitcherButton').getBoundingClientRect()
    return pill.height >= 47.9 && pill.width >= 47.9 && pill.right <= tabs.left + 0.1 && pill.left >= 0
  })).toBe(true)
  await expect.poll(() => pinnedSearchSpacing(pill)).toBeLessThan(0.5)
  await attachScreenshot('always-visible mobile search')
  await pill.click()
  const input = page.locator('.topNav .ft-input')
  await expect(input).toBeFocused()
  await input.fill('saved draft')
  await input.press('Escape')
  await expect(pill).toBeFocused()
  await pill.click()
  await expect(input).toHaveValue('saved draft')
  await page.locator('.closeMobileSearch').click()
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  await expect(page.locator('.capacitorPhoneTabDialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pill).toBeVisible()
  await page.reload()
  await expect(pill).toBeVisible()
  await page.evaluate(() => window.$store.commit('setHideSearchBar', true))
  await expect(pill).toHaveCount(0)
  await expect(page.locator('.navSearchButton')).toHaveCount(0)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setHideSearchBar', false)
    return store.dispatch('updateAlwaysShowMobileSearchBar', false)
  })
  await expect(pill).toHaveCount(0)
  await expect(page.locator('.navSearchButton')).toBeVisible()
})

test('phone tab overview exposes multi-step back and forward history without changing tabs', async ({ app, page }) => {
  await goTo(page, 'history')
  await goTo(page, 'userplaylists')
  await goTo(page, 'subscriptions')
  await setWindowSize(app, page, { width: 390, height: 850 })
  await enablePhoneHeader(page)
  const activeTabId = await page.evaluate(() => window.$store.getters.getPresentedTabId)
  const openHistory = async () => {
    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    await page.locator('.capacitorPhoneTabTarget[aria-selected="true"]').click({ button: 'right' })
    const historyButton = page.getByRole('menuitem', { name: 'Tab history', exact: true })
    await historyButton.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(historyButton).toBeFocused()
    await historyButton.click()
    await expect(page.locator('.capacitorTabActionsBackdrop')).toBeHidden()
    await expect(page.locator('.capacitorPhoneTabHistory')).toBeVisible()
    const entry = page.locator('.capacitorPhoneTabHistoryEntry[aria-current="page"]')
    await entry.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(entry).toBeFocused()
  }
  await openHistory()
  await expect(page.locator('.capacitorPhoneTabHistoryEntry[aria-current="page"]')).toContainText('Subscriptions')
  await page.locator('.capacitorPhoneTabHistoryEntry').filter({ hasText: /^History/ }).click()
  await expect(page).toHaveURL(/#\/history/)
  await expect(page.locator('.capacitorPhoneTabOverlay')).toBeHidden()
  await openHistory()
  await page.locator('.capacitorPhoneTabHistoryEntry').filter({ hasText: /^Subscriptions/ }).last().click()
  await expect(page).toHaveURL(/#\/subscriptions/)
  expect(await page.evaluate(() => window.$store.getters.getPresentedTabId)).toBe(activeTabId)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setSyncServerEnabled', true)
    store.commit('setSyncServerToken', 'e2e-token')
    store.commit('setSyncServerPrivacyMode', 'enhanced')
    store.commit('setSyncServerSyncSessions', true)
    store.commit('setSyncServerSharedTabs', false)
    store.commit('setSyncServerOtherDeviceSessions', [{ syncDeviceId: 'phone-history-e2e', sessionId: 'session', tabs: [] }])
  })
  await openHistory()
  await page.keyboard.press('Escape')
  await expect(page.locator('.capacitorPhoneOpenTabs')).toBeVisible()
  await expect(page.locator('#capacitor-phone-open-tabs-tab')).toBeVisible()
  await expect(page.locator('.capacitorPhoneTabTarget[aria-selected="true"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.capacitorPhoneTabSwitcherButton')).toBeFocused()
})

test('phone tab history clamps its rendered scroll range after resize and fewer entries', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 390, height: 550 })
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(0.95))
  await page.evaluate(() => {
    const store = window.$store
    const tab = store.getters.getPresentedTab
    const entry = tab.history[tab.historyIndex]
    store.commit('setTabNavigation', {
      tabId: tab.id,
      route: tab.route,
      history: Array.from({ length: 40 }, (_, index) => ({ ...entry, title: `Page ${index}` })),
      historyIndex: 39
    })
  })
  await enablePhoneHeader(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  await page.locator('.capacitorPhoneTabTarget[aria-selected="true"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Tab history', exact: true }).click()
  const panel = page.locator('.capacitorPhoneTabHistory')
  const checkRange = () => panel.evaluate(element => {
    const content = element.querySelector('.capacitorPhoneTabHistoryContent')
    const bottom = content.getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(element).paddingBottom)
    const end = element.getBoundingClientRect().bottom
    const maximum = Math.max(0, bottom - end + element.scrollTop)
    const track = element.querySelector('.os-scrollbar-vertical .os-scrollbar-track')
    const thumb = track.querySelector('.os-scrollbar-handle')
    return element.scrollTop <= maximum + 1 && (maximum === 0
      ? element.querySelector('.os-scrollbar-vertical').classList.contains('os-scrollbar-unusable')
      : Math.abs(thumb.getBoundingClientRect().height / track.getBoundingClientRect().height - element.clientHeight / element.scrollHeight) < 0.02)
  })
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  await setWindowSize(app, page, { width: 760, height: 850 })
  await expect.poll(checkRange).toBe(true)
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.evaluate(() => {
    const store = window.$store
    const tab = store.getters.getPresentedTab
    store.commit('setTabNavigation', { tabId: tab.id, route: tab.route, history: tab.history.slice(0, 2), historyIndex: 1 })
  })
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBe(0)
  await expect.poll(checkRange).toBe(true)
})

test('cancels a mouse hold outside the button and preserves stationary holds and clicks', async ({ page }) => {
  await goTo(page, 'userplaylists')
  await goTo(page, 'history')
  const button = page.locator('.navBackButton .iconButton')
  const dropdown = page.locator('.navBackButton .iconDropdown')
  await expect(button).toHaveAttribute('aria-disabled', 'false')
  const box = await button.boundingBox()
  const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await page.mouse.move(origin.x, origin.y + 100)
  await page.mouse.up()
  // Wait past the 500ms hold threshold to expose a timer surviving release.
  await page.waitForTimeout(600)
  await expect(dropdown).toBeHidden()
  await expect(page).toHaveURL(/#\/history/)
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await expect(dropdown).toBeVisible()
  await page.mouse.up()
  await expect(page).toHaveURL(/#\/history/)
  await page.keyboard.press('Escape')
  await expect(dropdown).toBeHidden()
  await button.click()
  await expect(page).toHaveURL(/#\/userplaylists/)
})
