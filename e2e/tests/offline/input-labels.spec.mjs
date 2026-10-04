import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'
import { test, expect, goTo, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

async function expectVisibleLabels(scope) {
  const missing = await scope.locator('input, textarea').evaluateAll(elements => elements
    .filter(element => ['text', 'search', 'url', 'number', 'password', 'email', 'tel', 'textarea'].includes(element.type) && element.checkVisibility() && !element.matches('.topNav .searchInput input, .settingsSearch input, .commandPalette input, .playlistSearch, .tabOrganizerSearch input, .groupRenameInput'))
    .filter(element => !Array.from(element.labels ?? []).some(label => label.checkVisibility() && label.textContent.trim()))
    .map(element => ({ id: element.id, placeholder: element.placeholder, className: element.className })))
  expect(missing).toEqual([])
  const withoutPlaceholder = await scope.locator('input, textarea').evaluateAll(elements => elements
    .filter(element => ['text', 'search', 'url', 'number', 'password', 'email', 'tel', 'textarea'].includes(element.type) && element.checkVisibility())
    .filter(element => !element.placeholder.trim())
    .map(element => ({ id: element.id, label: Array.from(element.labels ?? []).map(label => label.textContent.trim()).join(' '), className: element.className })))
  expect(withoutPlaceholder).toEqual([])
}

for (const width of [1600, 480]) {
  test.describe(`persistent input labels at ${width}px`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'dark', iconPack: width === 480 ? 'remix' : 'material', uiScale: 95, enableScreenshot: true, bounds: { x: 0, y: 0, width: 1400, height: 800, maximized: false } } } })

    test('custom engine labels remain visible while adding and editing an engine', async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width, height: 1000 })
      const section = await goToSettingsSection(page, 'context-menu-search')
      const form = section.locator('.addEngine')
      const name = form.getByLabel('Engine name', { exact: true })
      const url = form.getByLabel('Search URL', { exact: true })
      await expect(name).toHaveAttribute('placeholder', 'e.g. DuckDuckGo')
      await expect(url).toHaveAttribute('placeholder', 'https://example.com/search?q=%s')
      await expectVisibleLabels(form)
      await name.fill('Example engine')
      await url.fill('https://example.com/search?q=%s')
      await form.getByRole('button', { name: 'Add engine', exact: true }).click()
      const row = section.locator('.engineRow').filter({ has: page.getByLabel('Engine name', { exact: true }) })
      await expect(row.getByLabel('Engine name', { exact: true })).toHaveValue('Example engine')
      const removeButton = row.getByRole('button', { name: 'Remove Example engine', exact: true })
      await expect(removeButton).toHaveText('Delete')
      await expect(removeButton).toHaveClass(/destructive/)
      await expect(removeButton.locator('[data-icon="trash"]')).toBeVisible()
      await expectVisibleLabels(row)
      await row.getByLabel('Engine name', { exact: true }).fill('Renamed engine')
      await row.getByLabel('Search URL', { exact: true }).focus()
      await expect(row).toContainText('Renamed engine')
      await expectVisibleLabels(form)
      await page.locator('.settingsContent').evaluate(element => { element.scrollTop = element.scrollHeight })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await expect.poll(() => page.locator('.settingsContent').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await captureAppFramebuffer(app, testInfo, `custom-engine-labels-${width}`)
      await row.getByRole('button', { name: 'Remove Renamed engine', exact: true }).click()
      await expect(row).toHaveCount(0)
    })
  })
}

test('the main search keeps its familiar placeholder without a visible label', async ({ app, page }) => {
  for (const width of [1600, 480]) {
    const zoom = await app.electronApp.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ width, height: 1000 })
      return window.webContents.getZoomFactor()
    }, width)
    await expect.poll(() => page.evaluate(({ width, zoom }) => Math.abs(innerWidth - width / zoom), { width, zoom })).toBeLessThanOrEqual(1)
    for (const [locale, placeholder] of [['en-US', 'Search / Go to URL'], ['de-DE', 'Suchen / URL öffnen']]) {
      await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
      const field = page.locator('.topNav .searchInput')
      if (!await field.isVisible()) await page.locator('.navSearchButton').click()
      const input = field.locator('input')
      await expect(input).toHaveAttribute('placeholder', placeholder)
      await expect(input).toHaveAccessibleName(placeholder)
      await expect(field.locator('label')).toHaveCount(0)
      await input.fill('test')
      await expect(field.locator('label')).toHaveCount(0)
      await input.clear()
    }
  }
})

test('settings header search keeps its icon and original placeholder without visible label text', async ({ app, page }) => {
  await goToSettingsSection(page, 'general')
  for (const width of [1500, 480]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
    for (const [locale, placeholder] of [['en-US', 'Search settings'], ['de-DE', 'Einstellungen durchsuchen']]) {
      await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
      const search = page.locator('.settingsSearch')
      const input = search.locator('input')
      await expect(input).toHaveAttribute('placeholder', placeholder)
      await expect(input).toHaveAccessibleName(placeholder)
      await expect(search.locator('.textInputLabelText')).toHaveCount(0)
      await expect(search.locator('.ft-icon')).toBeVisible()
      const geometry = await search.evaluate(element => {
        const input = element.querySelector('input').getBoundingClientRect()
        const icon = element.querySelector('.ft-icon').getBoundingClientRect()
        return { before: icon.right < input.left, centerOffset: Math.abs(input.top + input.height / 2 - icon.top - icon.height / 2) }
      })
      expect(geometry.before).toBe(true)
      expect(geometry.centerOffset).toBeLessThanOrEqual(1)
    }
  }
})

test('settings, page searches, and compact search overlays have visible associated labels', async ({ page }) => {
  for (const section of ['general', 'appearance', 'playback', 'download', 'add-ons', 'subscriptions', 'focus', 'privacy', 'data', 'storage', 'sync', 'advanced']) {
    await goToSettingsSection(page, section)
    await expectVisibleLabels(page.locator('.settingsWindow'))
  }
  await page.locator('.settingsSearch input').fill('Screenshot')
  await expectVisibleLabels(page.locator('.settingsWindow'))
  await page.locator('.settingsSearch input').press('Escape')
  await goTo(page, 'userplaylists')
  await expectVisibleLabels(page.locator('#app'))
  await page.keyboard.press('Control+f')
  await expect(page.locator('.findbar')).toBeVisible()
  await expectVisibleLabels(page.locator('.findbar'))
  await page.locator('.findbarInput').fill('Playlist')
  await expectVisibleLabels(page.locator('.findbar'))
  await page.locator('.findbarInput').press('Escape')
  await page.keyboard.press('Control+k')
  await expect(page.locator('.commandPalette')).toBeVisible()
  await expect(page.locator('.commandPalette .textInputLabelText')).toHaveCount(0)
})

test('credentials and native theme fields offer hints while retaining their labels', async ({ page }) => {
  await page.evaluate(() => Object.assign(
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings,
    { useProxy: true, proxyProtocol: 'http', syncServerEnabled: true, enableScreenshot: true }
  ))
  const advanced = await goToSettingsSection(page, 'advanced')
  await expect(advanced.getByLabel('Proxy Username', { exact: true })).toHaveAttribute('placeholder', 'e.g. alex')
  await expect(advanced.getByLabel('Proxy Password', { exact: true })).toHaveAttribute('placeholder', 'Enter your password')
  await expectVisibleLabels(advanced)
  const sync = await goToSettingsSection(page, 'sync')
  await expect(sync.getByLabel('Username', { exact: true })).toHaveAttribute('placeholder', 'e.g. alex')
  await expect(sync.getByLabel('Password', { exact: true })).toHaveAttribute('placeholder', 'Enter your password')
  await expect(sync.getByLabel('Privacy passphrase', { exact: true })).toHaveAttribute('placeholder', 'Enter your encryption passphrase')
  await expectVisibleLabels(sync)
  const playback = await goToSettingsSection(page, 'playback')
  await expectVisibleLabels(playback)
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
  const themeName = page.locator('.customThemeEditor .themeNameField input')
  await expect(themeName).toHaveAttribute('placeholder', 'e.g. Dark')
  await themeName.fill('Example theme')
  await expectVisibleLabels(page.locator('.customThemeEditor'))
})
