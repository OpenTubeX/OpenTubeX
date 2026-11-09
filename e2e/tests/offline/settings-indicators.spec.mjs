import { test, expect, goTo, goToSettingsSection, setWindowSize, openInterfaceCustomizer } from '../../helpers/app.mjs'

test.describe('settings', () => {
  test('highlights changed settings and resets them to defaults', async ({ page, attachScreenshot }) => {
    await goTo(page, 'settings')

    const autoLoadToggle = page.getByRole('checkbox', { name: /Auto Load Next Page/i })
    await page.locator('label.switch-label').filter({ hasText: 'Auto Load Next Page' }).click()
    await expect(autoLoadToggle).not.toBeChecked()

    const autoLoadSetting = page.locator('.switch-ctn').filter({ has: autoLoadToggle })
    const resetButton = autoLoadSetting.getByRole('button', { name: 'Reset this setting to its default' })
    await expect(resetButton).toBeVisible()
    await expect(autoLoadSetting).toHaveCSS('border-left-width', '3px')
    await attachScreenshot('highlighted changed setting')

    await resetButton.click()
    await expect(autoLoadToggle).toBeChecked()
    await expect(resetButton).toHaveCount(0)
  })

  test('resets the composite thumbnail preference to its displayed default', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const setting = appearance.locator('.select').filter({
      has: page.getByRole('combobox', { name: 'Thumbnail Preference' })
    })
    const select = setting.locator('select')

    await select.selectOption('blur')
    await expect(select).toHaveValue('blur')

    const resetButton = setting.getByRole('button', {
      name: 'Reset this setting to its default'
    })
    await expect(resetButton).toBeVisible()
    await resetButton.click()

    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return {
        blurThumbnails: store.getters.getBlurThumbnails,
        thumbnailPreference: store.getters.getThumbnailPreference
      }
    })).toEqual({ blurThumbnails: false, thumbnailPreference: '' })
    await expect(select).toHaveValue('')
    await expect(resetButton).toHaveCount(0)
  })
})

test.describe('synced setting indicators', () => {
  test.use({
    seed: {
      settings: {
        highlightChangedSettings: true,
        reducedMotion: 'on',
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerSyncSettings: true,
        syncServerToken: 'e2e-sync-token'
      }
    }
  })

  test('shares the subscription settings sync toggle between its button and subpage', async ({ page }) => {
    const section = await goToSettingsSection(page, 'subscription')
    const manager = section.locator('.manageButton').filter({ hasText: 'Subscription settings' })
    await manager.getByRole('button', { name: 'Stop syncing this setting' }).click()
    await expect(manager.getByRole('button', { name: 'Sync this setting' })).toHaveAttribute('aria-pressed', 'false')
    await manager.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    const enable = page.locator('.settingsWindow .settingsBreadcrumb')
      .getByRole('button', { name: 'Sync this setting', exact: true })
    await expect(enable).toBeVisible()
    await enable.click()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSettingsExcluded
    })).not.toContain('subscriptionChannelSettings')
    await page.reload()
    const reloaded = await goToSettingsSection(page, 'subscription')
    await expect(reloaded.locator('.manageButton').filter({ hasText: 'Subscription settings' })
      .getByRole('button', { name: 'Stop syncing this setting' })).toBeVisible()
  })

  test('allows account sync to be disabled per setting', async ({ page }) => {
    await goTo(page, 'settings')

    const landingPage = page.locator('.select').filter({ hasText: 'Default Landing Page' })
    const syncButton = landingPage.getByRole('button', { name: 'Stop syncing this setting' })
    await expect(syncButton).toBeVisible()
    await syncButton.click()
    await expect(landingPage.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    await page.reload()
    await goTo(page, 'settings')
    await expect(landingPage.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    const toggle = page.getByRole('checkbox', { name: /Auto load next page/i })
    await page.locator('label').filter({ hasText: 'Auto load next page' })
      .getByRole('button', { name: 'Stop syncing this setting' })
      .click()
    await expect(toggle).toBeChecked()

    const localOnlyLabel = page.locator('label').filter({ hasText: 'Check for Updates' })
    await expect(localOnlyLabel.getByRole('button', { name: /syncing this setting/i })).toHaveCount(0)
  })

  test('allows quick settings and navigation customization to be excluded independently', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'quick settings')
    const sync = page.locator('.settingsBreadcrumb .syncedSettingIndicator')
    const selectTab = async (tab) => {
      await customizer.locator(`[data-settings-subpage-tab="${tab}"]`).click()
      await expect(customizer.locator(`[data-settings-subpage-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true')
    }

    await sync.click()
    await expect(sync).toHaveAccessibleName('Sync this setting')
    await selectTab('navigation')
    await expect(sync).toHaveAccessibleName('Stop syncing this setting')

    await sync.click()
    await expect(sync).toHaveAccessibleName('Sync this setting')
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSettingsExcluded
    })).toEqual(['quickSettings', 'navigationItems'])

    await selectTab('quickSettings')
    await sync.click()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSettingsExcluded
    })).toEqual(['navigationItems'])
  })

  for (const { section, label, settingKey } of [
    { section: 'playback', label: 'Customize Quick Playback Speed Bar', settingKey: 'quickPlaybackSpeedBarOptions' }
  ]) {
    test(`shares the ${settingKey} sync toggle between its launcher and breadcrumb`, async ({ app, page }) => {
      const content = await goToSettingsSection(page, section)
      if (section === 'playback') {
        await content.locator('label.switch-label')
          .filter({ hasText: 'Use Quick Playback Speed Bar' }).click()
      }
      const launcher = content.locator('.settingButtonWithSync').filter({ hasText: label })
      await launcher.getByRole('button', { name: 'Stop syncing this setting' }).click()
      await launcher.getByRole('button', { name: label, exact: true }).click()

      const breadcrumb = page.locator('.settingsBreadcrumb')
      const sync = breadcrumb.locator('.syncedSettingIndicator')
      await expect(sync).toBeVisible()
      await expect(sync).toHaveAttribute('aria-pressed', 'false')
      await expect(sync).toHaveAccessibleName('Sync this setting')
      await sync.click()
      await expect(sync).toHaveAttribute('aria-pressed', 'true')
      await expect(sync).toHaveAccessibleName('Stop syncing this setting')
      await expect.poll(() => page.evaluate(() => (
        window.$store
          .state.settings.syncServerSettingsExcluded
      ))).toEqual([])

      await setWindowSize(app, page, { width: 480, height: 800 })
      await expect(sync).toBeVisible()
      await sync.click()
      await expect.poll(() => page.evaluate(() => (
        window.$store
          .state.settings.syncServerSettingsExcluded
      ))).toEqual([settingKey])

      await page.locator('.settingsBackButton').click()
      await expect(breadcrumb.locator('.syncedSettingIndicator')).toHaveCount(0)
      await expect(launcher.getByRole('button', { name: 'Sync this setting' }))
        .toHaveAttribute('aria-pressed', 'false')
    })
  }
})
