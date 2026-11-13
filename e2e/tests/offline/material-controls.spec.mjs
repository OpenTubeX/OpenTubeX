import { test, expect, expectScrollAtRenderedEnd, goToSettingsSection, sel, setWindowSize } from '../../helpers/app.mjs'

for (const baseTheme of ['dark']) {
  test.describe(`outlined selects in ${baseTheme}`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme, rememberHistory: true, enableWatchStats: true } } })

    test('select menus fit their full option labels without a selection gutter', { tag: '@scale' }, async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const [category, name] of [['theme', 'Tab Layout'], ['general', /Language preference|Locale Preference/]]) {
        const section = await goToSettingsSection(page, category)
        const select = section.getByRole('combobox', { name, exact: true })
        await select.click()
        const menu = page.getByRole('listbox')
        const screenshot = testInfo.outputPath(`select-option-width-${category}.png`)
        await menu.screenshot({ path: screenshot })
        await testInfo.attach(`select-option-width-${category}`, { path: screenshot, contentType: 'image/png' })
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          const clipping = await menu.getByRole('option').evaluateAll(options => options.map(option => {
            const range = document.createRange()
            range.selectNodeContents(option.querySelector('.optionName'))
            const text = range.getBoundingClientRect()
            const row = option.getBoundingClientRect()
            const style = getComputedStyle(option)
            return {
              label: option.innerText,
              missingSpace: Math.max(row.left + parseFloat(style.paddingLeft) - text.left,
                text.right - row.right + parseFloat(style.paddingRight))
            }
          }))
          for (const { label, missingSpace } of clipping) {
            expect(missingSpace, `${direction}: ${label} fits inside its option`).toBeLessThanOrEqual(0.01)
          }
        }
        await select.press('Escape')
      }
    })
  })
}

test.describe('select indicators', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        highlightChangedSettings: true,
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerSyncSettings: true,
        syncServerToken: 'e2e-select-indicators',
        enableScreenshot: true,
        screenshotMode: 'clipboard',
        defaultVideoFormat: 'legacy',
        landingPage: 'history'
      }
    }
  })

  test('places sync and reset after selects with and without tooltips', async ({ app, page, uiScale }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const width of [1200, 400]) {
      // Keep the CSS viewport width independent of the UI scale.
      await setWindowSize(app, page, { width: Math.round(width * uiScale / 100), height: width === 1200 ? 800 : 900 })
      for (const [category, name] of [['general', 'Default Landing Page'], ['general', 'On Startup'], ['player', 'Screenshot Mode'], ['player', 'Default Media Format'], ['player', 'Default Quality']]) {
        if (await page.locator('.settingsBackButton').isVisible()) {
          await page.locator('.settingsBackButton').click()
        }
        const section = await goToSettingsSection(page, category)
        const root = section.locator('.select').filter({ hasText: name })
        const select = root.getByRole('combobox')
        await expect(select).toHaveAccessibleName(name)
        await expect(root.locator('.select-label button')).toHaveCount(0)
        await expect(root.locator('.selectIndicators .syncedSettingIndicator')).toBeVisible()
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          await select.scrollIntoViewIfNeeded()
          const geometry = await root.evaluate(element => {
            const field = element.querySelector('.select-text').getBoundingClientRect()
            const outline = element.querySelector('.selectOutline').getBoundingClientRect()
            const icons = element.querySelector('.selectIndicators').getBoundingClientRect()
            const viewport = element.closest('.settingsContent').getBoundingClientRect()
            const bounds = element.getBoundingClientRect()
            const rtl = getComputedStyle(element).direction === 'rtl'
            return {
              gap: rtl ? field.left - icons.right : icons.left - field.right,
              outlineOffset: Math.max(Math.abs(outline.left - field.left), Math.abs(outline.right - field.right)),
              centers: Math.abs(field.top + field.height / 2 - icons.top - icons.height / 2),
              overflow: Math.max(viewport.left - icons.left, icons.right - viewport.right),
              rootOverflow: Math.max(bounds.left - icons.left, icons.right - bounds.right)
            }
          })
          expect(geometry.gap).toBeGreaterThanOrEqual(7)
          expect(geometry.gap).toBeLessThanOrEqual(9)
          expect(geometry.outlineOffset).toBeLessThanOrEqual(1)
          expect(geometry.centers).toBeLessThanOrEqual(1)
          expect(geometry.overflow).toBeLessThanOrEqual(1)
          expect(geometry.rootOverflow).toBeLessThanOrEqual(1)
        }
        await page.evaluate(() => { document.body.dir = 'ltr' })
        if (name === 'Screenshot Mode') {
          await expect(root.locator('.selectIndicators .changedSettingIndicator')).toBeVisible()
          await root.locator('..').screenshot({ path: testInfo.outputPath(`screenshot-mode-${width}.png`) })
        }
      }
    }
    if (await page.locator('.settingsBackButton').isVisible()) {
      await page.locator('.settingsBackButton').click()
    }
    const general = await goToSettingsSection(page, 'general')
    const landing = general.getByRole('combobox', { name: 'Default Landing Page', exact: true }).locator('..')
    await landing.getByRole('button', { name: 'Stop syncing this setting', exact: true }).click()
    await expect(landing.getByRole('button', { name: 'Sync this setting', exact: true })).toBeVisible()
    await landing.getByRole('button', { name: 'Reset this setting to its default', exact: true }).click()
    await expect(landing.getByRole('combobox')).toHaveAccessibleDescription('Home')
  })
})

test.describe('modal control regressions', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'dark' } } })

  test('organizer combines group appearance controls', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator(sel.tabOrganizerButton).click()
    const organizer = page.getByRole('dialog', { name: 'Tab Organizer' })
    await organizer.getByRole('button', { name: 'Create Group', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Create Group', exact: true })
    const input = form.getByRole('textbox', { name: 'Group name', exact: true })
    const create = form.getByRole('button', { name: 'Create Group', exact: true })
    await input.fill('Appearance')
    await create.click()
    const group = organizer.locator('.tabGroup').filter({ hasText: 'Appearance' })
    await expect.soft(group.locator('.groupColorButton')).toHaveCount(0)
    const trigger = group.locator('.groupIconButton')
    await trigger.click()
    const colors = group.locator('.groupColorPicker')
    await expect(colors).toBeVisible({ timeout: 1000 })
    const icons = group.locator('.groupIconPicker')
    const [colorsBox, iconsBox] = await Promise.all([colors.boundingBox(), icons.boundingBox()])
    expect(colorsBox.y + colorsBox.height).toBeLessThanOrEqual(iconsBox.y)
    expect(await icons.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0)
    const [colorChoice, iconChoice] = await Promise.all([colors.locator('button').first().boundingBox(), icons.locator('button').first().boundingBox()])
    expect.soft(Math.abs(colorChoice.width - iconChoice.width)).toBeLessThanOrEqual(0.1)
    expect.soft(Math.abs(colorChoice.height - iconChoice.height)).toBeLessThanOrEqual(0.1)
    await colors.getByRole('option', { name: 'Blue', exact: true }).click()
    await expect(icons).toBeVisible()
    await expect(trigger).toHaveCSS('color', await colors.getByRole('option', { name: 'Blue', exact: true }).locator('.groupColor').evaluate(element => getComputedStyle(element).backgroundColor))
    await icons.getByRole('button', { name: 'Research', exact: true }).click()
    await expect(trigger.locator('[data-icon="flask"]')).toBeVisible()
    await expect(icons).toBeVisible({ timeout: 1000 })
    if (uiScale === 100) {
      await group.locator('.groupAppearancePicker').screenshot({ path: testInfo.outputPath('combined-group-picker.png') })
    }
    await page.keyboard.press('Escape')
    await expect(icons).toBeHidden()
    await expect(organizer).toBeVisible()
    await expect(trigger).toBeFocused()
    for (const width of [400, 360]) {
      await setWindowSize(app, page, { width, height: width + 450 })
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        await trigger.click()
        const pickerBox = await group.locator('.groupAppearancePicker').boundingBox()
        const viewport = await page.evaluate(() => innerWidth)
        expect(pickerBox.x).toBeGreaterThanOrEqual(0)
        expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(viewport)
        await organizer.getByRole('searchbox', { name: 'Search tabs', exact: true }).focus()
        await expect(icons).toBeHidden()
      }
    }
  })

  test('group Unload All is disabled for the sole open tab', async ({ page }) => {
    await page.evaluate(async () => {
      const state = await window.ftElectron.tabs.getState()
      const group = await window.ftElectron.tabs.createGroup({ name: 'Only tab' })
      await window.ftElectron.tabs.setGroup(state.tabs.map(tab => tab.id), group.id)
    })
    await page.locator(sel.tabOrganizerButton).click()
    const group = page.locator('.tabGroup').filter({ hasText: 'Only tab' })
    const unload = group.getByRole('button', { name: 'Unload All' })
    await expect(unload).toBeDisabled({ timeout: 1000 })
    const extraId = await page.evaluate(async () => (await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })).id)
    await expect(unload).toBeEnabled()
    await page.evaluate(id => window.ftElectron.tabs.close(id), extraId)
    await expect(unload).toBeDisabled()
  })
})

for (const width of [360, 400, 680, 760, 1000, 1200]) {
  test.describe(`settings window at ${width}px`, { tag: '@scale' }, () => {
    test.use({ seed: async ({ uiScale }, use) => use({ settings: { currentLocale: 'en-US', baseTheme: uiScale === 100 ? 'dark' : 'light', bounds: { x: 0, y: 0, width: 1400, height: 1000, maximized: false } } }) })

    test('keeps subscription controls inside a resized desktop settings window', async ({ page, uiScale }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(width => {
        localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 20, y: 20, width, height: 800 }))
      }, width)
      const section = await goToSettingsSection(page, 'subscription')
      const content = page.locator('.settingsContent')
      await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        const clipped = await section.evaluate(element => {
          const viewport = element.closest('.settingsContent').getBoundingClientRect()
          return Array.from(element.querySelectorAll('.switch-label, .switch-label-text, .select-text, .selectIndicators > *, .pure-material-slider, .subscriptionChannelSettingsManager .btn'))
            .filter(control => {
              const rect = control.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0 && (rect.left < viewport.left - 1 || rect.right > viewport.right + 1)
            })
            .map(control => ({ className: control.className, text: control.textContent.trim() }))
        })
        expect.soft(clipped, direction).toEqual([])
        expect.soft(await content.evaluate(element => element.scrollWidth - element.clientWidth), direction).toBeLessThanOrEqual(1)
      }
      if (uiScale === 100 && width === 360) {
        await page.evaluate(() => { document.body.dir = 'ltr' })
        const screenshot = testInfo.outputPath('narrow-subscription-settings.png')
        await page.locator('.settingsWindow').screenshot({ path: screenshot })
        await testInfo.attach('narrow-subscription-settings', { path: screenshot, contentType: 'image/png' })
      }
    })
  })
}

test.describe('paired switch alignment', { tag: '@scale' }, () => {
  test.use({ seed: async ({ uiScale }, use) => use({ settings: { currentLocale: 'en-US', baseTheme: uiScale === 100 ? 'dark' : 'light', bounds: { x: 0, y: 0, width: 1600, height: 1000, maximized: false } } }) })

  test('centers switches within changed markers and beside caption selects', async ({ app, page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const section = await goToSettingsSection(page, 'playback')
    const quick = section.locator('.quickPlaybackSpeedToggle')
    await quick.locator('input').press('Space')
    await expect(quick.locator('.changedSettingIndicator')).toBeVisible()
    for (const width of [1200, 480, 1201]) {
      const scroller = page.locator('.settingsContent')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await setWindowSize(app, page, { width, height: width === 480 ? 850 : width === 1200 ? 900 : 901 })
      if (width === 1201) {
        await expect.poll(() => scroller.evaluate(element => {
          const content = element.querySelector(':scope > .section')
          const viewport = element.getBoundingClientRect()
          const remaining = content.getBoundingClientRect().bottom + parseFloat(getComputedStyle(content).marginBottom) + parseFloat(getComputedStyle(element).paddingBottom) - viewport.bottom
          return Math.max(-element.scrollTop, -remaining) * devicePixelRatio
        })).toBeLessThanOrEqual(2)
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expectScrollAtRenderedEnd(scroller)
        await expect.poll(() => scroller.evaluate(element => {
          const track = element.querySelector('.os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect()
          const thumb = element.querySelector('.os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect()
          return Math.abs(thumb.bottom - track.bottom) * devicePixelRatio
        })).toBeLessThanOrEqual(2)
      }
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        for (const toggle of [quick, section.locator('[data-setting-key="enableCaptionTranslations"]')]) {
          await toggle.scrollIntoViewIfNeeded()
          const centers = await toggle.evaluate(element => {
            const root = element.getBoundingClientRect()
            const label = element.querySelector('.switch-label').getBoundingClientRect()
            return Math.abs(root.top + root.height / 2 - label.top - label.height / 2)
          })
          expect.soft(centers, `${direction} marker center`).toBeLessThanOrEqual(0.1)
        }
        const paired = await section.locator('.captionControls').evaluate(element => {
          const select = element.querySelector('.select-text').getBoundingClientRect()
          const toggle = element.querySelector('.switch-label').getBoundingClientRect()
          return {
            columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
            offset: Math.abs(select.top + select.height / 2 - toggle.top - toggle.height / 2),
            gap: toggle.top - select.bottom
          }
        })
        const rows = await section.locator('.captionControls').evaluate(element => {
          const columns = getComputedStyle(element).gridTemplateColumns.split(' ').length
          const controls = [...element.querySelectorAll(':scope > .captionControl')]
          const boxes = controls.map(control => control.getBoundingClientRect())
          const formHeight = parseFloat(getComputedStyle(element).getPropertyValue('--form-control-height'))
          const extraSpace = []
          for (let index = 0; index < controls.length; index += columns) {
            const contentHeight = Math.max(...controls.slice(index, index + columns).flatMap(control => [...control.children].map(child => child.getBoundingClientRect().height)))
            extraSpace.push(boxes[index].height - Math.max(formHeight, contentHeight))
          }
          return { extraSpace, gaps: boxes.slice(columns).map((box, index) => box.top - boxes[index].bottom) }
        })
        expect.soft(Math.max(...rows.extraSpace), 'caption rows fit their controls').toBeLessThanOrEqual(1)
        expect.soft(Math.max(...rows.gaps.map(gap => Math.abs(gap - 20))), 'shared caption row gap').toBeLessThanOrEqual(0.1)
        if (paired.columns > 1) {
          expect.soft(paired.offset, `${direction} caption control centers`).toBeLessThanOrEqual(0.1)
        } else {
          expect(paired.gap).toBeGreaterThan(0)
        }
      }
      await page.evaluate(() => { document.body.dir = 'ltr' })
      await quick.screenshot({ path: testInfo.outputPath(`centered-switch-marker-${width}.png`) })
      await section.locator('.captionControls').screenshot({ path: testInfo.outputPath(`aligned-caption-controls-${width}.png`) })
    }
  })
})

for (const { name, theme, width, height, scale, rtl } of [
  { name: 'dark desktop', theme: 'dark', width: 1600, height: 900, scale: 100 },
  { name: 'small phone', theme: 'dark', width: 375, height: 812, scale: 100 },
  { name: 'RTL landscape at 125%', theme: 'light', width: 812, height: 375, scale: 125, rtl: true },
]) {
  test.describe(name, () => {
    test.use({
      seed: {
        settings: {
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
          rememberHistory: false,
          saveVideoHistoryWithLastViewedPlaylist: false,
          bounds: { x: 0, y: 0, width, height, maximized: false }
        }
      }
    })

    test('Material switches keep labels, keyboard interaction and disabled states', async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
      await expect(page.locator('body')).toHaveClass(new RegExp(theme))
      if (rtl) await page.evaluate(() => { document.body.dir = 'rtl' })
      const section = await goToSettingsSection(page, 'privacy')
      const control = section.locator('[data-setting-key="rememberHistory"]')
      const input = control.locator('input')
      const label = control.locator('.switch-label')
      const dependent = section.locator('[data-setting-key="saveVideoHistoryWithLastViewedPlaylist"] input')
      await expect(input).not.toBeChecked()
      await expect(dependent).toBeDisabled()
      const touch = await page.evaluate(() => matchMedia('(any-pointer: coarse), (width <= 680px)').matches)
      await expect(label).toHaveCSS('min-height', touch ? '48px' : '36px')
      const geometry = await label.evaluate(element => {
        const track = getComputedStyle(element.querySelector('.switch-label-text'), '::before')
        const thumb = getComputedStyle(element.querySelector('.switch-thumb'))
        const text = element.querySelector('.switch-label-text').getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return {
          trackWidth: parseFloat(track.width),
          trackHeight: parseFloat(track.height),
          thumbWidth: parseFloat(thumb.width),
          duration: thumb.transitionDuration,
          textClearance: getComputedStyle(element).direction === 'rtl'
            ? bounds.right - text.right
            : text.left - bounds.left
        }
      })
      expect(geometry.duration).toBe('0s')
      for (const [key, value] of Object.entries({ trackWidth: 40, trackHeight: 24, thumbWidth: 18, textClearance: 58 })) {
        expect(geometry[key]).toBeCloseTo(value, 1)
      }

      await input.focus()
      await input.press('Space')
      await expect(input).toBeChecked()
      await expect(dependent).toBeEnabled()
      await expect.poll(() => label.evaluate(element => parseFloat(getComputedStyle(element.querySelector('.switch-thumb')).width))).toBeCloseTo(18, 1)
      expect(await label.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
      await label.hover()
      await page.mouse.down()
      expect(await label.evaluate(element => parseFloat(getComputedStyle(element.querySelector('.switch-thumb')).width))).toBeCloseTo(20, 1)
      expect(await label.evaluate(element => parseFloat(getComputedStyle(element).paddingInlineStart) + parseFloat(getComputedStyle(element.querySelector('.switch-thumb')).insetInlineStart))).toBeCloseTo(24, 1)
      await page.mouse.up()
      await expect(input).not.toBeChecked()
      await expect(dependent).toBeDisabled()
      await dependent.locator('..').locator('.switch-label').click({ force: true })
      await expect(dependent).not.toBeChecked()

      // Fractional Electron zoom offsets Playwright's element screenshot crop.
      // Keep the interaction checks above at the configured scale.
      if (scale !== 100) await page.evaluate(() => window.ftElectron.setZoomFactor(1))
      await label.scrollIntoViewIfNeeded()
      const screenshot = testInfo.outputPath('material-switches.png')
      await section.locator('.switchColumnGrid').first().screenshot({ path: screenshot })
      await testInfo.attach('material-switches', { path: screenshot, contentType: 'image/png' })
    })
  })
}
