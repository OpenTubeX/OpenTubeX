import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

for (const uiScale of [100, 95]) {
  test.describe(`standard form controls at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale, useQuickPlaybackSpeedBar: true, forbiddenTitles: '["example"]' } } })

    test('edits playback speed numbers and names with shared fields at wide and narrow widths', async ({ app, page }) => {
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
}

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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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

for (const uiScale of [100, 95]) {
  test.describe(`inline field alignment at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale, useQuickPlaybackSpeedBar: true, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true }, playlists: [{ _id: 'layout-test', playlistName: 'Layout test', videos: [] }] } })
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
    test('keeps playlist search close to its list and uses a filled indicator', async ({ app, page }) => {
      const { mockPlayableWatchPage } = await import('../../helpers/watch.mjs')
      const { openMockedVideo } = await import('../../helpers/player.mjs')
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.locator('.videoOptions').getByRole('button', { name: /^Add to playlist$/i }).click()
      const field = page.locator('.playlistSearch input')
      expect.soft(await field.evaluate(input => {
        const list = document.querySelector('.playlistList').getBoundingClientRect()
        return list.top - input.getBoundingClientRect().bottom
      })).toBeLessThanOrEqual(8)
      const verticalGaps = await field.evaluate(input => {
        const picker = input.closest('.addToPlaylistDropdown')
        const field = input.getBoundingClientRect()
        const header = picker.querySelector('.dropdownHeader').getBoundingClientRect()
        const details = picker.querySelector('.playlistDetails').getBoundingClientRect()
        return [field.top - header.bottom, details.top - field.bottom]
      })
      expect(Math.abs(verticalGaps[0] - verticalGaps[1])).toBeLessThanOrEqual(1)
      const insets = await field.evaluate(input => {
        const field = input.getBoundingClientRect()
        const picker = input.closest('.addToPlaylistDropdown').getBoundingClientRect()
        return [field.left - picker.left, picker.right - field.right]
      })
      for (const inset of insets) expect.soft(inset).toBeGreaterThanOrEqual(9)
      await expect.soft(field).toHaveCSS('border-top-width', '0px')
      expect(await field.evaluate(input => parseFloat(getComputedStyle(input).borderBottomWidth))).toBeCloseTo(1, 0)
    })
  })
}

test('quick-settings picker hover follows UI roundness', async ({ page }) => {
  await goToSettingsSection(page, 'appearance')
  await page.getByRole('button', { name: 'Customize quick settings' }).click()
  await page.getByRole('button', { name: 'Add setting' }).click()
  const option = page.locator('.settingPicker .list > li').first()
  await option.hover()
  await expect(option).toHaveClass(/hover/)
  for (const roundness of [0, 150]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), roundness)
    await expect(option).toHaveCSS('border-top-left-radius', `${5 * roundness / 100}px`)
  }
})
