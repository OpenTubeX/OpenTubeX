import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_CUSTOM_THEME } from '../../../src/customTheme.js'
import { test, expect, goToSettingsSection, latestSettings, setWindowSize, readDatastore } from '../../helpers/app.mjs'

async function setSetting(page, name, value) {
  await page.evaluate(async ({ name, value }) => {
    const store = window.$store
    await store.dispatch(`update${name}`, value)
  }, { name, value })
}

async function cachedIcon(app, fileName = 'tray-icon.png') {
  // writeFile empties the file before writing it, so an empty read is still in progress.
  return readFile(path.join(app.userDataDir, fileName)).then(bytes => bytes.length ? bytes.toString('base64') : null).catch(() => null)
}

async function backgroundPixel(app) {
  const image = await cachedIcon(app)
  if (!image) return null
  return app.electronApp.evaluate(({ nativeImage }, data) => {
    const bitmap = nativeImage.createFromDataURL(`data:image/png;base64,${data}`).toBitmap()
    return Array.from(bitmap.subarray((2 * 64 + 32) * 4, (2 * 64 + 32) * 4 + 4))
  }, image)
}

test('tray icon choices persist and follow the active app palette', async ({ app, page }, testInfo) => {
  await goToSettingsSection(page, 'appearance')
  await page.getByRole('button', { name: 'Tray icon', exact: true }).click()
  let choices = page.getByRole('group', { name: 'Tray icon', exact: true })
  for (const label of await choices.locator('label').all()) {
    await expect(label).not.toHaveText('')
  }
  await choices.locator('input[value="dracula"]').check()
  await expect.poll(() => cachedIcon(app)).not.toBeNull()
  const fixedIcon = await cachedIcon(app)
  await expect.poll(async () => latestSettings(readDatastore(app.userDataDir, 'settings')).trayIconPreset).toBe('dracula')
  await setSetting(page, 'BaseTheme', 'light')
  await expect.poll(() => cachedIcon(app)).toBe(fixedIcon)
  await choices.locator('input[value="theme"]').check()
  await expect.poll(async () => [null, fixedIcon].includes(await cachedIcon(app))).toBe(false)
  const lightIcon = await cachedIcon(app)
  await setSetting(page, 'BaseTheme', 'dark')
  await expect.poll(async () => [null, lightIcon].includes(await cachedIcon(app))).toBe(false)
  const darkIcon = await cachedIcon(app)
  ;({ page } = await app.relaunch())
  choices = page.getByRole('group', { name: 'Tray icon', exact: true })
  await expect.poll(() => cachedIcon(app)).toBe(darkIcon)
  await goToSettingsSection(page, 'appearance')
  await page.getByRole('button', { name: 'Tray icon', exact: true }).click()
  await expect(choices.locator('input[value="theme"]')).toBeChecked()
  await setSetting(page, 'BaseTheme', 'system')
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
    await expect.poll(() => choices.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.locator('.settingsWindow').screenshot({ path: testInfo.outputPath(`tray-icon-selector-${colorScheme}.png`), animations: 'disabled' })
  }
  await setSetting(page, 'SystemDarkTheme', 'dracula')
  await setSetting(page, 'BaseTheme', 'system')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => backgroundPixel(app)).toEqual([0x36, 0x2a, 0x28, 255])
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => cachedIcon(app)).toBe(lightIcon)
  const custom = { ...DEFAULT_CUSTOM_THEME, id: 'tray-test', name: 'Tray test', colors: { ...DEFAULT_CUSTOM_THEME.colors, background: '#123456', logoPrimary: '#abcdef' } }
  await page.evaluate(theme => window.ftElectron.saveCustomTheme(theme), custom)
  await setSetting(page, 'BaseTheme', 'custom:tray-test')
  await expect.poll(() => backgroundPixel(app)).toEqual([0x56, 0x34, 0x12, 255])
  // The monochrome icon gets its own cache file, which tells the next start to adapt it to the panel.
  await choices.locator('input[value="monochrome"]').check()
  await expect.poll(() => cachedIcon(app, 'tray-iconTemplate.png')).not.toBeNull()
  await expect.poll(() => cachedIcon(app)).toBeNull()
  await choices.locator('input[value="default"]').check()
  await expect.poll(() => cachedIcon(app, 'tray-iconTemplate.png')).toBeNull()
  await expect.poll(() => cachedIcon(app)).toBeNull()
})

test('tray icon selector clamps and resets its scroller at fractional UI scale', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.1)
  })
  await setWindowSize(app, page, { width: 800, height: 600 })
  await goToSettingsSection(page, 'appearance')
  await page.getByRole('button', { name: 'Tray icon', exact: true }).click()
  const scroller = page.locator('.settingsSubpageScroll').filter({ has: page.locator('.appIconPresets') })
  await scroller.evaluate(element => {
    const viewport = element.querySelector('[data-overlayscrollbars-viewport]') ?? element
    viewport.scrollTop = viewport.scrollHeight
  })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  const previousOffset = await scroller.evaluate(element => element.scrollTop)
  await setWindowSize(app, page, { width: 900, height: 1000 })
  // Crossing the desktop breakpoint restores a floating settings window.
  // Maximize it so the scroll viewport actually grows and its range shortens.
  await page.locator('.settingsWindow').getByRole('button', { name: 'Maximize', exact: true }).click()
  await expect.poll(() => scroller.evaluate(element => {
    const viewport = element.querySelector('[data-overlayscrollbars-viewport]') ?? element
    return Math.max(0, viewport.scrollTop - (viewport.scrollHeight - viewport.clientHeight))
  })).toBeLessThanOrEqual(1)
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(previousOffset)
  await expect.poll(() => scroller.evaluate(element => {
    const content = element.querySelector('.appIconPresets').getBoundingClientRect()
    const viewport = element.getBoundingClientRect()
    return content.bottom + parseFloat(getComputedStyle(element).paddingBottom) - viewport.bottom
  })).toBeGreaterThanOrEqual(-1)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  await page.locator('.settingsBreadcrumbParent').click()
  await page.getByRole('button', { name: 'Tray icon', exact: true }).click()
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
})

test('starting another renderer preserves the saved tray icon while settings load', async ({ app, page }) => {
  await setSetting(page, 'TrayIconPreset', 'dracula')
  await expect.poll(() => cachedIcon(app)).not.toBeNull()
  await app.electronApp.evaluate(({ Tray }) => {
    const original = Tray.prototype.setImage
    globalThis.trayDefaultResets = 0
    Tray.prototype.setImage = function (image) {
      if (typeof image === 'string') globalThis.trayDefaultResets++
      return original.call(this, image)
    }
  })
  await page.reload()
  await expect(page.locator('.topNav')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getTrayIconPreset)).toBe('dracula')
  expect(await app.electronApp.evaluate(() => globalThis.trayDefaultResets)).toBe(0)
})
