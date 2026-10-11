import { test, expect, goTo, goToSettingsSection, sel, setWindowSize } from '../../helpers/app.mjs'
import { DEFAULT_NAVIGATION_ITEMS } from '../../../src/navigationItems.js'

for (const uiScale of [100, 125]) {
  test.describe(`navigation options outline at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale } } })

    test('clamps scrolling after wider layouts and shorter translated labels', async ({ app, page }) => {
      async function resize(width) {
        await app.electronApp.evaluate(({ BrowserWindow }, bounds) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setBounds({ ...window.getBounds(), ...bounds })
        }, { width: Math.round(width * uiScale / 100), height: Math.round(650 * uiScale / 100) })
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
      }
      await resize(900)
      const appearance = await goToSettingsSection(page, 'appearance')
      await page.getByRole('button', { name: 'Maximize', exact: true }).click()
      await appearance.getByRole('button', { name: 'Customize navigation' }).click()
      await resize(350)
      const scroller = page.locator('.settingsSubpageScroll:visible')
      const content = scroller.locator('.settingsSubpageContent')
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      const thumb = scrollbar.locator('.os-scrollbar-handle')
      async function scrollToEnd() {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await expect.poll(() => content.evaluate(element => {
          const viewport = element.closest('.settingsSubpageScroll')
          return Math.abs(element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom +
            Number.parseFloat(getComputedStyle(viewport).paddingBottom)) * devicePixelRatio
        })).toBeLessThanOrEqual(2)
      }
      async function expectShorter(previousHeight, previousThumb) {
        await expect.poll(() => content.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(previousHeight)
        await expect.poll(() => content.evaluate(element => {
          const viewport = element.closest('.settingsSubpageScroll')
          const contentEnd = element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top +
            viewport.scrollTop + Number.parseFloat(getComputedStyle(viewport).paddingBottom)
          return (viewport.scrollTop - Math.max(0, contentEnd - viewport.clientHeight)) * devicePixelRatio
        }), { message: 'reflow leaves no obsolete scroll offset beyond the rendered content' }).toBeLessThanOrEqual(2)
        await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
        await expect.poll(() => thumb.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(previousThumb)
        await expect.poll(() => content.evaluate(element => {
          const viewport = element.closest('.settingsSubpageScroll')
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
        await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', 'de-DE')
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
        await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', 'en-US')
      })
      await expectShorter(germanHeight, germanThumb)
    })

    test('encloses all three switches at desktop and narrow widths', async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width: 900, height: 650 })
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Customize navigation' }).click()
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
        const scroller = page.locator('.settingsSubpageScroll:visible')
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => group.evaluate(element => {
          const scroller = element.closest('.settingsSubpageScroll')
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
      const scroller = page.locator('.settingsSubpageScroll:visible')
      const items = page.locator('.selectedItems .selectedItem')
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      while (await items.count() > 0) {
        await items.last().getByRole('button', { name: /^Remove / }).click()
        await expect.poll(() => scroller.evaluate(element => {
          const content = element.querySelector('.settingsSubpageContent')
          const contentEnd = content.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
            element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
          return element.scrollTop - Math.max(0, contentEnd - element.clientHeight)
        }), { message: 'removing navigation items leaves no obsolete scroll offset' }).toBeLessThanOrEqual(1)
      }
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(1)
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    })
  })
}

test('navigation visibility and compact labels are saved through their settings controls', async ({ app, page }) => {
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Customize navigation' }).click()
  for (const name of ["Always show navigation bar when it's at the bottom", "Compact navigation bar when it's at the bottom"]) {
    const toggle = page.getByRole('checkbox', { name: new RegExp(`^${name}`) })
    await expect(toggle).not.toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: name }).click()
    await expect(toggle).toBeChecked()
  }
  ;({ page } = await app.relaunch())
  const restoredAppearance = await goToSettingsSection(page, 'appearance')
  await restoredAppearance.getByRole('button', { name: 'Customize navigation' }).click()
  for (const name of ["Always show navigation bar when it's at the bottom", "Compact navigation bar when it's at the bottom"]) {
    await expect(page.getByRole('checkbox', { name: new RegExp(`^${name}`) })).toBeChecked()
  }
})

for (const uiScale of [100, 125]) {
  test.describe(`compact navigation labels at ${uiScale}%`, () => {
    test.use({ seed: { settings: { compactNavigationLabels: true, showProgressBarToast: false, uiScale } } })

    test('hides all mobile labels, centers icons and keeps overflow entries readable', async ({ app, page }) => {
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
          await expect(nav).toHaveCSS('height', '48px')
          await expect.poll(() => nav.locator('.inner > .navOption:not(.mobileHidden) .navIcon, .moreOptionNav .navIcon').evaluateAll(icons => Math.max(...icons.map(icon => {
            const iconBounds = icon.getBoundingClientRect()
            const optionBounds = icon.closest('.navOption').getBoundingClientRect()
            return Math.abs((iconBounds.top + iconBounds.bottom - optionBounds.top - optionBounds.bottom) / 2)
          })))).toBeLessThanOrEqual(1)
          await expect(nav.getByRole('button', { name: 'Playlists', exact: true })).toBeVisible()
          await expect(more.locator('.navLabel')).toBeHidden()
        }
        await more.click()
        for (const label of await nav.locator('.moreOptionContainer .navLabel').all()) {
          await expect(label).toBeVisible()
        }
        await nav.locator('.moreOptionContainer a[href="#/subscribedchannels"]').click()
        await expect(more).toHaveClass(/router-link-active/)
        await expect(more.locator('.navLabel')).toBeHidden()
        await expect(primary.locator('.navLabel:visible')).toHaveCount(0)
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/search/example'))
        await expect(page).toHaveURL(/#\/search\/example$/)
        await expect(nav.locator('.navLabel:visible')).toHaveCount(0)
      }
      await setWindowSize(app, page, { width: 1200, height: 800 })
      await expect(primary.locator('.navLabel:visible')).toHaveCount(4)
      await setWindowSize(app, page, { width: 400, height: 850 })
      await goTo(page, 'history')
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setHideLabelsSideBar', true))
      await expect(nav.locator('.navLabel:visible')).toHaveCount(0)
    })

    test('updates safe-area, progress and overflow insets when label modes change', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 500, height: 850 })
      await goTo(page, 'history')
      await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setAlwaysShowNavigationBar', true)
        store.commit('setShowProgressBar', true)
        store.commit('setProgressBarPercentage', 50)
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
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('setCompactNavigationLabels', compact)
          store.commit('setHideLabelsSideBar', hideLabels)
          // Restore the phone fixture after Vue updates the root class, before layout.
          await Promise.resolve()
          document.querySelector('.app').classList.add('capacitorPhoneLayout')
        }, { compact, hideLabels })
        await expect(page.locator('.sideNav')).toHaveCSS('height', `${height + 24}px`)
        if (height + 24 < previousNavHeight - 1) {
          await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollHeight)).toBeLessThan(previousHeight)
          await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - (document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)))).toBeLessThanOrEqual(1)
        }
        await expect(page.locator('.tabContent:not([inert]) > .routerView')).toHaveCSS('padding-bottom', `${height + 24 + 6}px`)
        await expect.poll(() => page.evaluate(() => {
          const nav = document.querySelector('.sideNav').getBoundingClientRect()
          const progress = document.querySelector('.progressBar').getBoundingClientRect()
          return Math.abs(nav.top - progress.bottom)
        })).toBeLessThanOrEqual(1)
        await page.locator('.moreOptionNav').click()
        await expect.poll(() => page.evaluate(() => {
          const menu = document.querySelector('.moreOptionContainer').getBoundingClientRect()
          const progress = document.querySelector('.progressBar').getBoundingClientRect()
          return Math.abs(menu.bottom - progress.top)
        })).toBeLessThanOrEqual(1)
        await page.locator('.moreOptionNav').click()
      }
    })

    test('bottom notifications follow compact navigation while visible and hidden', async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await setWindowSize(app, page, { width: 500, height: 850 })
      await goTo(page, 'history')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setToastPosition', 'bottom-center')
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
        document.querySelector('.app > .flexBox').style.minHeight = '3000px'
        window.ftElectron.showToastOnAllTabs('Navigation spacing test', 60000)
      })
      const toast = page.locator('.toast', { hasText: 'Navigation spacing test' })
      await expect(toast).toBeVisible()
      for (const compact of [false, true, false, true]) {
        await page.evaluate(compact => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setCompactNavigationLabels', compact), compact)
        await expect.poll(async () => {
          const nav = await page.locator('.sideNav').boundingBox()
          const notification = await toast.boundingBox()
          return nav.y - notification.y - notification.height
        }).toBeCloseTo(12, 0)
      }
      await page.locator('.app').evaluate(app => app.classList.add('capacitorPhoneLayout'))
      await expect.poll(async () => {
        const nav = await page.locator('.sideNav').boundingBox()
        const notification = await toast.boundingBox()
        return nav.y - notification.y - notification.height
      }).toBeCloseTo(12, 0)
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        window.dispatchEvent(new Event('offline'))
      })
      const status = page.locator('.connection-status-holder')
      await expect(page.locator('.connectionStatus')).toBeVisible()
      await expect.poll(async () => {
        const nav = await page.locator('.sideNav').boundingBox()
        const notice = await status.boundingBox()
        return Math.abs(nav.y - notice.y - notice.height)
      }).toBeLessThanOrEqual(1)
      await page.evaluate(() => window.scrollTo(0, 300))
      await expect(page.locator('.sideNav')).toHaveClass(/scrollHidden/)
      await expect.poll(() => status.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - innerHeight))).toBeLessThanOrEqual(1)
    })
  })
}

test.describe('side nav navigation', () => {
  test('omits About from the mobile navigation', async ({ page }) => {
    const sideNav = page.locator('.sideNav')
    const moreButton = sideNav.getByRole('button', { name: 'More', exact: true })

    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 }
    ]) {
      await page.setViewportSize(viewport)
      await moreButton.click()
      await expect(sideNav.locator('.moreOptionContainer')).toBeVisible()
      await expect(sideNav.getByRole('link', { name: 'About', exact: true })).toHaveCount(0)
      await moreButton.click()
    }
  })

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

  test('keeps the selection pill when navigating and switching to desktop', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    const sideNav = page.locator('.sideNav')
    for (const route of ['subscriptions', 'history']) {
      await goTo(page, route)
      await expect.poll(() => sideNav.locator('.mobileNavItem:visible').evaluateAll(items =>
        items.filter(item => getComputedStyle(item, '::before').opacity === '1')
          .map(item => item.getAttribute('href'))
      )).toEqual([`#/${route}`])
      await expect(sideNav.locator('.activeIndicator')).toBeHidden()
    }
    await page.setViewportSize({ width: 1000, height: 700 })
    await expect.poll(() => sideNav.locator('.navOption.router-link-active').evaluate(element =>
      getComputedStyle(element, '::before').opacity
    )).toBe('1')
  })

  test('customizes navigation order on the side bar and mobile bar', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize navigation' }).click()

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
    await expect.poll(() => page.locator('.sideNav .moreOptionContainer .navOption').evaluateAll(links => (
      links.map(link => link.getAttribute('href'))
    ))).toEqual(reordered.filter(id => id !== 'popular').slice(4).map(id => `#/${id}`))

    await page.locator('.sideNav .moreOptionContainer a[href="#/subscribedchannels"]').click()
    await expect(page).toHaveURL(/#\/subscribedchannels$/)
    const moreButton = page.locator('.sideNav .moreOptionNav')
    await expect(moreButton).toHaveClass(/router-link-active/)
    await expect.poll(() => moreButton.evaluate(element =>
      getComputedStyle(element, '::before').opacity
    )).toBe('1')
  })

  test('clamps the add-item picker after its options shrink', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize navigation' }).click()

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

  test('mobile navigation history keeps its own menu sizing', async ({ page }) => {
    await goTo(page, 'history')
    await goTo(page, 'userplaylists')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.locator(sel.backButton).click({ button: 'right' })
    const popout = page.locator('.topNav .iconDropdown')
    await expect(popout.getByRole('option').first()).toHaveCSS('font-size', '12px')
    await expect(popout).toHaveCSS('min-width', '0px')
  })

  test('navigation history popout shows page icons and a drop shadow', async ({ page }) => {
    await goTo(page, 'history')
    await goTo(page, 'userplaylists')

    await page.locator(sel.backButton).click({ button: 'right' })

    const popout = page.locator('.topNav .iconDropdown')
    await expect(popout).toBeVisible()
    await expect(popout.locator('[role="option"]')).toHaveCount(3)
    await expect(popout.locator('[role="option"] svg')).toHaveCount(3)
    await expect(popout).not.toHaveCSS('box-shadow', 'none')
  })
})

test.describe('side nav channel names', () => {
  test.use({
    seed: {
      settings: {
        alwaysShowScrollbars: true,
        currentLocale: 'en-US',
        expandSideBar: true,
        uiScale: 125
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          {
            id: 'UCarabicchannelname00000',
            name: 'قناة عربية',
            thumbnail: ''
          },
          ...Array.from({ length: 24 }, (_, index) => ({
            id: `UC${index.toString().padStart(22, '0')}`,
            name: `Channel ${index.toString().padStart(2, '0')}`,
            thumbnail: ''
          }))
        ]
      }]
    }
  })

  test('keeps RTL channel names clear of the scrollbar in an LTR app', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    const sideNav = page.locator('.sideNav.expanded')
    const arabicChannel = sideNav.locator('.navChannel', { hasText: 'قناة عربية' })
    await expect(arabicChannel).toBeVisible()

    const metrics = await arabicChannel.evaluate((channel) => {
      const label = channel.querySelector('.navLabel')
      const scrollbar = channel.closest('.inner').querySelector('.os-scrollbar-vertical')
      const labelBounds = label.getBoundingClientRect()
      const scrollbarBounds = scrollbar.getBoundingClientRect()

      return {
        appDirection: getComputedStyle(channel).direction,
        labelDirection: getComputedStyle(label).direction,
        scrollbarClearance: scrollbarBounds.left - labelBounds.right
      }
    })

    expect(metrics.appDirection).toBe('ltr')
    expect(metrics.labelDirection).toBe('rtl')
    expect(metrics.scrollbarClearance).toBeGreaterThanOrEqual(4)
  })
})

for (const uiScale of [90, 100, 125]) {
  test.describe(`side nav without labels at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { hideLabelsSideBar: true, uiScale },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [{
            id: 'UCaaaaaaaaaaaaaaaaaaaaaa',
            name: 'Alpha Channel',
            thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
          }]
        }]
      }
    })

    test('uses square tiles with centered icons and avatars in the collapsed side bar', async ({ page }) => {
      await goTo(page, 'channel/UCaaaaaaaaaaaaaaaaaaaaaa')
      const sideNav = page.locator('.sideNav.hiddenLabels')
      const [avatarBounds, channelTileBounds] = await Promise.all([
        sideNav.locator('.navChannel.router-link-active .channelThumbnail').boundingBox(),
        sideNav.locator('.navChannel.router-link-active').boundingBox()
      ])
      const avatarClearance = avatarBounds.x - channelTileBounds.x
      const avatarInlineCenter = avatarBounds.x + avatarBounds.width / 2
      const avatarCenter = avatarBounds.y + avatarBounds.height / 2
      const channelInlineCenter = channelTileBounds.x + channelTileBounds.width / 2
      const channelCenter = channelTileBounds.y + channelTileBounds.height / 2
      expect(Math.abs(channelTileBounds.width - 50)).toBeLessThanOrEqual(1)
      expect(Math.abs(channelTileBounds.height - 50)).toBeLessThanOrEqual(1)
      expect(Math.abs(avatarInlineCenter - channelInlineCenter)).toBeLessThanOrEqual(1)
      expect(Math.abs(avatarCenter - channelCenter)).toBeLessThanOrEqual(1)
      expect(avatarClearance).toBeGreaterThanOrEqual(4)

      await goTo(page, 'history')
      const sideNavBounds = await sideNav.boundingBox()
      expect(Math.abs(sideNavBounds.width - 50)).toBeLessThanOrEqual(1)
      const tileMetrics = await sideNav.locator('.inner > .navOption:visible .navIcon').evaluateAll(
        icons => icons.map(icon => {
          const bounds = icon.getBoundingClientRect()
          const optionBounds = icon.closest('.navOption').getBoundingClientRect()
          const iconInlineCenter = bounds.left + bounds.width / 2
          const iconCenter = bounds.top + bounds.height / 2
          const optionInlineCenter = optionBounds.left + optionBounds.width / 2
          const optionCenter = optionBounds.top + optionBounds.height / 2
          return {
            centerOffset: Math.abs(iconCenter - optionCenter),
            height: optionBounds.height,
            inlineCenterOffset: icon.matches(
              "[data-icon='user-check'][data-icon-pack='material']"
            )
              ? null
              : Math.abs(iconInlineCenter - optionInlineCenter),
            left: optionBounds.left,
            width: optionBounds.width
          }
        })
      )
      expect(tileMetrics.length).toBeGreaterThan(0)

      for (const tile of tileMetrics) {
        expect(Math.abs(tile.width - 50)).toBeLessThanOrEqual(1)
        expect(Math.abs(tile.height - 50)).toBeLessThanOrEqual(1)
        expect(Math.abs(tile.left - sideNavBounds.x)).toBeLessThanOrEqual(1)
        expect(tile.centerOffset).toBeLessThanOrEqual(1)
        if (tile.inlineCenterOffset !== null) {
          expect(tile.inlineCenterOffset).toBeLessThanOrEqual(1)
        }
      }

      const activeTile = sideNav.locator('.inner > .navOption.router-link-active:visible')
      await expect.poll(() => activeTile.evaluate(element =>
        getComputedStyle(element, '::before').opacity
      )).toBe('1')
    })
  })
}

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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tab = store.getters.getActiveTab
      tab.history[tab.historyIndex].titlePending = false
    })
    await page.locator(sel.sideNavLink('history')).first().evaluate(link => link.click())
    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.evaluate((forwardButtonSelector) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    await page.locator('.sideNav .moreOptionContainer a[href="#/subscribedchannels"]').click()
    await expect(page).toHaveURL(/#\/subscribedchannels$/)
  })
})

for (const uiScale of [100, 125]) {
  test.describe(`expressive bottom navigation at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale, alwaysShowNavigationBar: true } } })

    test('shows complete bottom labels without changing icon-only heights', async ({ app, page }) => {
      await goTo(page, 'subscriptions')
      const nav = page.locator('.sideNav')
      for (const width of [320, 390, 667]) {
        await setWindowSize(app, page, { width: Math.round(width * uiScale / 100), height: 1000 - width })
        for (const locale of ['en-US', 'de-DE']) {
          await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
          await expect.poll(() => nav.locator('.mobileNavItem:visible .navLabel').evaluateAll(labels => labels.every(label =>
            label.scrollWidth <= label.clientWidth && label.scrollHeight <= label.clientHeight
          )), { message: 'every navigation label fits without clipping' }).toBe(true)
          await expect.poll(() => nav.locator('.mobileNavItem:visible .navLabel > span:visible').evaluateAll(labels =>
            new Set(labels.map(label => getComputedStyle(label).fontSize)).size
          ), { message: 'all mobile destinations use one shared font size' }).toBe(1)
          await expect(nav).toHaveCSS('height', '60px')
          for (const label of await nav.locator('.mobileNavItem:visible .navLabel').all()) {
            await expect(label).toHaveCSS('white-space', 'nowrap')
            await expect(label).toHaveCSS('height', '16px')
            await expect(label).not.toHaveCSS('text-overflow', 'ellipsis')
          }
        }
      }
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setHideLabelsSideBar', true))
      await expect(nav).toHaveCSS('height', '60px')
      await expect(nav.locator('.navLabel:visible')).toHaveCount(0)
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setCompactNavigationLabels', true))
      await expect(nav).toHaveCSS('height', '48px')
    })

    test('keeps selection, touch targets and labels aligned across widths and directions', async ({ app, page }) => {
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
          const menu = await page.locator('.sideNav .moreOptionContainer').boundingBox()
          expect(menu.x).toBeGreaterThanOrEqual(0)
          expect(menu.x + menu.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
          await more.click()
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
        }
      }
    })
  })
}

for (const uiScale of [100, 125]) {
  test.describe(`localized bottom navigation at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale, useAITranslationCompletions: true, backendFallback: true, rememberHistory: true, enableWatchStats: true, alwaysShowNavigationBar: true, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', mainColor: 'Red', secColor: 'Blue' } } })

    test('keeps localized bottom navigation readable without clipping', async ({ app, page }, testInfo) => {
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
      await setWindowSize(app, page, { width: Math.round(320 * uiScale / 100), height: 800 })
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(320)
      const locales = (await import('../../../static/locales/activeLocales.json', { with: { type: 'json' } })).default
      const nav = page.locator('.sideNav')
      for (const order of [DEFAULT_NAVIGATION_ITEMS, [...DEFAULT_NAVIGATION_ITEMS.slice(4), ...DEFAULT_NAVIGATION_ITEMS.slice(0, 4)]]) {
        await page.evaluate(order => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateNavigationItems', order), order)
        await expect(nav.locator('.mobileNavItem:visible')).toHaveCount(5)
        for (const locale of locales) {
          await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
          await expect.poll(() => nav.locator('.mobileNavItem:visible .navLabel > span:visible').evaluateAll(labels => {
            const sizes = labels.map(label => parseFloat(getComputedStyle(label).fontSize))
            return labels.length === 5 && labels.every(label => label.getBoundingClientRect().width <= label.parentElement.getBoundingClientRect().width) &&
              Math.min(...sizes) >= 10 && new Set(sizes).size === 1
          }), { message: `${locale}: one readable size fits every bottom navigation label` }).toBe(true)
        }
      }
      await page.evaluate(async order => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateNavigationItems', order)
        await store.dispatch('updateCurrentLocale', 'gl')
      }, DEFAULT_NAVIGATION_ITEMS)
      const playlists = nav.locator('a[href="#/userplaylists"]')
      await expect(playlists).toHaveAttribute('aria-label', 'Listaxes de reprodución')
      await expect(playlists.locator('.navLabel > span:visible')).toHaveText('Listaxes')
      await playlists.click()
      await expect(page).toHaveURL(/#\/userplaylists$/)
      await expect.poll(() => nav.locator('.mobileNavItem:visible .navLabel > span:visible').evaluateAll(labels =>
        labels.every(label => parseFloat(getComputedStyle(label).fontSize) >= 10 &&
          label.getBoundingClientRect().width <= label.parentElement.getBoundingClientRect().width)
      ), { message: 'the active Galician label also fits at a readable size' }).toBe(true)
      await goTo(page, 'home')
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const box = await nav.boundingBox()
        const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }, box) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents
          const zoom = contents.getZoomFactor()
          return (await contents.capturePage({ x: Math.round(box.x * zoom), y: Math.round(box.y * zoom), width: Math.round(box.width * zoom), height: Math.round(box.height * zoom) })).toPNG().toString('base64')
        }, box)
        await testInfo.attach(`readable Galician mobile navigation ${colorScheme}`, { body: Buffer.from(screenshot, 'base64'), contentType: 'image/png' })
      }
      await setWindowSize(app, page, { width: Math.round(1000 * uiScale / 100), height: 850 })
      await expect(playlists.locator('.navLabel > span:visible')).toHaveText('Listaxes de reprodución')
    })
  })
}

for (const uiScale of [95, 125]) {
  test.describe(`expressive desktop navigation at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: { uiScale, alwaysShowScrollbars: true },
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

    test('header button hover respects reduced motion', async ({ page }) => {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'off'))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      // Exercise the component's OS preference fallback without the global override.
      await page.evaluate(() => document.documentElement.removeAttribute('data-reduced-motion'))
      const button = page.locator('.topNav .menuButton')
      await button.hover()
      await expect(button).toHaveCSS('transition-duration', '0s')
    })

    test('animates the header button radius while pressing with a mouse', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateReducedMotion', 'off')
        await store.dispatch('updateAnimationSpeed', 25)
      })
      const button = page.locator('.topNav .menuButton')
      await button.hover()
      await page.mouse.down()
      try {
        await expect.poll(() => button.evaluate(element => element.getAnimations().some(animation =>
          animation.transitionProperty?.startsWith('border-') && animation.playState === 'running'
        ))).toBe(true)
      } finally {
        await page.mouse.up()
      }
    })

    test('shows complete desktop destination labels', async ({ page }) => {
      for (const locale of ['en-US', 'de-DE']) {
        await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
        await goTo(page, 'subscriptions')
        await expect.poll(() => page.locator('.sideNav .navOption .navLabel:visible').evaluateAll(labels => labels.every(label =>
          label.scrollWidth <= label.clientWidth && label.scrollHeight <= label.clientHeight
        )), { message: 'desktop labels fit at readable size without truncation' }).toBe(true)
      }
    })

    test('keeps pills and labels contained in every sidebar mode and direction', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await goTo(page, 'history')
      const nav = page.locator('.sideNav')
      for (const direction of ['ltr', 'rtl']) {
        await page.locator('body').evaluate((body, direction) => { body.dir = direction }, direction)
        for (const mode of ['rail', 'icons', 'expanded', 'expanded-with-hidden-labels']) {
          await page.evaluate(mode => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            const expanded = mode.startsWith('expanded')
            if (store.getters.getIsSideNavOpen !== expanded) store.commit('toggleSideNav')
            store.commit('setHideLabelsSideBar', mode === 'icons' || mode === 'expanded-with-hidden-labels')
          }, mode)
          const active = nav.locator('.navOption.router-link-active')
          await expect.poll(() => active.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1')
          await expect(active.locator('.navLabel')).toBeVisible({ visible: mode !== 'icons' })
          const metrics = await active.evaluate(element => {
            const box = element.getBoundingClientRect()
            const icon = element.querySelector('.navIcon').getBoundingClientRect()
            const label = element.querySelector('.navLabel').getBoundingClientRect()
            const pill = getComputedStyle(element, '::before')
            return {
              width: box.width,
              height: box.height,
              iconFits: icon.left >= box.left && icon.right <= box.right && icon.top >= box.top && icon.bottom <= box.bottom,
              labelFits: label.width === 0 || (label.left >= box.left && label.right <= box.right && label.bottom <= box.bottom),
              transition: pill.transitionDuration
            }
          })
          expect(metrics.width).toBeGreaterThanOrEqual(47.9)
          expect(metrics.height).toBeGreaterThanOrEqual(47.9)
          expect(metrics.iconFits).toBe(true)
          expect(metrics.labelFits).toBe(true)
          expect(metrics.transition).toBe('0s')
          await active.focus()
          await expect(active).toBeFocused()
          await expect(nav.locator('.inner > .os-scrollbar-vertical')).toBeAttached()
        }
      }
    })

    test('clamps the sidebar after layout and content shorten at the scroll end', async ({ app, page }) => {
      const scroller = page.locator('.sideNav .inner')
      await setWindowSize(app, page, { width: 1100, height: 500 })
      const changes = [
        async () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('toggleSideNav')),
        async () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', 'de-DE')),
        async () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', 'en-US')),
        async () => page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('toggleSideNav')
          store.commit('setHideLabelsSideBar', true)
        }),
        async () => setWindowSize(app, page, { width: 1150, height: 800 }),
        async () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', 'de-DE')),
        async () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setNavigationItems', ['home', 'history'])),
        async () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setHideActiveSubscriptions', true))
      ]
      for (const [index, change] of changes.entries()) {
        const previousOffset = await scroller.evaluate(element => {
          element.scrollTop = element.scrollHeight
          return element.scrollTop
        })
        await change()
        await expect.poll(() => scroller.evaluate((element, previousOffset) => {
          const bounds = element.getBoundingClientRect()
          const children = [...element.children].filter(child => !child.classList.contains('os-scrollbar') && child.getBoundingClientRect().height > 0)
          const end = children.at(-1).getBoundingClientRect().bottom
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
    })
  })
}
