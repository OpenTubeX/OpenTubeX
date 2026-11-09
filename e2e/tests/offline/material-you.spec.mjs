import { test, expect, goToSettingsSection, setWindowSize, expectScrollAtRenderedEnd, readDatastore, latestSettings } from '../../helpers/app.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'materialLight', materialSeedColor: '#ffff00' } } })

test('hiding system accent controls clamps settings at the bottom', { tag: '@scale' }, async ({ page }) => {
  const section = await goToSettingsSection(page, 'theme')
  const scroller = page.locator('.settingsContent')
  await expect(section.locator('.accentColorSettings')).toBeVisible()
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expectScrollAtRenderedEnd(scroller)
  const oldRange = await scroller.evaluate(element => element.scrollHeight - element.clientHeight)
  await page.evaluate(() => window.$store.dispatch('updateBaseTheme', 'dynamic'))
  await expect(section.locator('.accentColorSettings')).toHaveCount(0)
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
})

function contrast(first, second) {
  const luminance = rgb => rgb.map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b)
  return (high + 0.05) / (low + 0.05)
}

async function colorsOf(element, pseudo = null) {
  return element.evaluate(async (node, pseudo) => {
    // Theme and hover changes transition colors; read them once they settle.
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.target?.contains(node) && animation.effect.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})))
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

/** Mocks the accent color Electron reports, which follows the host desktop otherwise. */
function setDesktopAccent(app, color) {
  return app.electronApp.evaluate(({ systemPreferences }, color) => {
    systemPreferences.getAccentColor = () => color
    systemPreferences.emit('accent-color-changed', {}, color)
  }, color)
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
  await expect(section.locator('.accentColorHeader code')).toHaveText('#00aaff')
  const primary = await page.locator('body').evaluate(el => el.style.getPropertyValue('--primary-color'))
  await page.evaluate(async () => {
    const store = window.$store
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
  await expect(section.locator('.accentColorHeader code')).toHaveText('#00aaff')
  await page.evaluate(() => window.$store.dispatch('updateBaseTheme', 'dark'))
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

test('Material preset swatches preview palettes and persist the selected seed', async ({ app, page }) => {
  // The host desktop's accent would add a system swatch
  await setDesktopAccent(app, '')
  const section = await goToSettingsSection(page, 'theme')
  const swatches = section.locator('.accentColorSwatches > button')
  await expect(swatches).toHaveCount(8)
  for (const name of ['Purple', 'Blue', 'Teal', 'Green', 'Amber', 'Pink', 'Red', 'Indigo']) {
    const preset = section.locator('.accentColorSwatches').getByRole('button', { name, exact: true })
    await preset.click()
    await expect(preset).toHaveAttribute('aria-pressed', 'true')
    await expect(section.locator('.accentSwatchCheck')).toHaveCount(1)
    const colors = await preset.evaluate(el => ({ seed: window.$store.getters.getMaterialSeedColor, palette: getComputedStyle(el).getPropertyValue('--swatch-primary') }))
    expect(colors.seed).toMatch(/^#[a-f0-9]{6}$/)
    expect(colors.palette).toMatch(/^#[a-f0-9]{6}$/)
  }
  // Observe Indigo on disk so the final check cannot match the earlier Blue selection.
  const savedSeed = () => latestSettings(readDatastore(app.userDataDir, 'settings')).materialSeedColor
  await expect.poll(savedSeed).toBe('#3f51b5')
  const blue = section.locator('.accentColorSwatches').getByRole('button', { name: 'Blue', exact: true })
  await blue.focus()
  await blue.press('Space')
  await expect(blue).toHaveAttribute('aria-pressed', 'true')
  // The swatch is optimistic; reload only after its queued write reaches disk.
  await expect.poll(savedSeed).toBe('#4285f4')
  await page.reload()
  await goToSettingsSection(page, 'theme')
  await expect(blue).toHaveAttribute('aria-pressed', 'true')
})

for (const movedAfterPreview of [false, true]) {
  test(`an interrupted drag does not overwrite a newer seed from elsewhere${movedAfterPreview ? ' after moving' : ''}`, async ({ page }) => {
    const section = await goToSettingsSection(page, 'theme')
    await section.locator('.accentCustomSwatch .colorFieldTrigger').click()
    const picker = page.getByRole('dialog', { name: 'Material accent color' })
    const bounds = await picker.getByRole('slider', { name: 'Saturation and brightness' }).boundingBox()
    // Pressing previews the color immediately and starts the preview timer.
    await page.mouse.move(bounds.x + 4, bounds.y + 4)
    await page.mouse.down()
    const seed = await page.evaluate(async ({ movedAfterPreview, x, y }) => {
      if (movedAfterPreview) {
        // This draft waits for the preview timer.
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y }))
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }
      // Cancel the drag without a change event, then sync a seed before the preview timer runs.
      window.dispatchEvent(new Event('blur'))
      await window.$store.dispatch('updateMaterialSeedColor', '#4285f4')
      await new Promise(resolve => setTimeout(resolve, 300))
      return window.$store.getters.getMaterialSeedColor
    }, { movedAfterPreview, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
    await page.mouse.up()
    expect(seed).toBe('#4285f4')
  })
}
