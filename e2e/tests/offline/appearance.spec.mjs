import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, goToSettingsSection, sel } from '../../helpers/app.mjs'

async function readSavedThemes (userDataDir) {
  const themeDirectory = path.join(userDataDir, 'themes')
  const files = (await readdir(themeDirectory)).filter(file => file.endsWith('.json'))
  const themes = await Promise.all(files.map(async file =>
    JSON.parse(await readFile(path.join(themeDirectory, file), 'utf8'))))
  return themes.sort((left, right) => left.name.localeCompare(right.name))
}

async function setWindowWidth (app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

async function enableVerticalTabBar (page, width) {
  await page.evaluate((tabBarWidth) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setUseVerticalTabBar', true)
    store.commit('setVerticalTabBarWidth', tabBarWidth)
  }, width)
  await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
}

async function expectAdjacent (left, right) {
  const [leftBox, rightBox] = await Promise.all([
    left.boundingBox(),
    right.boundingBox()
  ])

  expect(leftBox).not.toBeNull()
  expect(rightBox).not.toBeNull()
  expect(Math.abs(leftBox.y - rightBox.y)).toBeLessThan(1)
  expect(rightBox.x - leftBox.x - leftBox.width).toBeGreaterThanOrEqual(0)
  expect(rightBox.x - leftBox.x - leftBox.width).toBeLessThanOrEqual(12)
}

test.describe('distraction and appearance settings', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        hideEndScreenAnnotations: true,
        hideTrendingVideos: true
      }
    }
  })

  test('hidden UI elements stay hidden and the theme applies', async ({ page, attachScreenshot }) => {
    // Trending is removed from the side nav entirely.
    await expect(page.locator(sel.sideNavLink('trending'))).toHaveCount(0)

    // Profile switching and quick settings always remain available in the header.
    await expect(page.locator('.topNav .profileTrigger')).toBeVisible()

    // The base theme is applied as a class on <body>.
    await expect(page.locator('body')).toHaveClass(/dark/)

    await attachScreenshot('dark theme with the hidden elements')

    await goToSettingsSection(page, 'distraction')
    await expect(page.getByRole('checkbox', { name: 'Hide End-Screen Annotations' })).toBeChecked()
    await attachScreenshot('distraction settings')
  })
})

test.describe('default appearance', () => {
  test('trending link and profile selector are visible by default', async ({ page, attachScreenshot }) => {
    // The link may live in the side nav itself or its "More" flyout,
    // depending on the collapsed state — either way it must exist.
    await expect(page.locator(sel.sideNavLink('trending'))).not.toHaveCount(0)
    await expect(page.locator('.topNav .profileTrigger')).toBeVisible()
    await expect(page.locator('body')).toHaveClass(/(?:light|dark)/)
    await attachScreenshot('default appearance')
  })

  test('maps system light and dark modes to chosen themes', async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await goToSettingsSection(page, 'theme')

    const lightTheme = page.getByRole('combobox', { name: 'Light theme' })
    const darkTheme = page.getByRole('combobox', { name: 'Dark theme' })
    const mainColorTheme = page.getByRole('combobox', { name: /Main colou?r theme/i })
    const secondaryColorTheme = page.getByRole('combobox', { name: /Secondary colou?r theme/i })
    await expect(lightTheme).toHaveText('Light')
    await expect(darkTheme).toHaveText('Dark')
    await expectAdjacent(lightTheme, darkTheme)
    await expectAdjacent(mainColorTheme, secondaryColorTheme)
    await expect(page.locator('.select').filter({ has: lightTheme }).locator('.select-icon')).toBeVisible()
    await expect(page.locator('.select').filter({ has: darkTheme }).locator('.select-icon')).toBeVisible()

    await lightTheme.click()
    await page.locator(`#${await lightTheme.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Catppuccin Frappe', exact: true }).click()
    await expect(page.locator('body')).toHaveClass(/catppuccinFrappe/)

    await darkTheme.click()
    await page.locator(`#${await darkTheme.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Catppuccin Mocha', exact: true }).click()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/catppuccinMocha/)

    ;({ page } = await app.relaunch())
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/catppuccinMocha/)
  })
})

test.describe('custom theme editor', () => {
  test.use({ seed: { settings: { baseTheme: 'dark' } } })

  test('copies built-in themes, previews efficiently, persists, and survives closing settings', async ({ app, page }) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Highlight settings changed from defaults' }).click()
    await page.getByRole('button', { name: 'Create custom theme' }).click()

    const creatorBreadcrumb = page.locator('.settingsBreadcrumbLabel')
      .filter({ hasText: 'Custom theme creator' })
    await expect(creatorBreadcrumb.locator('.settingsBreadcrumbSubpageIcon'))
      .toHaveAttribute('data-icon', 'palette')
    await expect(page.getByRole('searchbox', { name: 'Search settings' })).toHaveCount(0)

    const editor = page.locator('.customThemeEditor')
    await expect(editor.getByRole('button', { name: 'Reset colors' }).locator('svg, .ft-icon')).toBeVisible()
    await editor.getByRole('textbox', { name: 'Theme name' }).fill('Midnight')
    const optionsRow = editor.locator('.themeSources')
    const [editorBox, colorGridBox] = await Promise.all([
      editor.boundingBox(),
      editor.locator('.colorGrid').boundingBox()
    ])
    expect(colorGridBox.y - editorBox.y).toBeLessThan(200)
    await expect(optionsRow.getByRole('checkbox', { name: 'Dark theme' })).toBeVisible()
    await expect(optionsRow.getByRole('combobox', { name: 'Based on' })).toBeVisible()
    const sourceMainColor = optionsRow.getByRole('combobox', { name: /Main colou?r theme/i })
    const sourceSecondaryColor = optionsRow.getByRole('combobox', { name: /Secondary colou?r theme/i })
    await expect(sourceMainColor).toHaveText('Red')
    await expect(sourceSecondaryColor).toHaveText('Blue')
    await expect(editor.locator('.changedSettingIndicatorPlaceholder')).toHaveCount(0)
    const optionControlCenters = await optionsRow.evaluate((options) => {
      const select = options.querySelector('.select-text').getBoundingClientRect()
      const toggle = options.querySelector('.switch-label').getBoundingClientRect()
      return {
        select: select.y + select.height / 2,
        toggle: toggle.y + toggle.height / 2
      }
    })
    expect(optionControlCenters.toggle).toBeCloseTo(optionControlCenters.select, 0)

    await sourceMainColor.click()
    await page.locator(`#${await sourceMainColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Green', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--primary-color', '#4caf50')
    await sourceSecondaryColor.click()
    await page.locator(`#${await sourceSecondaryColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Purple', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--accent-color', '#9c27b0')

    const basedOn = page.getByRole('combobox', { name: 'Based on' })

    const setEditorColor = async (label, value) => {
      const field = editor.locator('.colorField').filter({ has: page.getByText(label, { exact: true }) })
      await field.locator('input[type="color"]').evaluate((input, color) => {
        input.value = color
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, value)
    }

    await setEditorColor('Logo icon', '#123456')
    await setEditorColor('Logo text', '#654321')
    await setEditorColor('Background', '#101112')
    await sourceMainColor.click()
    await page.locator(`#${await sourceMainColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Orange', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--primary-color', '#ff9800')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#101112')
    await expect(editor.locator('.colorField').filter({ hasText: 'Logo icon' }).locator('input'))
      .toHaveValue('#123456')
    await sourceSecondaryColor.click()
    await page.locator(`#${await sourceSecondaryColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Teal', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--accent-color', '#009688')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#101112')
    await expect(editor.locator('.colorField').filter({ hasText: 'Logo text' }).locator('input'))
      .toHaveValue('#654321')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setBarColor', true)
    })
    await expect(page.locator('.topNav')).toHaveClass(/topNavBarColor/)
    await page.mouse.move(0, 0)
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-color', 'rgb(101, 67, 33)')
    await setEditorColor('Logo hover', '#abcdef')
    await page.locator('.topNav .logo').hover()
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-color', 'rgb(171, 205, 239)')

    await setEditorColor('Scrollbar hover', '#345678')
    await expect(page.locator('.os-scrollbar').first()).toHaveCSS('--os-handle-bg-hover', '#345678')

    await setEditorColor('Dropdown hover text', '#fedcba')
    await basedOn.click()
    await expect(page.getByRole('option', { name: 'System Default' })).toHaveCount(0)
    await page.getByRole('option', { name: 'Dark', exact: true }).hover()
    await expect(page.getByRole('option', { name: 'Dark', exact: true })).toHaveCSS('color', 'rgb(254, 220, 186)')
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#f1f1f1')
    await basedOn.click()
    await page.locator(`#${await basedOn.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Dark', exact: true }).click()

    const backgroundField = page.locator('.colorField')
      .filter({ has: page.getByText('Background', { exact: true }) })
    const backgroundInput = backgroundField.locator('input[type="color"]')
    await expect(backgroundInput).toHaveValue('#212121')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#212121')

    const dragState = await backgroundInput.evaluate((input) => {
      const code = input.parentElement.querySelector('code')
      const before = {
        preview: document.body.style.getPropertyValue('--bg-color'),
        label: code.textContent
      }
      input.value = '#334455'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.value = '#445566'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return {
        before,
        immediatePreview: document.body.style.getPropertyValue('--bg-color'),
        immediateLabel: code.textContent
      }
    })
    // Native drag events only queue the latest preview. They must not trigger a
    // Vue render or a whole-app style update for every pointer movement.
    expect(dragState.immediatePreview).toBe(dragState.before.preview)
    expect(dragState.immediateLabel).toBe(dragState.before.label)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')

    await backgroundInput.evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })))
    await expect(backgroundField.locator('code')).toHaveText('#445566')

    const darkTheme = page.getByRole('checkbox', { name: 'Dark theme' })
    await expect(darkTheme).toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: 'Dark theme' }).click()
    await expect(page.locator('body')).toHaveAttribute('data-custom-theme', 'light')

    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect.poll(async () => {
      const themes = await readSavedThemes(app.userDataDir)
      const theme = themes.find(({ name }) => name === 'Midnight')
      return {
        count: themes.length,
        background: theme?.colors.background,
        basedOn: theme?.basedOn,
        mainColor: theme?.mainColor,
        secondaryColor: theme?.secondaryColor,
        isDark: theme?.isDark
      }
    }).toEqual({
      count: 1,
      background: '#445566',
      basedOn: 'dark',
      mainColor: 'Orange',
      secondaryColor: 'Teal',
      isDark: false
    })
    await expect(editor).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit custom theme' }).click()

    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await page.locator('.topNav .profileTrigger').click()
    const quickAppearance = page.locator('.quickSettingsMenu .menuSection').filter({ hasText: 'Appearance' })
    await expect(quickAppearance.getByRole('combobox', { name: 'Base Theme' })).toBeDisabled()
    await expect(quickAppearance.getByRole('combobox', { name: /Main colou?r theme/i })).toBeDisabled()
    await expect(quickAppearance.getByRole('button', { name: 'Reset this setting to its default' })).toBeDisabled()
    await page.locator('.topNav .profileTrigger').click()
    await goTo(page, 'settings')
    await expect(page.getByText('Custom theme creator', { exact: true })).toBeVisible()
    await expect(backgroundInput).toHaveValue('#445566')

    await setEditorColor('Background', '#112233')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#112233')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(page.getByText('Custom theme creator', { exact: true })).toHaveCount(0)
    await expect(page.locator('.settingsKeyboardShortcutPage')).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')

    await page.locator('.settingsBackButton').click()
    await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: /Secondary colou?r theme/i })).toBeDisabled()

    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await expect(backgroundInput).toHaveValue('#445566')
    await expect(page.getByRole('combobox', { name: 'Based on' })).toHaveText('Dark')
    await expect(editor.getByRole('combobox', { name: /Main colou?r theme/i })).toHaveText('Orange')
    await expect(editor.getByRole('combobox', { name: /Secondary colou?r theme/i })).toHaveText('Teal')
    await editor.getByRole('textbox', { name: 'Theme name' }).fill('Paper')
    await page.getByRole('combobox', { name: 'Based on' }).click()
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect.poll(async () => {
      const themes = await readSavedThemes(app.userDataDir)
      return themes.map(({ name, basedOn }) => ({ name, basedOn }))
    }).toEqual([
      { name: 'Midnight', basedOn: 'dark' },
      { name: 'Paper', basedOn: 'light' }
    ])
    await expect(editor).toHaveCount(0)

    const baseThemeSelect = page.getByRole('combobox', { name: 'Base Theme' })
    await baseThemeSelect.click()
    await page.getByRole('option', { name: 'Midnight', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await expect(page.getByRole('combobox', { name: 'Based on' })).toHaveText('Dark')
    await expect(backgroundInput).toHaveValue('#445566')

    ;({ page } = await app.relaunch())
    await expect(page.locator('body')).toHaveClass(/custom/)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await expect(page.locator('body')).toHaveAttribute('data-custom-theme', 'light')

    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await page.getByRole('button', { name: 'Delete theme' }).click()
    const deletePrompt = page.getByRole('dialog', { name: /Delete “Midnight”/ })
    await expect(deletePrompt).toContainText('Delete “Midnight”?')
    await deletePrompt.getByRole('button', { name: 'Delete theme' }).click()
    await expect(page.getByText('Custom theme creator', { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await readSavedThemes(app.userDataDir)).map(({ name }) => name))
      .toEqual(['Paper'])
    await expect(page.locator('body')).toHaveClass(/dark/)
  })
})

test.describe('black theme surfaces', () => {
  test.use({ seed: { settings: { baseTheme: 'black' } } })

  test('keeps cards distinguishable from the page background', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('background-color', 'rgb(5, 5, 5)')
  })
})

test.describe('global progress presentation', () => {
  test('uses a persistent notification or the global bar based on the theme setting', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setProgressBarMessage', 'Downloading yt-dlp and ffmpeg')
      store.commit('setProgressBarIcon', ['fas', 'download'])
      store.commit('setProgressBarPercentage', 42)
      store.commit('setShowProgressBar', true)
    })

    const progressToast = page.getByTestId('progress-toast')
    await expect(progressToast).toContainText('Downloading yt-dlp and ffmpeg')
    await expect(progressToast.locator('.icon')).toHaveAttribute('data-icon', 'download')
    await expect(progressToast.locator('.progress-indicator')).toHaveAttribute('data-progress', '42')
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setShowProgressBarToast', false)
    })

    await expect(progressToast).toHaveCount(0)
    await expect(page.locator('.app > .progressBar')).toHaveCount(1)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setShowProgressBarToast', true)
    })
    await expect(progressToast).toBeVisible()

    // Fullscreen is for watching, so the progress notification steps aside
    await page.evaluate(() => document.querySelector('.app').requestFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await expect(progressToast).toHaveCount(0)
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)

    // Only the progress notification is suppressed: a regular toast still has
    // something to say that the fullscreen player can't tell the user itself
    await page.evaluate(() => window.ftElectron.showToastOnAllTabs('Copied to clipboard', 10000))
    await expect(page.locator('.toast', { hasText: 'Copied to clipboard' })).toBeVisible()

    await page.evaluate(() => document.exitFullscreen())
    await expect(progressToast).toBeVisible()
  })
})

test.describe('UI roundness', () => {
  test.use({ seed: { settings: { uiRoundness: 0 } } })

  test('applies to controls, cards, popovers, and modals', async ({ app, page, attachScreenshot }) => {
    await expect(page.locator('body')).toHaveCSS('--ui-roundness', '0')

    await goToSettingsSection(page, 'theme')
    const roundnessSlider = page.getByRole('slider', { name: /UI Roundness/ })
    const toggleSwitch = page.locator('label.switch-label').first()
    const toggleTrackRadius = () => toggleSwitch.evaluate((element) =>
      getComputedStyle(element, '::before').borderRadius)
    await expect(roundnessSlider).toHaveValue('0')
    expect(await toggleTrackRadius()).toBe('8px')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('border-radius', '0px')
    await expect(page.getByRole('button').first()).toHaveCSS('border-radius', '0px')

    await page.locator('.settingsMenu [data-section="data"]').click()
    await page.getByRole('button', { name: 'Export Subscriptions' }).click()
    await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '0px')
    await attachScreenshot('square modal at 0% roundness')

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await page.locator(sel.tabs).first().click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Context menu' })).toHaveCSS('border-radius', '0px')
    await attachScreenshot('square context menu at 0% roundness')

    await page.keyboard.press('Escape')
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await goToSettingsSection(page, 'theme')
    await roundnessSlider.fill('150')
    await expect(page.locator('body')).toHaveCSS('--ui-roundness', '1.5')
    expect(await toggleTrackRadius()).toBe('8px')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('border-radius', '12px')
    await attachScreenshot('settings at 150% roundness')

    ;({ page } = await app.relaunch())
    await goToSettingsSection(page, 'theme')
    await expect(page.getByRole('slider', { name: /UI Roundness/ })).toHaveValue('150')
  })
})

test.describe('rounded feed page headers', () => {
  test.use({
    seed: {
      settings: {
        uiRoundness: 200,
        backendPreference: 'invidious',
        backendFallback: true,
        fetchSubscriptionsAutomatically: false
      }
    }
  })

  test('preserves scaled card corners on feed pages', async ({ page, attachScreenshot }) => {
    const pages = [
      { route: 'subscriptions', header: '.subscriptionsHeader' },
      { route: 'trending', header: '.pageHeader' },
      { route: 'popular', header: '.pageHeader' }
    ]

    for (const { route, header } of pages) {
      await goTo(page, route)
      await expect(page.locator(header)).toHaveCSS('border-top-left-radius', '16px')
      await expect(page.locator(header)).toHaveCSS('border-top-right-radius', '16px')
      await attachScreenshot(`${route} header`)
    }
  })
})

test.describe('top nav beside the vertical tab bar', () => {
  test('search bar and profile selector stay clear of the tab column', async ({ app, page, attachScreenshot }) => {
    await enableVerticalTabBar(page, 220)

    // Wide enough viewport for the 3-column grid, but the top nav itself (beside
    // the 220px tab column) is not — the profile selector on the inline-end must
    // not overflow off the right edge (the grid must fall back to the flex row).
    await setWindowWidth(app, 1000)
    const profiles = page.locator('.topNav .profiles')
    await expect.poll(async () => {
      const [tabBarBox, profilesBox] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        profiles.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        profilesBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        profilesBox.x + profilesBox.width <= viewportWidth + 1
      )
    }).toBe(true)
    await attachScreenshot('top nav beside the vertical tab bar')

    // Mobile layout: the fixed search bar opens beside the tab column, not behind it.
    await setWindowWidth(app, 660)
    await page.locator('.topNav .navSearchButton').click()
    const searchContainer = page.locator('.topNav .searchContainer')
    await expect.poll(async () => {
      const [tabBarBox, searchBox] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        searchContainer.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        searchBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        searchBox.x + searchBox.width <= viewportWidth + 1
      )
    }).toBe(true)
    await attachScreenshot('mobile search bar beside the vertical tab bar')
  })
})

test.describe('tab orientation shortcut', () => {
  test('F1 switches between horizontal and vertical tabs', async ({ page, attachScreenshot }) => {
    const app = page.locator('.app')
    await expect(app).not.toHaveClass(/verticalTabs/)

    await page.keyboard.press('F1')
    await expect(app).toHaveClass(/verticalTabs/)
    await expect.poll(async () => {
      return page.locator('.tab.vertical.active').evaluate((tab) => {
        const tabEnd = tab.getBoundingClientRect().right
        const viewportEnd = tab.parentElement.getBoundingClientRect().right
        return viewportEnd - tabEnd
      })
    }).toBeGreaterThanOrEqual(1)
    await attachScreenshot('vertical tabs')

    await page.keyboard.press('F1')
    await expect(app).not.toHaveClass(/verticalTabs/)
    await attachScreenshot('horizontal tabs')
  })

  test('presses in quick succession are not swallowed by the pending write', async ({ app: appHandle, page }) => {
    const app = page.locator('.app')

    // The setting is only committed once persisted, so two presses that beat
    // the write have to queue up instead of both negating the same value —
    // otherwise they collapse into a single toggle and the layout flips.
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }))
      }
    })

    await expect.poll(async () => {
      const contents = await readFile(path.join(appHandle.userDataDir, 'settings.db'), 'utf8')
      return Object.fromEntries(contents.trim().split('\n')
        .map(line => JSON.parse(line))
        .map(record => [record._id, record.value]))
        .useVerticalTabBar
    }).toBe(false)
    await expect(app).not.toHaveClass(/verticalTabs/)
  })
})

test.describe('tab orientation shortcut rebound to a printable key', () => {
  test.use({
    seed: {
      settings: {
        keyboardShortcuts: JSON.stringify({ APP: { GENERAL: { TOGGLE_TAB_ORIENTATION: 'v' } } })
      }
    }
  })

  test('typing the key in the search bar does not toggle the layout', async ({ page }) => {
    const app = page.locator('.app')
    const searchInput = page.locator(sel.searchInput)

    await searchInput.click()
    await searchInput.type('vv')

    await expect(searchInput).toHaveValue('vv')
    await expect(app).not.toHaveClass(/verticalTabs/)

    // Outside a text field the rebound key still works.
    await page.locator('.app').click()
    await page.keyboard.press('v')
    await expect(app).toHaveClass(/verticalTabs/)
  })
})

test.describe('narrow layout top padding', () => {
  test('page content clears the fixed top nav and tab bar', async ({ app, page, attachScreenshot }) => {
    // On mobile widths the top nav is fixed and taller when a tab bar is
    // present; the page content must keep a gap below it instead of tucking
    // underneath (previously the content sat flush against the nav).
    await setWindowWidth(app, 560)
    const routerView = page.locator('.app > .routerView').first()
    await expect.poll(async () => {
      const [topNavBox, routerBox] = await Promise.all([
        page.locator('.topNav').boundingBox(),
        routerView.boundingBox()
      ])
      const gap = routerBox.y - (topNavBox.y + topNavBox.height)
      return gap >= 4 && gap <= 40
    }).toBe(true)
    await attachScreenshot('narrow layout')
  })
})
