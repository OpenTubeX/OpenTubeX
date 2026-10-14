import { test, expect, goToSettingsSection, setWindowSize, waitForAppReady, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'
import { sampleColors } from '../../helpers/colors.mjs'
import { materialColorScheme, materialSeedPalette } from '../../../src/materialTheme.js'

const variants = [['materialLight', 'Material Light'], ['materialDark', 'Material Dark'], ['materialBlack', 'Material Black']]

test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'materialLight', materialSeedColor: '#ffff00' } } })

test('Material swatches retain contrast when editing an inactive System theme', async ({ page }) => {
  const section = await goToSettingsSection(page, 'theme')
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateSystemLightTheme', 'materialLight')
    await store.dispatch('updateSystemDarkTheme', 'dark')
    await store.dispatch('updateBaseTheme', 'system')
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).not.toHaveClass(/dynamicColors/)
  await expect(section.locator('.materialColorSettings')).toBeVisible()
  for (const seed of ['#ffffff', '#000000', '#ffff00']) {
    await page.evaluate(seed => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateMaterialSeedColor', seed), seed)
    const editIcon = await colorsOf(section.locator('.materialSwatchEdit'))
    expect(contrast(editIcon.foreground, editIcon.background), `${seed}: inactive Material edit icon`).toBeGreaterThanOrEqual(3)
    const boundary = await colorsOf(section.locator('.materialCustomColor'))
    const container = await colorsOf(section.locator('.materialColorSettings'))
    expect(contrast(boundary.border, container.background), `${seed}: inactive Material swatch boundary`).toBeGreaterThanOrEqual(3)
  }
})

test('desktop Dynamic colors follows native accents and hides manual controls', async ({ app, page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const section = await goToSettingsSection(page, 'theme')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'dynamic'))
  await expect(section.locator('.materialColorSettings')).toHaveCount(0)
  await expect(section.getByRole('combobox', { name: /Main color theme/i })).toHaveCount(0)
  for (const [nativeColor, seed, dark] of [['#895AA2FF', '#895aa2', false], ['006A6AFF', '#006a6a', false], ['006A6AFF', '#006a6a', true]]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await app.electronApp.evaluate(({ systemPreferences }, color) => {
      systemPreferences.getAccentColor = () => color
      systemPreferences.emit('accent-color-changed', {}, color)
    }, nativeColor)
    const roles = materialColorScheme(materialSeedPalette(seed), dark)
    await expect(page.locator('body')).toHaveCSS('--primary-color', roles.primary)
    for (const element of [section.getByRole('combobox', { name: /^Base theme/i }), page.locator('.settingsMenu .title.active .titleDescription')]) {
      const { foreground, background } = await colorsOf(element)
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
    }
    await expect(section.locator('.materialColorSettings')).toHaveCount(0)
  }
  // Reload reads the native accent again rather than retaining renderer state.
  await page.reload()
  await page.emulateMedia({ colorScheme: 'dark' })
  await goToSettingsSection(page, 'theme')
  await expect(page.locator('body')).toHaveCSS('--primary-color', materialColorScheme(materialSeedPalette('#006a6a'), true).primary)
  await section.getByRole('combobox', { name: /^Base theme/i }).scrollIntoViewIfNeeded()
  const path = testInfo.outputPath('desktop-dynamic-colors.png')
  await page.locator('.settingsWindow').screenshot({ path })
  await testInfo.attach('Desktop Dynamic colors', { path, contentType: 'image/png' })
  for (const [theme, dark] of [['materialLight', false], ['materialDark', true], ['materialBlack', true]]) {
    await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', theme), theme)
    await expect(section.locator('.materialColorSettings')).toBeVisible()
    await expect(section.locator('.materialColorHeader code')).toHaveText('#ffff00')
    await expect(page.locator('body')).toHaveCSS('--primary-color', materialColorScheme(materialSeedPalette('#ffff00'), dark).primary)
  }
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'dynamic'))
  await app.electronApp.evaluate(({ systemPreferences }) => {
    systemPreferences.getAccentColor = () => ''
    systemPreferences.emit('accent-color-changed', {}, '')
  })
  await expect(page.locator('body')).toHaveCSS('--primary-color', materialColorScheme(materialSeedPalette('#ffff00'), true).primary)
  await expect(section.locator('.materialColorSettings')).toHaveCount(0)
})

test('desktop system accents reach new windows, startup backgrounds and live renderers', async ({ app, page }) => {
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'dynamic'))
  const dark = await app.electronApp.evaluate(({ systemPreferences, nativeTheme }) => {
    systemPreferences.getAccentColor = () => '#006A6AFF'
    systemPreferences.emit('accent-color-changed', {}, '#006A6AFF')
    return nativeTheme.shouldUseDarkColors
  })
  const newWindowPromise = app.electronApp.waitForEvent('window')
  await page.evaluate(() => window.ftElectron.openInNewWindow('/history'))
  const newPage = await newWindowPromise
  await waitForAppReady(newPage)
  const appearance = await newPage.evaluate(() => window.ftElectron.startupAppearance)
  expect(appearance.systemAccentColor).toBe('#006a6a')
  expect(appearance.background).toBe(materialColorScheme(materialSeedPalette('#006a6a'), dark).surface)
  for (const currentPage of [page, newPage]) await currentPage.emulateMedia({ colorScheme: 'light' })
  await app.electronApp.evaluate(({ systemPreferences }) => {
    systemPreferences.getAccentColor = () => 'ECaa2EFF'
    systemPreferences.emit('accent-color-changed', {}, 'ECaa2EFF')
  })
  for (const currentPage of [page, newPage]) {
    await expect(currentPage.locator('body')).toHaveCSS('--primary-color', materialColorScheme(materialSeedPalette('#ecaa2e'), false).primary)
  }
})

test('hiding system accent controls clamps settings at the bottom at every UI scale', async ({ page }) => {
  const section = await goToSettingsSection(page, 'theme')
  const scroller = page.locator('.settingsContent')
  for (const scale of [100, 125]) {
    await page.evaluate(async scale => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', scale)
      await store.dispatch('updateBaseTheme', 'materialLight')
    }, scale)
    await expect(section.locator('.materialColorSettings')).toBeVisible()
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expectScrollAtRenderedEnd(scroller)
    const oldRange = await scroller.evaluate(element => element.scrollHeight - element.clientHeight)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'dynamic'))
    await expect(section.locator('.materialColorSettings')).toHaveCount(0)
    await expectScrollAtRenderedEnd(scroller)
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(oldRange)
    await expect.poll(() => scroller.evaluate(element => {
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      return !scrollbar.classList.contains('os-scrollbar-unusable') &&
        Math.abs(thumb.bottom - track.bottom) * devicePixelRatio <= 2 &&
        Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
    })).toBe(true)
  }
})

test('Material accent box has vertical padding and a clickable custom swatch', async ({ page }) => {
  const section = await goToSettingsSection(page, 'theme')
  const box = section.locator('.materialColorSettings')
  const customSwatch = box.locator('.materialCustomSwatch .colorFieldTrigger')
  const picker = page.getByRole('dialog', { name: 'Material accent color' })
  for (const scale of [100, 125]) {
    await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', scale), scale)
    const padding = await box.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const header = element.querySelector('.materialColorHeader').getBoundingClientRect()
      const swatches = element.querySelector('.materialColorSwatches').getBoundingClientRect()
      return [header.top - bounds.top, bounds.bottom - swatches.bottom]
    })
    for (const value of padding) expect(value).toBeGreaterThanOrEqual(23.5)
    await expect(customSwatch).toBeVisible()
    await expect(customSwatch.locator('.materialCustomColor')).toHaveCSS('background-color', 'rgb(255, 255, 0)')
    await customSwatch.click()
    await expect(picker).toBeVisible()
    await expect(customSwatch).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(customSwatch).toBeFocused()
    await expect(customSwatch).toHaveAttribute('aria-expanded', 'false')
    await customSwatch.press('Enter')
    await expect(picker).toBeVisible()
    await page.keyboard.press('Escape')
  }
})

function contrast(first, second) {
  const luminance = rgb => rgb.map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b)
  return (high + 0.05) / (low + 0.05)
}

async function colorsOf(element, pseudo = null) {
  return element.evaluate((node, pseudo) => {
    const rgba = color => color.match(/[\d.]+/g).map(Number)
      .map((value, i) => color.startsWith('color(srgb ') && i < 3 ? value * 255 : value)
    const rgb = color => rgba(color).slice(0, 3)
    const style = getComputedStyle(node, pseudo)
    const ancestors = []
    for (let parent = node; parent; parent = parent.parentElement) ancestors.unshift(parent)
    const background = ancestors.reduce((bg, parent) => {
      const channels = rgba(getComputedStyle(parent).backgroundColor)
      return channels.slice(0, 3).map((c, i) => c * (channels[3] ?? 1) + bg[i] * (1 - (channels[3] ?? 1)))
    }, [255, 255, 255])
    return { foreground: rgb(style.color), border: rgb(style.borderBottomColor), background }
  }, pseudo)
}

async function fieldBoundaryContrast(app, control) {
  await control.scrollIntoViewIfNeeded()
  const points = await control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const container = element.closest('.settingsWindow').getBoundingClientRect()
    const x = rect.left - container.left
    const y = rect.top - container.top + rect.height / 2
    // Outlined selects draw a separate fieldset; search inputs use an inset
    // shadow. Sample their rendered edge, including fractional zoom pixels.
    return [[x - 4, y], ...[-0.5, 0.5, 1.5].map(offset => [x + offset, y])]
  })
  const [surface, ...edge] = await sampleColors(app, app.page.locator('.settingsWindow'), points)
  return Math.max(...edge.map(color => contrast(color, surface)))
}

for (const scale of [100, 125]) {
  for (const [theme, label] of variants) {
    test(`${label} retains rendered text and control contrast at ${scale}%`, async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
      const section = await goToSettingsSection(page, 'theme')
      await page.evaluate(async ({ theme, scale }) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateUiScale', scale)
        await store.dispatch('updateBaseTheme', theme)
      }, { theme, scale })
      await expect(page.locator('body')).toHaveClass(/dynamicColors/)
      await expect(section.getByRole('combobox', { name: /^Base theme/i })).toHaveText(label)
      await expect(section.getByRole('combobox', { name: /Main color theme/i })).toHaveCount(0)
      await expect(section.getByRole('button', { name: 'Material accent color' })).toBeVisible()
      for (const element of [
        page.locator('.settingsMenu .title.active .titleText'),
        page.locator('.settingsMenu .title.active .titleDescription'),
        section.getByRole('combobox', { name: /^Base theme/i }),
        page.locator('.settingsSearch input'),
        section.locator('.materialColorHeader'),
        section.locator('.materialColorHeader code'),
      ]) {
        const { foreground, background } = await colorsOf(element)
        expect(contrast(foreground, background), `${theme}: ${element}`).toBeGreaterThanOrEqual(4.5)
      }
      const placeholder = await colorsOf(page.locator('.settingsSearch input'), '::placeholder')
      expect(contrast(placeholder.foreground, placeholder.background), `${theme}: search placeholder`).toBeGreaterThanOrEqual(4.5)
      const customBorder = await colorsOf(section.locator('.materialCustomColor'))
      const accentBox = await colorsOf(section.locator('.materialColorSettings'))
      expect(contrast(customBorder.border, accentBox.background), `${theme}: custom swatch boundary`).toBeGreaterThanOrEqual(3)
      const editIcon = await colorsOf(section.locator('.materialSwatchEdit'))
      expect(contrast(editIcon.foreground, editIcon.background), `${theme}: custom swatch edit icon`).toBeGreaterThanOrEqual(3)
      for (const field of [section.getByRole('combobox', { name: /^Base theme/i }), page.locator('.settingsSearch input')]) {
        expect(await fieldBoundaryContrast(app, field), `${theme}: field boundary`).toBeGreaterThanOrEqual(3)
      }
      const toggle = section.getByRole('checkbox', { name: /^Always Show Scrollbars/ })
      for (const checked of [true, false]) {
        if (await toggle.isChecked() !== checked) await toggle.locator('..').locator('.switch-label').click()
        await expect(toggle).toBeChecked({ checked })
        const rendered = await toggle.locator('..').locator('.switch-label').evaluate(element => {
          const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
          return {
            track: rgb(getComputedStyle(element.querySelector('.switch-label-text'), '::before').backgroundColor),
            border: rgb(getComputedStyle(element.querySelector('.switch-label-text'), '::before').borderColor),
            thumb: rgb(getComputedStyle(element.querySelector('.switch-thumb')).backgroundColor),
            outline: rgb(getComputedStyle(element.querySelector('.switch-thumb')).outlineColor),
            surface: rgb(getComputedStyle(document.body).backgroundColor),
          }
        })
        expect(Math.max(contrast(rendered.track, rendered.surface), contrast(rendered.border, rendered.surface)), `${theme}: toggle boundary`).toBeGreaterThanOrEqual(3)
        expect(Math.max(contrast(rendered.thumb, rendered.track), contrast(rendered.outline, rendered.track)), `${theme}: toggle thumb boundary`).toBeGreaterThanOrEqual(3)
      }
      const button = section.getByRole('button', { name: 'Test toast', exact: true })
      for (const state of ['normal', 'hover', 'focus', 'pressed']) {
        await button.scrollIntoViewIfNeeded()
        if (state === 'hover') await button.hover()
        if (state === 'focus') await button.focus()
        if (state === 'pressed') {
          await button.hover()
          await page.mouse.down()
        }
        const { foreground, background } = await colorsOf(button)
        expect(contrast(foreground, background), `${theme}: ${state} button text`).toBeGreaterThanOrEqual(4.5)
        await page.mouse.move(0, 0)
        if (state === 'pressed') await page.mouse.up()
      }
      if (theme === 'materialBlack') await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      if (scale === 100) {
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateMaterialSeedColor', '#6750a4'))
        await section.getByRole('combobox', { name: /^Base theme/i }).scrollIntoViewIfNeeded()
        const path = testInfo.outputPath(`${theme}.png`)
        await page.locator('.settingsWindow').screenshot({ path })
        await testInfo.attach(label, { path, contentType: 'image/png' })
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateMaterialSeedColor', '#ffff00'))
      }
      const background = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)
      await page.emulateMedia({ colorScheme: 'light' })
      await expect(page.locator('body')).toHaveCSS('background-color', background)
      await page.emulateMedia({ colorScheme: 'dark' })
    })
  }
}

test('seed picker persists colors, system preferences select Material variants, and ordinary themes clear the palette', async ({ page }) => {
  const section = await goToSettingsSection(page, 'theme')
  await section.getByRole('button', { name: 'Material accent color' }).click()
  const picker = page.getByRole('dialog', { name: 'Material accent color' })
  const hexField = picker.getByRole('textbox', { name: /^Hex color/ })
  await hexField.fill('')
  const placeholder = await colorsOf(hexField, '::placeholder')
  expect(contrast(placeholder.foreground, placeholder.background)).toBeGreaterThanOrEqual(4.5)
  await hexField.fill('#00aaff')
  await picker.getByRole('textbox', { name: /^Hex color/ }).press('Tab')
  await picker.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(section.locator('.materialColorHeader code')).toHaveText('#00aaff')
  const primary = await page.locator('body').evaluate(el => el.style.getPropertyValue('--primary-color'))
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateSystemLightTheme', 'materialLight')
    await store.dispatch('updateSystemDarkTheme', 'materialBlack')
    await store.dispatch('updateBaseTheme', 'system')
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveClass(/light/)
  expect(await page.locator('body').evaluate(el => el.style.getPropertyValue('--primary-color'))).toBe(primary)
  await page.reload()
  await goToSettingsSection(page, 'theme')
  await expect(section.locator('.materialColorHeader code')).toHaveText('#00aaff')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'dark'))
  await expect(page.locator('body')).not.toHaveClass(/dynamicColors/)
  await expect(section.getByRole('button', { name: 'Material accent color' })).toHaveCount(0)
  expect(await page.locator('body').evaluate(el => el.style.getPropertyValue('--primary-color'))).toBe('')
})

test('Material seed picker fits narrow portrait and landscape layouts', async ({ app, page }) => {
  const section = await goToSettingsSection(page, 'theme')
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
  for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await setWindowSize(app, page, size)
    const trigger = section.getByRole('button', { name: 'Material accent color' })
    await trigger.scrollIntoViewIfNeeded()
    const geometry = await trigger.evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: window.innerWidth }))
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(geometry.width)
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Material accent color' })
    await expect(dialog.getByRole('textbox', { name: /^Hex color/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
})

test('Material preset swatches preview palettes and persist the selected seed', async ({ page }) => {
  const section = await goToSettingsSection(page, 'theme')
  const swatches = section.locator('.materialColorSwatches > button')
  await expect(swatches).toHaveCount(8)
  for (const name of ['Purple', 'Blue', 'Teal', 'Green', 'Amber', 'Pink', 'Red', 'Indigo']) {
    const preset = section.locator('.materialColorSwatches').getByRole('button', { name, exact: true })
    await preset.click()
    await expect(preset).toHaveAttribute('aria-pressed', 'true')
    await expect(section.locator('.materialSwatchCheck')).toHaveCount(1)
    const colors = await preset.evaluate(el => ({ seed: document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getMaterialSeedColor, palette: getComputedStyle(el).getPropertyValue('--swatch-primary') }))
    expect(colors.seed).toMatch(/^#[a-f0-9]{6}$/)
    expect(colors.palette).toMatch(/^#[a-f0-9]{6}$/)
  }
  const blue = section.locator('.materialColorSwatches').getByRole('button', { name: 'Blue', exact: true })
  await blue.focus()
  await blue.press('Space')
  await expect(blue).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await goToSettingsSection(page, 'theme')
  await expect(blue).toHaveAttribute('aria-pressed', 'true')
})
