import { test, expect, goTo, goToSettingsSection, sel, setWindowSize, openInterfaceCustomizer } from '../../helpers/app.mjs'
import { DEFAULT_NAVIGATION_ITEMS } from '../../../src/navigationItems.js'

// Fractional UI scales snap layout sizes to device pixels.
async function expectHeight(locator, pixels) {
  await expect.poll(() => locator.evaluate(element => Number.parseFloat(getComputedStyle(element).height)))
    .toBeCloseTo(pixels, 1)
}

test.describe('navigation options outline', { tag: '@scale' }, () => {
  test('clamps scrolling after wider layouts and shorter translated labels', async ({ app, page, uiScale }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
    async function resize(width) {
      await app.electronApp.evaluate(({ BrowserWindow }, bounds) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), ...bounds })
      }, { width: Math.round(width * uiScale / 100), height: Math.round(650 * uiScale / 100) })
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    }
    await resize(900)
    await goToSettingsSection(page, 'appearance')
    await page.getByRole('button', { name: 'Maximize', exact: true }).click()
    await openInterfaceCustomizer(page, 'navigation')
    await resize(350)
    const scroller = page.locator('.customizerEditorScroll:visible')
    const content = scroller.locator('.customizerEditor')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    const thumb = scrollbar.locator('.os-scrollbar-handle')
    async function scrollToEnd() {
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect.poll(() => content.evaluate(element => {
        const viewport = element.closest('.customizerEditorScroll')
        return Math.abs(element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom +
          Number.parseFloat(getComputedStyle(viewport).paddingBottom)) * devicePixelRatio
      })).toBeLessThanOrEqual(2)
    }
    async function expectShorter(previousHeight, previousThumb) {
      await expect.poll(() => content.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(previousHeight)
      await expect.poll(() => content.evaluate(element => {
        const viewport = element.closest('.customizerEditorScroll')
        const contentEnd = element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top +
          viewport.scrollTop + Number.parseFloat(getComputedStyle(viewport).paddingBottom)
        return (viewport.scrollTop - Math.max(0, contentEnd - viewport.clientHeight)) * devicePixelRatio
      }), { message: 'reflow leaves no obsolete scroll offset beyond the rendered content' }).toBeLessThanOrEqual(2)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      await expect.poll(() => thumb.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(previousThumb)
      await expect.poll(() => content.evaluate(element => {
        const viewport = element.closest('.customizerEditorScroll')
        const contentEnd = element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top +
          viewport.scrollTop + Number.parseFloat(getComputedStyle(viewport).paddingBottom)
        const bar = viewport.querySelector('.os-scrollbar-vertical')
        const track = bar.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const handle = bar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return Math.abs(handle.height / track.height - viewport.clientHeight / contentEnd)
      })).toBeLessThan(0.01)
      await scrollToEnd()
      await expect.poll(() => scrollbar.evaluate(element => {
        const track = element.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const handle = element.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return Math.abs(track.bottom - handle.bottom) * devicePixelRatio
      })).toBeLessThanOrEqual(2)
    }
    // Ensure widening reduces wrapped content rather than only changing its width.
    await page.locator('.fixedNavigationOptions .switch-label-text').first().evaluate(element => {
      element.firstChild.textContent = 'Always display the navigation sidebar while playing videos and scrolling through the current page'
    })
    await scrollToEnd()
    const narrowHeight = await content.evaluate(element => element.getBoundingClientRect().height)
    const narrowThumb = await thumb.evaluate(element => element.getBoundingClientRect().height)
    await resize(900)
    await expectShorter(narrowHeight, narrowThumb)
    await resize(350)
    await page.evaluate(async () => {
      await window.$store.dispatch('updateCurrentLocale', 'de-DE')
    })
    await expect(page.locator('.fixedNavigationOptions')).toContainText('Navigationsleiste')
    // Use a verbose translated label so the language switch actually reduces
    // the scroll range even when the standard captions fit the same rows.
    await page.locator('.fixedNavigationOptions .switch-label-text').first().evaluate(element => {
      element.firstChild.textContent = 'Navigationsleiste auch während der Wiedergabe und beim Scrollen immer anzeigen'
    })
    await scrollToEnd()
    const germanHeight = await content.evaluate(element => element.getBoundingClientRect().height)
    const germanThumb = await thumb.evaluate(element => element.getBoundingClientRect().height)
    await page.evaluate(async () => {
      await window.$store.dispatch('updateCurrentLocale', 'en-US')
    })
    await expectShorter(germanHeight, germanThumb)
  })

  test('encloses all three switches at desktop and narrow widths', async ({ app, page }, testInfo) => {
    await setWindowSize(app, page, { width: 900, height: 650 })
    await openInterfaceCustomizer(page, 'navigation')
    const group = page.locator('.fixedNavigationOptions')
    await expect(group.getByRole('checkbox')).toHaveCount(3)
    for (const narrow of [false, true]) {
      if (narrow) await setWindowSize(app, page, { width: 500, height: 600 })
      await expect.poll(() => group.evaluate(element => {
        const outline = element.getBoundingClientRect()
        return [...element.querySelectorAll('.switch-label')].every(label => {
          const bounds = label.getBoundingClientRect()
          return bounds.top >= outline.top + 7 && bounds.bottom <= outline.bottom - 7
        })
      }), { message: 'the outline leaves space above and below every switch label' }).toBe(true)
      await group.scrollIntoViewIfNeeded()
      const scroller = page.locator('.customizerEditorScroll:visible')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => group.evaluate(element => {
        const scroller = element.closest('.customizerEditorScroll')
        return scroller.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom -
          Number.parseFloat(getComputedStyle(scroller).paddingBottom)
      }), { message: 'extra space remains below the outlined options at the end of the page' }).toBeGreaterThan(15)
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => (
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
      ))
      await testInfo.attach(`${narrow ? 'narrow' : 'desktop'} navigation options`, {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
      })
    }
    const scroller = page.locator('.customizerEditorScroll:visible')
    const items = page.locator('.selectedItems .selectedItem')
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    while (await items.count() > 0) {
      await items.last().getByRole('button', { name: /^Remove / }).click()
      await expect.poll(() => scroller.evaluate(element => {
        const content = element.querySelector('.customizerEditor')
        const contentEnd = content.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
          element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
        return element.scrollTop - Math.max(0, contentEnd - element.clientHeight)
      }), { message: 'removing navigation items leaves no obsolete scroll offset' }).toBeLessThanOrEqual(1)
    }
    // The remaining options may still overflow the editor below the preview.
    await expect.poll(() => scroller.evaluate(element => {
      const unusable = element.querySelector(':scope > .os-scrollbar-vertical').classList.contains('os-scrollbar-unusable')
      return unusable === (element.scrollHeight - element.clientHeight <= 1)
    }), { message: 'the scrollbar matches the remaining scroll range' }).toBe(true)
  })
})

test('navigation visibility and compact labels are saved through their settings controls', async ({ app, page }) => {
  await openInterfaceCustomizer(page, 'navigation')
  for (const name of ["Always show navigation bar when it's at the bottom", "Compact navigation bar when it's at the bottom"]) {
    const toggle = page.getByRole('checkbox', { name: new RegExp(`^${name}`) })
    await expect(toggle).not.toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: name }).click()
    await expect(toggle).toBeChecked()
  }
  ;({ page } = await app.relaunch())
  await openInterfaceCustomizer(page, 'navigation')
  for (const name of ["Always show navigation bar when it's at the bottom", "Compact navigation bar when it's at the bottom"]) {
    await expect(page.getByRole('checkbox', { name: new RegExp(`^${name}`) })).toBeChecked()
  }
})

test.describe('compact navigation labels', () => {
  test.use({ seed: { settings: { compactNavigationLabels: true, showProgressBarToast: false } } })

  test('shows More only when destinations are hidden from the compact bar', async ({ app, page, uiScale }) => {
    await goTo(page, 'subscriptions')
    const nav = page.locator('.sideNav')
    const more = nav.getByRole('button', { name: 'More', exact: true })
    const items = ['home', 'subscriptions', 'userplaylists', 'history', 'subscribedchannels', 'stats']
    for (const viewport of [{ width: 375, height: 700 }, { width: 667, height: 375 }]) {
      await setWindowSize(app, page, {
        width: Math.round(viewport.width * uiScale / 100),
        height: Math.round(viewport.height * uiScale / 100)
      })
      for (const count of [4, 5, 6, 5]) {
        await page.evaluate(items => window.$store.commit('setNavigationItems', items), items.slice(0, count))
        const primaryIds = count > 5 ? items.slice(0, 4) : items.slice(0, count)
        await expect.poll(() => nav.locator('.inner > .navOption:visible').evaluateAll(links =>
          links.map(link => link.getAttribute('href'))
        )).toEqual(primaryIds.map(id => `#/${id}`))
        await expect(nav.locator('.navLabel:visible')).toHaveCount(0)
        if (count > 5) {
          await expect(more).toBeVisible()
          await more.click()
          await expect.poll(() => page.locator('.moreOptionContainer a').evaluateAll(links =>
            links.map(link => link.getAttribute('href'))
          )).toEqual(items.slice(4, count).map(id => `#/${id}`))
          await page.keyboard.press('Escape')
        } else {
          await expect(more).toHaveCount(0)
        }
      }
    }
  })

  test('hides all mobile labels, centers icons and keeps overflow entries readable', { tag: '@scale' }, async ({ app, page, uiScale }) => {
    const nav = page.locator('.sideNav')
    const primary = nav.locator('.inner > .navOption:not(.mobileHidden)')
    const more = nav.getByRole('button', { name: 'More', exact: true })
    for (const viewport of [{ width: 375, height: 700 }, { width: 667, height: 375 }]) {
      await setWindowSize(app, page, {
        width: Math.round(viewport.width * uiScale / 100),
        height: Math.round(viewport.height * uiScale / 100)
      })
      for (const route of ['subscriptions', 'history']) {
        await goTo(page, route)
        await expect(primary.locator('.navLabel:visible')).toHaveCount(0)
        await expect(nav.locator('.inner > .navOption.router-link-active')).toHaveAttribute('aria-label', route === 'history' ? 'History' : 'Subscriptions')
        await expect(primary.locator('.navIcon:visible')).toHaveCount(4)
        await expectHeight(nav, 48)
        await expect.poll(() => nav.locator('.inner > .navOption:not(.mobileHidden) .navIcon, .moreOptionNav .navIcon').evaluateAll(icons => Math.max(...icons.map(icon => {
          const iconBounds = icon.getBoundingClientRect()
          const optionBounds = icon.closest('.navOption').getBoundingClientRect()
          return Math.abs((iconBounds.top + iconBounds.bottom - optionBounds.top - optionBounds.bottom) / 2)
        })))).toBeLessThanOrEqual(1)
        await expect(nav.getByRole('button', { name: 'Playlists', exact: true })).toBeVisible()
        await expect(more.locator('.navLabel')).toBeHidden()
      }
      await more.click()
      const overflowIds = await page.locator('.moreOptionContainer a').evaluateAll(items =>
        items.map(item => item.getAttribute('href'))
      )
      const visibleIds = await nav.locator('.inner > .navOption:visible').evaluateAll(items =>
        items.map(item => item.getAttribute('href'))
      )
      expect(visibleIds.filter(id => overflowIds.includes(id))).toEqual([])
      for (const label of await page.locator('.moreOptionContainer .navLabel').all()) {
        await expect(label).toBeVisible()
      }
      await page.locator('.moreOptionContainer a[href="#/subscribedchannels"]').click()
      await expect(more).toHaveClass(/router-link-active/)
      await expect(more.locator('.navLabel')).toBeHidden()
      await expect(primary.locator('.navLabel:visible')).toHaveCount(0)
      await page.evaluate(() => window.$router.push('/search/example'))
      await expect(page).toHaveURL(/#\/search\/example$/)
      await expect(nav.locator('.navLabel:visible')).toHaveCount(0)
    }
    await setWindowSize(app, page, { width: 1200, height: 800 })
    await expect(primary.locator('.navLabel:visible')).toHaveCount(4)
    await setWindowSize(app, page, { width: 400, height: 850 })
    await goTo(page, 'history')
    await page.evaluate(() => window.$store.commit('setHideLabelsSideBar', true))
    await expect(nav.locator('.navLabel:visible')).toHaveCount(0)
  })

  test('updates safe-area, progress and overflow insets when label modes change', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 500, height: 850 })
    await goTo(page, 'history')
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setAlwaysShowNavigationBar', true)
      store.commit('addProgressOperation', { id: 'e2e', icon: ['fas', 'sync'], message: '', percentage: 50 })
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
      document.querySelector('.app').classList.add('capacitorPhoneLayout')
      const content = document.createElement('div')
      content.style.height = '3000px'
      document.querySelector('.tabContent:not([inert]) > .routerView').append(content)
    })
    await expect(page.locator('.progressBar')).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollHeight)).toBeGreaterThan(3000)
    for (const [compact, hideLabels] of [[false, false], [false, true], [true, true], [true, false], [false, false], [true, false]]) {
      const height = compact ? 48 : hideLabels ? 60 : 60
      const previousNavHeight = await page.locator('.sideNav').evaluate(element => element.getBoundingClientRect().height)
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight))
      const previousHeight = await page.evaluate(() => document.scrollingElement.scrollHeight)
      await page.evaluate(async ({ compact, hideLabels }) => {
        const store = window.$store
        store.commit('setCompactNavigationLabels', compact)
        store.commit('setHideLabelsSideBar', hideLabels)
        // Restore the phone fixture after Vue updates the root class, before layout.
        await Promise.resolve()
        document.querySelector('.app').classList.add('capacitorPhoneLayout')
      }, { compact, hideLabels })
      await expectHeight(page.locator('.sideNav'), height + 24)
      if (height + 24 < previousNavHeight - 1) {
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollHeight)).toBeLessThan(previousHeight)
        await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - (document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)))).toBeLessThanOrEqual(1)
      }
      await expect(page.locator('.tabContent:not([inert]) > .routerView')).toHaveCSS('padding-bottom', `${height + 24 + 10}px`)
      await expect.poll(() => page.evaluate(() => {
        const nav = document.querySelector('.sideNav').getBoundingClientRect()
        const progress = document.querySelector('.progressBar').getBoundingClientRect()
        return Math.abs(nav.top - progress.bottom)
      })).toBeLessThanOrEqual(1)
      await page.locator('.moreOptionNav').click()
      await expect.poll(() => page.evaluate(() => {
        const menu = document.querySelector('.moreOptionContainer').getBoundingClientRect()
        return Math.abs(menu.bottom - innerHeight)
      })).toBeLessThanOrEqual(1)
      await page.keyboard.press('Escape')
    }
  })
})

test.describe('side nav navigation', () => {
  test('keeps fixed mobile navigation below the system status bar', async ({ page }) => {
    const safeAreaInsetTop = 24
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 }
    ]) {
      await page.setViewportSize(viewport)
      await page.evaluate((inset) => {
        document.documentElement.style.setProperty('--safe-area-inset-top', `${inset}px`)
        const app = document.querySelector('.app')
        app.classList.add('capacitorTabs')
        app.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
      }, safeAreaInsetTop)

      const topNavBounds = await page.locator('.topNav').boundingBox()
      expect(topNavBounds.y).toBe(safeAreaInsetTop)
      await expect.poll(() => page.locator('.app').evaluate((app) => {
        const style = getComputedStyle(app, '::before')
        return {
          height: style.height,
          position: style.position,
          opaque: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        }
      })).toEqual({
        height: `${safeAreaInsetTop}px`,
        position: 'fixed',
        opaque: true,
      })
    }
  })

  test('customizes navigation order on the side bar and mobile bar', async ({ page }) => {
    await openInterfaceCustomizer(page, 'navigation')

    const selectedItems = page.locator('.selectedItems')
    const selectedIds = () => selectedItems.locator('.selectedItem').evaluateAll(rows => (
      rows.map(row => row.dataset.navigationItemId)
    ))
    await expect.poll(selectedIds).toEqual(DEFAULT_NAVIGATION_ITEMS)
    await expect(selectedItems.locator('.selectedItem').first()).toHaveCSS('user-select', 'none')
    const iconOffsets = await selectedItems.locator('.selectedItem').evaluateAll(rows => rows.map(row => {
      const icon = row.querySelector('.selectedItemIcon > svg')
      const rowBounds = row.getBoundingClientRect()
      const iconBounds = icon.getBoundingClientRect()
      return Math.abs(
        iconBounds.y + iconBounds.height / 2 -
        (rowBounds.y + rowBounds.height / 2)
      )
    }))
    expect(Math.max(...iconOffsets)).toBeLessThanOrEqual(0.5)

    await page.getByRole('button', { name: 'Remove Most Popular' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()
    const itemPicker = page.getByRole('menu', { name: 'Add item' })
    const popularOption = itemPicker.getByRole('menuitem', { name: 'Most Popular' })
    await expect(itemPicker.getByRole('searchbox')).toHaveCount(0)
    await expect(popularOption).toHaveCSS('cursor', 'pointer')
    await expect(popularOption).toHaveCSS('user-select', 'none')
    await popularOption.click()
    await expect.poll(selectedIds).toEqual([
      ...DEFAULT_NAVIGATION_ITEMS.filter(id => id !== 'popular'),
      'popular',
    ])
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect.poll(selectedIds).toEqual(DEFAULT_NAVIGATION_ITEMS)

    await page.getByRole('button', { name: 'Move History up' }).click()
    const reordered = [...DEFAULT_NAVIGATION_ITEMS]
    reordered.splice(reordered.indexOf('history'), 1)
    reordered.splice(2, 0, 'history')
    await expect.poll(selectedIds).toEqual(reordered)

    await page.locator('.settingsCloseButton').click()
    await page.setViewportSize({ width: 375, height: 700 })
    await expect.poll(() => page.locator('.sideNav .inner > .navOption:visible').evaluateAll(links => (
      links.map(link => link.getAttribute('href'))
    ))).toEqual(reordered.slice(0, 4).map(id => `#/${id}`))

    await page.locator('.sideNav .moreOptionNav').click()
    await expect.poll(() => page.locator('.moreOptionContainer .navOption').evaluateAll(links => (
      links.map(link => link.getAttribute('href'))
    ))).toEqual(reordered.filter(id => id !== 'popular').slice(4).map(id => `#/${id}`))

    await page.locator('.moreOptionContainer a[href="#/subscribedchannels"]').click()
    await expect(page).toHaveURL(/#\/subscribedchannels$/)
    const moreButton = page.locator('.sideNav .moreOptionNav')
    await expect(moreButton).toHaveClass(/router-link-active/)
    await expect.poll(() => moreButton.evaluate(element =>
      getComputedStyle(element, '::before').opacity
    )).toBe('1')
  })

  test('clamps the add-item picker after its options shrink', async ({ page }) => {
    await openInterfaceCustomizer(page, 'navigation')

    const selectedItems = page.locator('.selectedItems .selectedItem')
    while (await selectedItems.count() > 0) {
      await selectedItems.first().getByRole('button', { name: /^Remove / }).click()
    }

    await page.getByRole('button', { name: 'Add item' }).click()
    const picker = page.getByRole('menu', { name: 'Add item' })
    const scroller = picker.locator('.itemPickerList')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    const initialScrollTop = await scroller.evaluate(element => {
      element.scrollTop = element.scrollHeight
      return element.scrollTop
    })
    expect(initialScrollTop).toBeGreaterThan(0)

    await picker.getByRole('menuitem').last().click()
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })

  test('mobile navigation history opens the context menu sheet', async ({ page }) => {
    await goTo(page, 'history')
    await goTo(page, 'userplaylists')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.locator(sel.backButton).click({ button: 'right' })
    const sheet = page.locator('.mobileLinkActions')
    await expect(page.locator('.topNav .iconDropdown')).toHaveCount(0)
    // Each entry exposes whether it is the current page.
    await expect(sheet.getByRole('menuitemcheckbox')).toHaveCount(3)
    await expect(sheet.locator('[role="menuitemcheckbox"] svg')).toHaveCount(3)
    await expect(sheet.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(1)
    await sheet.getByRole('menuitemcheckbox', { name: 'History', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/#\/history/)
  })
})

test.describe('navigation history titles', () => {
  test.use({
    seed: {
      history: [{
        _id: 'jNQXAC9IVRw',
        videoId: 'jNQXAC9IVRw',
        title: 'Watch',
        author: 'jawed',
        authorId: 'UC4QobU6STFB0P71PMvOGN5A',
        published: 0,
        lengthSeconds: 19,
        watchProgress: 0,
        timeWatched: Date.now(),
        isWatched: false,
        type: 'video'
      }]
    }
  })

  test('keeps a known video titled Watch when navigating away before it loads', async ({ page }) => {
    await goTo(page, 'history')
    await page.locator('.ft-list-video .title').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.forwardButton).click({ button: 'right' })

    const options = page.locator('.topNav .iconDropdown [role="option"]')
    await expect(options.filter({ hasText: 'Watch' })).toHaveCount(1)
    await expect(options.filter({ hasText: '/watch/jNQXAC9IVRw' })).toHaveCount(0)
  })

  test('removes an untitled watch entry when navigating back before it loads', async ({ page }) => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.evaluate((backButtonSelector) => {
      const store = window.$store
      const tabId = store.getters.getActiveTabId
      store.commit('setTabContentTitle', {
        tabId,
        title: 'Watch',
        resolveHistoryEntry: false
      })
      document.querySelector(backButtonSelector).click()
    }, sel.backButton)
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator(sel.forwardButton)).toBeDisabled()
  })

  test('removes an untitled watch entry when navigating forward past it', async ({ page }) => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.evaluate(() => {
      const store = window.$store
      const tab = store.getters.getActiveTab
      tab.history[tab.historyIndex].titlePending = false
    })
    await page.locator(sel.sideNavRouteLink('history')).first().evaluate(link => link.click())
    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.evaluate((forwardButtonSelector) => {
      const store = window.$store
      const tab = store.getters.getActiveTab
      tab.history[tab.historyIndex].titlePending = true
      store.commit('setTabContentTitle', {
        tabId: tab.id,
        title: 'Watch',
        resolveHistoryEntry: false
      })
      document.querySelector(forwardButtonSelector).click()
    }, sel.forwardButton)
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.backButton).click({ button: 'right' })
    const options = page.locator('.topNav .iconDropdown [role="option"]')
    await expect(options).toHaveCount(2)
    await expect(options.filter({ hasText: 'Watch' })).toHaveCount(0)
  })

  test('removes an untitled watch entry when navigating to another page', async ({ page }) => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.getByRole('link', { name: 'Go to Subscriptions' }).click()
    await expect(page).toHaveURL(/#\/subscriptions/)
    await page.locator(sel.backButton).click({ button: 'right' })

    const options = page.locator('.topNav .iconDropdown [role="option"]')
    await expect(options).toHaveCount(2)
    await expect(options.filter({ hasText: 'Watch' })).toHaveCount(0)
  })
})

test('preserves a pasted YouTube comment link target', async ({ page }) => {
  const commentId = 'UgxZaBRFEKqDUoZULy94AaABAg'
  await page.locator(sel.searchInput).fill(
    `https://www.youtube.com/watch?v=jNQXAC9IVRw&lc=${commentId}&pp=0gcJCSIANpG00pGi`
  )
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*commentId=${commentId}`))
})

test.describe('scaled mobile navigation', () => {
  test.use({ seed: { settings: { uiScale: 125 } } })

  test('keeps More menu links clickable above the mobile bar', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 500, height: 700 })
    await page.locator('.sideNav .moreOptionNav').click()
    await page.locator('.moreOptionContainer a[href="#/subscribedchannels"]').click()
    await expect(page).toHaveURL(/#\/subscribedchannels$/)
  })
})

test.describe('expressive bottom navigation', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { alwaysShowNavigationBar: true } } })

  test('keeps selection, touch targets and labels aligned across widths and directions', async ({ app, page, uiScale }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const width of [320, 390, 667]) {
      await setWindowSize(app, page, { width: Math.round(width * uiScale / 100), height: 1000 - width })
      for (const direction of ['ltr', 'rtl']) {
        await page.locator('body').evaluate((body, dir) => { body.dir = dir }, direction)
        const home = page.locator('.sideNav a[href="#/home"]')
        await home.click()
        await expect(home).toHaveAttribute('aria-current', 'page')
        const items = page.locator('.sideNav .mobileNavItem:visible')
        await expect(items).toHaveCount(5)
        const metrics = await items.evaluateAll(elements => elements.map(element => {
          const box = element.getBoundingClientRect()
          const icon = element.querySelector('.navIcon').getBoundingClientRect()
          const label = element.querySelector('.navLabel').getBoundingClientRect()
          const pill = getComputedStyle(element, '::before')
          return {
            width: box.width,
            height: box.height,
            iconCenter: Math.abs((icon.left + icon.right - box.left - box.right) / 2),
            labelBottom: label.bottom - box.bottom,
            pillOpacity: pill.opacity,
            selected: element.classList.contains('router-link-active'),
            transition: pill.transitionDuration,
          }
        }))
        const widths = metrics.map(item => item.width)
        expect(Math.max(...widths) - Math.min(...widths), 'destinations have equal-width slots').toBeLessThanOrEqual(1)
        for (const item of metrics) {
          expect(item.width).toBeGreaterThanOrEqual(48)
          expect(item.height).toBeGreaterThanOrEqual(48)
          expect(item.iconCenter).toBeLessThanOrEqual(1)
          expect(item.labelBottom).toBeLessThanOrEqual(0)
          // The clicked/focused destination is selected; other items have no state layer.
          expect(item.pillOpacity).toBe(item.selected ? '1' : '0')
          expect(item.transition).toBe('0s')
        }
        const subscriptions = page.locator('.sideNav a[href="#/subscriptions"]')
        await subscriptions.click()
        await expect(subscriptions).toHaveAttribute('aria-current', 'page')
        await expect.poll(() => items.evaluateAll(elements => elements.every(element => {
          const box = element.getBoundingClientRect()
          const text = [...element.querySelectorAll('.navLabel span')].find(label => label.getClientRects().length > 0).getBoundingClientRect()
          return text.left >= box.left && text.right <= box.right && Math.abs(text.left + text.right - box.left - box.right) < 1
        })), { message: 'bold active labels fit and remain centered' }).toBe(true)
        const activeWidths = await items.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
        activeWidths.forEach((width, index) => expect(Math.abs(width - widths[index]), 'selection does not move neighboring destinations').toBeLessThanOrEqual(1))
        await expect(page.locator('.sideNav .activeIndicator')).toBeHidden()
        const more = page.locator('.sideNav .moreOptionNav')
        await more.click()
        const menu = await page.locator('.moreOptionContainer').boundingBox()
        expect(menu.x).toBeGreaterThanOrEqual(0)
        // Electron zoom can round innerWidth below the fractional layout edge.
        expect(menu.x + menu.width - await page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1)
        await page.keyboard.press('Escape')
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      }
    }
  })
})

/**
 * Scrolls the sidebar to its end before each change, then checks the offset
 * and scrollbar against the remaining content.
 * @param {import('@playwright/test').Page} page
 * @param {(() => Promise<unknown>)[]} changes
 */
async function expectSidebarClampedAfterChanges(page, changes) {
  const scroller = page.locator('.sideNav .inner')
  for (const [index, change] of changes.entries()) {
    const previousOffset = await scroller.evaluate(element => {
      element.scrollTop = element.scrollHeight
      return element.scrollTop
    })
    await change()
    await expect.poll(() => scroller.evaluate((element, previousOffset) => {
      const bounds = element.getBoundingClientRect()
      const children = [...element.children].filter(child => !child.classList.contains('os-scrollbar') && child.getBoundingClientRect().height > 0)
      // Like the app's clamp, include the last element's trailing margin.
      const end = children.at(-1).getBoundingClientRect().bottom + (Number.parseFloat(getComputedStyle(children.at(-1)).marginBlockEnd) || 0)
      const maximum = Math.max(0, end - bounds.top + element.scrollTop - element.clientHeight)
      const scrollbar = element.querySelector('.os-scrollbar-vertical')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      return {
        validOffset: Math.abs(element.scrollTop - Math.min(previousOffset, maximum)) <= 1,
        usable: !scrollbar.classList.contains('os-scrollbar-unusable') === (maximum > 1),
        matchingThumb: maximum <= 1 || Math.abs(thumb.height / track.height - element.clientHeight / (maximum + element.clientHeight)) < 0.03
      }
    }, previousOffset), { message: `sidebar scroll range after change ${index + 1}` }).toEqual({ validOffset: true, usable: true, matchingThumb: true })
  }
}

test.describe('expressive desktop navigation', () => {
  test.use({
    seed: {
      settings: { alwaysShowScrollbars: true },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: Array.from({ length: 24 }, (_, index) => ({
          id: `UC${index.toString().padStart(22, '0')}`,
          name: `Channel ${index}`,
          thumbnail: ''
        }))
      }]
    }
  })

  test('clamps the sidebar after layout and content shorten at the scroll end', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1100, height: 500 })
    const changes = [
      async () => page.evaluate(() => window.$store.commit('toggleSideNav')),
      async () => page.evaluate(() => window.$store.dispatch('updateCurrentLocale', 'de-DE')),
      async () => page.evaluate(() => window.$store.dispatch('updateCurrentLocale', 'en-US')),
      async () => page.evaluate(() => {
        const store = window.$store
        store.commit('toggleSideNav')
        store.commit('setHideLabelsSideBar', true)
      }),
      async () => setWindowSize(app, page, { width: 1150, height: 800 }),
      async () => page.evaluate(() => window.$store.dispatch('updateCurrentLocale', 'de-DE')),
      async () => page.evaluate(() => window.$store.commit('setNavigationItems', ['home', 'history'])),
      async () => page.evaluate(() => window.$store.commit('setHideActiveSubscriptions', true))
    ]
    await expectSidebarClampedAfterChanges(page, changes)
  })
})

test.describe('pinned playlists in the sidebar', () => {
  test.use({
    seed: {
      settings: { alwaysShowScrollbars: true, pinnedPlaylistIds: Array.from({ length: 8 }, (_, index) => `pinned-${index}`) },
      playlists: Array.from({ length: 8 }, (_, index) => ({
        _id: `pinned-${index}`,
        playlistName: `Pinned ${index}`,
        protected: false,
        description: '',
        videos: [],
        createdAt: Date.now() - index * 1000,
        lastUpdatedAt: Date.now()
      })),
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: Array.from({ length: 12 }, (_, index) => ({
          id: `UC${index.toString().padStart(22, '0')}`,
          name: `Channel ${index}`,
          thumbnail: ''
        }))
      }]
    }
  })

  test('clamps the sidebar when pinned playlists are removed at the scroll end', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1100, height: 500 })
    const pinned = page.locator('.sideNav .pinnedPlaylists .navChannel')
    await expect(pinned).toHaveCount(8)
    await expectSidebarClampedAfterChanges(page, [
      async () => page.evaluate(() => window.$store.dispatch('updatePinnedPlaylistIds', ['pinned-0', 'pinned-1', 'pinned-2', 'pinned-3', 'pinned-4', 'pinned-5'])),
      async () => page.evaluate(() => window.$store.dispatch('removePlaylist', 'pinned-5')),
      async () => page.evaluate(() => window.$store.commit('setHideActiveSubscriptions', true)),
      async () => page.evaluate(() => window.$store.dispatch('removePlaylists', ['pinned-2', 'pinned-3', 'pinned-4'])),
      async () => page.evaluate(() => window.$store.dispatch('updatePinnedPlaylistIds', [])),
    ])
    await expect(pinned).toHaveCount(0)
  })
})

test.describe('pinned channels in the sidebar', () => {
  test.use({
    seed: {
      settings: {
        alwaysShowScrollbars: true,
        hideActiveSubscriptions: true,
        pinnedChannels: Array.from({ length: 20 }, (_, index) => ({
          id: `UC${index.toString().padStart(22, '0')}`,
          name: `Pinned channel ${index}`,
          thumbnail: null
        }))
      }
    }
  })

  test('clamps the sidebar when pinned channels are removed or resized', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1100, height: 500 })
    const pinned = page.locator('.sideNav .pinnedChannels .navChannel')
    await expect(pinned).toHaveCount(20)
    await expectSidebarClampedAfterChanges(page, [
      async () => page.evaluate(() => window.$store.dispatch('updatePinnedChannels', window.$store.getters.getPinnedChannels.slice(0, 12))),
      async () => setWindowSize(app, page, { width: 1150, height: 700 }),
      async () => page.evaluate(() => window.$store.dispatch('updatePinnedChannels', []))
    ])
    await expect(pinned).toHaveCount(0)
  })
})
