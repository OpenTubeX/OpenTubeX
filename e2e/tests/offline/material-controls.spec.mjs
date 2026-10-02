import { test, expect, goTo, goToSettingsSection, sel, setWindowSize } from '../../helpers/app.mjs'

const DOWNLOAD_FOLDER_DESCRIPTION = "Videos are saved to this folder. Leave blank to use your system's Downloads folder. Leave blank to use your Downloads folder"

for (const baseTheme of ['dark', 'light']) {
  for (const uiScale of [100, 95]) {
    test.describe(`outlined selects in ${baseTheme} at ${uiScale}% scale`, () => {
      test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme, uiScale, rememberHistory: true, enableWatchStats: true } } })

      test('default selects round every corner with UI Roundness', async ({ app, page }, testInfo) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const section = await goToSettingsSection(page, 'general')
        const select = section.getByRole('combobox', { name: 'Week Starts On', exact: true })
        await expect(select.locator('..')).toHaveClass(/outlined/)
        await select.hover()
        const hoverBorders = await select.evaluate(element => {
          const style = getComputedStyle(element)
          return [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor]
        })
        expect(new Set(hoverBorders).size).toBe(1)
        for (const width of [1200, 400]) {
          await setWindowSize(app, page, { width, height: width === 1200 ? 800 : 900 })
          for (const roundness of [0, 50, 100, 200]) {
            await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), roundness)
            for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
              await expect(select).toHaveCSS(`border-${corner}-radius`, `${4 * roundness / 100}px`)
            }
            for (const edge of ['top', 'right', 'bottom', 'left']) {
              expect(await select.evaluate((element, edge) => parseFloat(getComputedStyle(element).getPropertyValue(`border-${edge}-width`)), edge)).toBeGreaterThan(0)
            }
          }
        }
        await select.click()
        await expect(page.getByRole('listbox')).toBeVisible()
        await page.getByRole('option', { name: 'Monday', exact: true }).click()
        await expect(select).toHaveAccessibleDescription('Monday')
        await select.blur()
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', 100))
        const narrowScreenshot = testInfo.outputPath('outlined-selects-narrow.png')
        await page.locator('.settingsWindow').screenshot({ path: narrowScreenshot })
        await testInfo.attach('outlined-selects-narrow', { path: narrowScreenshot, contentType: 'image/png' })
        await setWindowSize(app, page, { width: 1200, height: 800 })
        const screenshot = testInfo.outputPath('outlined-selects.png')
        await page.locator('.settingsWindow').screenshot({ path: screenshot })
        await testInfo.attach('outlined-selects', { path: screenshot, contentType: 'image/png' })
      })
    })
  }
}

test('closed selects announce their current choice', async ({ page }) => {
  const section = await goToSettingsSection(page, 'download')
  const select = section.getByRole('combobox', { name: 'Concurrent downloads', exact: true })
  await expect(select).toHaveAccessibleDescription('2')
  await select.press('ArrowDown')
  await expect(select).toHaveAccessibleDescription('3')
})

for (const uiScale of [100, 95]) {
  test.describe(`select indicators at ${uiScale}% scale`, () => {
    test.use({
      seed: {
        settings: {
          currentLocale: 'en-US',
          uiScale,
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

    test('places sync and reset after selects with and without tooltips', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const width of [1200, 400]) {
        await setWindowSize(app, page, { width, height: width === 1200 ? 800 : 900 })
        for (const [category, name] of [['general', 'Default Landing Page'], ['general', 'On Startup'], ['player', 'Screenshot Mode'], ['player', 'Default Video Format'], ['player', 'Default Quality']]) {
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
              const icons = element.querySelector('.selectIndicators').getBoundingClientRect()
              const viewport = element.closest('.settingsContent').getBoundingClientRect()
              const bounds = element.getBoundingClientRect()
              const rtl = getComputedStyle(element).direction === 'rtl'
              return {
                gap: rtl ? field.left - icons.right : icons.left - field.right,
                centers: Math.abs(field.top + field.height / 2 - icons.top - icons.height / 2),
                overflow: Math.max(viewport.left - icons.left, icons.right - viewport.right),
                rootOverflow: Math.max(bounds.left - icons.left, icons.right - bounds.right)
              }
            })
            expect(geometry.gap).toBeGreaterThanOrEqual(7)
            expect(geometry.gap).toBeLessThanOrEqual(9)
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
}

test('inputs announce tooltip guidance together with supporting text', async ({ page }) => {
  const downloads = await goToSettingsSection(page, 'download')
  const folder = downloads.getByRole('textbox', { name: 'Download Folder', exact: true })
  await expect(folder).toHaveAccessibleDescription(DOWNLOAD_FOLDER_DESCRIPTION)
  await folder.focus()
  await expect(folder).toHaveAccessibleDescription(DOWNLOAD_FOLDER_DESCRIPTION)
  await expect(downloads.getByRole('textbox', { name: 'Additional yt-dlp arguments', exact: true }))
    .toHaveAccessibleDescription('Additional command line arguments passed to yt-dlp for every download, for example --cookies-from-browser firefox.')
  const privacy = await goToSettingsSection(page, 'privacy')
  await expect(privacy.getByLabel('Password', { exact: true }))
    .toHaveAccessibleDescription('Set a password to prevent access to settings')
})

for (const scale of [100, 95]) {
  test.describe(`modal control regressions at ${scale}% scale`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', uiScale: scale, baseTheme: 'dark' } } })

    test('search filter header omits active options and Close keeps its border', async ({ page }, testInfo) => {
      await page.locator('.navFilterButton').click()
      const prompt = page.locator('.searchFiltersCard')
      await prompt.getByText('Today', { exact: true }).click()
      await expect.soft(prompt.locator('.activeFilters')).toHaveCount(0)
      const close = prompt.getByRole('button', { name: 'Close', exact: true })
      const border = await close.evaluate(element => {
        const style = getComputedStyle(element)
        return { width: parseFloat(style.borderTopWidth), color: style.borderTopColor }
      })
      expect.soft(border.width).toBeGreaterThan(0)
      expect.soft(border.color).not.toBe('rgba(0, 0, 0, 0)')
      if (scale === 100) await close.screenshot({ path: testInfo.outputPath('outlined-filter-close.png') })
      await prompt.getByRole('button', { name: 'Clear Filters', exact: true }).click()
      await expect(prompt.getByRole('radio', { name: 'Any Time', exact: true })).toBeChecked()
    })

    test('organizer checkbox marks stay centered and disabled labels mask the border', async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.locator(sel.tabOrganizerButton).click()
      const organizer = page.getByRole('dialog', { name: 'Tab Organizer' })
      await expect(organizer.locator('.newGroupForm .select')).toHaveCount(0)
      const move = organizer.locator('.bulkActionSelect')
      await expect(move.getByRole('combobox')).toBeDisabled()
      await expect.soft(move.locator('.select-label')).toHaveCSS('opacity', '1', { timeout: 1000 })
      if (scale === 100) await move.screenshot({ path: testInfo.outputPath('disabled-organizer-select.png') })
      await organizer.getByRole('button', { name: 'Select All', exact: true }).click()
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        for (const checkbox of await organizer.locator('.tabSelection input').all()) {
          await expect(checkbox).toBeChecked()
          const offset = await checkbox.locator('+ label').evaluate(element => {
            function center(pseudo) {
              const style = getComputedStyle(element, pseudo)
              const width = parseFloat(style.width) + (style.boxSizing === 'border-box' ? 0 : parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth))
              const left = style.left === 'auto' ? element.clientWidth - parseFloat(style.right) - width : parseFloat(style.left)
              return left + width / 2 + new DOMMatrix(style.transform).e
            }
            return Math.abs(center('::before') - center('::after'))
          })
          expect.soft(offset, `checkbox center in ${direction}`).toBeLessThanOrEqual(0.1)
        }
      }
      if (scale === 100) {
        await page.evaluate(() => { document.body.dir = 'ltr' })
        await organizer.locator('.tabGroupHeader').first().screenshot({ path: testInfo.outputPath('organizer-checkboxes.png') })
      }
    })

    test('organizer combines group appearance controls', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.locator(sel.tabOrganizerButton).click()
      const organizer = page.getByRole('dialog', { name: 'Tab Organizer' })
      const form = organizer.locator('.newGroupForm')
      const input = form.getByRole('textbox')
      const create = form.getByRole('button', { name: 'Create Group' })
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
      if (scale === 100) {
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
          await input.focus()
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

    test('external-player argument entry does not repeat its label as a placeholder', async ({ page }) => {
      const section = await goToSettingsSection(page, 'advanced')
      await section.getByRole('combobox', { name: 'External Player', exact: true }).click()
      await page.getByRole('option', { name: 'mpv', exact: true }).click()
      const argument = section.getByRole('textbox', { name: 'Add an argument', exact: true })
      await argument.focus()
      await expect(argument).toHaveAttribute('placeholder', '', { timeout: 1000 })
    })
  })
}

for (const scale of [100, 95]) {
  for (const width of [360, 400, 680, 760, 1000, 1200]) {
    test.describe(`settings window at ${width}px and ${scale}% scale`, () => {
      test.use({ seed: { settings: { currentLocale: 'en-US', uiScale: scale, baseTheme: scale === 100 ? 'dark' : 'light', bounds: { x: 0, y: 0, width: 1400, height: 1000, maximized: false } } } })

      test('keeps subscription controls inside a resized desktop settings window', async ({ page }, testInfo) => {
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
        if (scale === 100 && width === 360) {
          await page.evaluate(() => { document.body.dir = 'ltr' })
          const screenshot = testInfo.outputPath('narrow-subscription-settings.png')
          await page.locator('.settingsWindow').screenshot({ path: screenshot })
          await testInfo.attach('narrow-subscription-settings', { path: screenshot, contentType: 'image/png' })
        }
      })

      test('keeps block-list labels inside narrow fields and centers the stacked password action', async ({ page }, testInfo) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.evaluate(width => {
          localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 20, y: 20, width, height: 800 }))
        }, width)
        const section = await goToSettingsSection(page, 'distraction')
        for (const panel of await section.locator('.ft-input-tags-component').all()) {
          const input = panel.locator('input.ft-input')
          for (const focused of [false, true]) {
            if (focused) await input.focus()
            else await input.blur()
            const overflow = await panel.evaluate(element => {
              const input = element.querySelector('.ft-input').getBoundingClientRect()
              const label = element.querySelector('.selectLabelText').getBoundingClientRect()
              return Math.max(input.left - label.left, label.right - input.right, input.top - label.top, label.bottom - input.bottom)
            })
            expect.soft(overflow, `label overflow with focused=${focused}`).toBeLessThanOrEqual(1)
          }
        }
        if (scale === 100 && width === 400) {
          await section.locator('.ft-input-tags-component input').last().blur()
          await section.locator('.ft-input-tags-component').last().screenshot({ path: testInfo.outputPath('narrow-block-list-field.png') })
        }
        if (await page.locator('.settingsBackButton').isVisible()) {
          await page.locator('.settingsBackButton').click()
        }
        const password = await goToSettingsSection(page, 'privacy')
        const input = password.getByLabel('Password', { exact: true })
        const button = password.getByRole('button', { name: 'Set Password', exact: true })
        await expect(button).toBeVisible()
        const contentWidth = await page.locator('.settingsContent').evaluate(element => {
          const style = getComputedStyle(element)
          return element.getBoundingClientRect().width - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd) - parseFloat(style.borderInlineStartWidth) - parseFloat(style.borderInlineEndWidth)
        })
        for (const highlight of [false, true]) {
          await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateHighlightChangedSettings', value), highlight)
          const bounds = await input.boundingBox()
          const action = await button.boundingBox()
          const stacked = action.y >= bounds.y + bounds.height
          if (contentWidth <= 680) {
            expect.soft(stacked, `password action stacking at ${contentWidth}px with highlighting=${highlight}`).toBe(true)
          }
          if (stacked) {
            expect.soft(Math.abs(action.x + action.width / 2 - bounds.x - bounds.width / 2), `password action center with highlighting=${highlight}`).toBeLessThanOrEqual(1)
          }
        }
        if (scale === 100 && width === 400) {
          await input.locator('../../..').screenshot({ path: testInfo.outputPath('centered-password-action.png') })
        }
      })
    })
  }
}

// The production bundle disables Vue's per-element devtools metadata.
async function updateControlProps(control, props) {
  await control.evaluate((element, props) => {
    const root = element.closest('.ft-input-component, .select, .btn, .pure-checkbox')
    const visited = new Set()
    function find(vnode) {
      if (!vnode || typeof vnode !== 'object' || visited.has(vnode)) return null
      visited.add(vnode)
      if (vnode.component) {
        const instance = find(vnode.component.subTree)
        if (instance) return instance
        if (vnode.component.subTree.el === root) return vnode.component
      }
      if (vnode.suspense) {
        const instance = find(vnode.suspense.activeBranch)
        if (instance) return instance
      }
      if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) {
          const instance = find(child)
          if (instance) return instance
        }
      }
      return null
    }
    const instance = find(document.querySelector('#app')._vnode)
    if (!instance) throw new Error('Material control instance not found')
    Object.assign(instance.props, props)
  }, props)
}

for (const scale of [100, 95]) {
  for (const width of [1600, 480, 375]) {
    test.describe(`input alignment at ${width}px and ${scale}% scale`, () => {
      test.use({ seed: { settings: { currentLocale: 'en-US', uiScale: scale, baseTheme: scale === 100 ? 'dark' : 'light', bounds: { x: 0, y: 0, width, height: 900, maximized: false } } } })

      test('centers channel share and subscription buttons on the same row', async ({ app, page }, testInfo) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.evaluate(async () => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          await store.dispatch('updateBackendPreference', 'invidious')
          await store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
        })
        const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
        await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
          json: {
            author: 'Alignment test channel',
            authorId: channelId,
            authorThumbnails: [{
              url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
              width: 100,
              height: 100
            }],
            authorBanners: [],
            isFamilyFriendly: true,
            subCount: 100,
            description: 'A channel description.',
            totalViews: 1000,
            joined: 1000000000,
            relatedChannels: [],
            tabs: ['about']
          }
        }))
        const tab = await page.evaluate(id => window.ftElectron.tabs.create({
          route: `/channel/${id}/about`, makeActive: false
        }), channelId)
        await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
        const row = page.locator('.channelDetails .infoActionsContainer')
        const subscribe = row.locator('.subscribeButton')
        await expect(row.locator('.shareButton .iconButton')).toBeVisible()
        for (const label of ['Subscribe', 'Unsubscribe']) {
          await expect(subscribe).toHaveText(label)
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(value => { document.body.dir = value }, direction)
            await expect.poll(() => row.evaluate(element => {
              const share = element.querySelector('.shareButton .iconButton').getBoundingClientRect()
              const subscribe = element.querySelector('.subscribeButton').getBoundingClientRect()
              return Math.abs(share.top + share.height / 2 - subscribe.top - subscribe.height / 2)
            }), { message: `${label} and Share centers in ${direction}` }).toBeLessThanOrEqual(0.1)
            if (width <= 680) {
              await expect.poll(() => row.evaluate((element, direction) => {
                const row = element.getBoundingClientRect()
                const share = element.querySelector('.shareIcon').getBoundingClientRect()
                const subscribe = element.querySelector('.ftSubscribeButton').getBoundingClientRect()
                return direction === 'ltr'
                  ? Math.max(Math.abs(share.right - row.right), Math.abs(subscribe.left - row.left))
                  : Math.max(Math.abs(share.left - row.left), Math.abs(subscribe.right - row.right))
              }, direction), { message: `${label} and Share at opposite row edges in ${direction}` }).toBeLessThanOrEqual(1)
            }
          }
          if (label === 'Subscribe') await subscribe.click()
        }
        if (scale === 100) {
          await page.evaluate(() => { document.body.dir = 'ltr' })
          const screenshot = testInfo.outputPath('aligned-channel-actions.png')
          await page.locator('.channelDetails').screenshot({ path: screenshot })
          await testInfo.attach('aligned-channel-actions', { path: screenshot, contentType: 'image/png' })
        }
        if (width <= 680) {
          for (const [setting, remainingAction] of [
            ['updateHideSharingActions', '.ftSubscribeButton'],
            ['updateHideUnsubscribeButton', '.shareIcon']
          ]) {
            await page.evaluate(async setting => {
              document.body.dir = 'ltr'
              const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
              await store.dispatch(setting, true)
            }, setting)
            await expect(row.locator(':scope > *')).toHaveCount(1)
            await expect.poll(() => row.evaluate((element, remainingAction) => {
              const row = element.getBoundingClientRect()
              const action = element.querySelector(remainingAction).getBoundingClientRect()
              return window.innerWidth <= 400
                ? Math.abs(action.left + action.width / 2 - row.left - row.width / 2)
                : Math.abs(action.left - row.left)
            }, remainingAction), { message: `${remainingAction} keeps its alignment when shown alone` }).toBeLessThanOrEqual(1)
            await page.evaluate(setting => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(setting, false), setting)
          }
        }
        if (width === 375 && scale === 100) {
          await setWindowSize(app, page, { width: 340, height: 800 })
          for (const [locale, label] of [['en-US', 'Unsubscribe'], ['de-DE', 'Deabonnieren']]) {
            await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
            await expect(subscribe).toHaveText(label)
            for (const zoom of [1.5, 2]) {
              await app.electronApp.evaluate(({ BrowserWindow }, zoom) => {
                BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom)
              }, zoom)
              await expect.poll(() => row.evaluate(element => {
                const row = element.getBoundingClientRect()
                const actions = [...element.children]
                return actions.length === 2 && actions.every(action => {
                  const rect = action.getBoundingClientRect()
                  return Math.abs(rect.left + rect.width / 2 - row.left - row.width / 2) <= 1
                })
              }), { message: `Wrapped actions remain centered at ${zoom * 100}% scale in ${locale}` }).toBe(true)
            }
          }
        }
      })

      test('floats field labels without moving values and keeps selects compact', async ({ page }, testInfo) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const section = await goToSettingsSection(page, 'download')
        const field = section.getByRole('textbox', { name: 'Download Folder', exact: true })
        const label = field.locator('..').locator('.selectLabel')
        const select = section.getByRole('combobox', { name: 'Concurrent downloads' })
        await field.evaluate(element => element.blur())
        await expect(label).toHaveCSS('font-size', '16px')
        await field.focus()
        await expect(field).toHaveAttribute('placeholder', '')
        await expect(field).toHaveAccessibleDescription(DOWNLOAD_FOLDER_DESCRIPTION)
        await expect(field).toHaveAccessibleName('Download Folder')
        await expect(label).toHaveCSS('transform', 'matrix(0.75, 0, 0, 0.75, 0, 0)')
        await field.fill('/tmp/material-downloads')
        const focusedBounds = await field.boundingBox()
        await field.evaluate(element => element.blur())
        await expect(label).toHaveCSS('transform', 'matrix(0.75, 0, 0, 0.75, 0, 0)')
        expect((await field.boundingBox()).y).toBeCloseTo(focusedBounds.y, 1)

        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          for (const variant of ['filled', 'outlined']) {
            for (const control of [field, select]) {
              await updateControlProps(control, { variant })
            }
            await expect(field.locator('../..')).toHaveClass(variant === 'outlined' ? /outlined/ : /floatingLabel/)
            const geometry = await select.evaluate(element => {
              const field = element.getBoundingClientRect()
              const label = element.parentElement.querySelector('.select-label').getBoundingClientRect()
              const value = element.querySelector('.selectedValue').getBoundingClientRect()
              return { height: field.height, labelTop: label.top - field.top, labelBottom: label.bottom, valueTop: value.top }
            })
            expect(geometry.height).toBeCloseTo(45, 1)
            expect(geometry.labelBottom).toBeLessThanOrEqual(geometry.valueTop + 1)
            expect(geometry.labelTop).toBeCloseTo(variant === 'filled' ? 4 : -7, 0)
            await expect(field).toHaveValue('/tmp/material-downloads')
          }
        }
        if (scale === 100) {
          await page.evaluate(() => { document.body.dir = 'ltr' })
          await updateControlProps(field, { variant: 'filled' })
          await updateControlProps(select, { variant: 'filled' })
          const screenshot = testInfo.outputPath('material-floating-fields.png')
          await section.locator('.downloadPathInputs').screenshot({ path: screenshot })
          await testInfo.attach('material-floating-fields', { path: screenshot, contentType: 'image/png' })
        }
      })

      test('keeps default API URLs readable after entering a custom URL', async ({ page }, testInfo) => {
        await page.evaluate(async () => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          for (const setting of ['updateUseSponsorBlock', 'updateUseDeArrowThumbnails', 'updateUseReturnYouTubeDislikes']) {
            await store.dispatch(setting, true)
          }
        })
        const section = await goToSettingsSection(page, 'add-ons')
        for (const [name, defaultUrl] of [
          ['SponsorBlock API URL', 'https://sponsor.ajay.app'],
          ['DeArrow thumbnail API URL', 'https://dearrow-thumb.ajay.app'],
          ['API URL', 'https://ryd-proxy.kavin.rocks']
        ]) {
          const input = section.getByLabel(name, { exact: true })
          await expect(input).toHaveAttribute('placeholder', defaultUrl)
          await input.fill('https://custom.example.com')
          await input.blur()
          await expect(input).toHaveAccessibleName(name)
          await expect(input).toHaveAccessibleDescription(`Default: ${defaultUrl}`)
          const helper = input.locator('../..').locator('.supportingText')
          await expect(helper).toBeVisible()
          expect(await helper.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        }
        if (scale === 100) {
          const screenshot = testInfo.outputPath('api-default-guidance.png')
          await section.getByLabel('SponsorBlock API URL', { exact: true }).locator('../..').screenshot({ path: screenshot })
          await testInfo.attach('api-default-guidance', { path: screenshot, contentType: 'image/png' })
        }
      })

      test('keeps field text and action icons centered through focus', async ({ page }, testInfo) => {
        await goToSettingsSection(page, 'download')
        const field = page.getByRole('textbox', { name: /^Download Folder/ })
        await field.scrollIntoViewIfNeeded()
        const textCenter = () => field.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const styles = getComputedStyle(element)
          return bounds.top + (bounds.height + parseFloat(styles.borderTopWidth) - parseFloat(styles.borderBottomWidth) +
            parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom)) / 2
        })
        await field.evaluate(element => element.blur())
        const unfocusedCenter = await textCenter()
        for (const focused of [true, false]) {
          if (focused) await field.focus()
          else await field.evaluate(element => element.blur())
          expect.soft(await textCenter(), `text center when focused=${focused}`).toBeCloseTo(unfocusedCenter, 1)
          const offsets = await field.evaluate(element => {
            const bounds = element.getBoundingClientRect()
            const center = bounds.top + bounds.height / 2
            return ['.inputAction', '.buttonIcon', '.inputAction .ft-icon__glyph', '.inputIndicators .ft-icon__glyph'].map(selector => {
              const action = element.parentElement.querySelector(selector).getBoundingClientRect()
              return { selector, offset: action.top + action.height / 2 - center }
            })
          })
          for (const { selector, offset } of offsets) expect.soft(offset, `${selector} center when focused=${focused}`).toBeCloseTo(0, 1)
        }
        if (scale === 100) {
          const screenshot = testInfo.outputPath('aligned-download-input.png')
          await field.locator('../..').screenshot({ path: screenshot })
          await testInfo.attach('aligned-download-input', { path: screenshot, contentType: 'image/png' })
        }
      })

      test('matches field heights and balances download spacing without clipping the default hint', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const section = await goToSettingsSection(page, 'download')
        const folder = section.getByRole('textbox', { name: 'Download Folder', exact: true })
        const select = section.getByRole('combobox', { name: 'Concurrent downloads' })
        for (const input of await section.locator('input.ft-input').all()) {
          expect.soft((await input.boundingBox()).height).toBeCloseTo((await select.boundingBox()).height, 1)
        }
        await folder.focus()
        const hint = folder.locator('../..').locator('.supportingText')
        await expect.soft(hint).toHaveText('Leave blank to use your Downloads folder')
        if (await hint.count()) {
          expect(await hint.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        }
        const spacing = await section.locator('.downloadActions').evaluate(element => {
          const toggle = element.previousElementSibling.querySelector('.switch-label').getBoundingClientRect()
          const actions = element.getBoundingClientRect()
          const field = element.nextElementSibling.querySelector('input').getBoundingClientRect()
          return { above: actions.top - toggle.bottom, below: field.top - actions.bottom }
        })
        expect.soft(spacing.above).toBeCloseTo(spacing.below, 1)
        expect.soft(spacing.above).toBeGreaterThanOrEqual(19.9)
      })

      test('gives switch keyboard focus equal clearance on both sides', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const section = await goToSettingsSection(page, 'privacy')
        const input = section.locator('[data-setting-key="rememberSearchHistory"] input')
        const label = input.locator('+ label')
        await page.keyboard.press('Tab')
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          await input.focus()
          await expect(label).toHaveCSS('outline-style', 'solid')
          const clearance = await label.evaluate(element => {
            const style = getComputedStyle(element)
            const track = getComputedStyle(element, '::before')
            return {
              start: parseFloat(track.insetInlineStart),
              end: parseFloat(style.paddingInlineEnd),
              ring: -parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)
            }
          })
          expect.soft(clearance.start).toBeCloseTo(clearance.end, 1)
          expect.soft(clearance.start).toBeGreaterThanOrEqual(clearance.ring)
        }
      })

      test('keeps Capacitor fields and switch tracks larger independently of viewport width', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const section = await goToSettingsSection(page, 'download')
        // The real Android WebView is covered by the native renderer test.
        await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
        for (const field of await section.locator('input.ft-input, .select-text').all()) {
          expect.soft((await field.boundingBox()).height).toBeCloseTo(56, 1)
        }
        const toggle = section.locator('[data-setting-key="enableDownloads"] .switch-label')
        const track = await toggle.evaluate(element => {
          const style = getComputedStyle(element, '::before')
          return { width: parseFloat(style.width), height: parseFloat(style.height) }
        })
        expect.soft(track.width).toBeCloseTo(52, 1)
        expect.soft(track.height).toBeCloseTo(32, 1)
        expect.soft((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(48)
      })

      test('tag inputs fill their panels and keep long labels readable', async ({ page }, testInfo) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const section = await goToSettingsSection(page, 'distraction')
        const fields = section.locator('.ft-input-tags-component')
        await expect(fields).toHaveCount(2)
        for (const panel of await fields.all()) {
          const heading = panel.getByRole('heading')
          await expect(heading).toBeVisible({ timeout: 1000 })
          expect(await heading.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
          await expect(panel.locator('.selectLabelText')).toHaveText(/^(Enter channels|Enter text)$/)
          const input = panel.locator('input.ft-input')
          await input.scrollIntoViewIfNeeded()
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(value => { document.body.dir = value }, direction)
            const geometry = await panel.evaluate(element => {
              const panelStyle = getComputedStyle(element)
              const input = element.querySelector('.ft-input')
              const label = element.querySelector('.selectLabelText')
              const fieldStyle = getComputedStyle(input.closest('.ft-input-component'))
              const indicators = element.querySelector('.inputIndicators').getBoundingClientRect()
              const indicatorsGutter = indicators.width + 8
              const panelBounds = element.getBoundingClientRect()
              const inputBounds = input.getBoundingClientRect()
              const action = element.querySelector('.inputAction').getBoundingClientRect()
              return {
                fieldWidth: input.getBoundingClientRect().width,
                available: panelBounds.width - parseFloat(panelStyle.borderLeftWidth) - parseFloat(panelStyle.borderRightWidth) -
                  parseFloat(panelStyle.paddingLeft) - parseFloat(panelStyle.paddingRight) -
                  parseFloat(fieldStyle.paddingLeft) - parseFloat(fieldStyle.paddingRight) -
                  parseFloat(fieldStyle.borderLeftWidth) - parseFloat(fieldStyle.borderRightWidth) - indicatorsGutter,
                left: Math.min(inputBounds.left, indicators.left) - panelBounds.left,
                right: panelBounds.right - Math.max(inputBounds.right, indicators.right),
                actionLeft: action.left - inputBounds.left,
                actionRight: inputBounds.right - action.right,
                labelWhiteSpace: getComputedStyle(label).whiteSpace,
                labelBottom: label.getBoundingClientRect().bottom,
                inputBottom: input.getBoundingClientRect().bottom
              }
            })
            expect(geometry.fieldWidth).toBeCloseTo(geometry.available, 0)
            // Fractional zoom can round the marker border by one CSS pixel.
            expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(1)
            expect.soft(geometry.actionLeft).toBeGreaterThanOrEqual(0)
            expect.soft(geometry.actionRight).toBeGreaterThanOrEqual(0)
            expect(geometry.labelWhiteSpace).toBe('nowrap')
            expect(geometry.labelBottom).toBeLessThanOrEqual(geometry.inputBottom)
          }
          await input.focus()
          await input.fill('Material controls')
          await expect(input).toHaveValue('Material controls')
        }
        await page.evaluate(() => { document.body.dir = 'ltr' })
        if (scale === 100) {
          const screenshot = testInfo.outputPath('material-tag-input.png')
          await fields.last().screenshot({ path: screenshot })
          await testInfo.attach('material-tag-input', { path: screenshot, contentType: 'image/png' })
        }
      })

      test('selects in switch columns have equal spacing above and below', async ({ page }) => {
        const section = await goToSettingsSection(page, 'distraction')
        const select = section.getByRole('combobox', { name: /AI video summaries/i })
        await select.scrollIntoViewIfNeeded()
        const gaps = await select.evaluate(element => {
          const control = element.closest('.select')
          const field = element.getBoundingClientRect()
          const before = control.previousElementSibling.getBoundingClientRect()
          const after = control.nextElementSibling.getBoundingClientRect()
          return { above: field.top - before.bottom, below: after.top - field.bottom }
        })
        expect(gaps.above).toBeGreaterThan(0)
        expect(gaps.above).toBeCloseTo(gaps.below, 0)
      })

      test('uses the subscription column width for refresh interval labels', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const section = await goToSettingsSection(page, 'subscription')
        const selects = section.getByRole('combobox', { name: /^(Videos|Shorts|Live|Posts) Auto Refresh Interval$/ })
        await expect(selects).toHaveCount(4)
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          for (const select of await selects.all()) {
            const geometry = await select.evaluate(element => {
              const root = element.closest('.select')
              const caption = root.querySelector('.select-placeholder')
              const field = element.getBoundingClientRect()
              const column = root.closest('.switchColumn').getBoundingClientRect()
              const indicators = root.querySelector('.selectIndicators').getBoundingClientRect()
              return {
                clipped: caption.scrollWidth - caption.clientWidth,
                left: Math.min(field.left, indicators.left) - column.left,
                right: column.right - Math.max(field.right, indicators.right)
              }
            })
            expect.soft(geometry.clipped, await select.getAttribute('aria-labelledby')).toBeLessThanOrEqual(1)
            expect.soft(geometry.left).toBeGreaterThanOrEqual(-1)
            expect.soft(geometry.right).toBeGreaterThanOrEqual(-1)
          }
        }
      })

      test('cookie controls keep spacing, align fields and place input indicators beside the field', async ({ page }, testInfo) => {
        const advanced = await goToSettingsSection(page, 'advanced')
        const cookies = advanced.locator('.settingsSection').filter({
          has: page.getByRole('heading', { name: 'yt-dlp Cookies', exact: true })
        })
        const source = cookies.getByRole('combobox', { name: 'Cookie Source' })
        const modes = cookies.locator('.restrictedPlaybackAuthSource select')
        await modes.selectOption('none')
        const below = await source.evaluate(element => {
          const row = element.closest('.restrictedPlaybackAuthControls')
          return row.nextElementSibling.getBoundingClientRect().top - element.getBoundingClientRect().bottom
        })
        expect.soft(below).toBeGreaterThanOrEqual(15)
        await modes.selectOption('file')
        const input = cookies.getByRole('textbox', { name: 'Cookie File', exact: true })
        await expect(input.locator('..').locator('.selectLabelIcon')).toHaveAttribute('data-icon', 'file-lines')
        await expect(input.locator('..').locator('.buttonIcon')).toHaveAttribute('data-icon', 'folder-open')
        await input.scrollIntoViewIfNeeded()
        await input.fill('/tmp/material-cookies.txt')
        // Enable the indicator UI using fixture state, without configuring a real server.
        await page.evaluate(() => Object.assign(
          document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings,
          { syncServerEnabled: true, syncServerToken: 'fixture-token', syncServerSyncSettings: true, hideComments: true }
        ))
        // Exercise the shared input's sync icon with a syncable key; cookie paths stay local.
        await updateControlProps(input, { settingKey: 'hideComments' })
        await expect(input.locator('..').locator('.inputIndicators .syncedSettingIndicator')).toBeVisible()
        await expect(input.locator('..').locator('.inputIndicators .changedSettingIndicator')).toBeVisible()
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          const boxes = await Promise.all([source.boundingBox(), input.boundingBox()])
          expect.soft(boxes[0].width).toBeCloseTo(boxes[1].width, 0)
          if (width === 1600) {
            expect.soft(boxes[0].y).toBeCloseTo(boxes[1].y, 0)
            expect.soft(boxes[0].height).toBeCloseTo(boxes[1].height, 0)
          }
          const indicators = await input.evaluate(element => {
            const field = element.getBoundingClientRect()
            return [...element.parentElement.querySelectorAll('.inputIndicators button')].map(button => {
              const rect = button.getBoundingClientRect()
              return {
                outside: document.body.dir === 'rtl' ? field.left - rect.right : rect.left - field.right,
                center: rect.top + rect.height / 2 - field.top - field.height / 2
              }
            })
          })
          expect(indicators.length).toBeGreaterThan(0)
          for (const indicator of indicators) {
            expect.soft(indicator.outside).toBeGreaterThanOrEqual(4)
            expect.soft(Math.abs(indicator.center)).toBeLessThanOrEqual(1)
          }
        }
        await page.evaluate(() => { document.body.dir = 'ltr' })
        await updateControlProps(input, { settingKey: 'ytDlpPlaybackCookiesPath' })
        for (const pack of ['material', 'remix']) {
          await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
          await expect(input.locator('..').locator('.buttonIcon')).toHaveAttribute('data-icon-pack', pack)
          await expect(input.locator('..').locator('.selectLabelIcon')).toHaveAttribute('data-icon-pack', pack)
        }
        if (scale === 100) {
          const screenshot = testInfo.outputPath('cookie-controls.png')
          await cookies.locator('.restrictedPlaybackAuthControls').screenshot({ path: screenshot })
          await testInfo.attach('cookie-controls', { path: screenshot, contentType: 'image/png' })
        }
      })
    })
  }

  test.describe(`paired switch alignment at ${scale}% scale`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', uiScale: scale, baseTheme: scale === 100 ? 'dark' : 'light', bounds: { x: 0, y: 0, width: 1600, height: 1000, maximized: false } } } })

    test('centers switches within changed markers and beside caption selects', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const section = await goToSettingsSection(page, 'playback')
      const quick = section.locator('.quickPlaybackSpeedToggle')
      await quick.locator('input').press('Space')
      await expect(quick.locator('.changedSettingIndicator')).toBeVisible()
      for (const width of [1200, 480]) {
        await setWindowSize(app, page, { width, height: width === 1200 ? 900 : 850 })
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

    test('centers modal text fields horizontally', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateEnableDownloads', true))
      await goTo(page, 'downloads')
      for (const width of [1200, 400]) {
        await setWindowSize(app, page, { width, height: width === 1200 ? 800 : 900 })
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          await page.getByRole('button', { name: 'Add download', exact: true }).click()
          const prompt = page.getByRole('dialog', { name: 'Add download', exact: true })
          const field = prompt.getByRole('textbox')
          const offset = await field.evaluate(element => {
            const field = element.getBoundingClientRect()
            const card = element.closest('.promptCard').getBoundingClientRect()
            return Math.abs(field.left + field.width / 2 - card.left - card.width / 2)
          })
          expect.soft(offset, `${direction} modal field center at ${width}px`).toBeLessThanOrEqual(1)
          if (direction === 'ltr') await prompt.screenshot({ path: testInfo.outputPath(`centered-download-input-${width}.png`) })
          await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
        }
      }
      await page.evaluate(() => { document.body.dir = 'ltr' })
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
        'showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null }
      ))
      const playlist = page.locator('.playlistNameInput input')
      const offset = await playlist.evaluate(element => {
        const field = element.getBoundingClientRect()
        const card = element.closest('.promptCard').getBoundingClientRect()
        return Math.abs(field.left + field.width / 2 - card.left - card.width / 2)
      })
      expect(offset).toBeLessThanOrEqual(1)
    })

    test('shows the complete password guidance without truncating the field label', async ({ page }) => {
      const section = await goToSettingsSection(page, 'privacy')
      const input = section.locator('input[type="password"]')
      await expect(input).toHaveAccessibleName('Password')
      await input.focus()
      await expect(input).toHaveAttribute('placeholder', '')
      const field = input.locator('../..')
      await expect(field).toContainText('Set a password to prevent access to settings')
      const label = field.locator('.selectLabelText')
      const overflow = await label.evaluate(element => element.scrollWidth - element.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      await expect(input).toHaveAccessibleDescription('Set a password to prevent access to settings')
      const widths = await input.evaluate(element => ({ field: element.getBoundingClientRect().width, container: element.parentElement.getBoundingClientRect().width }))
      expect(widths.field).toBeCloseTo(widths.container, 1)
      await updateControlProps(input, { label: 'Set a password to prevent access to settings' })
      await input.evaluate(element => element.blur())
      const before = await input.boundingBox()
      await input.focus()
      await expect(field.locator('.selectLabel')).toHaveCSS('transform', 'matrix(0.75, 0, 0, 0.75, 0, 0)')
      expect((await input.boundingBox()).width).toBeCloseTo(before.width, 1)
    })

    test('Material buttons support variants and shape changes without shifting their bounds', async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
        'showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null }
      ))
      const button = page.locator('.promptCard .btn').first()
      await page.locator('.playlistNameInput input').fill('Material controls')
      await expect(button).toBeEnabled()
      await button.evaluate(element => element.addEventListener('click', event => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }, true))
      const variants = []
      const appearances = {}
      for (const variant of ['filled', 'tonal', 'outlined', 'text', 'elevated']) {
        await updateControlProps(button, { variant })
        await expect(button).toHaveClass(new RegExp(`variant-${variant}`))
        await page.keyboard.press('Tab')
        await button.focus()
        await expect(button).toHaveCSS('outline-style', 'solid')
        const before = await button.boundingBox()
        await button.hover()
        await page.mouse.down()
        await expect(button).toHaveCSS('border-radius', '8px')
        const pressed = await button.boundingBox()
        for (const key of ['x', 'y', 'width', 'height']) expect(pressed[key]).toBeCloseTo(before[key], 1)
        await page.mouse.up()
        await page.mouse.move(0, 0)
        await button.evaluate(element => element.blur())
        appearances[variant] = await button.evaluate(element => {
          const styles = getComputedStyle(element)
          return { background: styles.backgroundColor, border: styles.borderTopColor, shadow: styles.boxShadow }
        })
        variants.push(await button.evaluate(element => element.outerHTML))
      }
      expect(appearances.filled.background).not.toBe(appearances.tonal.background)
      expect(appearances.outlined.background).toBe('rgba(0, 0, 0, 0)')
      expect(appearances.text.background).toBe('rgba(0, 0, 0, 0)')
      expect(appearances.outlined.border).not.toBe('rgba(0, 0, 0, 0)')
      expect(appearances.elevated.shadow).not.toBe('none')
      for (const size of ['extra-small', 'small', 'medium', 'large', 'extra-large']) {
        await updateControlProps(button, { size })
        const height = { 'extra-small': 32, small: 40, medium: 56, large: 96, 'extra-large': 136 }[size]
        await expect(button).toHaveCSS('min-height', `${height}px`)
      }
      await updateControlProps(button, { size: 'small', selected: true })
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(button).toHaveCSS('border-radius', '12px')
      await button.evaluate(element => { element.disabled = true })
      await expect(button).toBeDisabled()
      await expect(button).toHaveCSS('opacity', '0.38')
      if (scale === 100) {
        await page.evaluate(html => {
          const examples = document.createElement('div')
          examples.className = 'materialButtonExamples'
          Object.assign(examples.style, { position: 'fixed', top: '100px', left: '100px', zIndex: '9999', display: 'flex', gap: '12px', padding: '24px', background: 'var(--card-bg-color)' })
          examples.innerHTML = html.join('')
          for (const [index, button] of [...examples.children].entries()) button.textContent = ['Filled', 'Tonal', 'Outlined', 'Text', 'Elevated'][index]
          document.body.append(examples)
        }, variants)
        const screenshot = testInfo.outputPath('material-button-variants.png')
        await page.locator('.materialButtonExamples').screenshot({ path: screenshot })
        await testInfo.attach('material-button-variants', { path: screenshot, contentType: 'image/png' })
      }
    })

    test('modal autofocus avoids the pointer outline while Tab preserves the rounded keyboard ring', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const section = await goToSettingsSection(page, 'appearance')
      const toggle = section.getByRole('checkbox', { name: 'Disable Smooth Scrolling', exact: true })
      for (const roundness of [0, 100, 200]) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), roundness)
        await toggle.locator('+ label').click()
        const prompt = page.locator('.promptCard')
        const first = prompt.locator('.btn').first()
        await expect(first).toBeFocused()
        expect(await first.evaluate(element => element.matches(':focus-visible'))).toBe(false)
        await expect.soft(first).toHaveCSS('outline-style', 'none', { timeout: 1000 })
        expect.soft(await first.evaluate(element => parseFloat(getComputedStyle(element).borderRadius))).toBeCloseTo(20 * roundness / 100, 1)
        await first.press('Tab')
        const cancel = prompt.getByRole('button', { name: 'Cancel', exact: true })
        await expect(cancel).toBeFocused()
        const style = await cancel.evaluate(element => {
          const style = getComputedStyle(element)
          return { outline: style.outlineStyle, outlineColor: style.outlineColor, color: style.color, radius: parseFloat(style.borderRadius) }
        })
        expect(style.outline).toBe('solid')
        expect(style.outlineColor).toBe(style.color)
        expect(style.radius).toBeCloseTo(20 * roundness / 100, 1)
        await cancel.click()
        await expect(prompt).toHaveCount(0)
      }
    })

    test('Material checkboxes expose mixed states and circular focus halos', async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.locator('.navFilterButton').click()
      const checkbox = page.locator('.searchRadio').filter({ hasText: 'Features' }).getByRole('checkbox', { name: 'Live', exact: true })
      const label = checkbox.locator('+ label')
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        await checkbox.focus()
        await checkbox.press('Space')
        await expect(checkbox).toBeChecked()
        const styles = await label.evaluate(element => {
          const box = getComputedStyle(element, '::before')
          const halo = getComputedStyle(element.querySelector('.checkboxStateLayer'))
          const probe = document.createElement('span')
          probe.style.color = 'var(--primary-color)'
          element.append(probe)
          const primary = getComputedStyle(probe).color
          probe.remove()
          return { width: box.width, height: box.height, color: box.backgroundColor, primary, haloRadius: halo.borderRadius, haloColor: halo.backgroundColor }
        })
        expect(parseFloat(styles.width)).toBeCloseTo(18, 1)
        expect(parseFloat(styles.height)).toBeCloseTo(18, 1)
        expect(styles.color).toBe(styles.primary)
        expect(styles.haloRadius).toBe('50%')
        expect(styles.haloColor).not.toBe('rgba(0, 0, 0, 0)')
        await updateControlProps(checkbox, { indeterminateValues: [await checkbox.getAttribute('value')] })
        await expect(checkbox).toBeChecked({ indeterminate: true })
        const dash = await label.evaluate(element => getComputedStyle(element, '::after').height)
        expect(dash).toBe('0px')
        await checkbox.press('Space')
        await expect(checkbox).not.toBeChecked()
        expect(await checkbox.evaluate(element => element.indeterminate)).toBe(false)
        await updateControlProps(checkbox, { indeterminateValues: [] })
      }
      if (scale === 100) {
        const screenshot = testInfo.outputPath('material-checkboxes.png')
        await label.locator('..').screenshot({ path: screenshot })
        await testInfo.attach('material-checkboxes', { path: screenshot, contentType: 'image/png' })
      }
    })

    test('centers Player switches beside wrapped labels with equal row spacing', async ({ page }, testInfo) => {
      await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 40, y: 40, width: 1400, height: 900 })))
      const section = await goToSettingsSection(page, 'playback')
      // Keep two columns while narrowing the content enough to wrap long labels.
      await section.evaluate(element => { element.parentElement.style.inlineSize = '800px' })
      const grid = section.locator('.playerSwitchGrid')
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        const geometry = await grid.evaluate(element => {
          const controls = Array.from(element.querySelectorAll('.switch-ctn'))
            .filter(toggle => getComputedStyle(toggle).display !== 'none')
            .map(toggle => {
              const label = toggle.querySelector('.switch-label')
              const bounds = label.getBoundingClientRect()
              const text = label.querySelector('.switch-label-text').getBoundingClientRect()
              const track = getComputedStyle(label, '::before')
              return {
                labelCenter: bounds.top + bounds.height / 2,
                textCenter: text.top + text.height / 2,
                textHeight: text.height,
                trackCenter: bounds.top + parseFloat(track.top) + new DOMMatrix(track.transform).m42 + parseFloat(track.height) / 2
              }
            })
          return { columns: getComputedStyle(element).gridTemplateColumns.split(' ').length, controls }
        })
        expect(geometry.columns).toBe(2)
        const pairs = geometry.controls.flatMap((control, index, controls) => index % 2 === 0 && controls[index + 1] ? [[control, controls[index + 1]]] : [])
        expect(pairs.some(([left, right]) => Math.abs(left.textHeight - right.textHeight) > 1)).toBe(true)
        for (const [left, right] of pairs) {
          for (const key of ['labelCenter', 'textCenter', 'trackCenter']) {
            expect.soft(left[key] - right[key], `${direction} paired ${key}`).toBeCloseTo(0, 1)
          }
        }
      }
      if (scale === 100) {
        await page.evaluate(() => { document.body.dir = 'ltr' })
        const screenshot = testInfo.outputPath('aligned-player-switches.png')
        await grid.screenshot({ path: screenshot })
        await testInfo.attach('aligned-player-switches', { path: screenshot, contentType: 'image/png' })
      }
    })
  })
}

for (const scale of [100, 95]) {
  for (const width of [1600, 480]) {
    test.describe(`compact sliders at ${width}px and ${scale}% scale`, () => {
      test.use({
        seed: {
          settings: {
            uiScale: scale,
            baseTheme: 'dark',
            quickSettings: ['baseTheme', 'mainColor', 'uiScale', 'thumbnailSize'],
            bounds: { x: 0, y: 0, width, height: 900, maximized: false }
          }
        }
      })

      test('preserves slider density in settings and the quick menu', async ({ page }, testInfo) => {
        const compact = width > 680
        const section = await goToSettingsSection(page, 'privacy')
        const settingsSlider = section.getByRole('slider', { name: /Watched Percentage Threshold/ })
        expect((await settingsSlider.boundingBox()).height).toBeCloseTo(compact ? 36 : 48, 1)
        await page.locator('.settingsCloseButton').click()
        await page.locator('.profileTrigger').click()
        const menu = page.getByRole('dialog', { name: 'Quick settings' })
        const sliders = menu.locator('.sliderGroup .pure-material-slider')
        await expect(sliders).toHaveCount(2)
        for (const slider of await sliders.all()) {
          // Phone targets compensate for Electron zoom to stay 48 screen pixels.
          expect((await slider.getByRole('slider').boundingBox()).height).toBeCloseTo(compact ? 24 : 48 * 100 / scale, 1)
        }
        const labelSpacing = await sliders.evaluateAll(elements => (
          elements[1].querySelector('.labelRow').getBoundingClientRect().top -
          elements[0].querySelector('.labelRow').getBoundingClientRect().top
        ))
        expect(labelSpacing).toBeLessThanOrEqual(compact ? 55 : 79 * 100 / scale)
        const thumbnail = menu.getByRole('slider', { name: 'Thumbnail Size' })
        const value = Number(await thumbnail.inputValue())
        const step = Number(await thumbnail.getAttribute('step'))
        await thumbnail.press('ArrowRight')
        await expect(thumbnail).toHaveValue(String(value + step))
        await expect(thumbnail).toHaveCSS('outline-style', 'solid')
        if (scale === 100) {
          await menu.locator('.profileSummary').focus()
          const screenshot = testInfo.outputPath('compact-sliders.png')
          await menu.locator('.menuSection').first().screenshot({ path: screenshot })
          await testInfo.attach('compact-sliders', { path: screenshot, contentType: 'image/png' })
        }
      })
    })
  }
}

for (const { name, theme, width, height, scale, rtl } of [
  { name: 'dark desktop', theme: 'dark', width: 1600, height: 900, scale: 100 },
  { name: 'light desktop at 95%', theme: 'light', width: 1600, height: 900, scale: 95 },
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
          uiScale: scale,
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
        const track = getComputedStyle(element, '::before')
        const thumb = getComputedStyle(element, '::after')
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
      for (const [key, value] of Object.entries({ trackWidth: 40, trackHeight: 24, thumbWidth: 12, textClearance: 58 })) {
        expect(geometry[key]).toBeCloseTo(value, 1)
      }

      await input.focus()
      await input.press('Space')
      await expect(input).toBeChecked()
      await expect(dependent).toBeEnabled()
      await expect.poll(() => label.evaluate(element => parseFloat(getComputedStyle(element, '::after').width))).toBeCloseTo(18, 1)
      expect(await label.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
      await label.hover()
      await page.mouse.down()
      expect(await label.evaluate(element => parseFloat(getComputedStyle(element, '::after').width))).toBeCloseTo(20, 1)
      expect(await label.evaluate(element => parseFloat(getComputedStyle(element, '::after').insetInlineStart))).toBeCloseTo(24, 1)
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

    test('split slider tracks leave space for the vertical handle at every value', async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
      const section = await goToSettingsSection(page, 'privacy')
      const slider = section.getByRole('slider', { name: /Watched Percentage Threshold/ })
      const historySwitch = section.locator('[data-setting-key="rememberHistory"] .switch-label')
      await historySwitch.click()
      await expect(slider).toBeEnabled()
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        for (const value of [0, 25, 50, 100]) {
          await slider.fill(String(value))
          const geometry = await slider.evaluate(input => {
            const control = input.closest('.sliderControl')
            const styles = getComputedStyle(control)
            const bounds = input.getBoundingClientRect()
            const active = control.querySelector('.activeTrack').getBoundingClientRect()
            const inactive = control.querySelector('.inactiveTrack').getBoundingClientRect()
            const rtl = getComputedStyle(input).direction === 'rtl'
            return {
              width: bounds.width,
              activeWidth: active.width,
              inactiveWidth: inactive.width,
              activeStart: rtl ? bounds.right - active.right : active.left - bounds.left,
              inactiveEnd: rtl ? inactive.left - bounds.left : bounds.right - inactive.right,
              trackCenter: active.top + active.height / 2 - bounds.top - bounds.height / 2,
              handleWidth: parseFloat(styles.getPropertyValue('--slider-handle-width')),
              handleHeight: parseFloat(styles.getPropertyValue('--slider-handle-height')),
              rowHeight: bounds.height,
              gap: parseFloat(styles.getPropertyValue('--slider-handle-gap')),
              direction: getComputedStyle(input).direction
            }
          })
          expect(geometry.activeWidth).toBeCloseTo(Math.max(0, value / 100 * (geometry.width - geometry.handleWidth) - geometry.gap), 1)
          expect(geometry.inactiveWidth).toBeCloseTo(Math.max(0, (1 - value / 100) * (geometry.width - geometry.handleWidth) - geometry.gap), 1)
          expect(geometry.activeStart).toBeCloseTo(0, 1)
          expect(geometry.inactiveEnd).toBeCloseTo(0, 1)
          expect(geometry.trackCenter).toBeCloseTo(0, 1)
          expect(geometry.handleHeight).toBeLessThanOrEqual(geometry.rowHeight + 0.1)
          expect(geometry.direction).toBe(direction)
        }
        await slider.fill('50')
        await slider.press(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
        await expect(slider).toHaveValue('51')
      }
      await page.evaluate(() => { document.body.dir = 'ltr' })
      await slider.fill('50')
      if (scale !== 100) await page.evaluate(() => window.ftElectron.setZoomFactor(1))
      const screenshot = testInfo.outputPath('material-slider.png')
      await slider.locator('..').locator('..').screenshot({ path: screenshot })
      await testInfo.attach('material-slider', { path: screenshot, contentType: 'image/png' })
      await historySwitch.click()
      await expect(slider).toBeDisabled()
      await expect(slider.locator('..')).toHaveCSS('opacity', '0.38')
    })
  })
}

test('filled fields and slider progress retain their input behavior', async ({ page }, testInfo) => {
  const section = await goToSettingsSection(page, 'privacy')
  const slider = section.getByRole('slider', { name: /Watched Percentage Threshold/ })
  await slider.fill('25')
  await expect(slider).toHaveCSS('--slider-progress', '25%')
  await slider.press('ArrowRight')
  await expect(slider).toHaveValue('26')
  await expect(slider).toHaveCSS('--slider-progress', '26%')
  await slider.fill('100')
  await expect(slider).toHaveCSS('--slider-progress', '100%')

  const select = section.locator('.privacyExternalLinkSelect .select-text')
  await expect(select).toHaveCSS('height', '45px')
  await select.click()
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options.first()).toBeVisible()
  expect((await options.first().boundingBox()).height).toBeLessThan(40)
  await select.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
    'showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null }
  ))
  const field = page.locator('.playlistNameInput input')
  await field.fill('Material controls')
  await field.hover()
  await expect(field).toHaveValue('Material controls')
  await expect(field).toHaveCSS('height', '45px')
  await expect(field).toHaveCSS('border-bottom-width', '1px')
  expect(await field.evaluate(element => getComputedStyle(element).boxShadow)).toContain('0px -1px')
  const screenshot = testInfo.outputPath('material-fields.png')
  await page.locator('.promptCard').screenshot({ path: screenshot })
  await testInfo.attach('material-fields', { path: screenshot, contentType: 'image/png' })
})

test('shared Material controls follow UI Roundness while switches keep their shape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const section = await goToSettingsSection(page, 'privacy')
  const select = section.locator('.privacyExternalLinkSelect .select-text')
  const switchLabel = section.locator('[data-setting-key="rememberHistory"] .switch-label')
  for (const roundness of [0, 50, 100, 200]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), roundness)
    expect(await select.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeCloseTo(4 * roundness / 100, 1)
    expect(await switchLabel.evaluate(element => parseFloat(getComputedStyle(element, '::before').borderTopLeftRadius))).toBeCloseTo(12, 1)
    await switchLabel.locator('..').locator('.switch-input').press('Space')
    await expect(switchLabel).toHaveCSS('border-radius', '4px')
  }

  await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
    'showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null }
  ))
  const card = page.locator('.promptCard')
  const field = page.locator('.playlistNameInput input')
  const button = card.locator('.btn').first()
  for (const roundness of [0, 50, 100, 200]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), roundness)
    for (const [element, radius] of [[card, 12], [field, 4], [button, 20]]) {
      expect(await element.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeCloseTo(radius * roundness / 100, 1)
    }
  }
})
