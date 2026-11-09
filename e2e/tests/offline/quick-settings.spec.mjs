import { test, expect, expectScrollAtRenderedEnd, goToSettingsSection, latestSettings, setWindowSize, readDatastore, openInterfaceCustomizer } from '../../helpers/app.mjs'
import { DEFAULT_QUICK_SETTINGS, normalizeQuickSettings } from '../../../src/renderer/helpers/quickSettings.js'

// Mixes selects, sliders and toggles across every common category. Startup
// replaces these former defaults when they were saved without changes.
const FORMER_DEFAULT_QUICK_SETTINGS = [
  'baseTheme',
  'mainColor',
  'uiScale',
  'thumbnailSize',
  'defaultQuality',
  'playNextVideo',
  'enableSubtitlesByDefault',
  'listType',
  'playlistViewType',
  'hideRecommendedVideos',
  'hideComments',
  'currentLocale',
  'region',
]

const ALL_QUICK_SETTINGS = [
  ...FORMER_DEFAULT_QUICK_SETTINGS,
  'useProxy',
]

const ADDITIONAL_QUICK_SETTINGS = [
  ['rememberHistory', 'Remember Watch History', 'Privacy'],
  ['defaultPlayback', 'Default Playback Rate', 'Playback'],
  ['defaultVideoFormat', 'Default Media Format', 'Playback'],
  ['useDeArrowTitles', 'Use DeArrow Video Titles', 'Add-ons'],
]

test.describe('desktop quick settings animation', () => {
  test.use({ seed: { settings: { reducedMotion: 'off', currentLocale: 'en-US' } } })

  test('keeps the panel open when reopening during its close animation', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toHaveCSS('transform', 'none')
    await page.evaluate(() => {
      window.quickSettingsWasClosing = null
      const trigger = document.querySelector('.profileTrigger')
      const onTransitionRun = event => {
        if (!event.target.matches('.quickSettingsMenu')) return
        clearTimeout(timeout)
        document.removeEventListener('transitionrun', onTransitionRun)
        trigger.click()
        window.quickSettingsWasClosing = true
      }
      const timeout = setTimeout(() => {
        document.removeEventListener('transitionrun', onTransitionRun)
        window.quickSettingsWasClosing = false
      }, 1000)
      document.addEventListener('transitionrun', onTransitionRun)
      trigger.click()
    })
    await expect.poll(() => page.evaluate(() => window.quickSettingsWasClosing)).not.toBeNull()
    expect(await page.evaluate(() => window.quickSettingsWasClosing)).toBe(true)
    await expect(menu).toHaveCount(1)
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCSS('opacity', '1')
    await expect(menu).toHaveCSS('transform', 'none')
    await expect(page.locator('.profileTrigger')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('cleans up when switching layouts during a close animation', async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('updateAnimationSpeed', 25))
    const menu = page.locator('.quickSettingsMenu')
    // Freeze the document timeline so the close animation is still running when
    // the layout switches, however long the steps in between take.
    const cdp = await page.context().newCDPSession(page)
    for (const closingPhoneSheet of [false, true]) {
      await page.locator('.profileTrigger').click()
      await menu.locator('.profileSummary').click()
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 })
      try {
        if (closingPhoneSheet) {
          await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
        } else {
          await page.locator('.profileTrigger').click()
        }
        await expect(page.locator('.profileTrigger')).toHaveAttribute('aria-expanded', 'false')
        await expect(menu).toBeAttached()
        await page.setViewportSize({ width: 1100, height: closingPhoneSheet ? 900 : 480 })
        await expect(menu).toHaveCount(0)
        await expect(page.locator('.mobileSheet')).toHaveCount(0)
      } finally {
        await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
      }
    }
    await page.locator('.profileTrigger').click()
    await expect(menu.locator('.profileSummary')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })
})

test.describe('quick settings select interactions', () => {
  test.use({ seed: { settings: { baseTheme: 'dark', alwaysShowScrollbars: true, quickSettings: ALL_QUICK_SETTINGS } } })

  test('keeps the select and quick settings open while dragging the dropdown scrollbar', { tag: '@scale' }, async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const select = menu.getByRole('combobox', { name: 'Language preference' })
    await select.click()
    const dropdown = page.locator('.selectDropdown')
    const scrollbar = dropdown.locator('.os-scrollbar-vertical')
    await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
    const thumb = scrollbar.locator('.os-scrollbar-handle')
    const bounds = await thumb.boundingBox()
    expect(bounds).not.toBeNull()
    const initialScrollTop = await dropdown.evaluate(element => element.scrollTop)
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    try {
      await expect(dropdown).toBeVisible()
      await expect(menu).toBeVisible()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 80, { steps: 8 })
      await expect.poll(() => dropdown.evaluate(element => element.scrollTop)).toBeGreaterThan(initialScrollTop)
    } finally {
      await page.mouse.up()
    }
    await expect(dropdown).toBeVisible()
    await expect(menu).toBeVisible()
    await expect(select).toBeFocused()
    await dropdown.locator('[aria-selected="true"]').click()
    await expect(dropdown).toBeHidden()
    await expect(menu).toBeVisible()
  })
})

test.describe('compact quick settings', { tag: '@scale' }, () => {
  async function resize(app, page, width, uiScale) {
    await app.electronApp.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ ...window.getBounds(), ...size })
    }, { width: Math.round(width * uiScale / 100), height: 820 * uiScale / 100 })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
  }

  test('uses a full-screen sheet when wide vertical tabs make the header compact', async ({ app, page, uiScale }) => {
    await resize(app, page, 800, uiScale)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setTabBarPosition', 'right')
      store.commit('setVerticalTabBarWidth', 400)
    })
    await expect(page.locator('.topNav')).toHaveClass(/phoneLayout/)
    await page.locator('.profileTrigger').click()
    const sheet = page.getByRole('dialog', { name: 'Quick settings' })
    await expect(sheet).toHaveClass(/mobileSheetEnabled/)
    await sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
    const bounds = await sheet.boundingBox()
    expect(Math.abs(bounds.x)).toBeLessThan(1)
    expect(Math.abs(bounds.y)).toBeLessThan(1)
    expect(Math.abs(bounds.width - 800)).toBeLessThan(1)
    expect(Math.abs(bounds.height - 820)).toBeLessThan(1)
  })

  test('fills the viewport with quick settings throughout the compact header layout', async ({ app, page, uiScale }, testInfo) => {
    for (const width of [600, 601, 640, 680, 681]) {
      await resize(app, page, width, uiScale)
      await page.locator('.profileTrigger').click()
      const quick = page.locator('.quickSettingsMenu')
      await expect(quick).toBeVisible()
      if (width <= 680) {
        const sheet = page.getByRole('dialog', { name: 'Quick settings' })
        await expect(sheet).toHaveClass(/mobileSheetEnabled/)
        await sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
        const bounds = await sheet.boundingBox()
        expect(Math.abs(bounds.x)).toBeLessThan(1)
        expect(Math.abs(bounds.y)).toBeLessThan(1)
        expect(Math.abs(bounds.width - width)).toBeLessThan(1)
        expect(Math.abs(bounds.height - 820)).toBeLessThan(1)
        if (width === 640) {
          // Electron captures the whole window at non-100% UI scales.
          const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => (
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
          ))
          await testInfo.attach('fullscreen quick settings at the previously broken width', {
            body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
          })
        }
        await sheet.getByRole('button', { name: 'Close', exact: true }).click()
      } else {
        await expect(quick).not.toHaveClass(/phoneQuickSettings/)
        const bounds = await quick.boundingBox()
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
        await quick.press('Escape')
      }
      await expect(quick).toHaveCount(0)
    }
  })
})

test.describe('quick settings pointer spacing', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        quickSettings: ['uiScale', 'thumbnailSize', 'uiRoundness', 'defaultPlayback', 'playNextVideo', 'enableSubtitlesByDefault'],
      }
    }
  })

  test('keeps mouse toggles compact and slider inputs below their captions in every menu layout', async ({ app, page, uiScale }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const touch = await page.context().newCDPSession(page)
    for (const { width, height } of [{ width: 1280, height: 900 }, { width: 480, height: 900 }, { width: 1280, height: 550 }]) {
      await app.electronApp.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, ...bounds })
      }, { width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
      await page.locator('.profileTrigger').click()
      const menu = page.locator('.quickSettingsMenu')
      await expect(menu).toBeVisible()
      if (width < 680 || height < 600) await expect(menu).toHaveClass(/phoneQuickSettings/)
      else await expect(menu).not.toHaveClass(/phoneQuickSettings/)
      await expect(menu).not.toHaveClass(/quick-settings-menu-enter-active/)
      for (const slider of await menu.locator('.pure-material-slider').all()) {
        const bounds = await slider.evaluate(element => ({
          caption: element.querySelector('.labelRow').getBoundingClientRect().toJSON(),
          input: element.querySelector('.input').getBoundingClientRect().toJSON(),
        }))
        expect.soft(bounds.input.top, `${width}×${height}: input does not overlap caption`).toBeGreaterThanOrEqual(bounds.caption.bottom - 0.1)
      }
      const tracks = await menu.locator('.switch-label-text').evaluateAll(labels => labels.map(label => {
        const bounds = label.getBoundingClientRect()
        const height = Number.parseFloat(getComputedStyle(label, '::before').blockSize)
        return { top: bounds.top + (bounds.height - height) / 2, bottom: bounds.top + (bounds.height + height) / 2 }
      }))
      expect(tracks).toHaveLength(2)
      expect.soft(tracks[1].top - tracks[0].bottom, `${width}×${height}: visible toggle gap`).toBeCloseTo(16, 1)
      const roundness = menu.locator('[data-setting-id="uiRoundness"]')
      const caption = roundness.locator('.labelRow')
      const captionBounds = await caption.boundingBox()
      const input = roundness.getByRole('slider')
      const before = await input.inputValue()
      await caption.click({ position: { x: captionBounds.width * 0.75, y: captionBounds.height - 1 } })
      await expect.soft(input, 'clicking the caption does not change the slider').toHaveValue(before, { timeout: 1000 })
      await input.press('ArrowRight')
      await expect(input).toHaveValue(String(Number(before) + 5))
      await input.press('ArrowLeft')

      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await expect.poll(() => page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
      for (const label of await menu.locator('.switch-label').all()) {
        expect((await label.boundingBox()).height, 'coarse-pointer toggle target stays large').toBeGreaterThanOrEqual(47.9)
      }
      await expectQuickSwitchTargets(menu, page)
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      if (width < 680 || height < 600) {
        await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'Close', exact: true }).click()
      } else {
        await menu.press('Escape')
      }
      await expect(menu).toHaveCount(0)
    }
    await touch.detach()
  })
})

async function expectQuickSwitchTargets(menu, page) {
  const switches = menu.locator('.switch-ctn')
  const targets = await switches.evaluateAll(elements => elements.map(element => {
    const label = element.querySelector('.switch-label').getBoundingClientRect()
    const input = element.querySelector('.switch-input').getBoundingClientRect()
    return { top: Math.min(label.top, input.top), bottom: Math.max(label.bottom, input.bottom) }
  }))
  for (let index = 1; index < targets.length; index++) {
    expect(targets[index].top, 'adjacent switch touch targets do not overlap').toBeGreaterThanOrEqual(targets[index - 1].bottom - 0.1)
  }
  const first = switches.first()
  await first.scrollIntoViewIfNeeded()
  const label = first.locator('.switch-label')
  const bounds = await label.boundingBox()
  const before = await switches.locator('.switch-input').evaluateAll(inputs => inputs.map(input => input.checked))
  // Tap the lower edge where an overlapping later row could steal the action.
  // Leave three CSS pixels for hit-test rounding at fractional zoom.
  await page.mouse.click(bounds.x + 20, bounds.y + bounds.height - 3)
  await expect(first.locator('.switch-input')).toBeChecked({ checked: !before[0] })
  const after = await switches.locator('.switch-input').evaluateAll(inputs => inputs.map(input => input.checked))
  expect(after.slice(1), 'tapping the first switch leaves its neighbors unchanged').toEqual(before.slice(1))
}

test.describe('quick settings touch spacing below 100% native UI scale', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        uiScale: 75,
        bounds: { x: 0, y: 0, width: 360, height: 675, maximized: false },
        quickSettings: ['enableSubtitlesByDefault', 'autoplayVideos', 'autoplayPlaylists'],
      }
    }
  })

  test('keeps native switch targets separate at 75% UI scale', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const touch = await page.context().newCDPSession(page)
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toBeVisible()
    await expect(menu).not.toHaveClass(/quick-settings-menu-enter-active/)
    await expectQuickSwitchTargets(menu, page)
    await touch.detach()
  })
})

test.describe('quick system themes', () => {
  test.use({ seed: { settings: { quickSettings: ['baseTheme'], baseTheme: 'system', currentLocale: 'en-US', uiScale: 125 } } })

  test('adds light and dark selectors and persists their choices across restart', async ({ app, page }, testInfo) => {
    await openInterfaceCustomizer(page, 'quick settings')
    await page.getByRole('button', { name: 'Add setting' }).click()
    const search = page.getByLabel('Search settings')
    for (const label of ['Light theme', 'Dark theme']) {
      await search.fill(label)
      await page.locator('.settingPicker .optionWrapper').getByText(label, { exact: true }).click()
    }
    await search.press('Escape')
    await page.locator('.settingsCloseButton').click()
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })

    for (const [scheme, label, choice, value] of [
      ['light', 'Light theme', 'Solarized Light', 'solarizedLight'],
      ['dark', 'Dark theme', 'Solarized Dark', 'solarizedDark'],
    ]) {
      await page.emulateMedia({ colorScheme: scheme })
      await menu.getByRole('combobox', { name: label }).click()
      await page.getByRole('option', { name: choice, exact: true }).click()
      await expect(page.locator('body')).toHaveClass(new RegExp(value))
      await expect(menu).toBeVisible()
    }
    await expect.poll(async () => {
      const saved = latestSettings(readDatastore(app.userDataDir, 'settings'))
      return [saved.quickSettings, saved.systemLightTheme, saved.systemDarkTheme]
    }).toEqual([['baseTheme', 'systemLightTheme', 'systemDarkTheme'], 'solarizedLight', 'solarizedDark'])

    ;({ page } = await app.relaunch())
    await page.locator('.profileTrigger').click()
    const reopened = page.getByRole('dialog', { name: 'Quick settings' })
    await expect(reopened.getByRole('combobox', { name: 'Light theme' })).toHaveText('Solarized Light')
    await expect(reopened.getByRole('combobox', { name: 'Dark theme' })).toHaveText('Solarized Dark')
    await expect(reopened).not.toHaveClass(/quick-settings-menu-enter-active/)
    // Electron capturePage includes the entire window at non-100% zoom.
    const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => (
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toDataURL()
    ))
    await testInfo.attach('light and dark quick theme selectors', {
      body: Buffer.from(screenshot.split(',')[1], 'base64'), contentType: 'image/png',
    })

    await reopened.getByRole('combobox', { name: 'Base Theme' }).click()
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await expect(reopened.locator('[data-setting-id="systemLightTheme"]')).toHaveCount(0)
    await expect(reopened.locator('[data-setting-id="systemDarkTheme"]')).toHaveCount(0)
    await reopened.getByRole('combobox', { name: 'Base Theme' }).click()
    await page.getByRole('option', { name: /System default/i }).click()
    for (const [id, label] of [['systemLightTheme', 'Light'], ['systemDarkTheme', 'Dark']]) {
      const control = reopened.locator(`[data-setting-id="${id}"]`)
      await control.getByRole('button', { name: 'Reset this setting to its default' }).click()
      await expect(control.getByRole('combobox')).toHaveText(label)
    }
  })

  test('clamps the menu after hiding system theme selectors at the bottom', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1000, height: 600 })
    })
    await page.evaluate(async ids => {
      const store = window.$store
      await store.dispatch('updateQuickSettings', [...ids, 'systemLightTheme', 'systemDarkTheme'])
    }, DEFAULT_QUICK_SETTINGS)
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const scroller = menu.locator('.quickSettingsScroll')
    const scrollbar = scroller.locator('.os-scrollbar-vertical')
    const thumb = scrollbar.locator('.os-scrollbar-handle')
    await scroller.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expectScrollAtRenderedEnd(scroller)
    const originalThumbHeight = await thumb.evaluate(element => element.getBoundingClientRect().height)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateBaseTheme', 'dark')
    })
    await expect(menu.locator('[data-setting-id="systemLightTheme"]')).toHaveCount(0)
    await expect(menu.locator('[data-setting-id="systemDarkTheme"]')).toHaveCount(0)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
    await expect.poll(() => thumb.evaluate(element => element.getBoundingClientRect().height))
      .toBeGreaterThan(originalThumbHeight)
  })
})

test.describe('additional quick settings', () => {
  test.use({ seed: { settings: { quickSettings: [], uiScale: 125 } } })

  test('keeps the next picker search while the previous setting save completes', async ({ page }) => {
    await openInterfaceCustomizer(page, 'quick settings')
    await page.getByRole('button', { name: 'Add setting' }).click()
    await page.evaluate(() => {
      const store = window.$store
      const dispatch = store.dispatch.bind(store)
      let release
      const gate = new Promise(resolve => { release = resolve })
      window.releaseQuickSettingSave = () => { store.dispatch = dispatch; release() }
      store.dispatch = async (type, payload, options) => {
        const result = await dispatch(type, payload, options)
        if (type === 'updateQuickSettings') await gate
        return result
      }
    })
    const search = page.getByLabel('Search settings')
    await search.fill('Remember Watch History')
    await page.locator('.settingPicker .optionWrapper').getByText('Remember Watch History', { exact: true }).click()
    await search.fill('Use DeArrow Video Titles')
    await page.evaluate(() => { window.releaseQuickSettingSave(); delete window.releaseQuickSettingSave })
    await expect(search).toHaveValue('Use DeArrow Video Titles')
    await page.locator('.settingPicker .optionWrapper').getByText(/^Use DeArrow Video Titles$/i).click()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getQuickSettings)).toEqual(['rememberHistory', 'useDeArrowTitles'])
  })

  test('adds all suggested controls, groups them, and persists changes across restart', async ({ app, page }, testInfo) => {
    test.setTimeout(120_000)
    await openInterfaceCustomizer(page, 'quick settings')
    await page.getByRole('button', { name: 'Add setting' }).click()
    const search = page.getByLabel('Search settings')
    for (const [, label] of ADDITIONAL_QUICK_SETTINGS) {
      await search.fill(label)
      await page.locator('.settingPicker .optionWrapper').getByText(new RegExp(`^${label}$`, 'i')).click()
    }
    await search.press('Escape')
    await page.locator('.settingsCloseButton').click()
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const expected = {}

    for (const [id, label, section] of ADDITIONAL_QUICK_SETTINGS) {
      const control = menu.locator(`[data-setting-id="${id}"]`)
      await expect(control.locator('..').getByRole('heading'))
        .toHaveText(section)
      if (id === 'defaultPlayback') {
        const slider = control.getByRole('slider')
        await slider.press('ArrowRight')
        expected[id] = 1.25
        await expect(slider).toHaveValue('1.25')
      } else if (id === 'defaultVideoFormat') {
        await control.getByRole('combobox', { name: new RegExp(`^${label}$`, 'i') }).click()
        await page.getByRole('option', { name: /^Audio Formats$/i }).click()
        expected[id] = 'audio'
      } else {
        const toggle = control.getByRole('checkbox')
        expected[id] = !await toggle.isChecked()
        await control.locator('label.switch-label').click()
        await expect(toggle).toBeChecked({ checked: expected[id] })
      }
      await expect(menu).toBeVisible()
    }

    const ids = normalizeQuickSettings(ADDITIONAL_QUICK_SETTINGS.map(([id]) => id))
    await expect.poll(async () => {
      const saved = latestSettings(readDatastore(app.userDataDir, 'settings'))
      return Object.fromEntries(['quickSettings', ...ids].map(id => [id, saved[id]]))
    }).toEqual({ quickSettings: ids, ...expected })

    ;({ page } = await app.relaunch())
    await page.locator('.profileTrigger').click()
    const reopened = page.getByRole('dialog', { name: 'Quick settings' })
    await expect(reopened.getByRole('heading', { name: 'Privacy', exact: true })
      .locator('[data-icon="lock"]')).toBeVisible()
    await expect.poll(() => reopened.locator('.quickSettingControl').evaluateAll(controls => (
      controls.map(control => control.dataset.settingId)
    ))).toEqual(ids)
    for (const [id, value] of Object.entries(expected)) {
      const control = reopened.locator(`[data-setting-id="${id}"]`)
      if (typeof value === 'boolean') {
        await expect(control.getByRole('checkbox')).toBeChecked({ checked: value })
      } else if (typeof value === 'number') {
        await expect(control.getByRole('slider')).toHaveValue(String(value))
      } else {
        await expect(control.getByRole('combobox')).toContainText(/Audio Formats/i)
      }
    }
    const bounds = await reopened.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    // Electron capturePage includes the entire window at non-100% zoom.
    const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => (
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toDataURL()
    ))
    await testInfo.attach('expanded quick settings catalog at 125 percent scale', {
      body: Buffer.from(screenshot.split(',')[1], 'base64'),
      contentType: 'image/png',
    })
  })
})

const EXPANDED_QUICK_SETTINGS = [
  ['secColor', 'Appearance'],
  ['reducedMotion', 'Appearance'],
  ['toastPosition', 'Appearance'],
  ['useCustomShortsPlayer', 'Playback'],
  ['loopShorts', 'Playback'],
  ['enableSkipSilenceByDefault', 'Playback'],
  ['aiVideoSummaryMode', 'Content'],
  ['videoDescriptionMode', 'Content'],
  ['hideLiveStreams', 'Content'],
  ['hideSubscriptionsLive', 'Content'],
]

test.describe('expanded quick settings catalog', () => {
  test.use({
    seed: {
      settings: {
        quickSettings: EXPANDED_QUICK_SETTINGS.map(([id]) => id),
        baseTheme: 'dark',
        reducedMotion: 'off',
        currentLocale: 'en-US',
      },
    },
  })

  test('groups the new controls, disables dependent toggles, and persists select changes', async ({ app, page, attachScreenshot }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    for (const [id, section] of EXPANDED_QUICK_SETTINGS) {
      await expect(menu.locator(`[data-setting-id="${id}"]`).locator('..').getByRole('heading'), id).toHaveText(section)
    }

    const toggle = id => menu.locator(`[data-setting-id="${id}"]`).getByRole('checkbox')
    const flip = id => menu.locator(`[data-setting-id="${id}"] label.switch-label`).click()
    await expect(toggle('enableSkipSilenceByDefault')).toBeDisabled()
    await expect(toggle('loopShorts')).toBeEnabled()
    await flip('useCustomShortsPlayer')
    await expect(toggle('loopShorts')).toBeDisabled()
    await expect(toggle('hideSubscriptionsLive')).toBeEnabled()
    await flip('hideLiveStreams')
    await expect(toggle('hideSubscriptionsLive')).toBeDisabled()
    await expect(toggle('hideSubscriptionsLive')).toBeChecked()
    await attachScreenshot('subscription controls with the live toggle disabled by Hide Live Streams')

    const choose = async (id, label, option) => {
      await menu.locator(`[data-setting-id="${id}"]`).getByRole('combobox', { name: label }).click()
      await page.getByRole('option', { name: option, exact: true }).click()
    }
    await choose('reducedMotion', 'Reduced Motion', 'Force on')
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'reduce')
    await choose('toastPosition', 'Toast Position', 'Top right')
    await choose('aiVideoSummaryMode', 'AI video summaries', 'Expanded')
    await choose('videoDescriptionMode', 'Video descriptions', 'Hide')
    await choose('secColor', 'Secondary Color Theme', 'Green')
    await menu.locator('[data-setting-id="secColor"]').scrollIntoViewIfNeeded()
    await attachScreenshot('new appearance and playback controls')

    const expected = {
      useCustomShortsPlayer: false,
      hideLiveStreams: true,
      reducedMotion: 'on',
      toastPosition: 'top-right',
      aiVideoSummaryMode: 'expanded',
      videoDescriptionMode: 'hide',
      secColor: 'Green',
    }
    await expect.poll(() => {
      const saved = latestSettings(readDatastore(app.userDataDir, 'settings'))
      return Object.fromEntries(Object.keys(expected).map(id => [id, saved[id]]))
    }).toEqual(expected)

    ;({ page } = await app.relaunch())
    await page.locator('.profileTrigger').click()
    const reopened = page.getByRole('dialog', { name: 'Quick settings' })
    await expect(reopened.locator('[data-setting-id="loopShorts"]').getByRole('checkbox')).toBeDisabled()
    await expect(reopened.locator('[data-setting-id="hideSubscriptionsLive"]').getByRole('checkbox')).toBeChecked()
    await expect(reopened.locator('[data-setting-id="toastPosition"]').getByRole('combobox')).toContainText('Top right')
    await expect(reopened.locator('[data-setting-id="secColor"]').getByRole('combobox')).toContainText('Green')
  })

  test('hides the parental control while a settings password locks Settings', async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('updateQuickSettings', ['showFamilyFriendlyOnly', 'hideVideoViews']))
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    await expect(menu.locator('[data-setting-id="showFamilyFriendlyOnly"]')).toBeVisible()
    await page.evaluate(() => window.$store.dispatch('updateSettingsPassword', 'secret'))
    await expect(menu.locator('[data-setting-id="showFamilyFriendlyOnly"]')).toHaveCount(0)
    await expect(menu.locator('[data-setting-id="hideVideoViews"]')).toBeVisible()
    await page.evaluate(() => window.$store.dispatch('updateSettingsPassword', ''))
    await expect(menu.locator('[data-setting-id="showFamilyFriendlyOnly"]')).toBeVisible()
  })
})

test.describe('quick thumbnail blur', () => {
  test.use({ seed: { settings: { quickSettings: ['blurThumbnails'] } } })

  test('reflects the quick toggle and reset in the full thumbnail selector', async ({ page }) => {
    for (const preference of ['blur', 'middle']) {
      const appearance = await goToSettingsSection(page, 'appearance')
      const select = appearance.locator('.select').filter({
        has: page.getByRole('combobox', { name: 'Thumbnail Preference' })
      }).locator('select')
      await select.selectOption(preference)
      await expect(select).toHaveValue(preference)
      await page.locator('.settingsCloseButton').click()
      await page.locator('.profileTrigger').click()
      const menu = page.getByRole('dialog', { name: 'Quick settings' })
      const toggle = menu.getByRole('checkbox', { name: 'Blur thumbnails' })
      const label = menu.locator('label.switch-label')

      if (preference === 'middle') {
        await label.click()
        await expect(toggle).toBeChecked()
      }
      await label.click()
      await expect(toggle).not.toBeChecked()
      await label.click()
      await expect(toggle).toBeChecked()
      await menu.getByRole('button', { name: 'Reset this setting to its default' }).click()
      await expect(toggle).not.toBeChecked()

      await menu.getByRole('button', { name: 'All Settings' }).click()
      const reopened = await goToSettingsSection(page, 'appearance')
      const reopenedSelect = reopened.locator('.select').filter({
        has: page.getByRole('combobox', { name: 'Thumbnail Preference' })
      }).locator('select')
      await expect(reopenedSelect).toHaveValue(preference === 'blur' ? '' : preference)
    }
  })
})

test.describe('quick settings menu', () => {
  test.use({ seed: { settings: { quickSettings: ALL_QUICK_SETTINGS } } })

  test('hands focus from the phone sheet to the command palette', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.locator('.profileTrigger').click()
    const sheet = page.locator('.mobileSheet[open]')
    await sheet.getByRole('button', { name: 'Open command palette' }).click()
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(palette.locator('input')).toBeFocused()
  })

  test('cancels a pending phone command palette when another action runs', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.locator('.profileTrigger').click()
    await page.locator('.mobileSheet[open]').evaluate(sheet => {
      sheet.querySelector('.commandPaletteShortcut').click()
      sheet.querySelector('.allSettingsShortcut').click()
    })
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
  })

  test('clears the open state when leaving the phone layout', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 800 })
    const trigger = page.locator('.profileTrigger')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await setWindowSize(app, page, { width: 1000, height: 700 })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(page.getByRole('dialog', { name: 'Quick settings' })).toBeVisible()
  })

  test('stays inside a short viewport below horizontal tabs', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1280, height: 720 })
    })
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(720)

    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const tabBar = page.locator('.tabBar:not(.vertical)')
    await expect(menu).toBeVisible()
    await expect(tabBar).toBeVisible()

    const [menuBounds, tabBarBounds] = await Promise.all([
      menu.evaluate(element => element.getBoundingClientRect().toJSON()),
      tabBar.evaluate(element => element.getBoundingClientRect().toJSON())
    ])
    expect(menuBounds.top).toBeGreaterThanOrEqual(tabBarBounds.bottom)
    expect(menuBounds.bottom).toBeLessThanOrEqual(720)
  })

  test('keeps its full phone width when route cards lose their gutters', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 375, height: 700 })
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(375)
    await page.locator('.app').evaluate((element) => {
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    })

    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toBeVisible()

    const bounds = await menu.evaluate(element => element.getBoundingClientRect().toJSON())
    expect(bounds.width).toBeGreaterThan(300)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(375)
  })

  test('hides the unavailable main color selector', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 420 })
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const appearance = menu.locator('.menuSection').first()
    const scrollViewport = menu.locator('.quickSettingsScroll')
    await scrollViewport.evaluate(element => element.scrollTo(0, element.scrollHeight))

    const baseTheme = appearance.getByRole('combobox', { name: 'Base Theme' })
    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateBaseTheme', 'hotPink')
    })

    await expect(menu).toBeVisible()
    await expect(baseTheme).toBeVisible()
    await expect(appearance.getByRole('combobox', { name: 'Main Color Theme' })).toHaveCount(0)
    const [sectionWidth, controlWidth] = await Promise.all([
      appearance.evaluate(element => element.clientWidth),
      appearance.locator('[data-setting-id="baseTheme"]').evaluate(element => element.clientWidth),
    ])
    expect(controlWidth).toBeGreaterThan(sectionWidth * 0.8)
    await expect.poll(() => scrollViewport.evaluate(element => {
      const content = element.querySelector('.quickSettingsContent')
      return element.scrollTop <= Math.max(0, content.offsetTop + content.offsetHeight - element.clientHeight) + 1
    })).toBe(true)
  })

  test('keeps view headers outside their scrollports and resets switched views', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 420 })
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const mainScroll = menu.locator('.quickSettingsScroll')

    await expect(mainScroll.locator('.profileHeaderRow')).toHaveCount(0)
    await mainScroll.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await menu.locator('.profileSummary').click()

    await expect(menu.locator('.quickSettingsScroll').locator('.profilePanelHeader')).toHaveCount(0)
    await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Back' }).click()
    await expect(menu.locator('.profileHeaderRow')).toBeVisible()
    await expect(mainScroll).toHaveJSProperty('scrollTop', 0)
  })

  test('opens About and switches to Settings from the quick menu', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 12,
        y: 12,
        width: 400,
        height: 600
      }))
    })
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()

    const aboutWindow = page.getByRole('dialog', { name: 'About' })
    await expect(aboutWindow).toBeVisible()
    await expect(aboutWindow.locator('.settingsBreadcrumb')).toContainText('About')
    await expect(aboutWindow.locator('.settingsMenu')).toHaveCount(0)
    await expect(aboutWindow.locator('.settingsBackButton')).toHaveCount(0)

    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'All Settings' }).click()

    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settingsWindow).toBeVisible()
    await expect(settingsWindow.locator('.settingsMenu')).toBeVisible()
  })
})

test.describe('customizable quick settings', () => {
  test.describe('block lists', () => {
    const channelsHidden = JSON.stringify([{ name: 'UCaaaaaaaaaaaaaaaaaaaaaa', preferredName: 'Example channel', icon: 'data:image/svg+xml;base64,PHN2Zy8+' }])
    const forbiddenTitles = JSON.stringify(['spoiler'])
    test.use({ seed: { settings: { channelsHidden, forbiddenTitles, quickSettings: ['enableBlockLists'] } } })

    test('toggles both lists without removing their entries and persists the choice', async ({ app, page }) => {
      await page.locator('.profileTrigger').click()
      const menu = page.getByRole('dialog', { name: 'Quick settings' })
      const toggle = menu.getByRole('checkbox', { name: 'Enable block lists' })
      await expect(toggle).toBeChecked()
      await menu.locator('label.switch-label').filter({ hasText: 'Enable block lists' }).click()
      await expect(toggle).not.toBeChecked()

      await expect.poll(() => page.evaluate(() => {
        const getters = window.$store.getters
        return [getters.getActiveChannelsHiddenNames.size, getters.getActiveForbiddenTitles.length]
      })).toEqual([0, 0])

      await menu.getByRole('button', { name: 'All Settings' }).click()
      const distraction = await goToSettingsSection(page, 'distraction')
      await expect(distraction.getByRole('checkbox', { name: 'Enable block lists' })).not.toBeChecked()
      await expect(distraction.getByText('Example channel')).toBeVisible()
      await expect(distraction.getByText('spoiler')).toBeVisible()

      await expect.poll(async () => {
        const saved = latestSettings(readDatastore(app.userDataDir, 'settings'))
        return [saved.enableBlockLists, saved.channelsHidden, saved.forbiddenTitles]
      }).toEqual([false, channelsHidden, forbiddenTitles])

      ;({ page } = await app.relaunch())
      await page.locator('.profileTrigger').click()
      const reopenedToggle = page.getByRole('dialog', { name: 'Quick settings' }).getByRole('checkbox', { name: 'Enable block lists' })
      await expect(reopenedToggle).not.toBeChecked()
      await page.getByRole('dialog', { name: 'Quick settings' }).locator('label.switch-label').filter({ hasText: 'Enable block lists' }).click()
      await expect.poll(() => page.evaluate(() => {
        const getters = window.$store.getters
        return [getters.getActiveChannelsHiddenNames.size, getters.getActiveForbiddenTitles.length]
      })).toEqual([1, 1])
    })
  })

  test('adds basic controls from Appearance and resets them', async ({ app, page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const launcher = appearance.locator('.customizerLauncher')
    await expect(launcher.getByRole('button')).toHaveCount(1)
    await expect(launcher.getByRole('button', { name: 'Customize interface', exact: true })).toBeVisible()
    await openInterfaceCustomizer(page, 'quick settings')
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Customize interface')

    const selectedSettings = page.locator('.selectedSettings')
    await expect(selectedSettings.locator('.selectedSetting')).toHaveCount(DEFAULT_QUICK_SETTINGS.length)
    await expect(selectedSettings.locator('.selectedSetting .selectedSettingIcon')).toHaveCount(DEFAULT_QUICK_SETTINGS.length)
    await expect.poll(() => selectedSettings.locator('.selectedSetting').evaluateAll(rows => (
      rows.map(row => row.dataset.settingId)
    ))).toEqual(DEFAULT_QUICK_SETTINGS)
    const actions = page.locator('.quickSettingsActions')
    const [subpageBounds, actionsBounds, settingsBounds, actionButtonBounds] = await Promise.all([
      page.locator('.customizerEditor').boundingBox(),
      actions.boundingBox(),
      selectedSettings.boundingBox(),
      actions.getByRole('button').evaluateAll(buttons => buttons.map(button => (
        button.getBoundingClientRect().toJSON()
      ))),
    ])
    const subpageCenter = subpageBounds.x + subpageBounds.width / 2
    expect(Math.abs(actionsBounds.x + actionsBounds.width / 2 - subpageCenter)).toBeLessThanOrEqual(1)
    expect(Math.abs(settingsBounds.x + settingsBounds.width / 2 - subpageCenter)).toBeLessThanOrEqual(1)
    const actionGroupCenter = (
      actionButtonBounds[0].x + actionButtonBounds.at(-1).x + actionButtonBounds.at(-1).width
    ) / 2
    expect(Math.abs(actionGroupCenter - subpageCenter)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Remove Hide Comments' }).click()
    await expect(selectedSettings).not.toContainText('Hide Comments')

    await page.getByRole('button', { name: 'Add setting' }).click()
    const settingPicker = page.getByLabel('Search settings')
    const settingPopover = page.getByRole('dialog', { name: 'Add setting' })
    await expect(settingPopover).toBeVisible()
    await expect(settingPopover).toHaveCSS('position', 'absolute')
    await expect(settingPicker).toHaveAttribute('type', 'search')
    await expect(settingPicker).toHaveAttribute('placeholder', 'Search settings')
    await expect(settingPopover.locator('.selectLabel')).toHaveCount(0)
    await expect(settingPopover.locator('.clearInputTextButton')).toHaveCount(0)
    await expect(page.locator('.settingPicker .optionWrapper').first()).toHaveCSS('cursor', 'pointer')
    await expect(page.locator('.settingPicker .optionWrapper').first()).toHaveCSS('user-select', 'none')
    await expect(selectedSettings.locator('.selectedSetting').first()).toHaveCSS('user-select', 'none')
    for (const setting of ['Icon Pack', 'UI Roundness', 'Enable Tor / Proxy']) {
      await settingPicker.fill(setting)
      await page.locator('.settingPicker .optionWrapper').filter({ hasText: setting }).click()
    }
    await settingPicker.press('Escape')
    await expect(settingPopover).toBeHidden()
    await expect(page.getByRole('button', { name: 'Add setting' })).toBeFocused()
    await page.locator('.settingsCloseButton').click()

    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const iconPack = menu.getByRole('combobox', { name: 'Icon Pack' })
    await expect(menu.locator('.menuSection').getByRole('heading', { name: 'Appearance', exact: true })).toHaveCount(1)
    await expect(iconPack).toBeVisible()
    await expect(menu.getByRole('slider', { name: 'UI Roundness' })).toBeVisible()
    await expect(menu.getByRole('checkbox', { name: 'Hide Comments' })).toHaveCount(0)
    await iconPack.click()
    await page.getByRole('option', { name: 'Remix Icon' }).click()
    await expect(iconPack).toContainText('Remix Icon')
    await menu.locator('label.switch-label').filter({ hasText: 'Enable Tor / Proxy' }).click()
    await expect.poll(() => app.electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].webContents.session.resolveProxy('https://example.com')
    })).toContain('127.0.0.1:9050')

    await menu.getByRole('button', { name: 'All Settings' }).click()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Customize interface')
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect(page.locator('.selectedSetting')).toHaveCount(DEFAULT_QUICK_SETTINGS.length)
    await expect(page.locator('.selectedSettings')).toContainText(/Base theme/i)
    await expect(page.locator('.selectedSettings')).not.toContainText('Icon Pack')
  })

  test('rearranges categories together and controls within their category', async ({ page, attachScreenshot }) => {
    await page.evaluate(quickSettings => window.$store.dispatch('updateQuickSettings', quickSettings), FORMER_DEFAULT_QUICK_SETTINGS)
    await openInterfaceCustomizer(page, 'quick settings')

    const selectedSettings = page.locator('.selectedSettings')
    const settingIds = () => selectedSettings.locator('.selectedSetting').evaluateAll(rows => (
      rows.map(row => row.dataset.settingId)
    ))
    await expect(page.getByRole('button', { name: 'Move Base Theme up' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Region for Trending down' })).toBeDisabled()

    await page.getByRole('button', { name: 'Move Hide Comments up' }).click()
    const hideCommentsMovedUp = [...FORMER_DEFAULT_QUICK_SETTINGS]
    const hideCommentsIndex = hideCommentsMovedUp.indexOf('hideComments')
    hideCommentsMovedUp.splice(hideCommentsIndex, 1)
    hideCommentsMovedUp.splice(hideCommentsIndex - 1, 0, 'hideComments')
    await expect.poll(settingIds).toEqual(hideCommentsMovedUp)

    await expect(page.getByRole('button', { name: 'Move Default Quality up' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Thumbnail Size down' })).toBeDisabled()
    await expect(selectedSettings.locator('h3')).toHaveText(['Appearance', 'Playback', 'Content', 'Language and region'])
    await page.getByRole('button', { name: 'Move Playback up', exact: true }).click()
    await expect.poll(settingIds).toEqual([
      ...hideCommentsMovedUp.slice(4, 7), ...hideCommentsMovedUp.slice(0, 4), ...hideCommentsMovedUp.slice(7),
    ])

    const content = selectedSettings.locator('[data-section-id="content"]')
    const playback = selectedSettings.locator('[data-section-id="playback"]')
    // Keep both categories inside the editor viewport below the preview.
    await playback.evaluate(element => element.scrollIntoView({ block: 'start' }))
    const handleBounds = await content.locator('.dragHandle').first().boundingBox()
    const contentBounds = await content.boundingBox()
    const playbackBounds = await playback.boundingBox()
    const x = handleBounds.x + handleBounds.width / 2
    const y = handleBounds.y + handleBounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + playbackBounds.y + playbackBounds.height / 2 - contentBounds.y - contentBounds.height / 2 - 8, { steps: 12 })
    await page.mouse.up()
    const contentFirst = [
      ...hideCommentsMovedUp.slice(7, 11),
      ...hideCommentsMovedUp.slice(4, 7),
      ...hideCommentsMovedUp.slice(0, 4),
      ...hideCommentsMovedUp.slice(11),
    ]
    await expect.poll(settingIds).toEqual(contentFirst)
    await attachScreenshot('grouped-quick-settings-editor')

    await page.locator('.settingsCloseButton').click()
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    await expect.poll(() => menu.locator('.quickSettingControl').evaluateAll(controls => (
      controls.map(control => control.dataset.settingId)
    ))).toEqual(contentFirst)

    await menu.getByRole('button', { name: 'All Settings' }).click()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Customize interface')
    await expect(selectedSettings).toBeVisible()
    await expect.poll(settingIds).toEqual(contentFirst)
  })
})

test.describe('grouped quick settings at narrow fractional scale', () => {
  test.use({
    seed: {
      settings: {
        uiScale: 125,
        quickSettings: ['baseTheme', 'defaultQuality', 'mainColor', 'playNextVideo', 'hideComments'],
      }
    }
  })

  test('groups saved categories and moves whole groups with touch and keyboard', async ({ app, page, attachScreenshot }) => {
    await setWindowSize(app, page, { width: 500, height: 850 })
    await openInterfaceCustomizer(page, 'quick settings')
    const sections = page.locator('.selectedSection')
    const ids = () => sections.evaluateAll(rows => rows.map(row => row.dataset.sectionId))
    await expect.poll(ids).toEqual(['appearance', 'playback', 'content'])
    await expect(page.locator('[data-section-id="appearance"] .selectedSetting')).toHaveCount(2)
    const movePlayback = page.getByRole('button', { name: 'Move Playback up', exact: true })
    await movePlayback.focus()
    await movePlayback.press('Enter')
    await expect.poll(ids).toEqual(['playback', 'appearance', 'content'])

    const playback = page.locator('[data-section-id="playback"]')
    const appearanceSection = page.locator('[data-section-id="appearance"]')
    const handle = playback.locator('.dragHandle').first()
    // The editor scrolls below the preview; start from the visible category.
    await playback.scrollIntoViewIfNeeded()
    const target = await appearanceSection.boundingBox()
    const source = await handle.boundingBox()
    const sourceRow = await playback.boundingBox()
    const dropY = source.y + source.height / 2 + target.y + target.height - sourceRow.y - sourceRow.height
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: source.x + source.width / 2, y: source.y + source.height / 2 }],
    })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: source.x + source.width / 2, y: dropY }],
    })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
    await expect.poll(ids).toEqual(['appearance', 'playback', 'content'])
    const viewportWidth = await page.evaluate(() => innerWidth)
    for (const bounds of await sections.evaluateAll(rows => rows.map(row => row.getBoundingClientRect().toJSON()))) {
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(viewportWidth)
    }
    await attachScreenshot('grouped-quick-settings-narrow')
    await expect.poll(async () => latestSettings(readDatastore(app.userDataDir, 'settings')).quickSettings)
      .toEqual(['baseTheme', 'mainColor', 'defaultQuality', 'playNextVideo', 'hideComments'])
    ;({ page } = await app.relaunch())
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    await expect(menu.locator('.menuSection h3')).toHaveText(['Appearance', 'Playback', 'Content'])
  })
})

test.describe('quick settings customization at fractional UI scale', () => {
  test.use({ seed: { settings: { uiScale: 125 } } })

  test('keeps the searchable setting list usable when filtering shortens it', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 900, height: 650 })
    })
    await openInterfaceCustomizer(page, 'quick settings')
    await page.getByRole('button', { name: 'Add setting' }).click()

    const settingPicker = page.getByLabel('Search settings')
    const settingPopover = page.getByRole('dialog', { name: 'Add setting' })
    const options = page.locator('.settingPicker .list')
    const scrollbar = options.locator('.os-scrollbar-vertical')
    await expect(options).toBeVisible()
    await expect(settingPicker).toHaveCSS('padding-inline-start', '16px')
    await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
    await options.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => options.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(async () => {
      const [popoverBounds, scrollbarBounds] = await Promise.all([
        settingPopover.evaluate(element => element.getBoundingClientRect().toJSON()),
        scrollbar.evaluate(element => element.querySelector('.os-scrollbar-track').getBoundingClientRect().toJSON()),
      ])
      expect(scrollbarBounds.x).toBeGreaterThanOrEqual(popoverBounds.x - 1)
      expect(scrollbarBounds.y).toBeGreaterThanOrEqual(popoverBounds.y - 1)
      expect(scrollbarBounds.x + scrollbarBounds.width).toBeLessThanOrEqual(
        popoverBounds.x + popoverBounds.width + 1
      )
      expect(scrollbarBounds.y + scrollbarBounds.height).toBeLessThanOrEqual(
        popoverBounds.y + popoverBounds.height + 1
      )
    }).toPass({ timeout: 15_000 })
    const hoveredOption = options.locator('li').nth(1)
    await hoveredOption.hover()
    const [hoveredOptionBounds, scrollbarTrackBounds] = await Promise.all([
      hoveredOption.evaluate(element => element.getBoundingClientRect().toJSON()),
      scrollbar.evaluate(element => element.querySelector('.os-scrollbar-track').getBoundingClientRect().toJSON()),
    ])
    expect(hoveredOptionBounds.x + hoveredOptionBounds.width).toBeLessThanOrEqual(
      scrollbarTrackBounds.x + 1
    )

    await settingPicker.fill('Icon Pack')
    await expect(options.locator('li')).toHaveCount(1)
    await expect(options).toHaveJSProperty('scrollTop', 0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })
})

test.describe('quick distraction settings', () => {
  test.use({ seed: { settings: { playNextVideo: true } } })

  test('turns off autoplay when recommended videos are hidden', async ({ page }) => {
    await page.locator('.profileTrigger').click()

    const autoplay = page.getByRole('checkbox', { name: 'Autoplay Recommended Videos' })
    await expect(autoplay).toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: 'Hide Recommended Videos' }).click()

    await expect(autoplay).not.toBeChecked()
    await expect(autoplay).toBeDisabled()
  })
})

test.describe('quick settings focus during a pending update', () => {
  test.use({ seed: { settings: { quickSettings: ['thumbnailSize', 'playlistThumbnailSize'] } } })

  test('keeps focus on a control chosen while another control saves', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const globalSlider = page.locator('.thumbnailSizeSlider input')
    const playlistSlider = page.locator('.playlistThumbnailSizeSlider input')
    await expect(playlistSlider).toBeVisible()
    await page.evaluate(() => {
      const store = window.$store
      const dispatch = store.dispatch
      store.dispatch = (type, payload) => {
        if (type !== 'updateThumbnailSize') return dispatch(type, payload)
        return new Promise(resolve => {
          window.releaseThumbnailSizeUpdate = () => {
            const update = dispatch(type, payload)
            resolve(update)
            return update
          }
        })
      }
    })

    await globalSlider.press('Home')
    await expect.poll(() => page.evaluate(() => typeof window.releaseThumbnailSizeUpdate)).toBe('function')
    await playlistSlider.focus()
    await page.evaluate(async () => {
      await window.releaseThumbnailSizeUpdate()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })

    await expect(playlistSlider).toBeFocused()
    await page.keyboard.press('End')
    await expect(playlistSlider).toHaveValue('180')
    await expect(globalSlider).toHaveValue('60')
  })
})
