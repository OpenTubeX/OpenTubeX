import {
  test,
  expect,
  expectAnimation,
  expectOverlayScrollRange,
  goTo,
  goToSettingsSection,
  recordAnimations,
  sel
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
  test('opens from the application menu without remounting the current feed', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    const subscriptionsPage = page.locator('.subscriptionsPage')
    await subscriptionsPage.evaluate(element => {
      element.dataset.settingsShortcutMarker = 'preserved'
    })

    const clickMenuItem = label => app.electronApp.evaluate(({ BrowserWindow, Menu }, label) => {
      const browserWindow = BrowserWindow.getAllWindows()[0]
      if (!browserWindow) throw new Error('Browser window was not found')
      const item = Menu.getApplicationMenu().items
        .flatMap(menu => menu.submenu?.items ?? [])
        .find(candidate => candidate.label === label)
      item.click({}, browserWindow, browserWindow.webContents)
    }, label)

    await clickMenuItem('Preferences')
    await expect(page.locator('.settingsWindow .settingsMenu')).toBeVisible()
    await expect(subscriptionsPage).toHaveAttribute('data-settings-shortcut-marker', 'preserved')
    await clickMenuItem('Preferences')
    await expect(page.locator('.settingsWindow')).toHaveCount(0)

    await clickMenuItem('Profile Manager')
    await expect(page.locator('.settingsWindow .profileSettingsContent')).toBeVisible()
    await expect(subscriptionsPage).toHaveAttribute('data-settings-shortcut-marker', 'preserved')
    await expect(page).toHaveURL(/#\/subscriptions$/)
  })

  test('shows Subscriptions for a restored legacy About tab', async ({ page }) => {
    const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/about', makeActive: false }))
    await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
    await expect(page.locator(`.tabContent[data-tab-id="${tab.id}"] .subscriptionsPage`)).toBeVisible()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('.settingsWindow')).toHaveCount(0)
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

    // Read the closing view when the leave starts. Polling for it afterwards can
    // miss the short leave animation on a loaded machine.
    await settingsWindow.evaluate(element => {
      window.shortcutsShownWhileLeaving = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (!element.classList.contains('settings-window-leave-active')) return
          observer.disconnect()
          resolve(element.querySelector('.shortcutColumns')?.checkVisibility() ?? false)
        })
        observer.observe(element, { attributes: true, attributeFilter: ['class'] })
      })
    })
    await page.keyboard.press('Shift+?')
    expect(await page.evaluate(() => window.shortcutsShownWhileLeaving)).toBe(true)
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
    // At 95% UI Scale, scrollHeight rounds to whole CSS pixels while scrollTop
    // snaps to device pixels, so the end can differ by one more device pixel.
    await expect.poll(() => content.evaluate(element => Math.abs(
      element.scrollHeight - element.clientHeight - element.scrollTop
    ) - 1 / devicePixelRatio)).toBeLessThanOrEqual(1)
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
    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('showSettingsWindow', null)
    })

    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settingsWindow).toBeVisible()
    await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()

    await expect(settingsWindow).toBeHidden()
    const minimizedButton = page.locator('.minimizedUtilityButton')
    await expect(minimizedButton).toBeVisible()
    await expect(minimizedButton).toHaveAccessibleName('Restore: Settings')

    await minimizedButton.click()
    await expect(settingsWindow).toBeVisible()
    await page.locator('.settingsCloseButton').click()
    await expect(settingsWindow).toBeHidden()
    await expect(page.locator('.minimizedUtilityButton')).toHaveCount(0)
  })

  test('preserves its scroll position after being minimized and restored', { tag: '@scale' }, async ({ page }) => {
    await expectMinimizeToPreserveSettingsScroll(page)
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

  test('clamps the settings scroll position after repeated resizing', { tag: '@scale' }, async ({ page }) => {
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

    await expectOverlayScrollRange(content)

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

    await expectOverlayScrollRange(menu)
  })

  test('keeps the settings window inside the narrowest supported viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await goTo(page, 'settings')
    await page.setViewportSize({ width: 340, height: 600 })
    await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)

    const bounds = await page.locator('.settingsWindow').boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(340)

    await page.evaluate(() => window.$store.dispatch('showSettingsWindow', 'about'))
    const aboutPage = page.locator('.settingsAboutPage')
    await expect(aboutPage.locator('.about-chunks')).toBeVisible()
    expect(await aboutPage.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
  })

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

  test('keeps its scroll position when always-visible scrollbars are enabled', { tag: '@scale' }, async ({ page }) => {
    await expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page)
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
