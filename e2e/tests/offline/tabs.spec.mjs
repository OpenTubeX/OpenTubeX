import { test, expect, sel, goTo } from '../../helpers/app.mjs'

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
  test('new tab button opens a tab and activates it', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)
    await expect(page.locator(sel.tabs).nth(1)).toContainText('Subscriptions')
    await expect(page.locator(sel.tabs).nth(1)).not.toContainText('/subscriptions')
    await expect(page.locator(sel.tabs).nth(1).locator('[data-icon="rss"]')).toBeVisible()
  })

  test('uses the matching app icon when the route changes', async ({ page }) => {
    await goTo(page, 'settings')
    await expect(page.locator(sel.activeTab).locator('[data-icon="sliders"]')).toBeVisible()

    await goTo(page, 'history')
    await expect(page.locator(sel.activeTab).locator('[data-icon="clock-rotate-left"]')).toBeVisible()
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

  test('Ctrl+T opens and Ctrl+W closes a tab', async ({ page }) => {
    await page.keyboard.press('Control+t')
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toContainText('Subscriptions')
    await expect(page.locator(sel.tabs).nth(1)).not.toContainText('/subscriptions')

    await page.keyboard.press('Control+w')
    await expect(page.locator(sel.tabs)).toHaveCount(1)
  })

  test('each tab keeps its own route', async ({ page }) => {
    await goTo(page, 'settings')
    await expect(page).toHaveURL(/#\/settings/)

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history/)

    // Switch back to the first tab: its route must be restored.
    await page.locator(sel.tabs).first().click()
    await expect(page).toHaveURL(/#\/settings/)

    await page.locator(sel.tabs).nth(1).click()
    await expect(page).toHaveURL(/#\/history/)
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

  test('keeps consecutive selected drags aligned while the first drop settles', async ({ page }) => {
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
  test('restoring a closed tab restores its navigation history', async ({ page }) => {
    await goTo(page, 'settings')
    await goTo(page, 'history')
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.tabs).first().click()
    await expect(page).toHaveURL(/#\/history/)

    await page.keyboard.press('Control+w')
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await page.keyboard.press('Control+Shift+t')

    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/settings/)
    await page.locator(sel.forwardButton).click()
    await expect(page).toHaveURL(/#\/history/)
  })

  test.describe('with navigation history disabled after closing', () => {
    test.use({ seed: { settings: { rememberTabNavigationHistory: true } } })

    test('does not persist restored history across a relaunch', async ({ app }) => {
      let page = app.page
      await goTo(page, 'settings')
      await goTo(page, 'history')
      await page.locator(sel.newTabButton).click()
      await page.locator(sel.tabs).first().click()
      await page.keyboard.press('Control+w')

      await goTo(page, 'settings')
      const rememberHistory = page.getByRole('checkbox', { name: 'Remember Tab Navigation History' })
      await expect(rememberHistory).toBeChecked()
      await page.locator('label.switch-label').filter({ hasText: 'Remember Tab Navigation History' }).click()
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

    await goTo(page, 'settings')
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

    const externalRequests = []
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) {
        externalRequests.push(request.url())
      }
    })

    await page.locator('body').press('r')
    await page.waitForTimeout(500)
    expect(externalRequests).toEqual([])
  })
})
