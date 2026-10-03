import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`centered desktop header at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale } } })

    test('preserves search spacing when scrollbar width changes without resizing', async ({ app, page }) => {
      await app.electronApp.evaluate(({ BrowserWindow }, factor) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), width: 800 * factor, height: 820 * factor })
      }, uiScale / 100)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(800)
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setEnableDownloads', true)
        store.commit('setMoveDownloadsToAppHeader', true)
        store.commit('setMoveSettingsToAppHeader', true)
        store.commit('setHideHeaderSyncIndicator', false)
        store.commit('setSyncServerStatus', 'syncing')
      })
      const header = page.locator('.topNav')
      await expect(header.locator('.searchContainer')).toBeVisible()
      for (const width of [4, 20, 4]) {
        await page.evaluate(width => {
          document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setScrollbarThumbWidth', width)
        }, width)
        await expect.poll(() => header.evaluate(element => {
          const field = element.querySelector('.searchContainer').getBoundingClientRect()
          const actions = [...element.querySelector('.profiles').children]
            .map(child => child.getBoundingClientRect()).filter(bounds => bounds.width > 0)
          return Math.min(...actions.map(bounds => bounds.left)) - field.right
        }), { message: `search keeps its action gap with ${width}px scrollbar width` }).toBeGreaterThanOrEqual(12)
      }
    })

    test('centers search with space on both sides and removes logo text before collapsing search', async ({ app, page }, testInfo) => {
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      for (const [tabPosition, extraActions] of [['top', false], ['left', false], ['right', true]]) {
        await page.evaluate(({ tabPosition, extraActions }) => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('setTabBarPosition', tabPosition)
          store.commit('setVerticalTabBarWidth', 220)
          store.commit('setEnableDownloads', extraActions)
          store.commit('setMoveDownloadsToAppHeader', extraActions)
          store.commit('setMoveSettingsToAppHeader', extraActions)
          store.commit('setHideHeaderSyncIndicator', !extraActions)
          store.commit('setSyncServerStatus', extraActions ? 'syncing' : 'idle')
        }, { tabPosition, extraActions })
        for (const width of [1000, 1280, 1080, 960, 900, 800, 735, 681, 680]) {
          await app.electronApp.evaluate(({ BrowserWindow }, size) => {
            const window = BrowserWindow.getAllWindows()[0]
            window.setBounds({ ...window.getBounds(), ...size })
          }, { width: Math.round(width * uiScale / 100), height: 820 * uiScale / 100 })
          await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
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
}

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

for (const zoom of [1, 1.25]) {
  test(`phone header actions have equal spacing at ${zoom} scale`, async ({ app, page }) => {
    await enablePhoneHeader(page)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setEnableDownloads', true)
      store.commit('setMoveDownloadsToAppHeader', true)
      store.commit('setMoveSettingsToAppHeader', true)
    })
    await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
    for (const width of [375, 680, 850]) {
      await setWindowSize(app, page, { width, height: width === 375 ? 850 : width === 680 ? 800 : 700 })
      if (width === 850) await page.locator('.topNav').evaluate(header => header.classList.add('phoneLayout'))
      await expect.poll(() => page.locator('.profiles').evaluate(element => {
        const buttons = [...element.querySelectorAll(':scope > button, .capacitorPhoneTabSwitcherButton, .profileTrigger')]
          .map(button => button.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
        const distances = buttons.slice(1).map((rect, index) => rect.left + rect.width / 2 - buttons[index].left - buttons[index].width / 2)
        return Math.max(...distances) - Math.min(...distances)
      })).toBeLessThan(0.2)
    }
  })
}

test('phone header honors settings and downloads placement', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 390, height: 850 })
  const header = page.locator('.topNav')
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setMoveDownloadsToAppHeader', false)
    store.commit('setMoveSettingsToAppHeader', false)
  })
  await expect(header.locator('.downloadsButton')).toHaveCount(0)
  await expect(header.locator('.settingsButton')).toHaveCount(0)
  await page.locator('.profileTrigger').click()
  await expect(page.locator('.downloadsShortcut')).toBeVisible()
  await expect(page.locator('.allSettingsShortcut')).toBeVisible()
})

for (const zoom of [1, 1.25]) {
  test(`phone header reserves section gaps at the shortcut cutoff at ${zoom} scale`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 390, height: 850 })
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setEnableDownloads', true)
      store.commit('setMoveDownloadsToAppHeader', true)
      store.commit('setMoveSettingsToAppHeader', true)
      store.commit('setAlwaysShowMobileSearchBar', true)
    })
    await enablePhoneHeader(page)
    await page.evaluate(() => {
      document.querySelector('.app').classList.add('capacitorTabletLayout')
      // Put the shortcut cutoff above the 350px layout breakpoint so the section
      // gaps are present. Action margins are part of the measured header budget.
      document.querySelector('.topNav .quickSettings').style.marginInlineStart = '52px'
    })
    await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
    for (const width of [380, 383, 384, 390, 380]) {
      await app.electronApp.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), ...size })
      }, { width: Math.round(width * zoom), height: 850 * zoom })
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
      await expect.poll(() => page.locator('.pinnedSearchTrigger').evaluate(element => element.getBoundingClientRect().width), {
        message: `pinned search retains its 48px target at ${width}px`
      }).toBeGreaterThanOrEqual(48)
      const shortcuts = page.locator('.topNav .downloadsButton, .topNav .settingsButton')
      await expect(shortcuts).toHaveCount(width < 384 ? 0 : 2)
    }
  })
}

test('phone header retains visible logo text and shortcuts when search is hidden', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 680, height: 850 })
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setHideSearchBar', true)
    store.commit('setEnableDownloads', true)
    store.commit('setMoveDownloadsToAppHeader', true)
    store.commit('setMoveSettingsToAppHeader', true)
    store.commit('setHideHeaderSyncIndicator', false)
    store.commit('setSyncServerStatus', 'syncing')
    store.commit('setSettingsWindowView', 'about')
    store.commit('setSettingsWindowMinimized', true)
  })
  await enablePhoneHeader(page)
  const header = page.locator('.topNav')
  for (const width of [560, 680, 560]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ ...window.getBounds(), width })
    }, width)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
    await expect(header.locator('.logoText')).toBeVisible()
    await expect(header.locator('.downloadsButton')).toBeVisible()
    await expect(header.locator('.settingsButton')).toBeVisible()
    await expect.poll(() => header.evaluate(element => {
      const logo = element.querySelector('.logo').getBoundingClientRect()
      const action = element.querySelector('.profiles').getBoundingClientRect()
      return action.left - logo.right
    })).toBeGreaterThanOrEqual(4)
  }
})

for (const pinned of [false, true]) {
  test(`crowded phone header keeps actions reachable with pinned search ${pinned}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 850 })
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
    await page.evaluate(pinned => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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

for (const width of [375, 450, 480]) {
  for (const pinned of [false, true]) {
    test(`tablet header at ${width}px preserves history and full-width search with pinned search ${pinned}`, async ({ app, page }) => {
      await setWindowSize(app, page, { width, height: 850 })
      await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), width === 375 ? 1.25 : 1)
      await page.evaluate(pinned => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
}
for (const zoom of [1, 1.25]) {
  test(`phone header keeps the brand and replaces its row with balanced search at ${zoom} scale`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 390, height: 850 })
    await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
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

  test(`always-visible phone search returns to its pill and persists at ${zoom} scale`, async ({ app, page, attachScreenshot }) => {
    await setWindowSize(app, page, { width: 375, height: 850 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
    await enablePhoneHeader(page)
    await expect(page.locator('.pinnedSearchTrigger')).toHaveCount(0)
    await page.evaluate(async theme => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', theme)
      await store.dispatch('updateAlwaysShowMobileSearchBar', true)
    }, zoom === 1 ? 'dark' : 'light')
    const pill = page.locator('.pinnedSearchTrigger')
    await expect(pill).toBeVisible()
    await expect(page.locator('.topNav .logo')).toBeHidden()
    await expect(page.locator('.capacitorPhoneTabSwitcherButton')).toBeVisible()
    await expect(page.locator('.profileTrigger')).toBeVisible()
    await expect.poll(() => pill.evaluate(element => {
      const pill = element.getBoundingClientRect()
      const tabs = document.querySelector('.capacitorPhoneTabSwitcherButton').getBoundingClientRect()
      return pill.height >= 48 && pill.width >= 48 && pill.right <= tabs.left && pill.left >= 0
    })).toBe(true)
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
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setHideSearchBar', true))
    await expect(pill).toHaveCount(0)
    await expect(page.locator('.navSearchButton')).toHaveCount(0)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setHideSearchBar', false)
      return store.dispatch('updateAlwaysShowMobileSearchBar', false)
    })
    await expect(pill).toHaveCount(0)
    await expect(page.locator('.navSearchButton')).toBeVisible()
  })
}

test.describe('phone search suggestions', () => {
  test.use({
    seed: {
      settings: { enableSearchSuggestions: false },
      searchHistory: [{ _id: 'header test', lastUpdatedAt: Date.now() }]
    }
  })

  for (const zoom of [1, 1.25]) {
    for (const direction of ['ltr', 'rtl']) {
      test(`span the whole search bar at ${zoom} scale in ${direction}`, async ({ app, page }) => {
        await setWindowSize(app, page, { width: 375, height: 850 })
        await app.electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
        await page.evaluate(dir => { document.body.dir = dir }, direction)
        await enablePhoneHeader(page)
        await page.locator('.navSearchButton').click()
        const results = page.locator('.topNav .searchInput .list')
        await expect(results).toBeVisible()
        await expect(results).toContainText('header test')
        await expect.poll(() => results.evaluate(list => {
          const bounds = list.getBoundingClientRect()
          const search = list.closest('.searchContainer').getBoundingClientRect()
          return Math.abs(bounds.left - search.left) < 0.1 &&
            Math.abs(bounds.right - search.right) < 0.1 &&
            Math.abs(bounds.top - search.bottom) < 0.1
        })).toBe(true)
      })
    }
  }
})

test('phone tab overview exposes multi-step back and forward history without changing tabs', async ({ app, page }) => {
  await goTo(page, 'history')
  await goTo(page, 'userplaylists')
  await goTo(page, 'subscriptions')
  await setWindowSize(app, page, { width: 390, height: 850 })
  await enablePhoneHeader(page)
  const activeTabId = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTabId)
  const openHistory = async () => {
    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const historyButton = page.getByRole('button', { name: 'Tab history', exact: true })
    await historyButton.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(historyButton).toBeFocused()
    await expect.poll(() => historyButton.evaluate(element => {
      const style = getComputedStyle(element)
      const probe = document.createElement('span')
      probe.style.color = 'var(--primary-color)'
      element.append(probe)
      const expectedColor = getComputedStyle(probe).color
      probe.remove()
      return style.outlineStyle === 'solid' && Number.parseFloat(style.outlineWidth) >= 2 && style.outlineColor === expectedColor
    })).toBe(true)
    await page.getByRole('button', { name: 'Tab history', exact: true }).click()
    await expect(page.locator('.capacitorPhoneTabHistory')).toBeVisible()
    const entry = page.locator('.capacitorPhoneTabHistoryEntry[aria-current="page"]')
    await entry.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(entry).toBeFocused()
    await expect.poll(() => entry.evaluate(element => {
      const style = getComputedStyle(element)
      const probe = document.createElement('span')
      probe.style.color = 'var(--primary-color)'
      element.append(probe)
      const expectedColor = getComputedStyle(probe).color
      probe.remove()
      return style.outlineStyle === 'solid' && Number.parseFloat(style.outlineWidth) >= 2 && style.outlineColor === expectedColor
    })).toBe(true)
  }
  await openHistory()
  await expect.poll(() => page.locator('.capacitorPhoneTabHistoryEntry').first().evaluate(entry => {
    const icon = entry.querySelector('.ft-icon').getBoundingClientRect()
    const label = entry.querySelector('span[dir="auto"]').getBoundingClientRect()
    return icon.width <= 20.1 && Math.abs(label.left - icon.right - 12) < 0.1
  })).toBe(true)
  await expect(page.locator('.capacitorPhoneTabHistoryEntry[aria-current="page"]')).toContainText('Subscriptions')
  await page.locator('.capacitorPhoneTabHistoryEntry').filter({ hasText: /^History/ }).click()
  await expect(page).toHaveURL(/#\/history/)
  await expect(page.locator('.capacitorPhoneTabOverlay')).toBeHidden()
  await openHistory()
  await page.locator('.capacitorPhoneTabHistoryEntry').filter({ hasText: /^Subscriptions/ }).last().click()
  await expect(page).toHaveURL(/#\/subscriptions/)
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTabId)).toBe(activeTabId)
  await openHistory()
  await page.keyboard.press('Escape')
  await expect(page.locator('.capacitorPhoneOpenTabs')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tab history', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.capacitorPhoneTabSwitcherButton')).toBeFocused()
})

test('phone tab history clamps its rendered scroll range after resize and fewer entries', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 390, height: 550 })
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(0.95))
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
  await page.getByRole('button', { name: 'Tab history', exact: true }).click()
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const tab = store.getters.getPresentedTab
    store.commit('setTabNavigation', { tabId: tab.id, route: tab.route, history: tab.history.slice(0, 2), historyIndex: 1 })
  })
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBe(0)
  await expect.poll(checkRange).toBe(true)
})
