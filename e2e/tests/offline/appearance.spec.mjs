import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { cloneDefaultCustomTheme } from '../../../src/customTheme.js'

import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  sel,
  readDatastore,
  latestSettings,
} from '../../helpers/app.mjs'

// Custom theme state colors are drawn opaque with relative color syntax, which
// computes to color(srgb ...), so compare the rendered sRGB channels.
function backgroundRgb(locator) {
  return locator.evaluate(element => {
    const context = document.createElement('canvas').getContext('2d')
    context.fillStyle = getComputedStyle(element).backgroundColor
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
    return alpha === 255 ? `rgb(${red}, ${green}, ${blue})` : `rgba(${red}, ${green}, ${blue}, ${alpha})`
  })
}

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
    const store = window.$store
    store.commit('setTabBarPosition', 'left')
    store.commit('setVerticalTabBarWidth', tabBarWidth)
  }, width)
  await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
}

async function expectHorizontalGap (left, right, expectedGap) {
  await expect.poll(async () => {
    const [leftBox, rightBox] = await Promise.all([
      left.locator('..').boundingBox(),
      right.locator('..').boundingBox()
    ])

    return leftBox !== null && rightBox !== null &&
      Math.abs(leftBox.y - rightBox.y) < 1 &&
      Math.abs(rightBox.x - leftBox.x - leftBox.width - expectedGap) <= 1
  }).toBe(true)
}

test.describe('default appearance', () => {
  test('maps system light and dark modes to chosen themes', async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await goToSettingsSection(page, 'theme')

    const lightTheme = page.getByRole('combobox', { name: 'Light theme' })
    const darkTheme = page.getByRole('combobox', { name: 'Dark theme' })
    const mainColorTheme = page.getByRole('combobox', { name: /Main colou?r theme/i })
    const secondaryColorTheme = page.getByRole('combobox', { name: /Secondary colou?r theme/i })
    await expect(lightTheme).toHaveText('Light')
    await expect(darkTheme).toHaveText('Dark')
    await expectHorizontalGap(lightTheme, darkTheme, 12)
    await expectHorizontalGap(mainColorTheme, secondaryColorTheme, 12)
    await page.getByRole('button', { name: 'Highlight settings changed from defaults' }).click()
    await expectHorizontalGap(lightTheme, darkTheme, 12)
    await expectHorizontalGap(mainColorTheme, secondaryColorTheme, 12)
    await expect(page.locator('.select').filter({ has: lightTheme }).locator('.select-icon')).toBeVisible()
    await expect(page.locator('.select').filter({ has: darkTheme }).locator('.select-icon')).toBeVisible()

    await lightTheme.click()
    const lightThemeOptions = page.locator(`#${await lightTheme.getAttribute('aria-controls')}`)
    await expect(lightThemeOptions.getByRole('option', { name: 'Catppuccin Frappe', exact: true }))
      .toHaveCount(0)
    await expect(lightThemeOptions.getByRole('option', { name: 'Catppuccin Latte', exact: true }))
      .toBeVisible()
    await lightThemeOptions.getByRole('option', { name: 'Catppuccin Latte', exact: true }).click()
    await expect(page.locator('body')).toHaveClass(/catppuccinLatte/)

    await darkTheme.click()
    const darkThemeOptions = page.locator(`#${await darkTheme.getAttribute('aria-controls')}`)
    await expect(darkThemeOptions.getByRole('option', { name: 'Catppuccin Latte', exact: true }))
      .toHaveCount(0)
    await expect(darkThemeOptions.getByRole('option', { name: 'Catppuccin Mocha', exact: true }))
      .toBeVisible()
    await darkThemeOptions.getByRole('option', { name: 'Catppuccin Mocha', exact: true }).click()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/catppuccinMocha/)

    ;({ page } = await app.relaunch())
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/catppuccinMocha/)
  })

  test('centers short phone pickers and dismisses them from the backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await goToSettingsSection(page, 'theme')
    const iconPack = page.getByRole('combobox', { name: 'Icon Pack' })
    await iconPack.click()

    const sheet = page.locator('.mobileSheet.compactSheet[open]')
    const options = sheet.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(options.filter({ has: page.locator('.optionRadio') })).toHaveCount(2)
    await expect(options.filter({ has: page.locator('.optionRadio') }).first()).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => sheet.evaluate(dialog => {
      const bounds = dialog.getBoundingClientRect()
      return bounds.width < innerWidth && bounds.height < innerHeight &&
        Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2) <= 1 &&
        Math.abs(bounds.y + bounds.height / 2 - innerHeight / 2) <= 1
    })).toBe(true)

    await page.mouse.click(5, 5)
    await expect(sheet).toHaveCount(0)
    await expect(iconPack).toHaveAttribute('aria-expanded', 'false')

    await iconPack.click()
    await sheet.getByRole('option', { name: 'Remix Icon' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(iconPack).toHaveText('Remix Icon')
  })

  test('fits and scrolls the app font picker in a narrow phone dialog', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 320 })
    await goToSettingsSection(page, 'theme')
    const appFont = page.getByRole('combobox', { name: 'App font' })
    await appFont.click()

    const fontDropdown = page.locator(`#${await appFont.getAttribute('aria-controls')}`)
    const sheet = page.locator('.mobileSheet[open]').filter({ has: fontDropdown })
    await expect(sheet).toHaveClass(/compactSheet/)
    await expect(fontDropdown).toHaveClass(/phonePicker/)
    await expect(fontDropdown).toBeFocused()
    await expect(fontDropdown).toHaveAttribute('data-overlayscrollbars-viewport')
    const scrollbar = fontDropdown.locator(':scope > .os-scrollbar-vertical')
    await expect.poll(() => fontDropdown.evaluate(menu => {
      const bounds = menu.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth &&
        bounds.top >= 0 && bounds.bottom <= innerHeight && menu.scrollWidth <= menu.clientWidth
    })).toBe(true)
    await expect.poll(() => fontDropdown.evaluate(menu => menu.scrollHeight - menu.clientHeight)).toBeGreaterThan(0)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await fontDropdown.evaluate(menu => { menu.scrollTop = menu.scrollHeight })
    await expect.poll(() => fontDropdown.evaluate(menu => menu.scrollTop)).toBeGreaterThan(0)
    await expect(fontDropdown.getByRole('option').last()).toBeInViewport()

    await sheet.getByRole('searchbox', { name: 'Search', exact: true }).fill('Geist')
    await expect(fontDropdown.getByRole('option')).toHaveCount(1)
    await expect.poll(() => fontDropdown.evaluate(menu =>
      menu.scrollTop <= 1 && menu.scrollHeight <= menu.clientHeight + 1
    )).toBe(true)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    await sheet.getByRole('searchbox', { name: 'Search', exact: true }).fill('')
    await expect.poll(() => fontDropdown.getByRole('option').count()).toBeGreaterThan(1)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await fontDropdown.evaluate(menu => { menu.scrollTop = menu.scrollHeight })

    await page.setViewportSize({ width: 600, height: 480 })
    await expect.poll(() => fontDropdown.evaluate(menu => {
      const lastOption = menu.querySelector('.selectOption:last-of-type').getBoundingClientRect()
      const padding = Number.parseFloat(getComputedStyle(menu).paddingBottom)
      return Math.abs(lastOption.bottom + padding - menu.getBoundingClientRect().bottom)
    })).toBeLessThanOrEqual(1)
    await expect.poll(() => scrollbar.evaluate(element => {
      const track = element.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const thumb = element.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      return Math.abs(track.bottom - thumb.bottom)
    })).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(appFont).toHaveAttribute('aria-expanded', 'false')
  })

  test('lists installed fonts and persists the selected app font', async ({ app, page }, testInfo) => {
    await goToSettingsSection(page, 'theme')

    const appFont = page.getByRole('combobox', { name: 'App font' })
    await expect(appFont).toHaveText('Geist')
    await expect(page.locator('.select').filter({ has: appFont }).locator('.select-icon')).toBeVisible()
    await appFont.click()

    const fontDropdown = page.locator(`#${await appFont.getAttribute('aria-controls')}`)
    const fontOptions = fontDropdown.getByRole('option')
    await expect.poll(() => fontOptions.count()).toBeGreaterThan(10)
    await expect(fontOptions.getByText('Roboto', { exact: true })).toHaveCount(1)
    await expect(fontOptions.nth(0)).toHaveText('Geist')
    await expect(fontOptions.nth(1)).toHaveText('Roboto')
    await expect(fontOptions.nth(9)).toHaveText('System default')
    const headings = fontDropdown.locator('.selectGroupHeading')
    await expect(headings).toHaveText(['Bundled fonts', 'System fonts'])
    await expect(fontOptions.first()).toHaveAccessibleDescription('Bundled fonts')
    await expect(fontOptions.nth(9)).toHaveAccessibleDescription('System fonts')
    await expect(headings.nth(1).locator('xpath=following-sibling::li[1]')).toHaveText('System default')
    await fontDropdown.screenshot({ path: testInfo.outputPath('font-picker.png') })
    await expect(headings.first()).toHaveCSS('border-top-width', '0px')
    // A heading at the top of the list gets no extra space above it.
    await expect(headings.first()).toHaveCSS('margin-top', '0px')
    await expect(headings.nth(1)).toHaveCSS('margin-top', '4px')
    for (const heading of await headings.all()) {
      await expect(heading).toHaveCSS('margin-bottom', '4px')
      expect(await heading.evaluate(element => {
        const style = getComputedStyle(element)
        return style.paddingBlockStart === style.paddingBlockEnd
      })).toBe(true)
    }
    await expect(fontDropdown).toHaveClass(/below/)
    expect(await page.evaluate(([buttonId, dropdownId]) => {
      const button = document.getElementById(buttonId).getBoundingClientRect()
      const dropdown = document.getElementById(dropdownId).getBoundingClientRect()
      return Math.abs(dropdown.top - button.bottom - 4)
    }, [await appFont.getAttribute('id'), await fontDropdown.getAttribute('id')])).toBeLessThanOrEqual(2)

    // Keep this scroll-clamping check in desktop layout; phone pickers close on exit.
    await page.setViewportSize({ width: 800, height: 650 })
    await expect.poll(() => fontDropdown.evaluate(menu => menu.clientWidth)).toBeLessThanOrEqual(784)
    await appFont.click()
    await page.setViewportSize({ width: 1200, height: 610 })
    await appFont.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await appFont.click()
    await expect(fontDropdown).toBeVisible()
    await expect.poll(() => fontDropdown.evaluate(menu => menu.clientHeight)).toBeLessThan(400)
    await expect.poll(() => fontDropdown.evaluate(menu => menu.scrollHeight - menu.clientHeight))
      .toBeGreaterThan(0)
    await fontDropdown.evaluate(menu => { menu.scrollTop = menu.scrollHeight })
    await expect.poll(() => fontDropdown.evaluate(menu => menu.scrollTop)).toBeGreaterThan(0)
    const previousScrollRange = await fontDropdown.evaluate(menu => menu.scrollHeight - menu.clientHeight)
    await page.setViewportSize({ width: 1200, height: 1000 })
    await expect.poll(() => fontDropdown.evaluate(menu => menu.scrollHeight - menu.clientHeight)).toBeLessThan(previousScrollRange)
    await expect.poll(() => fontDropdown.evaluate(menu => {
      const lastOption = menu.querySelector('.selectOption:last-of-type')
      const style = getComputedStyle(menu)
      const contentEnd = lastOption.getBoundingClientRect().bottom + Number.parseFloat(style.paddingBottom)
      const viewportEnd = menu.getBoundingClientRect().bottom - Number.parseFloat(style.borderBottomWidth)
      return Math.abs(contentEnd - viewportEnd) * devicePixelRatio <= 2
    })).toBe(true)
    await appFont.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await expect(appFont).toBeInViewport()
    await fontDropdown.evaluate(menu => { menu.scrollTop = 0 })

    const selectedFont = (await fontOptions.nth(10).textContent()).trim()
    await fontOptions.nth(10).click()
    await expect(appFont).toHaveText(selectedFont)
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily))
      .toContain(selectedFont)

    await appFont.click()
    await expect(fontOptions.nth(0)).toHaveText('Geist')
    await expect(fontOptions.nth(1)).toHaveText('Roboto')
    await expect(fontOptions.nth(9)).toHaveText('System default')
    await expect(fontOptions.nth(10)).toHaveText(selectedFont)
    await expect(fontOptions.nth(10)).toHaveAttribute('aria-selected', 'true')
    await appFont.click()

    await page.locator('.settingsCloseButton').click()
    await page.locator('.profileTrigger').click()
    const profileSummary = page.locator('.profileSummary')
    await expect(profileSummary).toBeVisible()
    expect(await profileSummary.evaluate(element => getComputedStyle(element).fontFamily))
      .toContain(selectedFont)

    ;({ page } = await app.relaunch())
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily))
      .toContain(selectedFont)

    await goToSettingsSection(page, 'theme')
    const relaunchedAppFont = page.getByRole('combobox', { name: 'App font' })
    await relaunchedAppFont.click()
    const relaunchedFontOptions = page.locator(`#${await relaunchedAppFont.getAttribute('aria-controls')}`)
      .getByRole('option')
    await expect.poll(() => relaunchedFontOptions.count()).toBeGreaterThan(10)
    await expect(relaunchedFontOptions.nth(0)).toHaveText('Geist')
    await expect(relaunchedFontOptions.nth(1)).toHaveText('Roboto')
    await expect(relaunchedFontOptions.nth(9)).toHaveText('System default')
    await expect(relaunchedFontOptions.nth(10)).toHaveText(selectedFont)
    await expect(relaunchedFontOptions.nth(10)).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('custom theme editor', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        quickSettings: ['baseTheme', 'mainColor'],
      },
    },
  })

  test('imports clipboard themes as new drafts and saves only on confirmation', async ({ app, page }) => {
    const theme = cloneDefaultCustomTheme()
    theme.name = 'Clipboard midnight'
    theme.colors.background = '#112233'
    theme.colors.watchedThumbnailOverlay = '#66339980'
    await app.electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), JSON.stringify(theme))
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    const importButton = page.getByRole('button', { name: 'Import from clipboard' })
    await expect(importButton.locator('.ft-icon')).toBeVisible()
    await importButton.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: 'Theme name' })).toHaveValue(theme.name)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#112233')
    await expect(page.locator('body')).toHaveCSS('--watched-thumbnail-overlay-color', '#66339980')
    expect(await page.evaluate(() => window.ftElectron.loadCustomTheme())).toEqual([])
    // Closing the editor confirms its asynchronous save has finished.
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect(page.locator('.customThemeEditor')).toBeHidden()
    const saved = await page.evaluate(() => window.ftElectron.loadCustomTheme())
    expect(saved).toHaveLength(1)
    expect(saved[0].id).not.toBe(theme.id)
    expect(saved[0].colors.background).toBe('#112233')
    expect(saved[0].colors.watchedThumbnailOverlay).toBe('#66339980')

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(async (themeId) => {
      const store = window.$store
      await store.dispatch('updateSystemDarkTheme', `custom:${themeId}`)
      await store.dispatch('updateBaseTheme', 'system')
    }, saved[0].id)
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await importButton.click()
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect(page.locator('.customThemeEditor')).toBeHidden()
    const importedAgain = await page.evaluate(() => window.ftElectron.loadCustomTheme())
    expect(importedAgain).toHaveLength(2)
    expect(new Set(importedAgain.map(({ id }) => id)).size).toBe(2)
    expect(importedAgain).toContainEqual(saved[0])
    const importedId = importedAgain.find(({ id }) => id !== saved[0].id).id
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getBaseTheme
    })).toBe(`custom:${importedId}`)
  })

  test('keeps watched overlays visible when importing older transparent themes', async ({ app, page }) => {
    const theme = cloneDefaultCustomTheme()
    theme.colors.background = '#11223300'
    delete theme.colors.watchedThumbnailOverlay
    await app.electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), JSON.stringify(theme))
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('button', { name: 'Import from clipboard' }).click()
    await expect(page.locator('body')).toHaveCSS('--watched-thumbnail-overlay-color', '#112233b3')
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect(page.locator('.customThemeEditor')).toBeHidden()
    const [saved] = await page.evaluate(() => window.ftElectron.loadCustomTheme())
    expect(saved.colors.background).toBe('#11223300')
    expect(saved.colors.watchedThumbnailOverlay).toBe('#112233b3')
  })

  test('keeps clipboard import controls visible in narrow and scaled windows', async ({ app, page }, testInfo) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    for (const [width, scale] of [[1200, 1], [420, 1], [500, 1.25]]) {
      await setWindowWidth(app, width)
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      const buttons = page.locator('.fileActions button')
      await expect(buttons).toHaveCount(4)
      for (const button of await buttons.all()) {
        await expect(button).toBeInViewport({ ratio: 1 })
      }
      await expect.poll(() => page.locator('.editorHeader').evaluate(element =>
        element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await page.screenshot({ path: testInfo.outputPath('clipboard-import.png') })
  })

  test('preserves the draft when clipboard themes are empty or invalid', async ({ app, page }) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    const name = page.getByRole('textbox', { name: 'Theme name' })
    await name.fill('Keep my draft')
    const originalBackground = await page.locator('body').evaluate(element => element.style.getPropertyValue('--bg-color'))
    for (const text of ['', 'not JSON', '{"name":"Missing colors"}']) {
      await app.electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
      await page.getByRole('button', { name: 'Import from clipboard' }).click()
      await expect(page.locator('.toast').filter({ hasText: 'Clipboard does not contain a valid theme' }).last()).toBeVisible()
      await expect(name).toHaveValue('Keep my draft')
      await expect(page.locator('body')).toHaveCSS('--bg-color', originalBackground)
      expect(await page.evaluate(() => window.ftElectron.loadCustomTheme())).toEqual([])
    }
  })

  test('clamps the color-source list after a responsive reflow', async ({ app, page }) => {
    await setWindowWidth(app, 420)
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('button', { name: 'Page background', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Page background' })
    await picker.getByRole('button', { name: 'Copy from another color' }).click()

    const list = page.locator('.colorSourceList')
    await expect(list).toHaveAttribute('data-overlayscrollbars-viewport')
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await setWindowWidth(app, 1200)
    await expect.poll(() => list.evaluate((element) => {
      const content = element.querySelector('.colorSourceContent')
      const contentEnd = content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      return element.scrollTop <= Math.max(0, contentEnd - element.clientHeight) + 1
    })).toBe(true)
  })

  test('copies built-in themes, previews efficiently, persists, and survives closing settings', async ({ app, page }) => {
    // Edits dozens of colors across several editor sessions, which takes longer than the default on slower machines.
    test.slow()
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Highlight settings changed from defaults' }).click()
    await page.getByRole('button', { name: 'Create custom theme' }).click()

    const creatorBreadcrumb = page.locator('.settingsBreadcrumbLabel')
      .filter({ hasText: 'Custom theme creator' })
    await expect(creatorBreadcrumb.locator('.settingsBreadcrumbSubpageIcon'))
      .toHaveAttribute('data-icon', 'palette')
    await expect(page.getByRole('searchbox', { name: 'Search settings' })).toHaveCount(0)

    const editor = page.locator('.customThemeEditor')
    const resetColorsButton = editor.getByRole('button', { name: 'Reset to base theme' })
    await expect(resetColorsButton.locator('.ft-icon')).toBeVisible()
    await expect(resetColorsButton).toBeDisabled()
    await expect(editor.getByText('Instance menu', { exact: true })).toHaveCount(0)
    await expect(editor.getByText('Visited accent', { exact: true })).toHaveCount(0)
    await editor.getByRole('textbox', { name: 'Theme name' }).fill('Midnight')
    const optionsRow = editor.locator('.themeSources')
    const [optionsBox, colorGridBox] = await Promise.all([
      optionsRow.boundingBox(),
      editor.locator('.colorGrid').boundingBox()
    ])
    const gap = colorGridBox.y - optionsBox.y - optionsBox.height
    expect(gap).toBeGreaterThanOrEqual(0)
    expect(gap).toBeLessThanOrEqual(24)
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
      await editor.getByRole('button', { name: label, exact: true }).click()
      const picker = page.getByRole('dialog', { name: label })
      await picker.getByRole('textbox', { name: 'Hex color' }).fill(value)
      await picker.getByRole('textbox', { name: 'Hex color' }).press('Enter')
      await picker.getByRole('button', { name: 'Apply' }).click()
    }

    await setEditorColor('Logo icon', '#123456')
    await expect(resetColorsButton).toBeEnabled()
    await setEditorColor('Logo text', '#654321')
    await setEditorColor('Selected text background', '#345678')
    await setEditorColor('Selected text', '#fedcba')
    await expect.poll(() => page.evaluate(() => {
      const selectionStyle = getComputedStyle(document.body, '::selection')
      return [selectionStyle.backgroundColor, selectionStyle.color]
    })).toEqual(['rgb(52, 86, 120)', 'rgb(254, 220, 186)'])
    await expect(page.locator('.topNav .searchInput .ft-input')).toHaveCSS('line-height', '20px')
    await setEditorColor('Page background', '#101112')
    await sourceMainColor.click()
    await page.locator(`#${await sourceMainColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Orange', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--primary-color', '#ff9800')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#101112')
    await expect(editor.locator('.ftColorPicker').filter({ hasText: 'Logo icon' }).locator('code'))
      .toHaveText('#123456')
    await sourceSecondaryColor.click()
    await page.locator(`#${await sourceSecondaryColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Teal', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--accent-color', '#009688')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#101112')
    await expect(editor.locator('.ftColorPicker').filter({ hasText: 'Logo text' }).locator('code'))
      .toHaveText('#654321')
    await page.mouse.move(0, 0)
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-color', 'rgb(101, 67, 33)')
    await setEditorColor('Logo hover', '#abcdef')
    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await page.locator('.topNav .logo').hover()
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
    await goTo(page, 'settings')
    await expect(editor).toBeVisible()

    await setEditorColor('Scrollbar thumb hover', '#345678')
    await expect(page.locator('.os-scrollbar').first()).toHaveCSS('--os-handle-bg-hover', '#345678')

    await setEditorColor('Dropdown item hover text', '#fedcba')
    await basedOn.click()
    await expect(page.getByRole('option', { name: 'System Default' })).toHaveCount(0)
    await page.getByRole('option', { name: 'Light', exact: true }).hover()
    await expect(page.getByRole('option', { name: 'Light', exact: true })).toHaveCSS('color', 'rgb(254, 220, 186)')
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#f1f1f1')
    await basedOn.click()
    await page.locator(`#${await basedOn.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Dark', exact: true }).click()

    const backgroundField = editor.locator('.ftColorPicker')
      .filter({ has: page.getByText('Page background', { exact: true }) })
    const backgroundValue = backgroundField.locator('code')
    await expect(backgroundValue).toHaveText('#0f0f0f')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#0f0f0f')
    await expect(resetColorsButton).toBeDisabled()

    await backgroundField.getByRole('button', { name: 'Page background' }).click()
    let backgroundPicker = page.getByRole('dialog', { name: 'Page background' })
    await expect(backgroundPicker.getByRole('button', { name: 'Reset' })).toBeDisabled()
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).fill('#33445580')
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).press('Enter')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#33445580')
    await expect(backgroundPicker.getByRole('button', { name: 'Reset' })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Page background' })).toHaveCount(0)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#0f0f0f')

    await backgroundField.getByRole('button', { name: 'Page background' }).click()
    backgroundPicker = page.getByRole('dialog', { name: 'Page background' })
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).fill('#445566')
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).press('Enter')
    await backgroundPicker.getByRole('button', { name: 'Apply' }).click()
    await expect(backgroundValue).toHaveText('#445566')
    await expect(resetColorsButton).toBeEnabled()

    const darkTheme = page.getByRole('checkbox', { name: 'Dark theme' })
    await expect(darkTheme).toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: 'Dark theme' }).click()
    await expect(page.locator('body')).toHaveAttribute('data-custom-theme', 'light')

    await setEditorColor('Primary control hover and focus', '#123456')
    await setEditorColor('Primary control pressed', '#234567')
    await setEditorColor('Secondary control hover and focus', '#345678')
    await setEditorColor('Secondary control pressed', '#456789')
    await setEditorColor('Destructive action', '#123abc')
    await setEditorColor('Destructive hover and focus', '#456def')
    await setEditorColor('Destructive pressed', '#789abc')
    await setEditorColor('Text and icons on destructive actions', '#fedcba')

    const saveAndApplyButton = page.getByRole('button', { name: 'Save and apply' })
    const resetButton = page.getByRole('button', { name: 'Reset to base theme' })
    await page.keyboard.press('Tab')
    // Reset is a secondary action and Save and apply the primary one.
    await resetButton.focus()
    await expect.poll(() => backgroundRgb(resetButton)).toBe('rgb(52, 86, 120)')
    await saveAndApplyButton.focus()
    await expect.poll(() => backgroundRgb(saveAndApplyButton)).toBe('rgb(18, 52, 86)')
    await page.keyboard.down('Space')
    await expect.poll(() => backgroundRgb(saveAndApplyButton)).toBe('rgb(35, 69, 103)')
    await page.keyboard.up('Space')
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
    await page.evaluate(async () => {
      const [theme] = await window.ftElectron.loadCustomTheme()
      await window.ftElectron.saveCustomTheme({ ...theme, id: '../custom-theme' })
        .then(() => { throw new Error('Invalid custom theme ID was accepted') }, () => {})
      await Promise.all([
        window.ftElectron.saveCustomTheme(theme),
        window.ftElectron.saveCustomTheme(theme)
      ])
    })
    await expect.poll(async () => (await readSavedThemes(app.userDataDir)).map(({ name }) => name))
      .toEqual(['Midnight'])
    await expect(editor).toHaveCount(0)
    await goToSettingsSection(page, 'storage')
    const removeHistoryButton = page.getByRole('button', { name: 'Remove Watch History' })
    // Custom themes give destructive buttons their own state shades.
    await removeHistoryButton.hover()
    await expect(removeHistoryButton).toHaveCSS('color', 'rgb(254, 220, 186)')
    await expect.poll(() => backgroundRgb(removeHistoryButton)).toBe('rgb(69, 109, 239)')
    await page.mouse.down()
    await expect.poll(() => backgroundRgb(removeHistoryButton)).toBe('rgb(120, 154, 188)')
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()

    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await page.locator('.topNav .profileTrigger').click()
    const quickAppearance = page.locator('.quickSettingsMenu .menuSection').filter({ hasText: 'Appearance' })
    await expect(quickAppearance.getByRole('combobox', { name: 'Base Theme' })).toBeDisabled()
    await expect(quickAppearance.getByRole('combobox', { name: /Main colou?r theme/i })).toHaveCount(0)
    await page.locator('.topNav .profileTrigger').click()
    await goTo(page, 'settings')
    await expect(page.getByText('Custom theme creator', { exact: true })).toBeVisible()
    await expect(backgroundValue).toHaveText('#445566')

    const discardChangesButton = page.getByRole('button', { name: 'Discard changes' })
    await expect(saveAndApplyButton).toBeDisabled()
    await expect(discardChangesButton).toBeDisabled()

    await setEditorColor('Page background', '#112233')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#112233')
    await expect(saveAndApplyButton).toBeEnabled()
    await expect(discardChangesButton).toBeEnabled()
    await discardChangesButton.click()
    await expect(backgroundValue).toHaveText('#445566')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await expect(saveAndApplyButton).toBeDisabled()
    await expect(discardChangesButton).toBeDisabled()

    await setEditorColor('Page background', '#112233')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#112233')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(page.getByText('Custom theme creator', { exact: true })).toHaveCount(0)
    await expect(page.locator('.settingsKeyboardShortcutPage')).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')

    await page.locator('.settingsBackButton').click()
    await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: /Secondary colou?r theme/i })).toBeDisabled()

    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await page.locator('label.switch-label').filter({ hasText: 'Dark theme' }).click()
    await expect(darkTheme).toBeChecked()
    await saveAndApplyButton.click()

    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await expect(backgroundValue).toHaveText('#445566')
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

    await page.emulateMedia({ colorScheme: 'light' })
    const baseThemeSelect = page.getByRole('combobox', { name: 'Base Theme' })
    await baseThemeSelect.click()
    await page.locator(`#${await baseThemeSelect.getAttribute('aria-controls')}`)
      .getByRole('option', { name: /System default/i }).click()
    const darkSystemTheme = page.getByRole('combobox', { name: 'Dark theme' })
    await darkSystemTheme.click()
    const darkSystemThemeOptions = page.locator(`#${await darkSystemTheme.getAttribute('aria-controls')}`)
    await expect(darkSystemThemeOptions.getByRole('option', { name: 'Paper', exact: true })).toHaveCount(0)
    await expect(darkSystemThemeOptions.getByRole('option', { name: 'Midnight', exact: true })).toBeVisible()
    await darkSystemThemeOptions.getByRole('option', { name: 'Midnight', exact: true }).click()

    await page.locator('.settingsCloseButton').click()
    await page.locator('.topNav .profileTrigger').click()
    const quickSettingsMainColor = page.locator('.quickSettingsMenu .menuSection')
      .filter({ hasText: 'Appearance' }).getByRole('combobox', { name: /Main colou?r theme/i })
    await expect(quickSettingsMainColor).toBeEnabled()
    await quickSettingsMainColor.click()
    const quickSettingsMainColorList = page.locator(`#${await quickSettingsMainColor.getAttribute('aria-controls')}`)
    await expect(quickSettingsMainColorList).toBeVisible()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(quickSettingsMainColor).toHaveCount(0)
    await expect(quickSettingsMainColorList).toHaveCount(0)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(quickSettingsMainColor).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
    await goTo(page, 'settings')
    await expect(page.locator('.settingsContent > [data-section="appearance"]')).toBeVisible()

    const lightSystemTheme = page.getByRole('combobox', { name: 'Light theme' })
    await lightSystemTheme.click()
    const lightSystemThemeOptions = page.locator(`#${await lightSystemTheme.getAttribute('aria-controls')}`)
    await expect(lightSystemThemeOptions.getByRole('option', { name: 'Midnight', exact: true })).toHaveCount(0)
    await lightSystemThemeOptions.getByRole('option', { name: 'Paper', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit custom theme' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await setEditorColor('Page background', '#abcdef')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#abcdef')
    await page.locator('.settingsBackButton').click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#f1f1f1')
    await expect(page.locator('body')).toHaveClass(/custom/)
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await setEditorColor('Page background', '#abcdef')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect(page.locator('.settingsWindow:visible')
      .getByRole('combobox', { name: 'Base Theme' })).toHaveText('System default')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#abcdef')

    const activeBaseThemeSelect = page.locator('.settingsWindow:visible')
      .getByRole('combobox', { name: 'Base Theme' })
    await activeBaseThemeSelect.click()
    await page.locator(`#${await activeBaseThemeSelect.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Midnight', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await expect(page.getByRole('combobox', { name: 'Based on' })).toHaveText('Dark')
    await expect(backgroundValue).toHaveText('#445566')

    ;({ page } = await app.relaunch())
    await expect(page.locator('body')).toHaveClass(/custom/)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await expect(page.locator('body')).toHaveAttribute('data-custom-theme', 'dark')

    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await page.getByRole('button', { name: 'Delete theme' }).click()
    const deletePrompt = page.getByRole('dialog', { name: /Delete “Midnight”/ })
    await expect(deletePrompt).toHaveClass(/autosize/)
    await expect(deletePrompt).toContainText('Delete “Midnight”?')
    await deletePrompt.getByRole('button', { name: 'Delete theme' }).click()
    await expect(page.getByText('Custom theme creator', { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await readSavedThemes(app.userDataDir)).map(({ name }) => name))
      .toEqual(['Paper'])
    await expect(page.locator('body')).toHaveClass(/dark/)
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getBaseTheme
    })).toBe('dark')
  })
})

test.describe('invalid appearance values', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'missingTheme',
        systemLightTheme: 'solarizedDark',
        systemDarkTheme: 'solarizedLight',
        mainColor: 'missingMainColor',
        secColor: 'missingSecondaryColor'
      }
    }
  })

  test('falls back to defaults', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => {
      const getters = window.$store.getters
      return [
        getters.getBaseTheme,
        getters.getSystemLightTheme,
        getters.getSystemDarkTheme,
        getters.getMainColor,
        getters.getSecColor
      ]
    })).toEqual(['system', 'light', 'dark', 'Red', 'Blue'])
  })
})

test.describe('font size', { tag: '@scale' }, () => {
  test('scales text but not icons when changed, and saves it', async ({ app, page, attachScreenshot }) => {
    const navLabel = page.locator('.sideNav .navOption .navLabel').first()
    const navIcon = page.locator('.sideNav .navOption .navIcon').first()
    await expect(navLabel).toHaveCSS('font-size', '12px')
    await expect(navIcon).toHaveCSS('font-size', '24px')

    await goToSettingsSection(page, 'theme')
    const sectionTitle = page.locator('.sectionTitle').first()
    await expect(sectionTitle).toHaveCSS('font-size', '22px')
    const spacing = await page.locator('.sectionBody').first().evaluate(element => getComputedStyle(element).padding)

    await page.getByRole('slider', { name: /Font Size/ }).fill('150')
    await expect(page.locator('body')).toHaveCSS('--font-scale', '1.5')
    await expect(page.locator('body')).toHaveCSS('font-size', '24px')
    await expect(sectionTitle).toHaveCSS('font-size', '33px')
    await expect(navLabel).toHaveCSS('font-size', '18px')
    await expect(navIcon).toHaveCSS('font-size', '24px')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('padding', spacing)
    await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).fontSize).toBe(150)
    await attachScreenshot('settings at 150% font size')
  })

  test.describe('saved at 150%', () => {
    test.use({ seed: { settings: { fontSize: 150 } } })

    test('applies on startup and widens the side bar for its labels', async ({ page }) => {
      await expect(page.locator('body')).toHaveCSS('font-size', '24px')
      await expect(page.locator('.sideNav .navOption .navLabel').first()).toHaveCSS('font-size', '18px')
      await expect(page.locator('.sideNav .navOption .navIcon').first()).toHaveCSS('font-size', '24px')
      // UI Scale zoom can leave the computed width a fraction of a pixel off.
      await expect.poll(() => page.locator('.sideNav').first().evaluate(element => parseFloat(getComputedStyle(element).width)))
        .toBeCloseTo(156, 0)
    })
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

test.describe('tab layout shortcut', () => {
  test('presses in quick succession are not swallowed by the pending write', async ({ app: appHandle, page }) => {
    const app = page.locator('.app')

    // The setting is only committed once persisted, so two presses that beat
    // the write have to queue up instead of both advancing from the same value.
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }))
      }
    })

    await expect.poll(async () => {
      const contents = readDatastore(appHandle.userDataDir, 'settings')
      return Object.fromEntries(contents.trim().split('\n')
        .map(line => JSON.parse(line))
        .map(record => [record._id, record.value]))
        .tabBarPosition
    }).toBe('bottom')
    await expect(app).toHaveClass(/tabBar-bottom/)
  })
})

test.describe('tab layout shortcut rebound to a printable key', () => {
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
    await expect(app).toHaveClass(/tabBar-top/)

    // Outside a text field the rebound key still works.
    await page.locator('.app').click()
    await page.keyboard.press('v')
    await expect(app).toHaveClass(/tabBar-left/)
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

test.describe('Tally themes', () => {
  test('selects, persists, and follows the system with the Tally palettes', async ({ app, page, attachScreenshot }) => {
    await goToSettingsSection(page, 'theme')
    for (const mode of ['Light', 'Dark']) {
      await page.getByRole('combobox', { name: /^Base theme/i }).click()
      await page.getByRole('option', { name: `Tally ${mode}`, exact: true }).click()
      // The accent picker replaces the main and secondary colors.
      await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toHaveCount(0)
      await expect(page.getByRole('combobox', { name: /Secondary colou?r theme/i })).toHaveCount(0)
      await attachScreenshot(`Tally ${mode} settings`)
    }

    ;({ page } = await app.relaunch())
    await expect(page.locator('body')).toHaveClass(/openTubeXDark/)
    expect(await app.electronApp.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true)
    await goToSettingsSection(page, 'theme')
    await page.getByRole('combobox', { name: /^Base theme/i }).click()
    await page.getByRole('option', { name: /^System default$/i }).click()
    for (const [mode, other] of [['Light', 'Dark'], ['Dark', 'Light']]) {
      await page.getByRole('combobox', { name: `${mode} theme`, exact: true }).click()
      await expect(page.getByRole('option', { name: `Tally ${other}`, exact: true })).toHaveCount(0)
      await page.getByRole('option', { name: `Tally ${mode}`, exact: true }).click()
      await page.emulateMedia({ colorScheme: mode.toLowerCase() })
      await expect(page.locator('body')).toHaveClass(new RegExp(`openTubeX${mode}`))
    }

    // Leaving a fixed palette restores the user's normal color controls.
    await page.getByRole('combobox', { name: /^Base theme/i }).click()
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeEnabled()
    await expect(page.locator('body')).toHaveCSS('--primary-color', '#f44336')
  })
})
