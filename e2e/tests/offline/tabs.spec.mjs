import { test, expect, sel, goTo, goToSettingsSection } from '../../helpers/app.mjs'

/**
 * Returns the box of an element that has stopped moving. Menus and submenus
 * animate in, so measuring right after they become visible yields coordinates
 * that are still a few pixels off their resting place.
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<{ x: number, y: number, width: number, height: number }>}
 */
async function boundingBoxWhenSettled(locator) {
  let previous = null
  let settledBox = null

  await expect.poll(async () => {
    const box = await locator.boundingBox()
    const current = box && `${box.x},${box.y},${box.width},${box.height}`
    const settled = current !== null && current === previous
    previous = current
    if (settled) {
      settledBox = box
    }
    return settled
  }).toBe(true)

  return settledBox
}

/**
 * Delay reorder handling in the main process without delaying other tab
 * operations, simulating a busy system around the renderer-to-main handoff.
 * @param {{electronApp: import('@playwright/test').ElectronApplication}} app
 * @param {number} [delayMs]
 */
async function delayTabReorders(app, delayMs = 1000) {
  await app.electronApp.evaluate(({ ipcMain }, delay) => {
    const channel = 'tabs-reorder'
    const [listener] = ipcMain.listeners(channel)
    ipcMain.removeListener(channel, listener)
    ipcMain.on(channel, (event, ...args) => {
      setTimeout(() => listener(event, ...args), delay)
    })
  }, delayMs)
}

/**
 * Leaves three tabs open with the requested one active and returns their ids in
 * tab bar order.
 * @param {import('@playwright/test').Page} page
 * @param {number} activeIndex
 * @returns {Promise<string[]>}
 */
async function openThreeTabsAndActivate(page, activeIndex) {
  await page.locator(sel.newTabButton).click()
  await page.locator(sel.newTabButton).click()
  await expect(page.locator(sel.tabs)).toHaveCount(3)

  await page.locator(sel.tabs).nth(activeIndex).click()
  await expect(page.locator(sel.tabs).nth(activeIndex)).toHaveClass(/active/)

  return await page.locator(sel.tabs).evaluateAll(
    (tabs) => tabs.map((tab) => tab.dataset.tabId)
  )
}

test.describe('tab bar', () => {
  test('reconciles synced sessions without remounting retained tabs', async ({ page }) => {
    const initialState = await page.evaluate(() => window.ftElectron.tabs.getState())
    const retainedTabId = initialState.activeTabId
    const remoteClosedTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/about',
      title: 'Closed remotely',
      makeActive: false,
      lazyLoad: true
    }))
    const secondRetainedTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/history',
      title: 'Retained history',
      makeActive: true
    }))

    await expect(page.locator(`.tabContent[data-tab-id="${secondRetainedTab.id}"]`)).toBeVisible()
    await page.locator(`.tab[data-tab-id="${retainedTabId}"]`).click()
    await expect(page.locator(`.tabContent[data-tab-id="${retainedTabId}"]`)).toBeVisible()
    await page.locator(`.tab[data-tab-id="${remoteClosedTab.id}"]`).click()
    await expect(page.locator(`.tabContent[data-tab-id="${remoteClosedTab.id}"]`)).toBeVisible()

    const result = await page.evaluate(async ({ retainedTabIds, remoteClosedTabId }) => {
      window.__syncRetainedTabNodes = retainedTabIds.map(tabId => (
        document.querySelector(`.tabContent[data-tab-id="${tabId}"]`)
      ))
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('prepareTabReloadRoute', {
        tabId: retainedTabIds[0],
        route: '/about'
      })
      store.commit('setTabContentTitle', {
        tabId: retainedTabIds[0],
        title: 'Stale local title'
      })
      const [session] = await window.ftElectron.tabs.getSyncSessions()
      const remoteSession = {
        ...session,
        tabs: [
          ...session.tabs
            .filter(tab => tab.id !== remoteClosedTabId)
            .map(tab => tab.id === retainedTabIds[0]
              ? {
                  ...tab,
                  url: 'app://bundle/#/playlists',
                  title: 'Playlists'
                }
              : tab),
          {
            id: 'remote-new-tab',
            url: 'app://bundle/#/settings',
            title: 'Opened remotely',
            isPinned: false,
            color: null,
            isUnloaded: true
          }
        ],
        activeTabId: retainedTabIds[1],
        updatedAt: session.updatedAt + 1
      }

      const applied = await window.ftElectron.tabs.applySyncSessions([remoteSession])
      const stateAfterApply = await window.ftElectron.tabs.getState()
      return {
        applied,
        removedPresentedTabCleared: stateAfterApply.presentedTabId !== remoteClosedTabId
      }
    }, {
      retainedTabIds: [retainedTabId, secondRetainedTab.id],
      remoteClosedTabId: remoteClosedTab.id
    })

    expect(result).toEqual({
      applied: true,
      removedPresentedTabCleared: true
    })
    await expect(page.locator(`.tab[data-tab-id="${remoteClosedTab.id}"]`)).toHaveCount(0)
    await expect(page.locator('.tab[data-tab-id="remote-new-tab"]')).toHaveCount(1)
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', secondRetainedTab.id)
    await expect.poll(() => page.evaluate(tabId => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getTabById(tabId).route.fullPath
    }, retainedTabId)).toBe('/playlists')
    expect(await page.evaluate(tabId => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tab = store.getters.getTabById(tabId)
      return {
        retainedNodesConnected: window.__syncRetainedTabNodes.map(node => node?.isConnected === true),
        pendingReloadRoute: tab.pendingReloadRoute,
        contentTitle: tab.contentTitle
      }
    }, retainedTabId)).toEqual({
      retainedNodesConnected: [true, true],
      pendingReloadRoute: null,
      contentTitle: 'Playlists'
    })
  })

  test('new tab button opens a tab and activates it', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)
    await expect(page.locator(sel.tabs).nth(1)).toContainText('Subscriptions')
    await expect(page.locator(sel.tabs).nth(1)).not.toContainText('/subscriptions')
    await expect(page.locator(sel.tabs).nth(1).locator('[data-icon="rss"]')).toBeVisible()
  })

  test('opens background tabs beside their opener in creation order', async ({ page }) => {
    const openerTabId = await page.locator(sel.tabs).getAttribute('data-tab-id')
    const existingTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/history',
      title: 'Existing tab',
      makeActive: false,
      lazyLoad: true,
      openerTabId: 'unrelated-tab'
    }))
    const firstVideo = await page.evaluate(openerTabId => window.ftElectron.tabs.create({
      route: '/watch/first',
      title: 'First video',
      makeActive: false,
      lazyLoad: true,
      openerTabId
    }), openerTabId)
    const secondVideo = await page.evaluate(openerTabId => window.ftElectron.tabs.create({
      route: '/watch/second',
      title: 'Second video',
      makeActive: false,
      lazyLoad: true,
      openerTabId
    }), openerTabId)

    await expect(page.locator(sel.tabs)).toHaveCount(4)
    await expect.poll(async () => page.locator(sel.tabs).evaluateAll(
      tabs => tabs.map(tab => tab.dataset.tabId)
    )).toEqual([openerTabId, firstVideo.id, secondVideo.id, existingTab.id])

    await page.evaluate(({ tabId }) => window.ftElectron.tabs.move(tabId, 3), {
      tabId: secondVideo.id
    })
    const thirdVideo = await page.evaluate(openerTabId => window.ftElectron.tabs.create({
      route: '/watch/third',
      title: 'Third video',
      makeActive: false,
      lazyLoad: true,
      openerTabId
    }), openerTabId)

    await expect.poll(async () => page.locator(sel.tabs).evaluateAll(
      tabs => tabs.map(tab => tab.dataset.tabId)
    )).toEqual([openerTabId, firstVideo.id, thirdVideo.id, existingTab.id, secondVideo.id])
  })

  test('fixed internal routes use their page title before mounting', async ({ page }) => {
    const fixedRoutes = [
      ['/subscriptions', 'Subscriptions'],
      ['/subscribedchannels', 'Channel List'],
      ['/trending', 'Trending'],
      ['/popular', 'Most Popular'],
      ['/userplaylists', 'Your Playlists'],
      ['/history', 'History'],
      ['/downloads', 'Downloads'],
      ['/stats', 'Stats'],
      ['/settings', 'Settings'],
      ['/about', 'About'],
      ['/settings/profile', 'Profile Manager']
    ]
    const tabs = await page.evaluate(async (routes) => {
      return await Promise.all(routes.map(route => (
        window.ftElectron.tabs.create({
          route,
          makeActive: false,
          lazyLoad: true
        })
      )))
    }, [...fixedRoutes.map(([route]) => route), '/channel/channel-id', '/'])

    expect(tabs.map(tab => tab.title)).toEqual([
      ...fixedRoutes.map(([, title]) => title),
      '/channel/channel-id',
      '/'
    ])
  })

  test('uses one utility window for Settings and Downloads', async ({ page }) => {
    const routeBeforeOpening = page.url()
    await goTo(page, 'settings')
    expect(await page.locator(`${sel.activeTab} .loadingDot`).count()).toBe(0)
    await expect(page.locator(sel.activeTab).locator('[data-icon="rss"]')).toBeVisible()
    await expect(page.locator('.settingsWindow')).toHaveCount(1)

    await goTo(page, 'downloads')
    const downloadsWindow = page.getByRole('dialog', { name: 'Downloads', exact: true })
    await expect(downloadsWindow).toBeVisible()
    await expect(downloadsWindow.locator('.settingsBreadcrumb')).toContainText('Downloads')
    await expect(downloadsWindow.locator('.settingsMenu')).toHaveCount(0)
    await expect(page.locator('.settingsWindow')).toHaveCount(1)
    await expect(page.locator(sel.activeTab).locator('[data-icon="rss"]')).toBeVisible()
    expect(page.url()).toBe(routeBeforeOpening)

    await downloadsWindow.locator('.settingsCloseButton').click()
    await expect(downloadsWindow).toBeHidden()
    expect(page.url()).toBe(routeBeforeOpening)

    await goTo(page, 'downloads')
    await goTo(page, 'settings')
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toHaveCount(0)
    await expect(page.locator('.settingsWindow')).toHaveCount(1)
  })

  test('uses a distinct page icon for watch tabs', async ({ page }) => {
    const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/watch/jNQXAC9IVRw',
      makeActive: false,
      lazyLoad: true
    }))
    const tab = page.locator(`.tab[data-tab-id="${watchTab.id}"]`)

    await expect(tab.locator('[data-icon="clapperboard"]')).toBeVisible()
    await expect(tab.locator('[data-icon="play"]')).toHaveCount(0)
  })

  test('does not show a cached watch avatar before its loading indicator settles', async ({ page }) => {
    const videoId = 'jNQXAC9IVRw'
    await page.evaluate(({ videoId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      // Keep the tab on its avatar after loading so this test observes the
      // loader/avatar handoff rather than racing the autoplay play icon.
      store.commit('setAutoplayVideos', false)
      store.commit('setVideoAvatar', {
        videoId,
        avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
      })

      window.__watchTabIconStates = []
      const recordIconStates = () => {
        for (const tab of document.querySelectorAll('.tab')) {
          window.__watchTabIconStates.push({
            id: tab.dataset.tabId,
            loading: tab.querySelector('.loadingDot') != null,
            avatar: tab.querySelector('.tabAvatar') != null
          })
        }
      }
      new MutationObserver(recordIconStates).observe(
        document.querySelector('.tabsContainer'),
        { childList: true, subtree: true }
      )
    }, { videoId })

    const watchTab = await page.evaluate(({ videoId }) => {
      return window.ftElectron.tabs.create({
        route: `/watch/${videoId}`,
        title: 'Cached video',
        makeActive: true
      })
    }, { videoId })

    const tab = page.locator(`.tab[data-tab-id="${watchTab.id}"]`)
    await expect(tab.locator('.loadingDot')).toBeVisible()
    await expect(tab.locator('.loadingDot')).toHaveCount(0)
    await expect.poll(() => page.evaluate(tabId => (
      window.__watchTabIconStates.some(state => state.id === tabId && !state.loading && state.avatar)
    ), watchTab.id)).toBe(true)

    const states = await page.evaluate(
      tabId => window.__watchTabIconStates.filter(state => state.id === tabId),
      watchTab.id
    )
    const lastLoadingIndex = states.findLastIndex(state => state.loading)

    expect(lastLoadingIndex).toBeGreaterThanOrEqual(0)
    expect(states.slice(0, lastLoadingIndex + 1).some(state => state.avatar)).toBe(false)
    expect(states.slice(lastLoadingIndex + 1).some(state => state.avatar)).toBe(true)
  })

  test('Ctrl+T opens and Ctrl+W closes a tab', async ({ page }) => {
    await page.keyboard.press('Control+t')
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toContainText('Subscriptions')
    await expect(page.locator(sel.tabs).nth(1)).not.toContainText('/subscriptions')

    await page.keyboard.press('Control+w')
    await expect(page.locator(sel.tabs)).toHaveCount(1)
  })

  test('each tab keeps its own route', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'userplaylists')
    await expect(page).toHaveURL(/#\/userplaylists/)

    // Switch back to the first tab: its route must be restored.
    await page.locator(sel.tabs).first().click()
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.tabs).nth(1).click()
    await expect(page).toHaveURL(/#\/userplaylists/)
  })

  test('selects multiple tabs with modifier clicks', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    const tabs = page.locator(sel.tabs)
    await tabs.first().click()
    await tabs.nth(2).click({ modifiers: ['Control'] })

    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('aria-pressed', 'false')
    await expect(tabs.nth(2)).toHaveAttribute('aria-pressed', 'true')

    await tabs.nth(3).click({ modifiers: ['Shift'] })
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'false')
    await expect(tabs.nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(tabs.nth(3)).toHaveAttribute('aria-pressed', 'true')

    await tabs.nth(1).click()
    await expect(page.locator(`${sel.tabs}[aria-pressed="true"]`)).toHaveCount(0)
    await expect(tabs.nth(1)).toHaveClass(/active/)
  })

  test('uses the only selected tab as the shift-selection anchor', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    const tabs = page.locator(sel.tabs)
    await tabs.first().click()
    await tabs.nth(2).click({ modifiers: ['Control'] })
    await tabs.first().click({ modifiers: ['Control'] })
    await tabs.nth(3).click({ modifiers: ['Shift'] })

    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'false')
    await expect(tabs.nth(1)).toHaveAttribute('aria-pressed', 'false')
    await expect(tabs.nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(tabs.nth(3)).toHaveAttribute('aria-pressed', 'true')
  })

  test('clears multi-selection when a shortcut activates another tab', async ({ page }) => {
    const tabIds = await openThreeTabsAndActivate(page, 0)
    const tabs = page.locator(sel.tabs)
    await tabs.nth(2).click({ modifiers: ['Control'] })
    await expect(page.locator(`${sel.tabs}[aria-pressed="true"]`)).toHaveCount(2)

    await page.keyboard.press('Control+2')
    await expect(tabs.nth(1)).toHaveClass(/active/)
    await expect(page.locator(`${sel.tabs}[aria-pressed="true"]`)).toHaveCount(0)

    await page.keyboard.press('Control+w')
    await expect(tabs).toHaveCount(2)
    const remainingTabIds = await tabs.evaluateAll(elements => elements.map(tab => tab.dataset.tabId))
    expect(remainingTabIds).toEqual([tabIds[0], tabIds[2]])
  })

  test('applies close and reload shortcuts to the selected tabs', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    let tabs = page.locator(sel.tabs)
    await tabs.first().click()
    await tabs.nth(2).click({ modifiers: ['Control'] })

    const beforeReload = await page.evaluate(() => window.ftElectron.tabs.getState())
    const selectedIds = [beforeReload.tabs[0].id, beforeReload.tabs[2].id]
    const unselectedId = beforeReload.tabs[1].id
    const refreshKeys = Object.fromEntries(
      beforeReload.tabs.map(tab => [tab.id, tab.refreshKey])
    )

    await page.keyboard.press('Control+r')
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return Object.fromEntries(state.tabs.map(tab => [tab.id, tab.refreshKey]))
    }).toEqual({
      [selectedIds[0]]: refreshKeys[selectedIds[0]] + 1,
      [unselectedId]: refreshKeys[unselectedId],
      [selectedIds[1]]: refreshKeys[selectedIds[1]] + 1
    })

    await page.keyboard.press('Control+w')
    await expect(tabs).toHaveCount(1)
    tabs = page.locator(sel.tabs)
    await expect(tabs).toHaveAttribute('data-tab-id', unselectedId)
  })

  test('confirms before closing several selected tabs at once', async ({ page }) => {
    for (let index = 0; index < 5; index++) {
      await page.locator(sel.newTabButton).click()
    }
    const tabs = page.locator(sel.tabs)
    await expect(tabs).toHaveCount(6)

    await tabs.first().click()
    for (let index = 1; index < 5; index++) {
      await tabs.nth(index).click({ modifiers: ['Control'] })
    }

    await page.keyboard.press('Control+w')
    const prompt = page.locator('.prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('5')

    await prompt.getByRole('button', { name: 'Cancel' }).click()
    await expect(prompt).toHaveCount(0)
    await expect(tabs).toHaveCount(6)

    await page.keyboard.press('Control+w')
    await expect(prompt).toContainText('Settings → General → Confirm before…')
    await prompt.getByRole('button', { name: 'Never ask again', exact: true }).click()
    await expect(tabs).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getConfirmCloseMultipleTabs
    })).toBe(false)
  })

  test('shows a confirmation for loading several unloaded tabs', async ({ page }) => {
    for (let index = 0; index < 5; index++) {
      await page.evaluate(() => window.ftElectron.tabs.create({
        makeActive: false,
        lazyLoad: true
      }))
    }

    const tabs = page.locator(sel.tabs)
    await expect(tabs).toHaveCount(6)
    await tabs.first().click()
    for (let index = 1; index < 6; index++) {
      await tabs.nth(index).click({ modifiers: ['Control'] })
    }
    await tabs.last().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Load Tabs', exact: true }).click()

    const prompt = page.locator('.prompt')
    await expect(prompt).toContainText('Load multiple tabs?')
    await expect(prompt).toContainText('This will load 5 tabs.')
    await expect(prompt).toContainText('Settings → General → Confirm before…')
    await expect(prompt.getByRole('button', { name: 'Load 5 Tabs', exact: true })).toBeVisible()
    await prompt.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator(`${sel.tabs}.unloaded`)).toHaveCount(5)
  })

  test('does not confirm when closing fewer tabs than the threshold', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    const tabs = page.locator(sel.tabs)
    await expect(tabs).toHaveCount(3)

    await tabs.first().click()
    await tabs.nth(1).click({ modifiers: ['Control'] })

    await page.keyboard.press('Control+w')
    await expect(tabs).toHaveCount(1)
    await expect(page.locator('.prompt')).toHaveCount(0)
  })

  test('closes several tabs in one state update', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(4)

    // The first tab stays active, so no tab that is about to be closed has to
    // be presented (and mounted) on the way out. A tab that is still presented
    // while it closes is kept alive until its replacement paints, which is a
    // second state update by design.
    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.presentedTabId === state.tabs[0].id
    }).toBe(true)

    const tabCounts = await page.evaluate(async () => {
      const initialState = await window.ftElectron.tabs.getState()
      const closingIds = initialState.tabs.slice(1).map(tab => tab.id)

      return await new Promise((resolve, reject) => {
        const counts = []
        const timeoutId = window.setTimeout(() => {
          removeListener()
          reject(new Error('Timed out waiting for the tabs to close'))
        }, 5000)
        const removeListener = window.ftElectron.tabs.onStateUpdated((state) => {
          if (state.tabs.length === initialState.tabs.length) return

          counts.push(state.tabs.length)
          if (state.tabs.length === 1) {
            window.clearTimeout(timeoutId)
            removeListener()
            resolve(counts)
          }
        })

        window.ftElectron.tabs.closeMultiple(closingIds)
      })
    })

    expect(tabCounts).toEqual([1])
    await expect(page.locator(sel.tabs)).toHaveCount(1)
  })

  test('coalesces rapid tab creation state updates', async ({ page }) => {
    const tabCounts = await page.evaluate(async () => {
      const initialState = await window.ftElectron.tabs.getState()
      const counts = []
      const removeListener = window.ftElectron.tabs.onStateUpdated((state) => {
        if (state.tabs.length === initialState.tabs.length || state.tabs.length === counts.at(-1)) return
        counts.push(state.tabs.length)
      })

      await Promise.all(Array.from({ length: 4 }, () => (
        window.ftElectron.tabs.create({ route: '/history', makeActive: false })
      )))
      removeListener()
      return counts
    })

    // The first tab appears immediately; the rest of the burst arrives together.
    expect(tabCounts).toEqual([2, 5])
    await expect(page.locator(sel.tabs)).toHaveCount(5)
  })

  test('applies a complete tab reorder in one state update', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    const result = await page.evaluate(async () => {
      const initialState = await window.ftElectron.tabs.getState()
      const initialIds = initialState.tabs.map(tab => tab.id)
      const reorderedIds = [...initialIds.slice(1), initialIds[0]]

      return await new Promise((resolve, reject) => {
        const changedOrders = []
        const timeoutId = window.setTimeout(() => {
          removeListener()
          reject(new Error('Timed out waiting for atomic tab reorder'))
        }, 5000)
        const removeListener = window.ftElectron.tabs.onStateUpdated((state) => {
          const order = state.tabs.map(tab => tab.id)
          if (order.every((tabId, index) => tabId === initialIds[index])) return

          const key = order.join(',')
          if (!changedOrders.includes(key)) {
            changedOrders.push(key)
          }
          if (order.every((tabId, index) => tabId === reorderedIds[index])) {
            window.clearTimeout(timeoutId)
            removeListener()
            resolve({ changedOrders, reorderedIds })
          }
        })

        window.ftElectron.tabs.reorder(reorderedIds)
      })
    })

    expect(result.changedOrders).toHaveLength(1)
    await expect.poll(() => {
      return page.locator(sel.tabs).evaluateAll(elements => {
        return elements.map(element => element.dataset.tabId)
      })
    }).toEqual(result.reorderedIds)
  })

  test('commits a completed drop before a new pointerdown cancels settling', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    const tabs = page.locator(sel.tabs)
    const originalIds = await tabs.evaluateAll(elements => {
      return elements.map(element => element.dataset.tabId)
    })
    await tabs.nth(1).click()
    await expect(tabs.nth(1)).toHaveClass(/active/)
    await tabs.nth(3).click({ modifiers: ['Control'] })

    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tabBar .tab'))
      const sourceRect = tabs[3].getBoundingClientRect()
      const targetRect = tabs[2].getBoundingClientRect()
      tabs[3].dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: sourceRect.left + sourceRect.width / 2,
        clientY: sourceRect.top + sourceRect.height / 2
      }))
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        buttons: 1,
        clientX: targetRect.left + targetRect.width / 2 - 2,
        clientY: targetRect.top + targetRect.height / 2
      }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))

      const interruptRect = tabs[0].getBoundingClientRect()
      tabs[0].dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: interruptRect.left + interruptRect.width / 2,
        clientY: interruptRect.top + interruptRect.height / 2
      }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    })

    await expect.poll(() => {
      return tabs.evaluateAll(elements => {
        return elements.map(element => element.dataset.tabId)
      })
    }).toEqual([
      originalIds[1],
      originalIds[0],
      originalIds[3],
      originalIds[2]
    ])
  })

  test('drags all selected tabs together from the selected tab under the pointer', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    const tabs = page.locator(sel.tabs)
    const originalIds = await tabs.evaluateAll(elements => {
      return elements.map(element => element.dataset.tabId)
    })
    await tabs.nth(2).click()
    await expect(tabs.nth(2)).toHaveClass(/active/)
    await tabs.nth(3).click({ modifiers: ['Control'] })
    await expect(page.locator(`${sel.tabs}[aria-pressed="true"]`)).toHaveCount(2)

    const sourceBox = await tabs.nth(3).boundingBox()
    const targetBox = await tabs.first().boundingBox()
    expect(sourceBox).not.toBeNull()
    expect(targetBox).not.toBeNull()

    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 5 }
    )
    await page.mouse.up()

    await expect.poll(() => {
      return tabs.evaluateAll(elements => {
        return elements.map(element => element.dataset.tabId)
      })
    }).toEqual([
      originalIds[2],
      originalIds[3],
      originalIds[0],
      originalIds[1],
      originalIds[4]
    ])
  })

  test('keeps consecutive selected drags aligned while reorder updates are delayed', async ({ app, page }) => {
    await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    const tabs = page.locator(sel.tabs)
    const originalIds = await tabs.evaluateAll(elements => {
      return elements.map(element => element.dataset.tabId)
    })
    await tabs.nth(2).click()
    await expect(tabs.nth(2)).toHaveClass(/active/)
    await tabs.nth(3).click({ modifiers: ['Control'] })

    await delayTabReorders(app)

    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tabBar .tab'))

      function drag(source, target) {
        const sourceRect = source.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        source.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: sourceRect.left + sourceRect.width / 2,
          clientY: sourceRect.top + sourceRect.height / 2
        }))
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          buttons: 1,
          clientX: targetRect.left + targetRect.width / 2,
          clientY: targetRect.top + targetRect.height / 2
        }))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
      }

      drag(tabs[3], tabs[0])
      drag(tabs[2], tabs[4])
    })

    await page.waitForTimeout(600)
    const visualOrderWhileWaiting = await tabs.evaluateAll(elements => {
      return elements
        .map(element => ({
          id: element.dataset.tabId,
          start: element.getBoundingClientRect().left
        }))
        .sort((a, b) => a.start - b.start)
        .map(({ id }) => id)
    })
    expect(visualOrderWhileWaiting).toEqual([
      originalIds[0],
      originalIds[1],
      originalIds[4],
      originalIds[2],
      originalIds[3]
    ])

    await expect.poll(() => {
      return tabs.evaluateAll(elements => {
        return elements.map(element => element.dataset.tabId)
      })
    }).toEqual([
      originalIds[0],
      originalIds[1],
      originalIds[4],
      originalIds[2],
      originalIds[3]
    ])
  })

  test('restores the authoritative order when an intervening tab invalidates a reorder', async ({ app, page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()

    const tabs = page.locator(sel.tabs)
    const originalIds = await tabs.evaluateAll(elements => {
      return elements.map(element => element.dataset.tabId)
    })
    await delayTabReorders(app)

    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tabBar .tab'))
      const sourceRect = tabs[3].getBoundingClientRect()
      const targetRect = tabs[0].getBoundingClientRect()
      tabs[3].dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: sourceRect.left + sourceRect.width / 2,
        clientY: sourceRect.top + sourceRect.height / 2
      }))
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        buttons: 1,
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top + targetRect.height / 2
      }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    })

    await page.evaluate(openerTabId => window.ftElectron.tabs.create({
      route: '/history',
      title: 'Intervening tab',
      makeActive: false,
      lazyLoad: true,
      openerTabId
    }), originalIds[0])

    const authoritativeOrder = await page.evaluate(async () => {
      return (await window.ftElectron.tabs.getState()).tabs.map(tab => tab.id)
    })
    await expect(tabs).toHaveCount(5)
    await expect.poll(() => tabs.evaluateAll(elements => {
      return elements.map(element => element.dataset.tabId)
    })).toEqual(authoritativeOrder)
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.state.tabs.pendingTabOrder
    })).toBeNull()
  })

  test('keeps a submenu open while moving toward it diagonally', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.tabs).first().click({ button: 'right' })

    const closeTabs = page.getByRole('menuitem', { name: 'Close Tabs', exact: true })
    await closeTabs.hover()

    const submenu = closeTabs.locator('xpath=following-sibling::*[@role="menu"]')
    await expect(submenu).toBeVisible()

    // Build the path from the settled submenu and keep it comfortably inside
    // the safe triangle so device-pixel rounding cannot close the submenu.
    const parentBox = await boundingBoxWhenSettled(closeTabs)
    const submenuBox = await boundingBoxWhenSettled(submenu)

    await page.mouse.move(
      parentBox.x + parentBox.width * 0.75,
      parentBox.y + parentBox.height / 2
    )
    await page.mouse.move(
      submenuBox.x + submenuBox.width / 2,
      submenuBox.y + submenuBox.height * 0.65,
      { steps: 10 }
    )

    await expect(submenu).toBeVisible()
  })

  test('keeps a submenu inside the viewport for a bottom vertical tab', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 450 })
    await page.keyboard.press('F1')
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)

    for (let index = 0; index < 7; index++) {
      await page.keyboard.press('Control+t')
    }

    await page.locator(sel.activeTab).click({ button: 'right' })
    const tabColor = page.getByRole('menuitem', { name: 'Tab Color', exact: true })
    await tabColor.hover()

    const submenu = tabColor.locator('xpath=following-sibling::*[@role="menu"]')
    await expect(submenu).toBeVisible()
    const submenuBox = await boundingBoxWhenSettled(submenu)
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))

    expect(submenuBox.x).toBeGreaterThanOrEqual(8)
    expect(submenuBox.y).toBeGreaterThanOrEqual(8)
    expect(submenuBox.x + submenuBox.width).toBeLessThanOrEqual(viewport.width - 8)
    expect(submenuBox.y + submenuBox.height).toBeLessThanOrEqual(viewport.height - 8)
  })

  test('aligns close buttons for pinned and unpinned vertical tabs', async ({ page }) => {
    await page.keyboard.press('Control+t')
    await page.keyboard.press('F1')
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)

    const tabs = page.locator(sel.tabs)
    const pinnedTab = tabs.first()
    const unpinnedTab = tabs.nth(1)
    const pinnedTabId = await pinnedTab.getAttribute('data-tab-id')

    await page.evaluate(tabId => window.ftElectron.tabs.setPinned(tabId, true), pinnedTabId)
    await expect(pinnedTab).toHaveClass(/pinned/)
    await pinnedTab.hover()

    const pinnedCloseBox = await pinnedTab.locator('.closeButton').boundingBox()
    const unpinnedCloseBox = await unpinnedTab.locator('.closeButton').boundingBox()

    expect(pinnedCloseBox).not.toBeNull()
    expect(unpinnedCloseBox).not.toBeNull()
    expect(pinnedCloseBox.x).toBe(unpinnedCloseBox.x)
  })

  test('keeps the vertical tab scrollbar inside the window edge', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 450 })
    for (let index = 0; index < 15; index++) {
      await page.keyboard.press('Control+t')
    }

    for (const position of ['left', 'right']) {
      await page.evaluate(position => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setTabBarPosition', position)
      }, position)

      const container = page.locator('.tabsContainer')
      const scrollbar = container.locator(':scope > .os-scrollbar-vertical')
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

      await expect.poll(async () => {
        const [containerBox, scrollbarBox] = await Promise.all([
          container.boundingBox(),
          scrollbar.boundingBox()
        ])
        if (containerBox === null || scrollbarBox === null) return Infinity

        const containerEdge = position === 'left'
          ? containerBox.x
          : containerBox.x + containerBox.width
        const scrollbarEdge = position === 'left'
          ? scrollbarBox.x
          : scrollbarBox.x + scrollbarBox.width
        const expectedEdge = position === 'left' ? 0 : 800

        return Math.max(
          Math.abs(containerEdge - expectedEdge),
          Math.abs(scrollbarEdge - expectedEdge)
        )
      }).toBeLessThanOrEqual(1)
    }
  })

  test('uses the same title font size for pinned and unpinned tabs', async ({ page }) => {
    await page.keyboard.press('Control+t')

    const tabs = page.locator(sel.tabs)
    const pinnedTab = tabs.first()
    const pinnedTabId = await pinnedTab.getAttribute('data-tab-id')

    await page.evaluate(tabId => window.ftElectron.tabs.setPinned(tabId, true), pinnedTabId)
    await expect(pinnedTab).toHaveClass(/pinned/)

    const titleFontSizes = await tabs.locator('.tabTitle').evaluateAll(titles => {
      return titles.map(title => getComputedStyle(title).fontSize)
    })

    expect(titleFontSizes[0]).toBe(titleFontSizes[1])
  })

  // Regression: search bar text used to leak between tabs (65f4e2e13)
  test('search bar text is independent per tab', async ({ page }) => {
    const searchInput = page.locator(sel.searchInput)
    await searchInput.fill('first tab query')

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(searchInput).toHaveValue('')

    await searchInput.fill('second tab query')

    await page.locator(sel.tabs).first().click()
    await expect(searchInput).toHaveValue('first tab query')

    await page.locator(sel.tabs).nth(1).click()
    await expect(searchInput).toHaveValue('second tab query')
  })

  test('cleared search bar text stays empty after switching tabs', async ({ page }) => {
    const searchInput = page.locator(sel.searchInput)
    await page.locator(sel.newTabButton).click()

    await searchInput.fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator('.topNav .searchInput .clearInputTextButton').click()
    await expect(searchInput).toHaveValue('')

    await page.locator(sel.tabs).first().click()
    await page.locator(sel.tabs).nth(1).click()

    await expect(searchInput).toHaveValue('')
  })

  test('search filters are independent per tab', async ({ page }) => {
    const filterButton = page.locator('.navFilterButton')

    await filterButton.click()
    await page.locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(filterButton).toHaveClass(/filterChanged/)

    await page.locator(sel.newTabButton).click()
    await expect(filterButton).not.toHaveClass(/filterChanged/)

    await filterButton.click()
    await expect(page.locator('input[type="radio"][value="today"]')).not.toBeChecked()
    await page.locator('.searchRadio', { hasText: 'Prioritize' }).getByText('Popularity', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.locator(sel.tabs).first().click()
    await filterButton.click()
    await expect(page.locator('input[type="radio"][value="today"]')).toBeChecked()
    await expect(page.locator('input[type="radio"][value="relevance"]')).toBeChecked()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.locator(sel.tabs).nth(1).click()
    await filterButton.click()
    await expect(page.locator('input[type="radio"][value="popularity"]')).toBeChecked()
    await expect(page.locator('input[type="radio"][value="today"]')).not.toBeChecked()
  })

  test('loading a search tab fills the search bar from its route', async ({ page }) => {
    const searchTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/search/loaded%20tab%20query',
      makeActive: false
    }))

    await page.locator(`.tab[data-tab-id="${searchTab.id}"]`).click()

    await expect(page.locator(sel.searchInput)).toHaveValue('loaded tab query')
  })

  test('closing the active tab activates a remaining tab', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(3)

    await page.locator(sel.activeTab).locator('.closeButton').click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.activeTab)).toHaveCount(1)
  })

  test('closing the active tab selects the previous tab by default', async ({ page }) => {
    const tabIds = await openThreeTabsAndActivate(page, 1)

    await page.locator(sel.activeTab).locator('.closeButton').click()
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', tabIds[0])
  })

  test('falls back to the next tab when there is no previous tab', async ({ page }) => {
    const tabIds = await openThreeTabsAndActivate(page, 0)

    await page.locator(sel.activeTab).locator('.closeButton').click()
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', tabIds[1])
  })

  // Regression: removing a logical tab left its detached video presented in
  // the native PiP window (#268). A canvas stream keeps this independent of
  // external media servers while exercising Chromium's real PiP API.
  test('exits PiP when its source tab is closed', async ({ page }) => {
    const sourceTab = page.locator('.tabContent[aria-hidden="false"]')
    await sourceTab.evaluate(async (root) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height)

      const video = document.createElement('video')
      video.className = 'pipTestVideo'
      video.muted = true
      video.srcObject = canvas.captureStream(5)

      const button = document.createElement('button')
      button.className = 'pipTestButton'
      button.textContent = 'Enter PiP'
      button.addEventListener('click', () => video.requestPictureInPicture(), { once: true })

      root.append(canvas, video, button)
      await video.play()
    })

    const video = page.locator('.pipTestVideo')
    await sourceTab.locator('.pipTestButton').click()
    await expect.poll(() => video.evaluate(
      (element) => document.pictureInPictureElement === element
    )).toBe(true)

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect.poll(() => video.evaluate(
      (element) => document.pictureInPictureElement === element
    )).toBe(true)

    await page.locator(sel.tabs).first().locator('.closeButton').click()
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement === null)).toBe(true)
  })

  // Regression: closing the presented tab activates its replacement before the
  // old subtree is disposed. Auto-PiP must not interpret that transition as an
  // ordinary tab switch and open PiP for the tab being closed (#364).
  test('does not enter PiP while its source tab is closing', async ({ page }) => {
    const sourceTab = page.locator('.tabContent[aria-hidden="false"]')
    const sourceTabId = await sourceTab.getAttribute('data-tab-id')
    await sourceTab.evaluate(async (root) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height)

      const video = document.createElement('video')
      video.className = 'player pipTestVideo'
      video.muted = true
      video.srcObject = canvas.captureStream(5)
      video.ui = {
        getControls: () => ({
          togglePiP: () => video.requestPictureInPicture()
        })
      }

      root.append(canvas, video)
      await video.play()
    })

    // Verify the synthetic player exercises the same privileged PiP request
    // path used by automatic PiP.
    await page.evaluate((tabId) => window.ftElectron.requestPiP(tabId), sourceTabId)
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement !== null)).toBe(true)
    await page.evaluate(() => document.exitPictureInPicture())

    await page.evaluate(() => window.ftElectron.tabs.create({ makeActive: false }))
    await expect(page.locator(sel.tabs)).toHaveCount(2)

    await page.evaluate((tabId) => {
      window.ftElectron.tabs.close(tabId)
      window.ftElectron.requestPiP(tabId)
    }, sourceTabId)

    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement === null)).toBe(true)
  })

  // Regression: selected tab was lost when navigating back (3f498ec59)
  test('history back keeps the current tab selected', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)

    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)
  })
})

test.describe('closed tabs', () => {
  test('does not restore a tab whose deferred close is interrupted by shutdown', async ({ app }) => {
    let page = app.page
    const closedTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')

    await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/about',
      makeActive: false,
      lazyLoad: true
    }))

    await page.locator(sel.activeTab).locator('.closeButton').evaluate(element => element.click())
    ;({ page } = await app.relaunch())
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect(page.locator(sel.tabs)).not.toHaveAttribute('data-tab-id', closedTabId)
    await expect(page).toHaveURL(/#\/about/)
  })

  test('restoring a closed tab restores its navigation history', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await goTo(page, 'history')
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.tabs).first().click()
    await expect(page).toHaveURL(/#\/history/)

    await page.keyboard.press('Control+w')
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await page.keyboard.press('Control+Shift+t')

    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/userplaylists/)
    await page.locator(sel.forwardButton).click()
    await expect(page).toHaveURL(/#\/history/)
  })

  test.describe('with navigation history disabled after closing', () => {
    test.use({ seed: { settings: { rememberTabNavigationHistory: true } } })

    test('does not persist restored history across a relaunch', async ({ app }) => {
      let page = app.page
      await goTo(page, 'userplaylists')
      await goTo(page, 'history')
      await page.locator(sel.newTabButton).click()
      await page.locator(sel.tabs).first().click()
      await page.keyboard.press('Control+w')

      const privacy = await goToSettingsSection(page, 'privacy')
      await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)
      const rememberHistory = privacy.getByRole('checkbox', { name: 'Remember Tab Navigation History' })
      await expect(rememberHistory).toBeChecked()
      await privacy.locator('label.switch-label').filter({ hasText: 'Remember Tab Navigation History' }).click()
      await expect(rememberHistory).not.toBeChecked()

      await page.keyboard.press('Control+Shift+t')
      await expect(page).toHaveURL(/#\/history/)

      ;({ page } = await app.relaunch())
      await expect(page).toHaveURL(/#\/history/)
      await expect(page.locator(sel.backButton)).toBeDisabled()
    })
  })
})

test.describe('tab close focus set to the next tab', () => {
  test.use({ seed: { settings: { tabCloseFocus: 'nextTab' } } })

  test('closing the active tab selects the next tab', async ({ page }) => {
    const tabIds = await openThreeTabsAndActivate(page, 1)

    await page.locator(sel.activeTab).locator('.closeButton').click()
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', tabIds[2])
  })

  test('falls back to the previous tab when there is no next tab', async ({ page }) => {
    const tabIds = await openThreeTabsAndActivate(page, 2)

    await page.locator(sel.activeTab).locator('.closeButton').click()
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', tabIds[1])
  })

  test('selects the loaded previous tab when the next tab is unloaded', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)
    const previousTabId = await page.locator(sel.tabs).first().getAttribute('data-tab-id')
    await expect(page.locator(`.tab[data-tab-id="${previousTabId}"]`)).not.toHaveClass(/unloaded/)
    const unloadedTab = await page.evaluate(() => window.ftElectron.tabs.create({
      makeActive: false,
      lazyLoad: true
    }))
    await expect(page.locator(`.tab[data-tab-id="${unloadedTab.id}"]`)).toHaveClass(/unloaded/)

    await page.locator(sel.activeTab).locator('.closeButton').click()
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', previousTabId)
    await expect(page.locator(`.tab[data-tab-id="${unloadedTab.id}"]`)).toHaveClass(/unloaded/)
  })
})

test.describe('tab icons disabled', () => {
  test.use({ seed: { settings: { showTabIcons: false } } })

  test('hides page icons', async ({ page }) => {
    await expect(page.locator(sel.activeTab).locator('.tabPageIcon, .tabAvatar')).toHaveCount(0)
  })
})

test.describe('fixed tab width', () => {
  test.use({ seed: { settings: { useFixedTabWidth: true, fixedTabWidth: 140 } } })

  test('gives every horizontal tab the configured width', async ({ page }) => {
    await page.keyboard.press('Control+t')
    await expect(page.locator(sel.tabs)).toHaveCount(2)

    await expect.poll(async () => {
      return await page.locator(sel.tabs).evaluateAll(
        tabs => tabs.map(tab => Math.round(tab.getBoundingClientRect().width))
      )
    }).toEqual([140, 140])

    // Vertical tabs fill the column, so the setting must not constrain them.
    await page.keyboard.press('F1')
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
    await expect.poll(async () => {
      return await page.locator(sel.tabs).first().evaluate(
        tab => Math.round(tab.getBoundingClientRect().width)
      )
    }).toBeGreaterThan(140)
  })
})

test.describe('localized tab titles', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('new subscription tabs use the loaded locale', async ({ page }) => {
    await expect(page.locator(sel.activeTab)).toContainText('Abos')

    await page.keyboard.press('Control+t')
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.activeTab)).toContainText('Abos')
    await expect(page.locator(sel.activeTab)).not.toContainText(/\/subscriptions|Subscriptions\.Subscriptions/)
  })
})

test.describe('custom default page', () => {
  test.use({ seed: { settings: { landingPage: 'history' } } })

  test('uses the configured route and title for a new tab', async ({ page }) => {
    const tab = await page.evaluate(async () => {
      return await window.ftElectron.tabs.create({
        makeActive: false,
        lazyLoad: true
      })
    })

    expect(tab.route.fullPath).toBe('/history')
    expect(tab.title).toBe('History')
  })
})

test.describe('removed settings landing page', () => {
  test.use({ seed: { settings: { landingPage: 'settings' } } })

  test('migrates to subscriptions before creating tabs', async ({ page }) => {
    const tab = await page.evaluate(async () => {
      return await window.ftElectron.tabs.create({
        makeActive: false,
        lazyLoad: true
      })
    })

    expect(tab.route.fullPath).toBe('/subscriptions')
    expect(tab.title).toBe('Subscriptions')
  })
})

test.describe('RTL context menus', () => {
  test.use({ seed: { settings: { currentLocale: 'ar' } } })

  test('positions the menu at the physical pointer coordinates', async ({ page }) => {
    const targetBox = await page.locator(sel.searchInput).boundingBox()
    expect(targetBox).not.toBeNull()

    const pointer = {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + targetBox.height / 2
    }
    await page.mouse.click(pointer.x, pointer.y, { button: 'right' })

    const menu = page.locator('.contextMenu')
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCSS('transform', 'none')

    const menuBox = await menu.boundingBox()
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    expect(menuBox).not.toBeNull()
    expect(menuBox.x).toBeCloseTo(
      Math.max(8, Math.min(pointer.x - menuBox.width, viewport.width - menuBox.width - 8)),
      0
    )
    expect(menuBox.y).toBeCloseTo(
      Math.max(8, Math.min(pointer.y, viewport.height - menuBox.height - 8)),
      0
    )

    await page.keyboard.press('Escape')
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.tabs).first().click({ button: 'right' })

    const closeTabs = page.getByRole('menuitem', { name: 'Close Tabs', exact: true })
    await closeTabs.hover()

    const submenu = closeTabs.locator('xpath=following-sibling::*[@role="menu"]')
    await expect(submenu).toBeVisible()

    const parentBox = await closeTabs.boundingBox()
    const submenuBox = await submenu.boundingBox()
    expect(parentBox).not.toBeNull()
    expect(submenuBox).not.toBeNull()
    expect(submenuBox.x + submenuBox.width / 2).toBeLessThan(
      parentBox.x + parentBox.width / 2
    )
  })
})

test.describe('subscription feed tabs', () => {
  test.use({
    seed: {
      settings: {
        hideSubscriptionsVideos: false,
        hideSubscriptionsShorts: false,
        hideSubscriptionsLive: false,
        hideSubscriptionsCommunity: false,
        useRssFeeds: false
      }
    }
  })

  test('uses the last selected feed for newly opened subscription tabs', async ({ page }) => {
    const feedTab = (tab) => page
      .locator('.tabContent[aria-hidden="false"]')
      .locator(`[data-subscription-feed-tab="${tab}"]`)

    await feedTab('shorts').click()
    await expect(feedTab('shorts')).toHaveAttribute('aria-selected', 'true')

    await page.locator(sel.newTabButton).click()
    await expect(feedTab('shorts')).toHaveAttribute('aria-selected', 'true')

    await feedTab('live').click()
    await page.locator(sel.tabs).first().click()
    await expect(feedTab('shorts')).toHaveAttribute('aria-selected', 'true')

    await goTo(page, 'history')
    await goTo(page, 'subscriptions')
    await expect(feedTab('live')).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('background tab shortcuts', () => {
  test.use({
    seed: {
      settings: { fetchSubscriptionsAutomatically: false },
      profiles: [
        {
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [
            {
              id: 'UC-test-subscription',
              name: 'Test subscription',
              thumbnail: ''
            }
          ]
        }
      ]
    }
  })

  test('Ctrl+R refreshes the current feed on an active subscriptions tab', async ({ page }) => {
    await expect(page.getByText(/disabled automatic subscription fetching/i)).toBeVisible()
    await page.route(/^https?:\/\//, (route) => route.abort())

    const externalRequests = []
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) {
        externalRequests.push(request.url())
      }
    })

    await page.keyboard.press('Control+r')
    await expect.poll(() => externalRequests.length).toBeGreaterThan(0)
  })

  // Regression: the document-level subscriptions listener refreshed a hidden
  // tab when R was pressed in a different tab (d20ff948f).
  test('R does not refresh subscriptions in a background tab', async ({ page }) => {
    await expect(page.getByText(/disabled automatic subscription fetching/i)).toBeVisible()

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'history')

    const subscriptionRefreshRequests = []
    page.on('request', (request) => {
      if (request.url().includes('UC-test-subscription')) {
        subscriptionRefreshRequests.push(request.url())
      }
    })

    await page.locator('body').press('r')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(resolve)
    })))
    expect(subscriptionRefreshRequests).toEqual([])
  })

  test('R typed in settings search does not refresh subscriptions behind it', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    const subscriptionRefreshRequests = []
    page.on('request', (request) => {
      if (request.url().includes('UC-test-subscription')) {
        subscriptionRefreshRequests.push(request.url())
      }
    })

    await search.press('r')
    await expect(search).toHaveValue('r')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(resolve)
    })))
    expect(subscriptionRefreshRequests).toEqual([])
  })
})

/**
 * Opens the Ctrl+Tab switcher and keeps Control held so the overlay stays up.
 * Callers must release Control (or Escape) when finished.
 * @param {import('@playwright/test').Page} page
 */
async function openTabSwitcher(page) {
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await expect(page.locator('.tabSwitcher')).toBeVisible()
}

test.describe('tab switcher', () => {
  test('wraps into multiple rows when there are many tabs', async ({ page }) => {
    await page.evaluate(async () => {
      for (let i = 0; i < 9; i++) {
        await window.ftElectron.tabs.create({
          makeActive: false,
          lazyLoad: true
        })
      }
    })
    await expect(page.locator(sel.tabs)).toHaveCount(10)

    try {
      await openTabSwitcher(page)

      const gridPositions = await page.locator('.tabSwitcherItem').evaluateAll((items) => {
        return {
          rows: new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size,
          columns: new Set(items.map((item) => Math.round(item.getBoundingClientRect().left))).size
        }
      })
      expect(gridPositions.rows).toBeGreaterThan(1)
      expect(gridPositions.columns).toBeGreaterThan(1)
    } finally {
      await page.keyboard.up('Control')
    }

    await expect(page.locator('.tabSwitcher')).toHaveCount(0)
  })

  test('shows page icons when tab icons are enabled', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)

    try {
      await openTabSwitcher(page)
      await expect(page.locator('.tabSwitcherItem .tabSwitcherTitleIcon')).toHaveCount(2)
      await expect(page.locator('.tabSwitcherItem .tabSwitcherTitleIcon').first())
        .toHaveAttribute('data-icon', 'rss')
    } finally {
      await page.keyboard.up('Control')
    }
  })
})

test.describe('tab switcher without icons', () => {
  test.use({ seed: { settings: { showTabIcons: false } } })

  test('hides title icons when tab icons are disabled', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)

    try {
      await openTabSwitcher(page)
      await expect(
        page.locator('.tabSwitcherItem .tabSwitcherTitleIcon, .tabSwitcherItem .tabSwitcherTitleAvatar')
      ).toHaveCount(0)
    } finally {
      await page.keyboard.up('Control')
    }
  })
})
