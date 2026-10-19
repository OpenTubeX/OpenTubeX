import { test, expect, goToSettingsSection, setWindowSize, openInterfaceCustomizer } from '../../helpers/app.mjs'

test.describe('standard form controls', () => {
  test.use({ seed: { settings: { useQuickPlaybackSpeedBar: true, forbiddenTitles: '["example"]' } } })

  test('edits playback speed numbers and names with shared fields at wide and narrow widths', { tag: '@scale' }, async ({ app, page }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Customize Quick Playback Speed Bar' }).click()
    const row = page.locator('.quickPlaybackSpeedEntry').first()
    const speed = row.getByRole('spinbutton', { name: 'Playback Speed', exact: true })
    await expect(row.locator('[data-icon="gauge-high"]')).toBeVisible()
    await speed.fill('1.25')
    await speed.press('Tab')
    await expect(speed).toHaveValue('1.25')
    await speed.fill('1')
    await speed.press('Tab')
    for (const value of ['0', '', '1.001', '0.004']) {
      await speed.fill(value)
      await speed.press('Tab')
      await expect(speed).toHaveValue('1')
    }
    await speed.fill('1.25')
    await speed.press('Tab')

    await row.getByRole('button', { name: 'Edit Playback Speed Name' }).click()
    const name = row.getByRole('textbox', { name: 'Name', exact: true })
    await name.fill('Comfortable')
    await name.press('Tab')
    await expect(name).toHaveValue('Comfortable')
    for (const width of [1100, 375, 812]) {
      await setWindowSize(app, page, { width, height: width === 812 ? 500 : width === 1100 ? 880 : 900 })
      await row.scrollIntoViewIfNeeded()
      await expect(speed).toBeInViewport()
      expect(await row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    }
    await row.getByRole('button', { name: 'Use automatic playback speed name' }).click()
    await expect(row.locator('.quickPlaybackSpeedName')).toContainText('1.25')
  })

  test('keeps a playback speed edit while its save is still pending', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('db-settings')
      let held = false
      ipcMain.removeHandler('db-settings')
      ipcMain.handle('db-settings', async (event, request) => {
        if (!held && request.action === 2 && request.data._id === 'quickPlaybackSpeedBarOptions') {
          held = true
          await new Promise(resolve => { globalThis.releaseQuickPlaybackSpeedWrite = resolve })
        }
        return original(event, request)
      })
    })
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Customize Quick Playback Speed Bar' }).click()
    const row = page.locator('.quickPlaybackSpeedEntry').first()
    const speed = row.getByRole('spinbutton', { name: 'Playback Speed', exact: true })
    await speed.fill('1.25')
    await speed.press('Tab')
    await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.releaseQuickPlaybackSpeedWrite)).toBe('function')

    await row.getByRole('button', { name: 'Edit Playback Speed Name' }).click()
    await row.getByRole('textbox', { name: 'Name', exact: true }).fill('Comfortable')
    await app.electronApp.evaluate(() => globalThis.releaseQuickPlaybackSpeedWrite())
    await expect(speed).toHaveValue('1.25')
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.$store.getters.getQuickPlaybackSpeedBarOptions)[0]
    ))).toMatchObject({ speed: 1.25, name: 'Comfortable' })
  })

  test('shows and hides tag entries with the shared checkbox without losing them', async ({ page }) => {
    const section = await goToSettingsSection(page, 'distraction')
    const field = section.locator('.containingTextFlexBox .ft-input-tags-component')
    const checkbox = field.getByRole('checkbox', { name: 'Show Added Items' })
    await expect(checkbox).toBeChecked()
    await field.locator('.pure-checkbox label').click()
    await expect(checkbox).not.toBeChecked()
    await expect(field.locator('.ft-tag-box')).toHaveCount(0)
    await field.locator('.pure-checkbox label').click()
    await expect(checkbox).toBeChecked()
    await expect(field.locator('.ft-tag-box')).toContainText('example')
  })
})

test.describe('standard pairing fields', () => {
  test.use({ seed: { settings: { syncServerUrl: 'https://sync.example.test', syncServerEnabled: true } } })

  test('selects the read-only code and accepts multiline manual entry', async ({ page }) => {
    let session
    await page.route('https://sync.example.test/**', async route => {
      const url = new URL(route.request().url())
      let json = {}
      if (url.pathname === '/health') json = { capabilities: { encrypted_sync: 1, live_sync: 1, key_pairing: 1 } }
      if (url.pathname === '/v1/pairing' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        session = { version: 1, id: body.id, account_id: null, recipient_public_key: body.recipient_public_key, recipient_device_id: body.recipient_device_id, recipient_device_name: body.recipient_device_name, approving_device_id: null, expires_at: Date.now() + 300000, approved: false }
        json = session
      } else if (url.pathname.startsWith('/v1/pairing/')) json = session
      await route.fulfill({ json })
    })
    await goToSettingsSection(page, 'sync')
    await page.getByRole('button', { name: 'Pair with an existing device', exact: true }).click()
    await page.getByRole('button', { name: 'Create pairing code', exact: true }).click()
    await page.getByRole('button', { name: 'Use text code instead', exact: true }).click()
    const code = page.getByRole('textbox', { name: 'Pairing code', exact: true })
    await expect(page.locator('.ft-input-component').filter({ has: code }).locator('[data-icon="key"]')).toBeVisible()
    await expect(code).toHaveAttribute('readonly', '')
    await code.focus()
    expect(await code.evaluate(el => el.selectionEnd - el.selectionStart)).toBeGreaterThan(100)
    await code.click()
    expect(await code.evaluate(el => el.selectionEnd - el.selectionStart)).toBeGreaterThan(100)
    await code.blur()
    await code.click()
    await expect(code).toBeFocused()
    expect(await code.evaluate(el => el.selectionEnd - el.selectionStart)).toBeGreaterThan(100)

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.evaluate(async () => {
      const store = window.$store
      for (const [key, value] of Object.entries({ SyncServerToken: 'local-fixture', SyncServerPrivacyMode: 'enhanced', SyncServerPrivacyKey: 'fixture', SyncServerPrivacySalt: 'fixture', SyncServerDeviceId: 'fixture' })) {
        await store.dispatch(`update${key}`, value)
      }
    })
    await page.getByRole('button', { name: 'Pair another device', exact: true }).click()
    await page.getByRole('button', { name: 'Enter code manually', exact: true }).click()
    const manual = page.getByRole('textbox', { name: 'Pairing code', exact: true })
    await expect(page.locator('.ft-input-component').filter({ has: manual }).locator('[data-icon="key"]')).toBeVisible()
    await expect(manual).toBeFocused()
    await manual.fill('opentubex-pairing:example-code')
    await manual.press('End')
    await manual.press('Enter')
    await manual.pressSequentially('example continuation')
    await expect(manual).toHaveValue('opentubex-pairing:example-code\nexample continuation')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.locator('.settingsCloseButton').click()
  })
})

test.describe('inline field alignment', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { useQuickPlaybackSpeedBar: true, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true }, playlists: [{ _id: 'layout-test', playlistName: 'Layout test', videos: [] }] } })
  test('centers settings, theme and playback fields without stacked-form spacing', async ({ page }) => {
    await goToSettingsSection(page, 'general')
    const centerOffset = async (selector, other) => page.evaluate(({ selector, other }) => {
      const a = document.querySelector(selector).getBoundingClientRect()
      const b = document.querySelector(other).getBoundingClientRect()
      return Math.abs(a.y + a.height / 2 - b.y - b.height / 2)
    }, { selector, other })
    expect.soft(await centerOffset('.settingsSearch input', '.settingsHeaderActions')).toBeLessThanOrEqual(1)
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme', exact: true }).click()
    expect.soft(await centerOffset('.themeNameField input', '.fileActions')).toBeLessThanOrEqual(1)
    await expect(page.locator('.themeNameField [data-icon="font"]')).toBeVisible()
    const themeGaps = await page.locator('.customThemeEditor').evaluate(editor => {
      const name = editor.querySelector('.themeNameField input').getBoundingClientRect()
      const sources = editor.querySelector('.themeSources').getBoundingClientRect()
      const grid = editor.querySelector('.colorGrid').getBoundingClientRect()
      return [name.top - editor.getBoundingClientRect().top, sources.top - name.bottom, grid.top - sources.bottom]
    })
    for (const gap of themeGaps) expect(gap).toBeCloseTo(12, 0)

    await page.locator('.settingsBackButton').click()
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Customize Quick Playback Speed Bar' }).click()
    expect.soft(await centerOffset('.quickPlaybackSpeedValueField input', '.quickPlaybackSpeedDragHandle')).toBeLessThanOrEqual(1)
  })
  test('keeps playlist search compact with balanced spacing and a filled indicator', async ({ app, page, uiScale }, testInfo) => {
    const { mockPlayableWatchPage } = await import('../../helpers/watch.mjs')
    const { openMockedVideo } = await import('../../helpers/player.mjs')
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.locator('.videoOptions').getByRole('button', { name: /^Add to playlist$/i }).click()
    const field = page.locator('.playlistSearch input')
    const verticalGaps = await field.evaluate(input => {
      const picker = input.closest('.addToPlaylistDropdown')
      const field = input.getBoundingClientRect()
      const header = picker.querySelector('.dropdownHeader').getBoundingClientRect()
      const list = picker.querySelector('.playlistList').getBoundingClientRect()
      return [field.top - header.bottom, list.top - field.bottom]
    })
    for (const gap of verticalGaps) expect.soft(gap).toBeCloseTo(8, 0)
    expect.soft(await field.evaluate(input => input.getBoundingClientRect().height)).toBeCloseTo(36, 0)
    const insets = await field.evaluate(input => {
      const field = input.getBoundingClientRect()
      const picker = input.closest('.addToPlaylistDropdown').getBoundingClientRect()
      return [field.left - picker.left, picker.right - field.right]
    })
    for (const inset of insets) expect.soft(inset).toBeGreaterThanOrEqual(9)
    await expect.soft(field).toHaveCSS('border-top-width', '0px')
    expect(await field.evaluate(input => parseFloat(getComputedStyle(input).borderBottomWidth))).toBeCloseTo(1, 0)
    if (uiScale === 100) {
      await field.focus()
      await page.locator('.addToPlaylistDropdown').screenshot({ path: testInfo.outputPath('playlist-search-desktop.png') })
    }
    await page.locator('.iconDropdown').press('Escape')
    await expect(page.locator('.addToPlaylistDropdown')).toBeHidden()
    await setWindowSize(app, page, { width: 375, height: 850 })
    await page.locator('.videoOptions').getByRole('button', { name: /^Add to playlist$/i }).click()
    await expect(page.locator('.phonePlaylistPicker')).toBeVisible()
    await expect.poll(() => field.evaluate(input => input.getBoundingClientRect().height)).toBeGreaterThanOrEqual(45)
  })
})

test('quick-settings picker hover follows UI roundness', async ({ page }) => {
  await goToSettingsSection(page, 'appearance')
  await openInterfaceCustomizer(page, 'quick settings')
  await page.getByRole('button', { name: 'Add setting' }).click()
  const option = page.locator('.settingPicker .list > li').first()
  await option.hover()
  await expect(option).toHaveClass(/hover/)
  for (const roundness of [0, 150]) {
    await page.evaluate(value => window.$store.dispatch('updateUiRoundness', value), roundness)
    await expect(option).toHaveCSS('border-top-left-radius', `${5 * roundness / 100}px`)
  }
})
