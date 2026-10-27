import { readFile } from 'node:fs/promises'

import { sampleColors } from '../../helpers/colors.mjs'
import {
  test,
  expect,
  expectAnimation,
  goTo,
  goToSettingsSection,
  recordAnimations,
  sel,
  setWindowSize
} from '../../helpers/app.mjs'

async function expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page) {
  await goToSettingsSection(page, 'appearance')
  const content = page.locator('.settingsContent')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const toggle = page.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' })
  await toggle.scrollIntoViewIfNeeded()
  const scrollTop = await content.evaluate(element => element.scrollTop)

  await toggle.click()
  await expect(page.getByRole('checkbox', { name: 'Always Show Scrollbars' })).toBeChecked()
  await expect.poll(async () => Math.abs(
    await content.evaluate(element => element.scrollTop) - scrollTop
  )).toBeLessThanOrEqual(1)
}

async function expectMinimizeToPreserveSettingsScroll(page) {
  await goToSettingsSection(page, 'appearance')
  const content = page.locator('.settingsContent')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const scrollTop = await content.evaluate(element => element.scrollTop)

  const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()
  await expect(settingsWindow).toBeHidden()
  await page.getByRole('button', { name: 'Restore: Settings' }).click()
  await expect(settingsWindow).toBeVisible()

  await expect.poll(async () => Math.abs(
    await content.evaluate(element => element.scrollTop) - scrollTop
  )).toBeLessThanOrEqual(1)
}

async function pressSettingsShortcut(app) {
  await app.electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const fileMenu = Menu.getApplicationMenu()?.items.find(item => item.label === 'File')
    const preferencesItem = fileMenu?.submenu?.items.find(item => item.label === 'Preferences')
    if (!browserWindow || !preferencesItem) {
      throw new Error('Preferences application-menu item was not found')
    }
    preferencesItem.click(undefined, browserWindow, undefined)
  })
}

test.describe('settings', () => {
  test('keeps General settings aligned to the bottom of its scroll range', async ({ page }) => {
    await goTo(page, 'settings')
    const content = page.locator('.settingsContent')
    await expect(content).toBeVisible()
    await content.hover()
    await page.mouse.wheel(0, 2000)

    await expect.poll(() => content.evaluate((element) => {
      const lastSection = element.querySelector('.settingsCategory > :last-child')
      return element.getBoundingClientRect().bottom - lastSection.getBoundingClientRect().bottom
    })).toBeLessThanOrEqual(45)
  })

  test('renders without flashing native scrollbars', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.locator('.settingsContent > .section')).toHaveCount(1)
    await expect(page.locator('.settingsContent .os-scrollbar-vertical')).toHaveCount(1)
    await expect(page.locator('.settingsContent')).toHaveCSS('scrollbar-width', 'none')
  })

  test('opens over the current page and renders the selected section', async ({ page, attachScreenshot }) => {
    const url = page.url()
    const activeTab = await page.locator(sel.activeTab).textContent()

    await goTo(page, 'settings')

    await expect(page).toHaveURL(url)
    await expect(page.locator(sel.activeTab)).toContainText(activeTab)
    const windowIcon = page.locator('.settingsWindowIcon')
    await expect(windowIcon).toBeVisible()
    await expect(windowIcon).toHaveAttribute('data-icon', 'gear')
    await expect(page.locator('.settingsBreadcrumbCategoryIcon')).toBeVisible()
    // Read both boxes in the same animation frame. Separate protocol calls can
    // measure different positions while the settings window is opening.
    const centerDifference = await page.locator('.settingsBreadcrumb').evaluate(breadcrumb => {
      const iconBounds = breadcrumb.querySelector('.settingsWindowIcon').getBoundingClientRect()
      const labelBounds = breadcrumb.querySelector('.settingsBreadcrumbLabel').getBoundingClientRect()
      return Math.abs((iconBounds.y + iconBounds.height / 2) - (labelBounds.y + labelBounds.height / 2))
    })
    // Allow fractional-pixel rounding at non-100% UI scales.
    expect(centerDifference).toBeLessThanOrEqual(1)
    await expect(page.getByRole('button', {
      name: 'Highlight settings changed from defaults'
    }).locator('[data-icon="pen"]')).toBeVisible()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expect(page.locator('.settingsContent > [data-section="general"]')).toBeVisible()
    await attachScreenshot('settings window over the page')
  })

  test('opens from Preferences without remounting the current feed', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    const subscriptionsPage = page.locator('.subscriptionsPage')
    await subscriptionsPage.evaluate(element => {
      element.dataset.settingsShortcutMarker = 'preserved'
    })

    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0]
      if (!browserWindow) throw new Error('Browser window was not found')
      browserWindow.webContents.send('change-view', {
        route: '/settings',
        tabId: 'preferences-test'
      })
    })

    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(subscriptionsPage).toHaveAttribute('data-settings-shortcut-marker', 'preserved')
  })

  test('keeps a direct legacy settings route inside the app', async ({ page }) => {
    const tab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/settings',
      makeActive: true
    }))

    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(candidate => candidate.id === tab.id)?.route.fullPath
    }).toBe('/')
  })

  test('toggles from the app settings button', async ({ page }) => {
    const profileButton = page.locator('.profileTrigger')
    await profileButton.click()
    const settingsButton = page.locator('.allSettingsShortcut')
    await expect(settingsButton.locator('[data-icon="gear"]')).toBeVisible()
    await expect(page.locator('.sideNav').getByText('Settings', { exact: true })).toHaveCount(0)
    await settingsButton.click()
    await expect(page.locator('.settingsWindow')).toBeVisible()

    await profileButton.click()
    await expect(settingsButton).toBeVisible()
    // The leave animation can finish before a polling assertion sees it.
    await page.locator('.settingsWindow').evaluate((element) => {
      window.__settingsWindowLeaveAnimated = false
      new MutationObserver((_mutations, observer) => {
        if (element.classList.contains('settings-window-leave-active')) {
          window.__settingsWindowLeaveAnimated = true
          observer.disconnect()
        }
      }).observe(element, { attributeFilter: ['class'] })
    })
    await settingsButton.click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    expect(await page.evaluate(() => window.__settingsWindowLeaveAnimated)).toBe(true)
  })

  test('lets clicks through to the page while closing', async ({ page }) => {
    await goTo(page, 'settings')
    const interceptedClicks = await page.locator('.settingsWindow').evaluate(element => new Promise(resolve => {
      const bounds = element.getBoundingClientRect()
      const x = bounds.left + bounds.width / 2
      const y = bounds.top + bounds.height / 2
      let interceptedClicks = false
      const sample = () => {
        if (!element.isConnected) {
          resolve(interceptedClicks)
          return
        }
        interceptedClicks ||= element.contains(document.elementFromPoint(x, y))
        requestAnimationFrame(sample)
      }
      element.querySelector('.settingsCloseButton').click()
      requestAnimationFrame(sample)
    }))
    expect(interceptedClicks).toBe(false)
    await expect(page.locator('.settingsWindow')).toBeHidden()
  })

  test('reopens a section while the previous window is still closing', async ({ page }) => {
    // Stretch the leave animation so the reopen always starts mid-close.
    await page.addStyleTag({ content: '.settingsWindow.settings-window-leave-active { animation-duration: 2s !important; }' })
    await goToSettingsSection(page, 'focus')
    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow.settings-window-leave-active')).toHaveCount(1)
    const focus = await goToSettingsSection(page, 'focus')
    await expect(focus).toBeVisible()
    await expect(page.locator('.settingsWindow')).toHaveCount(1)
  })

  test('keeps the current compact view throughout the close animation at 95% UI scale', async ({ page }) => {
    await page.evaluate(() => {
      const store = window.$store
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 500,
        height: 450
      }))
      return store.dispatch('updateUiScale', 95)
    })

    const settingsWindow = page.locator('.settingsWindow')
    const settingsMenu = page.locator('.settingsMenu')

    const closeWithCurrentView = async (contentSelector) => {
      // Read the closing view in one browser callback before the animation ends.
      const closingView = await settingsWindow.evaluate(async (element, selector) => {
        element.querySelector('.settingsCloseButton').click()
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return {
          leaving: element.classList.contains('settings-window-leave-active'),
          menuVisible: element.querySelector('.settingsMenu')?.checkVisibility() ?? false,
          contentVisible: element.querySelector(selector)?.checkVisibility() ?? false
        }
      }, contentSelector)
      expect(closingView).toEqual({ leaving: true, menuVisible: false, contentVisible: true })
      await expect(settingsWindow).toBeHidden()
    }

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()
    await expect(page.locator('.channelListContainer')).toBeVisible()

    await closeWithCurrentView('.channelListContainer')

    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(settingsMenu).toBeHidden()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    await closeWithCurrentView('.shortcutColumns')

    await goTo(page, 'settings')
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)
    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
  })

  test('closes an open shortcut prompt when Android reports keyboard disconnection', async ({ page }) => {
    // Electron removes the Android-only handler from its bundle. Exercise the
    // source handler against the running store and Settings UI instead.
    const appSource = await readFile(new URL('../../../src/renderer/App.vue', import.meta.url), 'utf8')
    const handlerSource = appSource.match(/function handleHardwareKeyboardChange\(event\) \{[\s\S]*?\n\}/)?.[0]
    expect(handlerSource).toBeTruthy()
    const reportKeyboardState = attached => page.evaluate(`(() => {
      const store = window.$store
      const hardwareKeyboardAttached = { value: ${!attached} }
      ${handlerSource}
      handleHardwareKeyboardChange({ attached: ${attached} })
      return hardwareKeyboardAttached.value
    })()`)

    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    expect(await reportKeyboardState(true)).toBe(true)
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    expect(await reportKeyboardState(false)).toBe(false)
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)
    await expect(page.locator('.settingsWindow')).toBeVisible()

    expect(await reportKeyboardState(true)).toBe(true)
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)
  })

  test('reopens Keyboard Shortcuts when its shortcut is pressed during closing', async ({ page }) => {
    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    const settingsWindow = page.locator('.settingsWindow')
    await page.locator('.settingsCloseButton').click()
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await page.keyboard.press('Shift+?')

    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.shortcutColumns')).toBeVisible()
  })

  test('toggles Settings and Keyboard Shortcuts with their app shortcuts', async ({ app, page }) => {
    const settingsWindow = page.locator('.settingsWindow')

    await pressSettingsShortcut(app)
    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)

    await pressSettingsShortcut(app)
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await expect(settingsWindow).toBeHidden()

    await page.keyboard.press('Shift+?')
    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    await page.keyboard.press('Shift+?')
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await expect(page.locator('.shortcutColumns')).toBeVisible()
    await expect(settingsWindow).toBeHidden()
  })

  test('preserves category scroll when Settings is toggled but resets it when switching categories', async ({ app, page }) => {
    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateUiScale', 95)
    })
    await pressSettingsShortcut(app)

    await page.locator('.settingsMenu [data-section="appearance"]').click()
    const content = page.locator('.settingsContent')
    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => content.evaluate(element => Math.abs(
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))).toBeLessThanOrEqual(1)
    const scrollTop = await content.evaluate(element => element.scrollTop)
    const appearanceRange = await content.evaluate(element => element.scrollHeight - element.clientHeight)

    await pressSettingsShortcut(app)
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await pressSettingsShortcut(app)
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect.poll(async () => Math.abs(
      await content.evaluate(element => element.scrollTop) - scrollTop
    )).toBeLessThanOrEqual(1)

    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect(content.locator(':scope > [data-section="privacy"]')).toBeVisible()
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)
    await expect.poll(() => content.evaluate(element => element.scrollHeight - element.clientHeight))
      .toBeLessThan(appearanceRange)
    await expect.poll(() => content.evaluate(element => {
      const section = element.querySelector(':scope > [data-section="privacy"]')
      const renderedEnd = section.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
        element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
      const maximum = Math.max(0, renderedEnd - element.clientHeight)
      const nativeRange = element.scrollHeight - element.clientHeight
      if (Math.abs(nativeRange - maximum) > 1) return false
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      if (maximum <= 1) return scrollbar.classList.contains('os-scrollbar-unusable')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      return !scrollbar.classList.contains('os-scrollbar-unusable') &&
        Math.abs(thumb.top - track.top) <= 1 &&
        Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
    }), { message: 'the shorter category has no retained empty range and its thumb matches the rendered content' }).toBe(true)
  })

  test('minimizes utility windows into the header and restores their view', async ({ page }) => {
    for (const view of [null, 'about', 'downloads']) {
      await page.evaluate((windowView) => {
        const store = window.$store
        return store.dispatch('showSettingsWindow', windowView)
      }, view)

      const windowName = view === 'about' ? 'About' : view === 'downloads' ? 'Downloads' : 'Settings'
      const settingsWindow = page.getByRole('dialog', { name: windowName, exact: true })
      await expect(settingsWindow).toBeVisible()
      await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()

      await expect(settingsWindow).toBeHidden()
      const minimizedButton = page.locator('.minimizedUtilityButton')
      await expect(minimizedButton).toBeVisible()
      await expect(minimizedButton).toHaveAccessibleName(`Restore: ${windowName}`)
      if (view === 'downloads') {
        await expect(page.locator('.downloadsButton')).toHaveCount(0)
      }

      await minimizedButton.click()
      await expect(page.getByRole('dialog', { name: windowName, exact: true })).toBeVisible()
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.minimizedUtilityButton')).toHaveCount(0)
    }
  })

  test('preserves its scroll position after being minimized and restored', { tag: '@scale' }, async ({ page }) => {
    await expectMinimizeToPreserveSettingsScroll(page)
  })

  test('keeps the current settings subpage when minimized and restored', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    const breadcrumb = page.locator('.settingsBreadcrumb')
    await expect(breadcrumb).toContainText('Saved Channel Settings')

    await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()
    await expect(settingsWindow).toBeHidden()
    await page.getByRole('button', { name: 'Restore: Settings' }).click()

    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.channelListContainer')).toBeVisible()
    await expect(breadcrumb).toContainText('Saved Channel Settings')
  })

  test('restores the last selected category when reopened', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()

    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')

    await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()
    await expect(page.locator('.settingsMenu [data-section="privacy"]')).toHaveClass(/active/)
  })

  test('resizes without creating horizontal settings overflow', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)
    const originalBounds = await settingsWindow.boundingBox()
    const resizeHandle = page.locator('.resize-se')
    const handleBounds = await resizeHandle.boundingBox()

    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBounds.x - 600, handleBounds.y - 180)
    await page.mouse.up()

    const resizedBounds = await settingsWindow.boundingBox()
    expect(resizedBounds.width).toBeLessThan(originalBounds.width)
    expect(resizedBounds.height).toBeLessThan(originalBounds.height)
    expect(resizedBounds.x).toBeCloseTo(originalBounds.x, 0)
    expect(resizedBounds.y).toBeCloseTo(originalBounds.y, 0)
    await expect(settingsWindow.locator('.settingsPage')).toHaveClass(/compactSettings/)
    expect(await page.locator('.settingsContent').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Array.from(element.querySelectorAll('*'))
        .filter(child => child.getBoundingClientRect().right > bounds.right + 1)
        .map(child => ({
          className: child.className?.toString(),
          right: child.getBoundingClientRect().right,
          tagName: child.tagName
        }))
    })).toEqual([])

    await expect.poll(() => page.evaluate(() => {
      return JSON.parse(localStorage.getItem('opentubex-settings-window-bounds'))?.width
    })).toBeCloseTo(resizedBounds.width, 0)
    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)

    const restoredBounds = await settingsWindow.boundingBox()
    expect(restoredBounds.width).toBeCloseTo(resizedBounds.width, 0)
    expect(restoredBounds.height).toBeCloseTo(resizedBounds.height, 0)
  })

  test('does not expose a horizontal scrollbar in phone-sized Appearance settings', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goToSettingsSection(page, 'appearance')

    const scroller = page.locator('.settingsContent')
    await expect(scroller).toBeVisible()
    await expect.poll(() => scroller.evaluate(element => ({
      horizontalScrollRange: element.scrollWidth - element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
      horizontalScrollbarVisible: element.querySelector('.os-scrollbar-horizontal')
        ?.classList.contains('os-scrollbar-visible') ?? false,
    }))).toEqual({
      horizontalScrollRange: 0,
      overflowX: 'hidden',
      horizontalScrollbarVisible: false,
    })
  })

  test('keeps stacked theme selects compact in a narrow settings window', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const selects = page.locator('.settingsContent .themeSelectRow .select')
    await expect(selects.first()).toBeVisible()
    expect(await selects.evaluateAll(elements => elements.every(element => element.offsetHeight === 45))).toBe(true)
    expect(await selects.evaluateAll(elements => elements.every(element => {
      const buttonBounds = element.querySelector('.select-text').getBoundingClientRect()
      const arrowBounds = element.querySelector('.iconSelect').getBoundingClientRect()
      return Math.abs(
        arrowBounds.top + arrowBounds.height / 2 - (buttonBounds.top + buttonBounds.height / 2)
      ) <= 1
    }))).toBe(true)
  })

  test('clamps Theme settings after a narrow-to-wide reflow', async ({ page }) => {
    await page.setViewportSize({ width: 340, height: 600 })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const content = page.locator('.settingsContent')
    await content.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.setViewportSize({ width: 1200, height: 800 })
    await expect.poll(() => content.evaluate(element => {
      const section = Array.from(element.children).find(child => {
        return child.classList.contains('section') && getComputedStyle(child).display !== 'none'
      })
      const maximum = Math.max(0, section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximum + 1
    })).toBe(true)
  })

  test('does not clamp a subpixel Theme settings scroll boundary', async ({ page }) => {
    await goToSettingsSection(page, 'appearance')

    const result = await page.locator('.settingsContent').evaluate(element => {
      element.scrollTop = element.scrollHeight

      let prototype = Object.getPrototypeOf(element)
      let descriptor = null
      while (prototype !== null && descriptor === null) {
        descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop') ?? null
        prototype = Object.getPrototypeOf(prototype)
      }
      if (descriptor?.get === undefined || descriptor.set === undefined) {
        throw new Error('Unable to inspect the native scrollTop property')
      }

      const section = element.querySelector(':scope > .section')
      const maximum = Math.max(0, section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      const writes = []

      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get() {
          // Electron zoom can put the real boundary between CSS pixels even
          // though the layout properties used above report integer values.
          return descriptor.get.call(this) + 0.25
        },
        set(value) {
          writes.push(value)
          descriptor.set.call(this, value)
        }
      })

      try {
        const observedScrollTop = element.scrollTop
        element.dispatchEvent(new Event('scroll'))
        return { maximum, observedScrollTop, writes }
      } finally {
        delete element.scrollTop
      }
    })

    expect(result.observedScrollTop).toBeGreaterThan(result.maximum)
    expect(result.observedScrollTop).toBeLessThanOrEqual(result.maximum + 1)
    expect(result.writes).toEqual([])
  })

  test('returns to download settings when Downloads was opened from there', async ({ page }) => {
    const routeBeforeOpening = page.url()
    const downloadSection = await goToSettingsSection(page, 'download')

    await downloadSection.getByRole('button', { name: 'Open Downloads' }).click()
    const downloadsDialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
    await expect(downloadsDialog).toBeVisible()
    await downloadsDialog.getByRole('button', { name: 'Back', exact: true }).click()

    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
    await expect(downloadSection).toBeVisible()
    await expect(page.locator('.settingsWindow')).toHaveCount(1)
    expect(page.url()).toBe(routeBeforeOpening)

    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'downloads')
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })
      .getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
  })

  test('moves Downloads and Settings from Quick Settings into the app header', async ({ page }) => {
    const themeSection = await goToSettingsSection(page, 'appearance')
    const downloadsToggle = themeSection.getByRole('checkbox', {
      name: 'Move Downloads to App Header'
    })
    const settingsToggle = themeSection.getByRole('checkbox', {
      name: 'Move Settings to App Header'
    })

    await expect(downloadsToggle).not.toBeChecked()
    await expect(settingsToggle).not.toBeChecked()
    await expect(page.locator('.topNav .downloadsButton')).toHaveCount(0)
    await expect(page.locator('.topNav .settingsButton')).toHaveCount(0)

    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const downloadsShortcut = menu.getByRole('button', { name: 'Downloads' })
    const allSettingsShortcut = menu.getByRole('button', { name: 'All settings' })
    await expect(downloadsShortcut).toBeVisible()
    await expect(allSettingsShortcut).toBeVisible()
    await expect(menu.getByRole('heading', { name: 'Playback', exact: true })).toBeVisible()
    await expect(menu.getByRole('heading', { name: 'Content', exact: true })).toBeVisible()
    await page.locator('.profileTrigger').click()

    await themeSection.locator('label.switch-label')
      .filter({ hasText: 'Move Downloads to App Header' }).click()
    await themeSection.locator('label.switch-label')
      .filter({ hasText: 'Move Settings to App Header' }).click()
    await expect(downloadsToggle).toBeChecked()
    await expect(settingsToggle).toBeChecked()
    await page.locator('.settingsCloseButton').click()

    const downloadsButton = page.locator('.topNav .downloadsButton')
    const settingsButton = page.locator('.topNav .settingsButton')
    await expect(downloadsButton).toBeVisible()
    await expect(settingsButton).toBeVisible()

    await page.locator('.profileTrigger').click()
    await expect(downloadsShortcut).toHaveCount(0)
    await expect(allSettingsShortcut).toHaveCount(0)
    await page.locator('.profileTrigger').click()

    for (const [button, windowName] of [
      [downloadsButton, 'Downloads'],
      [settingsButton, 'Settings']
    ]) {
      await button.click()
      const utilityWindow = page.getByRole('dialog', { name: windowName, exact: true })
      await expect(utilityWindow).toBeVisible()
      await expect(utilityWindow.getByRole('button', { name: /Minimi[sz]e/ })).toHaveCount(0)
      await utilityWindow.getByRole('button', { name: 'Close' }).click()
    }
  })

  test('morphs header Downloads and Settings windows out of and back into their buttons', { tag: '@scale' }, async ({ page }) => {
    await page.evaluate(async () => {
      await window.$store.dispatch('updateMoveDownloadsToAppHeader', true)
      await window.$store.dispatch('updateMoveSettingsToAppHeader', true)
      window.viewTransitions = 0
      const startViewTransition = document.startViewTransition.bind(document)
      document.startViewTransition = (...args) => {
        window.viewTransitions++
        return startViewTransition(...args)
      }
      window.utilityWindowMorphs = []
      const animate = Element.prototype.animate
      Element.prototype.animate = function (keyframes, options) {
        if (options?.id === 'utility-window-morph') {
          const { x, y, width, height } = this.getBoundingClientRect()
          window.utilityWindowMorphs.push({ keyframes: keyframes.map(keyframe => ({ ...keyframe })), bounds: { x, y, width, height } })
        }
        return animate.call(this, keyframes, options)
      }
    })
    const morphs = () => page.evaluate(() => window.utilityWindowMorphs)
    // Measure in the same CSS pixels as the recorded window bounds.
    const measure = locator => locator.evaluate(element => element.getBoundingClientRect().toJSON())
    /** Checks that the collapsed end of the morph covers the button. */
    async function expectMorph(morph, button, closing) {
      for (const keyframe of morph.keyframes) {
        // Other properties would keep the morph off the compositor.
        expect(Object.keys(keyframe).filter(key => !['offset', 'easing', 'composite'].includes(key)).sort())
          .toEqual(['opacity', 'transform'])
      }
      const collapsed = morph.keyframes.at(closing ? -1 : 0)
      expect(collapsed.opacity).toBe(0)
      const [x, y, scale] = collapsed.transform.match(/^translate\((\S+)px, (\S+)px\) scale\((\S+)\)$/).slice(1).map(Number)
      const { bounds } = morph
      const box = await measure(button)
      expect(bounds.x + bounds.width / 2 + x).toBeCloseTo(box.x + box.width / 2, 0)
      expect(bounds.y + bounds.height / 2 + y).toBeCloseTo(box.y + box.height / 2, 0)
      expect(bounds.width * scale).toBeCloseTo(box.width, 0)
    }

    for (const [icon, windowName] of [['downloads', 'Downloads'], ['settings', 'Settings']]) {
      await page.evaluate(() => { window.utilityWindowMorphs = [] })
      const button = page.locator(`.topNav [data-settings-window-icon="${icon}"]`)
      const buttonBox = await measure(button)
      await button.click()
      const utilityWindow = page.getByRole('dialog', { name: windowName, exact: true })
      await expect(utilityWindow).toBeVisible()
      await expect.poll(async () => (await morphs()).length).toBe(1)
      await expectMorph((await morphs())[0], button, false)
      expect(await measure(button)).toEqual(buttonBox)

      await utilityWindow.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(utilityWindow).toBeHidden()
      await expect.poll(async () => (await morphs()).length).toBe(2)
      await expectMorph((await morphs())[1], button, true)
    }

    // Only windows outside the header can be minimized.
    await page.evaluate(async () => {
      await window.$store.dispatch('updateMoveSettingsToAppHeader', false)
      window.utilityWindowMorphs = []
      await window.$store.dispatch('showSettingsWindow')
    })
    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)
    await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()
    await expect(settingsWindow).toBeHidden()
    const minimizedButton = page.locator('.minimizedUtilityButton')
    await expect.poll(async () => (await morphs()).length).toBe(1)
    await expectMorph((await morphs())[0], minimizedButton, true)
    const minimizedBox = await measure(minimizedButton)
    await minimizedButton.click()
    await expect(settingsWindow).toBeVisible()
    await expect.poll(async () => (await morphs()).length).toBe(2)
    const restore = (await morphs())[1]
    const [restoreX, restoreY] = restore.keyframes[0].transform.match(/^translate\((\S+)px, (\S+)px\)/).slice(1).map(Number)
    expect(restore.bounds.x + restore.bounds.width / 2 + restoreX).toBeCloseTo(minimizedBox.x + minimizedBox.width / 2, 0)
    expect(restore.bounds.y + restore.bounds.height / 2 + restoreY).toBeCloseTo(minimizedBox.y + minimizedBox.height / 2, 0)
    await expect(minimizedButton).toHaveCount(0)
    expect(await page.evaluate(() => window.viewTransitions)).toBe(0)
  })

  test('opens a header window requested while another one morphs closed', async ({ page }) => {
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateMoveDownloadsToAppHeader', true)
      await store.dispatch('updateMoveSettingsToAppHeader', true)
      await store.dispatch('showSettingsWindow')
    })
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const store = window.$store
      store.dispatch('closeSettingsWindowToIcon')
      store.dispatch('openSettingsWindowFromIcon', 'downloads')
    })
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSettingsWindowMorphing)).toBe(false)
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
  })

  test('keeps the Settings scroll position when it morphs into and out of its header button', { tag: '@scale' }, async ({ page }) => {
    await goToSettingsSection(page, 'appearance')
    await page.evaluate(() => window.$store.dispatch('updateMoveSettingsToAppHeader', true))
    const content = page.locator('.settingsContent')
    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const scrollTop = await content.evaluate(element => element.scrollTop)

    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settingsWindow.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(settingsWindow).toBeHidden()
    await page.locator('.topNav .settingsButton').click()
    await expect(settingsWindow).toBeVisible()

    await expect.poll(async () => Math.abs(
      await content.evaluate(element => element.scrollTop) - scrollTop
    )).toBeLessThanOrEqual(1)
  })

  test('clamps the Downloads scroll position when a wider layout becomes shorter', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 650
      }))
      const store = window.$store
      for (let index = 0; index < 8; index++) {
        store.commit('upsertYtDlpDownload', {
          id: index + 1,
          title: `Responsive download ${index + 1}`,
          status: 'completed',
          mode: 'video',
          availability: 'available',
          destination: `/tmp/responsive-download-${index + 1}.webm`,
          sizeBytes: 1024 * (index + 1)
        })
      }
    })
    await goTo(page, 'downloads')
    const downloadsScroll = page.locator('.settingsDownloadsPage')
    await downloadsScroll.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => downloadsScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const resizeHandle = page.locator('.resize-e')
    const handleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBounds.x + 600, handleBounds.y + handleBounds.height / 2)
    await page.mouse.up()

    await expect.poll(() => downloadsScroll.evaluate(element => {
      const content = element.firstElementChild
      const maximumScrollTop = Math.max(0, content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximumScrollTop + 1
    })).toBe(true)
  })

  test('resets standalone scroll position when switching views', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 650
      }))
      const store = window.$store
      for (let index = 0; index < 8; index++) {
        store.commit('upsertYtDlpDownload', {
          id: index + 1,
          title: `View switch download ${index + 1}`,
          status: 'completed',
          mode: 'video',
          availability: 'available',
          destination: `/tmp/view-switch-download-${index + 1}.webm`
        })
      }
    })
    await goTo(page, 'downloads')
    const downloadsScroll = page.locator('.settingsDownloadsPage')
    await downloadsScroll.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => downloadsScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('showSettingsWindow', 'about')
    })
    await expect(page.getByRole('dialog', { name: 'About', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('showSettingsWindow', 'downloads')
    })

    await expect.poll(() => page.locator('.settingsDownloadsPage').evaluate(element => element.scrollTop)).toBe(0)
  })

  test('clamps the settings scroll position after repeated resizing', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    const content = page.locator('.settingsContent')
    const resizeHandle = page.locator('.resize-se')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)

    const originalHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      originalHandleBounds.x + originalHandleBounds.width / 2,
      originalHandleBounds.y + originalHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(originalHandleBounds.x - 180, originalHandleBounds.y - 180)
    await page.mouse.up()

    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const smallerHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      smallerHandleBounds.x + smallerHandleBounds.width / 2,
      smallerHandleBounds.y + smallerHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(smallerHandleBounds.x + 180, smallerHandleBounds.y + 180)
    await page.mouse.up()

    await page.waitForTimeout(250)
    expect(await content.evaluate(element => {
      const section = element.querySelector('.section')
      const contentEnd = section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      return element.scrollTop - Math.max(0, contentEnd - element.clientHeight)
    })).toBeLessThanOrEqual(1)

    const restoredHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      restoredHandleBounds.x + restoredHandleBounds.width / 2,
      restoredHandleBounds.y + restoredHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(restoredHandleBounds.x - 180, restoredHandleBounds.y - 180)
    await page.mouse.up()

    const menu = page.locator('.settingsMenu')
    await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const compactHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      compactHandleBounds.x + compactHandleBounds.width / 2,
      compactHandleBounds.y + compactHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(compactHandleBounds.x + 180, compactHandleBounds.y + 180)
    await page.mouse.up()

    await page.waitForTimeout(250)
    expect(await menu.evaluate(element => (
      element.scrollTop - Math.max(0, element.scrollHeight - element.clientHeight)
    ))).toBeLessThanOrEqual(1)
  })

  test('animates maximize and restore while preserving its floating bounds', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)
    const originalBounds = await settingsWindow.boundingBox()
    await settingsWindow.evaluate(element => {
      const animate = element.animate.bind(element)
      element.animate = (...args) => {
        element.dataset.boundsAnimationStarted = 'true'
        return animate(...args)
      }
    })

    await page.getByRole('button', { name: 'Maximize' }).click()
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(settingsWindow).toHaveAttribute('data-bounds-animation-started', 'true')
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await expect.poll(async () => (await settingsWindow.boundingBox()).width).toBe(viewport.width)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height).toBe(viewport.height)
    await expect(page.locator('.settingsResizeHandle:visible')).toHaveCount(0)

    await settingsWindow.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(settingsWindow).not.toHaveClass(/maximized/)
    await expect.poll(async () => (await settingsWindow.boundingBox()).width)
      .toBeCloseTo(originalBounds.width, 0)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height)
      .toBeCloseTo(originalBounds.height, 0)

    const breadcrumb = page.locator('.settingsBreadcrumb')
    const breadcrumbBounds = await breadcrumb.boundingBox()
    await breadcrumb.dblclick({
      position: { x: breadcrumbBounds.width - 4, y: breadcrumbBounds.height / 2 }
    })
    await expect(settingsWindow).toHaveClass(/maximized/)
    await breadcrumb.dblclick({
      position: { x: breadcrumbBounds.width - 4, y: breadcrumbBounds.height / 2 }
    })
    await expect(settingsWindow).not.toHaveClass(/maximized/)

    await page.getByRole('button', { name: 'Maximize' }).click()
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(page.locator('body > .os-scrollbar-vertical')).toHaveCSS('visibility', 'hidden')
    await expect.poll(() => settingsWindow.evaluate(element => element.getAnimations().length)).toBe(0)
    const dragTargetBounds = await page.locator('.settingsBreadcrumbLabel').first().boundingBox()
    await page.mouse.move(
      dragTargetBounds.x + dragTargetBounds.width / 2,
      dragTargetBounds.y + dragTargetBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      dragTargetBounds.x + dragTargetBounds.width / 2 + 30,
      dragTargetBounds.y + dragTargetBounds.height / 2 + 20
    )
    await expect(settingsWindow).not.toHaveClass(/maximized/)
    await page.mouse.up()
    await expect.poll(async () => (await settingsWindow.boundingBox()).width)
      .toBeCloseTo(originalBounds.width, 0)
  })

  test('keeps the settings window inside the narrowest supported viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await goTo(page, 'settings')
    await page.setViewportSize({ width: 340, height: 600 })
    await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)

    const bounds = await page.locator('.settingsWindow').boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(340)
  })

  async function expectMaximizedSettingsToFillViewport(page) {
    for (const width of [1080, 535, 810, 1080]) {
      await page.setViewportSize({ width, height: 800 })
      await goTo(page, 'settings')
      const settingsWindow = page.locator('.settingsWindow')
      const maximize = settingsWindow.getByRole('button', { name: 'Maximize', exact: true })
      if (await maximize.isVisible()) await maximize.click()
      await expect(settingsWindow).toHaveClass(/maximized/)
      await expect.poll(() => settingsWindow.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return Math.max(Math.abs(bounds.left), Math.abs(bounds.width - document.documentElement.clientWidth))
      })).toBeLessThan(1)
      await settingsWindow.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(settingsWindow).toBeHidden()
    }
  }

  test('maximized settings fill the viewport after resize and reopen', { tag: '@scale' }, async ({ page }) => {
    await expectMaximizedSettingsToFillViewport(page)
  })

  for (const zoom of [0.75, 1.5]) {
    test(`maximized settings fill the viewport after resize and reopen at ${zoom} scale`, async ({ page }) => {
      await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
      await expectMaximizedSettingsToFillViewport(page)
    })
  }

  test('keeps narrow settings maximized below the status bar after viewport height changes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-top', '24px')
    })
    await goTo(page, 'settings')

    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(page.getByRole('button', { name: /Maximi[sz]e|Restore/ })).toHaveCount(0)
    await expect(page.locator('.settingsResizeHandle:visible')).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: 'Search settings' })).not.toBeFocused()

    await page.setViewportSize({ width: 375, height: 500 })
    await page.setViewportSize({ width: 375, height: 800 })

    await expect.poll(async () => (await settingsWindow.boundingBox()).y).toBe(24)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height).toBe(776)

    await page.setViewportSize({ width: 720, height: 390 })
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect.poll(async () => (await settingsWindow.boundingBox()).width).toBe(720)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height).toBe(366)
  })

  test('keeps its minimum size when a resize pointer crosses the window', async ({ page }) => {
    await goTo(page, 'settings')
    const resizeHandle = page.locator('.resize-se')
    const handleBounds = await resizeHandle.boundingBox()

    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(0, 0)
    await page.mouse.up()

    // Rounded because the window lands on a fractional CSS pixel on scaled
    // displays: the point is that it stopped at its 360px minimum instead of
    // collapsing, not that it hit it to the pixel.
    const bounds = await page.locator('.settingsWindow').boundingBox()
    expect(Math.round(bounds.width)).toBeGreaterThanOrEqual(360)
    expect(Math.round(bounds.height)).toBeGreaterThanOrEqual(360)
  })

  test('wraps controls before the two-column detail pane clips them', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 820,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await expect(page.locator('.settingsPage')).not.toHaveClass(/compactSettings/)

    for (const grid of ['.switchColumnGrid', '.switchGrid']) {
      expect(await page.locator(grid).first().evaluate(element => {
        return new Set(Array.from(element.children).map(control => {
          const bounds = (control.querySelector('.select-text') || control).getBoundingClientRect()
          return Math.round(bounds.left + bounds.width / 2)
        })).size
      })).toBe(1)
    }

    const content = page.locator('.settingsContent')
    expect(await content.evaluate(element => {
      const rightEdge = element.getBoundingClientRect().right
      return Array.from(element.querySelectorAll('.section *')).every(child => {
        const bounds = child.getBoundingClientRect()
        return bounds.width === 0 || bounds.right <= rightEdge + 1
      })
    })).toBe(true)
    await attachScreenshot('820px wide settings window')
  })

  test('returns from saved channel settings through its clickable breadcrumb', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const breadcrumb = page.locator('.settingsBreadcrumb')
    await expect(breadcrumb).toContainText('Settings')
    await expect(breadcrumb).toContainText('Playback')
    await expect(breadcrumb).toContainText('Saved Channel Settings')
    await expect(breadcrumb.locator('.settingsBreadcrumbSubpageIcon[data-icon="users"]')).toBeVisible()
    await breadcrumb
      .getByRole('button', { name: 'Playback' })
      .locator('.settingsBreadcrumbCategoryIcon')
      .click()

    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
    await expect(breadcrumb).not.toContainText('Saved Channel Settings')
  })

  test('keeps saved-channel controls in two columns without narrow wrapping', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      const store = window.$store
      return Promise.all([
        store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify({
          channel1: 1,
          channel2: 1.25,
          channel3: 1.5
        })),
        store.dispatch('updateChannelVideoQualities', JSON.stringify({ channel1: '1080' })),
        store.dispatch('updateChannelSubtitlesStates', JSON.stringify({ channel1: true })),
        store.dispatch('updateChannelVolumes', JSON.stringify({ channel1: 0.5 }))
      ])
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const entries = page.locator('.channelEntry')
    await expect(entries).toHaveCount(3)
    const firstEntryPreferences = entries.first().locator('.channelPreference')
    const preferenceTops = await firstEntryPreferences.evaluateAll(elements => {
      return elements.slice(0, 2).map(element => Math.round(element.getBoundingClientRect().top))
    })
    expect(new Set(preferenceTops).size).toBe(1)
    await attachScreenshot('saved channel controls in two columns')

    await entries.first().locator('.channelLink').click()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Saved Channel Settings')
    await expect(page.locator('.channelListContainer')).toBeVisible()
  })

  test('keeps shortcut and saved-channel subpages scrollable in compact layout', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 500,
        height: 450
      }))
      const store = window.$store
      return Promise.all([
        store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`channel${index}`, 1 + index / 10])
        ))),
        store.dispatch('updateChannelVideoQualities', JSON.stringify({ channel0: '1080' })),
        store.dispatch('updateChannelSubtitlesStates', JSON.stringify({ channel0: true })),
        store.dispatch('updateChannelVolumes', JSON.stringify({ channel0: 0.5 }))
      ])
    })
    await goTo(page, 'settings')
    await expect(page.locator('.settingsPage')).toHaveClass(/compactSettings/)
    await expect(async () => {
      const gaps = await page.locator('.settingsWindow').evaluate(element => {
        const header = element.querySelector('.settingsWindowHeader').getBoundingClientRect()
        const search = element.querySelector('.settingsSearch').getBoundingClientRect()
        return { left: search.left - header.left, right: header.right - search.right }
      })
      expect(gaps.left).toBeCloseTo(10, 0)
      expect(gaps.right).toBeCloseTo(10, 0)
    }).toPass()
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('FFmpeg Source')
    await expect(page.locator('.settingsMenu')).toBeHidden()
    await expect(page.getByRole('button', { name: 'FFmpeg Source', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('')
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await recordAnimations(page)
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await expectAnimation(page, 'settings-compact-slide-forward')
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const channelList = page.locator('.channelListContainer')
    expect(await page.locator('.channelPreferences').first().evaluate(element => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length
    })).toBe(1)
    expect(await channelList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await channelList.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => channelList.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const settingsBackButton = page.locator('.settingsBackButton')
    await settingsBackButton.click()
    await recordAnimations(page)
    await settingsBackButton.click()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expectAnimation(page, 'settings-compact-slide-backward')

    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    const shortcuts = page.locator('.shortcutColumns')
    expect(await shortcuts.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await shortcuts.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => shortcuts.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await settingsBackButton.click()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expect(page.locator('.settingsContent')).toBeHidden()
  })

  test('animates category changes vertically in two-column layout', async ({ page }) => {
    await goTo(page, 'settings')

    await recordAnimations(page)
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await expectAnimation(page, 'settings-section-slide-forward')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await expectAnimation(page, 'settings-section-slide-backward')

    // The class is cleared once it has played, so nothing replays the slide
    // later on — rebuilding the overlay scrollbars used to.
    await expect(page.locator('.settingsContent')).not.toHaveClass(/settingsSectionSlide/)
    await recordAnimations(page)
    await page.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' }).click()
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => window.__playedAnimations)).toEqual([])
  })

  test('keeps its scroll position when always-visible scrollbars are enabled', { tag: '@scale' }, async ({ page }) => {
    await expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page)
  })

  test.describe('with reduced motion', () => {
    test.use({ seed: { settings: { reducedMotion: 'on' } } })

    test('leaves no slide class behind for a suppressed animation', async ({ page }) => {
      await goTo(page, 'settings')
      await recordAnimations(page)
      await page.locator('.settingsMenu [data-section="playback"]').click()
      await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()

      // Nothing plays, and nothing is left that could play later: turning
      // reduced motion back off would otherwise slide the settings unprompted.
      await expect(page.locator('.settingsContent')).not.toHaveClass(/settingsSectionSlide/)
      await page.evaluate(() => {
        const store = window.$store
        return store.dispatch('updateReducedMotion', 'off')
      })
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => window.__playedAnimations)).toEqual([])
    })
  })

  test('select dropdowns use overlay scrollbars', async ({ page }) => {
    await goTo(page, 'settings')

    const combobox = page.getByRole('combobox', { name: /Language preference|Locale Preference/ })
    await combobox.click()

    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    await expect(dropdown).toContainText('English (US) (100%)')
    await expect(dropdown.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect(dropdown).toHaveCSS('scrollbar-width', 'none')

    const appearance = await dropdown.evaluate((menu) => {
      const menuStyle = getComputedStyle(menu)
      const chromeBottom = Math.max(
        ...Array.from(document.querySelectorAll('.topNav, .tabBar:not(.vertical)'))
          .map(element => element.getBoundingClientRect().bottom)
      )

      return {
        chromeBottom,
        cursor: getComputedStyle(menu.querySelector('.selectOption')).cursor,
        fontFamily: menuStyle.fontFamily,
        menuTop: menu.getBoundingClientRect().top
      }
    })

    expect(appearance.fontFamily).toContain('Geist')
    expect(appearance.cursor).toBe('default')
    expect(appearance.menuTop).toBeGreaterThanOrEqual(appearance.chromeBottom)

    const scrollbarHandle = dropdown.locator('.os-scrollbar-vertical .os-scrollbar-handle')
    const handleBounds = await scrollbarHandle.boundingBox()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2 + 30
    )
    await expect(dropdown).toBeVisible()
    await page.mouse.up()

    await combobox.press('Home')
    await combobox.press('ArrowDown')
    await combobox.press('Enter')
    await expect(combobox).toContainText('English (US) (100%)')
    await expect(dropdown).toHaveCount(0)

    await page.locator('.settingsMenu [data-section="advanced"]').click()
    await page.getByRole('combobox', { name: 'Preferred API backend' }).click()
    await expect(dropdown).toBeVisible()
    expect(await dropdown.evaluate(menu => menu.scrollHeight <= menu.clientHeight)).toBe(true)
  })

  test('contains wheel scrolling at the ends of select dropdowns', async ({ page }) => {
    await goTo(page, 'settings')

    await page.evaluate(() => {
      const store = window.$store
      store.commit('setScrollSpeed', 200)
      document.body.style.minBlockSize = '4000px'
      document.scrollingElement.scrollTop = 1000
    })
    await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop))
      .toBe(1000)

    await page.getByRole('combobox', { name: /Language preference|Locale Preference/ }).click()
    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    await dropdown.hover()

    for (const { dropdownEnd, wheelDelta } of [
      { dropdownEnd: 'bottom', wheelDelta: 1000 },
      { dropdownEnd: 'top', wheelDelta: -1000 }
    ]) {
      await dropdown.evaluate((element, end) => {
        element.scrollTop = end === 'bottom' ? element.scrollHeight : 0
      }, dropdownEnd)
      const pageScrollTop = await page.evaluate(() => document.scrollingElement.scrollTop)

      for (let index = 0; index < 5; index++) {
        await page.mouse.wheel(0, wheelDelta)
      }

      await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop))
        .toBe(pageScrollTop)
    }
  })

  test('closes without replacing the underlying page', async ({ page }) => {
    const url = page.url()
    await goTo(page, 'settings')
    await page.locator('.settingsCloseButton').click()

    await expect(page.locator('.settingsWindow')).toHaveCount(0)
    await expect(page).toHaveURL(url)
  })

  test('switches sections without changing the current URL', async ({ page }) => {
    const url = page.url()
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="playback"]')
    await playerSectionLink.click()
    await expect(playerSectionLink).toHaveClass(/active/)
    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
    await expect(page).toHaveURL(url)
  })

  test('keeps the window and its scroll position when switching tabs', async ({ page }) => {
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="playback"]')
    await playerSectionLink.click()

    const settingsContent = page.locator('.settingsContent')
    const sectionScrollPosition = await settingsContent.evaluate(element => element.scrollTop)
    await settingsContent.hover()
    await page.mouse.wheel(0, 200)
    await expect.poll(() => settingsContent.evaluate(element => element.scrollTop))
      .toBeGreaterThan(sectionScrollPosition)
    const scrollPosition = await settingsContent.evaluate(element => element.scrollTop)
    await expect(playerSectionLink).toHaveClass(/active/)

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(playerSectionLink).toHaveClass(/active/)

    await expect.poll(() => settingsContent.evaluate(element => element.scrollTop)).toBe(scrollPosition)
  })
})

test.describe('localized compact settings breadcrumb', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('prioritizes the current category over the redundant root label', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 650,
        height: 520
      }))
    })
    await goToSettingsSection(page, 'focus')

    const breadcrumb = page.locator('.settingsBreadcrumb')
    const root = breadcrumb.locator('.settingsBreadcrumbRoot')
    const category = breadcrumb.locator('.settingsBreadcrumbLabel')

    await expect(page.locator('.settingsPage')).toHaveClass(/compactSettings/)
    await expect(root).toBeHidden()
    await expect(breadcrumb.locator('.settingsBreadcrumbSeparator').first()).toBeHidden()
    await expect(category.locator('.settingsBreadcrumbText')).toHaveText('Ablenkungsfreier Modus')
    await expect.poll(() => category.locator('.settingsBreadcrumbText').evaluate(element => (
      element.scrollWidth <= element.clientWidth + 1
    ))).toBe(true)
  })
})

test.describe('fractional window positions', () => {
  // Wayland reports fractional pointer positions while dragging, and fractional
  // UI scales turn whole CSS pixels into fractional device pixels.
  test('keeps the header border on whole device pixels while dragging and scrolling', { tag: '@scale' }, async ({ app, page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 180.92, y: 60.6875, width: 850, height: 520 }))
    })
    await goTo(page, 'settings')
    const dialog = page.locator('.settingsWindow')
    const header = dialog.locator('.settingsWindowHeader')
    await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
    const devicePixelOffset = () => dialog.evaluate((element) => {
      const { left, top } = element.getBoundingClientRect()
      return Math.max(...[left, top].map(value => Math.abs(value * devicePixelRatio - Math.round(value * devicePixelRatio))))
    })
    await expect.poll(devicePixelOffset).toBeLessThan(0.01)

    const label = await dialog.locator('.settingsBreadcrumbLabel').first().boundingBox()
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2)
    await page.mouse.down()
    await page.mouse.move(label.x + label.width / 2 + 30, label.y + label.height / 2 + 20, { steps: 3 })
    await expect.poll(devicePixelOffset).toBeLessThan(0.01)
    await page.mouse.up()
    await expect.poll(devicePixelOffset).toBeLessThan(0.01)

    // Scrolling composites the content pane, which must not paint over the border.
    const { width, height } = await header.boundingBox()
    const borderPoints = [0.5, 0.75].flatMap(x => [0.2, 0.9, 1.6].map(y => [width * x, height - y]))
    const before = await sampleColors(app, header, borderPoints)
    const content = dialog.locator('.settingsContent')
    await content.hover()
    await page.mouse.wheel(0, 137)
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await sampleColors(app, header, borderPoints)).toEqual(before)
  })
})
