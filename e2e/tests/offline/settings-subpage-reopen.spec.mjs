import { test, expect, goTo, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'
import { hashPassword } from '../../../src/renderer/helpers/passwords.js'

const password = 'test-settings-password'
const settingsPassword = await hashPassword(password)

async function toggleSettingsFromPreferences(app) {
  await app.electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const preferences = Menu.getApplicationMenu().items.find(item => item.label === 'File')
      .submenu.items.find(item => item.label === 'Preferences')
    preferences.click(undefined, window, undefined)
  })
}

async function expectPromptResourcesReleased(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).not.toBe('hidden')
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.isAnyPromptOpen
  ))).toBe(false)
}

for (const uiScale of [100, 125]) {
  for (const protectedSettings of [false, true]) {
    test.describe(`customizer picker dismissal at ${uiScale}%, password ${protectedSettings}`, () => {
      test.use({
        seed: {
          settings: {
            uiScale,
            settingsPassword: protectedSettings ? settingsPassword : '',
            navigationItems: ['home', 'subscriptions'],
            fullscreenActions: ['share']
          }
        }
      })

      for (const { label, addLabel, pickerSelector } of [
        { label: 'Customize navigation', addLabel: 'Add item', pickerSelector: '.itemPickerPopover' },
        { label: 'Customize fullscreen actions', addLabel: 'Add action', pickerSelector: '.itemPickerPopover' },
        { label: 'Customize quick settings', addLabel: 'Add setting', pickerSelector: '.settingPickerPopover' },
      ]) {
        test(`dismisses ${label} picker through Preferences`, async ({ app, page }) => {
          await goTo(page, 'settings')
          const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
          if (protectedSettings) {
            await passwordInput.fill(password)
            await passwordInput.press('Enter')
          }
          const appearance = await goToSettingsSection(page, 'appearance')
          await appearance.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).click()
          const addButton = page.getByRole('button', { name: new RegExp(`^${addLabel}$`, 'i') })
          const addButtonHandle = await addButton.elementHandle()
          const picker = page.locator(pickerSelector)
          await addButton.click()
          await expect(picker).toBeVisible()
          await toggleSettingsFromPreferences(app)
          await expect(page.locator('.settingsWindow')).toBeHidden()
          await toggleSettingsFromPreferences(app)
          if (protectedSettings) {
            await expect(passwordInput).toBeFocused()
            await passwordInput.fill(password)
            await passwordInput.press('Enter')
          }
          await expect(page.locator('.settingsBreadcrumb')).toContainText(new RegExp(label, 'i'))
          await expect(picker).toHaveCount(0)
          await expect(addButton).toHaveAttribute('aria-expanded', 'false')
          await addButton.click()
          await expect(picker).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(picker).toHaveCount(0)
          await expect(addButton).toBeFocused()

          // A queued click on the retained control must not reopen a hidden picker.
          await toggleSettingsFromPreferences(app)
          await expect(page.locator('.settingsWindow')).toBeHidden()
          await addButtonHandle.evaluate(button => button.click())
          await toggleSettingsFromPreferences(app)
          if (protectedSettings) {
            await expect(passwordInput).toBeFocused()
            await passwordInput.fill(password)
            await passwordInput.press('Enter')
          }
          await expect(picker).toHaveCount(0)
          await expect(addButton).toHaveAttribute('aria-expanded', 'false')
        })
      }
    })
  }
}

for (const uiScale of [100, 125]) {
  test.describe(`protected settings subpage reopening at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: { uiScale, settingsPassword, rememberPlaybackSpeedPerChannel: true },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: '' }]
        }]
      }
    })

    test('opens a pending command-palette target after the first Settings unlock', async ({ page }) => {
      await page.keyboard.press('Control+k')
      const search = page.getByRole('combobox', { name: 'Search commands' })
      await search.fill('thumbnail preference')
      await page.getByRole('option', { name: /Thumbnail Preference/ }).click()
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await expect(passwordInput).toBeFocused()
      await passwordInput.fill('wrong-password')
      await passwordInput.press('Enter')
      await expect(page.getByRole('alert')).toHaveText('Incorrect password')
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      await expect(page.locator('.settingsSearchTarget')).toContainText('Thumbnail Preference')
    })

    test('shows sync errors while the retained Sync section is locked', async ({ page }) => {
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSyncServerError', 'Visible sync error')
      })
      await expect(page.locator('.toast', { hasText: 'Visible sync error' })).toHaveCount(0)
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await expect(page.locator('.section[data-section="sync"]')).toBeHidden()
      await page.evaluate(() => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSyncServerError', 'Locked sync error')
      })
      await expect(page.locator('.toast', { hasText: 'Locked sync error' })).toBeVisible()
    })

    test('keeps a locked draft and scrolling through the Downloads shortcut', async ({ page, app }) => {
      await setWindowSize(app, page, { width: 1000, height: 650 })
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
      const themeName = page.locator('.customThemeEditor .themeNameField input')
      await themeName.fill('Unfinished theme')
      const scroller = page.locator('.customThemeEditor .colorGrid')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      const scrollTop = await scroller.evaluate(element => element.scrollTop)
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await page.keyboard.press('Control+j')
      const downloads = page.locator('.settingsDownloadsPage')
      await expect(downloads).toBeVisible()
      await expect(themeName).toHaveValue('Unfinished theme')
      // A queued event on a retained private control must not open an overlay.
      await page.locator('.customThemeEditor .colorFieldTrigger').first().evaluate(button => button.click())
      await expect(page.locator('.colorPickerPopover')).toHaveCount(0)
      await downloads.getByRole('button', { name: 'Add download', exact: true }).click()
      const downloadPrompt = page.locator('.prompt')
      await expect(downloadPrompt).toBeVisible()
      await downloadPrompt.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(themeName).toBeVisible()
      await expect(themeName).toHaveValue('Unfinished theme')
      await expect(page.locator('.colorPickerPopover')).toHaveCount(0)
      await expect.poll(async () => Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollTop)).toBeLessThanOrEqual(1)
    })

    for (const overlay of ['color', 'select', 'icon', 'tooltip']) {
      test(`rejects inactive opens of a retained ${overlay} overlay through unlocking`, async ({ app, page }) => {
        await goTo(page, 'settings')
        const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        let trigger
        let popup
        if (overlay === 'icon') {
          await page.evaluate(() => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            store.commit('setChannelPlaybackSpeeds', JSON.stringify({ UCaaaaaaaaaaaaaaaaaaaaaa: 1.5 }))
            store.commit('setRememberVolumePerChannel', true)
          })
          const playback = await goToSettingsSection(page, 'playback')
          await playback.getByRole('button', { name: /^Manage Saved Channels/ }).click()
          trigger = page.locator('.channelEntry').getByRole('button', { name: 'Remember another setting for this channel', exact: true })
          popup = page.locator('.iconDropdown')
        } else {
          const appearance = await goToSettingsSection(page, 'appearance')
          if (overlay === 'tooltip') {
            trigger = appearance.locator('.tooltip .button').first()
            popup = page.locator('body > [role="tooltip"]:visible')
          } else {
            await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
            const editor = page.locator('.customThemeEditor')
            trigger = overlay === 'select'
              ? editor.getByRole('combobox', { name: 'Based on', exact: true })
              : editor.locator('.colorFieldTrigger').first()
            popup = page.locator(overlay === 'select' ? '.selectDropdown' : '.colorPickerPopover')
          }
        }
        const triggerHandle = await trigger.elementHandle()
        let colorSourcesHandle
        const openPopup = async () => {
          if (overlay === 'tooltip') await trigger.focus()
          else await trigger.click()
          await expect(popup).toBeVisible()
          if (overlay === 'color') {
            await expect(page.locator('.colorSourceList')).toHaveCount(0)
            colorSourcesHandle ??= await popup.locator('.copyFromButton').elementHandle()
          }
        }
        const closePopup = async () => {
          if (overlay === 'tooltip') await trigger.evaluate(button => button.blur())
          else await page.keyboard.press('Escape')
          await expect(popup).toHaveCount(0)
        }
        await page.mouse.move(0, 0)
        await openPopup()
        await closePopup()
        for (const phase of ['closed', 'locked']) {
          await toggleSettingsFromPreferences(app)
          await expect(page.locator('.settingsWindow')).toBeHidden()
          if (phase === 'locked') {
            await toggleSettingsFromPreferences(app)
            await expect(passwordInput).toBeFocused()
          }
          await triggerHandle.evaluate((button, type) => {
            if (type === 'tooltip') {
              button.dispatchEvent(new MouseEvent('mouseenter'))
              button.dispatchEvent(new FocusEvent('focus'))
            } else button.click()
          }, overlay)
          if (colorSourcesHandle) await colorSourcesHandle.evaluate(button => button.click())
          await expect(popup).toHaveCount(0)
          if (phase === 'closed') {
            await toggleSettingsFromPreferences(app)
            await expect(passwordInput).toBeFocused()
          }
          await passwordInput.fill(password)
          await passwordInput.press('Enter')
          await expect(page.locator('.settingsPassword')).toHaveCount(0)
          await expect(trigger).toBeVisible()
          await expect(popup).toHaveCount(0)
          await openPopup()
          await closePopup()
        }
      })
    }

    for (const opener of ['header', 'toast']) {
      test(`a direct section opener replaces a pending search target (${opener})`, async ({ page }) => {
        await goTo(page, 'settings')
        const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        const appearance = await goToSettingsSection(page, 'appearance')
        await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
        const themeName = page.locator('.customThemeEditor .themeNameField input')
        await themeName.fill('Unfinished theme')
        await page.locator('.settingsCloseButton').click()
        await expect(page.locator('.settingsWindow')).toBeHidden()
        await page.keyboard.press('Control+k')
        await page.getByRole('combobox', { name: 'Search commands' }).fill('ui scale')
        await page.getByRole('option', { name: /UI Scale/ }).click()
        await expect(passwordInput).toBeFocused()
        await page.locator('.settingsCloseButton').click()
        await expect(page.locator('.settingsWindow')).toBeHidden()
        if (opener === 'header') {
          await page.evaluate(() => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            store.commit('setSyncServerStatus', 'syncing')
          })
          await page.locator('.topNav .syncIndicator').click()
        } else {
          await page.evaluate(() => {
            window.ftElectron.showToastOnAllTabs('Sync needs attention', 30000, ['fas', 'sync'], 'open-sync-settings')
          })
          await page.locator('.toast', { hasText: 'Sync needs attention' }).getByRole('button', { name: /^Sync(?: Settings)?$/i }).click()
        }
        await expect(passwordInput).toBeFocused()
        await expect(themeName).toHaveValue('Unfinished theme')
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        await expect(page.locator('.section[data-section="sync"]')).toBeVisible()
        await expect(page.locator('.settingsSearchTarget')).toHaveCount(0)
      })
    }

    test('keeps keyboard shortcut navigation unavailable while Settings is locked', async ({ page }) => {
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
      const themeName = page.locator('.customThemeEditor .themeNameField input')
      await themeName.fill('Unfinished theme')
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      const shortcuts = page.locator('.settingsHeaderActions').getByRole('button', { name: 'Show keyboard shortcuts', exact: true })
      await expect(shortcuts).toHaveCount(0)
      await expect(themeName).toHaveValue('Unfinished theme')
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(themeName).toBeVisible()
      await expect(themeName).toHaveValue('Unfinished theme')
      await shortcuts.click()
      await expect(page.locator('.settingsKeyboardShortcutPage')).toBeVisible()
    })

    for (const targetType of ['setting', 'category', 'root']) {
      test(`keeps a draft locked until the latest command-palette target can open (${targetType})`, async ({ page }) => {
        await goTo(page, 'settings')
        const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        const appearance = await goToSettingsSection(page, 'appearance')
        await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
        const themeName = page.locator('.customThemeEditor .themeNameField input')
        await themeName.fill('Unfinished theme')
        await page.locator('.settingsCloseButton').click()
        await expect(page.locator('.settingsWindow')).toBeHidden()
        await goTo(page, 'settings')
        await expect(passwordInput).toBeFocused()
        for (const [query, label] of [['thumbnail preference', /Thumbnail Preference/], ['ui scale', /UI Scale/]]) {
          await page.keyboard.press('Control+k')
          const search = page.getByRole('combobox', { name: 'Search commands' })
          await search.fill(query)
          await page.getByRole('option', { name: label }).click()
          await expect(search).toHaveCount(0)
          await expect(themeName).toHaveCount(1)
          await expect(themeName).toHaveValue('Unfinished theme')
        }
        if (targetType === 'category') {
          await page.keyboard.press('Control+k')
          await page.getByRole('combobox', { name: 'Search commands' }).fill('general settings')
          await page.locator('[role="option"][id$="-settings-general"]').click()
          await expect(themeName).toHaveValue('Unfinished theme')
        }
        if (targetType === 'root') {
          await page.keyboard.press('Control+k')
          const search = page.getByRole('combobox', { name: 'Search commands' })
          await search.fill('check for updates')
          await page.getByRole('option', { name: /Check for updates/i }).click()
          await expect(themeName).toHaveValue('Unfinished theme')
          await page.keyboard.press('Control+k')
          await page.getByRole('combobox', { name: 'Search commands' }).fill('settings')
          await page.locator('[role="option"][id$="-settings-root"]').click()
          await expect(themeName).toHaveValue('Unfinished theme')
        }
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        await expect(page.locator('.settingsPassword')).toHaveCount(0)
        if (targetType === 'setting') {
          await expect(page.locator('.settingsSearchTarget')).toContainText('UI Scale')
        } else if (targetType === 'category') {
          await expect(page.locator('.section[data-section="general"]')).toBeVisible()
          await expect(page.locator('.settingsSearchTarget')).toHaveCount(0)
        } else {
          await expect(themeName).toBeVisible()
          await expect(themeName).toHaveValue('Unfinished theme')
          await expect(page.locator('.settingsSearchTarget')).toHaveCount(0)
        }
      })
    }

    test('keeps standalone Downloads pickers available with a Settings password', async ({ page }) => {
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('upsertYtDlpDownload', {
          id: 1,
          title: 'Downloaded video',
          status: 'completed',
          mode: 'video',
          availability: 'available',
          destination: '/tmp/downloaded-video.webm'
        })
      })
      await goTo(page, 'downloads')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      const downloads = page.locator('.settingsDownloadsPage')
      await downloads.getByRole('button', { name: 'Search filters', exact: true }).click()
      await downloads.getByRole('combobox', { name: 'Sort by', exact: true }).click()
      await expect(page.locator('.selectDropdown')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('.selectDropdown')).toHaveCount(0)
    })

    test('dismisses a teleported prompt when Preferences closes settings', async ({ app, page }) => {
      if (uiScale === 125) await setWindowSize(app, page, { width: 500, height: 700 })
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      const playback = await goToSettingsSection(page, 'playback')
      await playback.getByRole('button', { name: 'Manage Saved Channels (0)', exact: true }).click()
      await page.getByRole('button', { name: 'Add subscribed channel', exact: true }).click()
      const prompt = page.getByRole('dialog', { name: 'Add subscribed channel', exact: true })
      await expect(prompt).toBeVisible()
      await toggleSettingsFromPreferences(app)
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await expect(prompt).toHaveCount(0)
      await expectPromptResourcesReleased(page)
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await expect(prompt).toHaveCount(0)
      await expectPromptResourcesReleased(page)
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      await expect(page.locator('.settingsBreadcrumb')).toContainText('Saved Channel Settings')
      await page.getByRole('button', { name: 'Add subscribed channel', exact: true }).click()
      await expect(prompt).toBeVisible()
      await expect(prompt.getByRole('button', { name: 'Alpha Channel', exact: true })).toBeEnabled()
    })

    for (const outcome of ['success', 'failure']) {
      test(`dismisses a busy prompt through unlocking while its operation is still pending (${outcome})`, async ({ app, page }) => {
        if (uiScale === 125) await setWindowSize(app, page, { width: 500, height: 700 })
        await goTo(page, 'settings')
        const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        await expect(page.locator('.settingsPassword')).toHaveCount(0)
        const sync = await goToSettingsSection(page, 'sync')
        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('setSyncServerUrl', '')
          store.commit('setSyncServerToken', 'test-token')
          store.commit('setSyncServerLiveSupported', true)
          store.commit('setSyncServerEnabled', true)
          store.commit('setSyncServerActivity', [{
            id: 'overlay-test',
            deviceName: 'Laptop',
            collection: 'subscriptions',
            action: 'added',
            item: 'Alpha Channel',
            createdAt: Date.now()
          }])
          store._actions.clearSyncServerActivity = [() => new Promise((resolve, reject) => {
            window.finishOverlayActivityClear = resolve
            window.failOverlayActivityClear = () => reject(new Error('Activity clear failed'))
          })]
        })
        await sync.locator('.activityClear').click()
        const prompt = page.getByRole('dialog', { name: 'Clear on this device', exact: true })
        await prompt.getByRole('button', { name: 'Clear on this device', exact: true }).click()
        await expect(prompt).toHaveAttribute('inert', '')
        await toggleSettingsFromPreferences(app)
        await expect(page.locator('.settingsWindow')).toBeHidden()
        await expect(prompt).toHaveCount(0)
        await expectPromptResourcesReleased(page)
        await goTo(page, 'settings')
        await expect(passwordInput).toBeFocused()
        await expect(prompt).toHaveCount(0)
        await expectPromptResourcesReleased(page)
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        await expect(page.locator('.settingsPassword')).toHaveCount(0)
        await expect(prompt).toHaveCount(0)
        await expectPromptResourcesReleased(page)
        await page.evaluate(outcome => {
          if (outcome === 'success') window.finishOverlayActivityClear()
          else window.failOverlayActivityClear()
        }, outcome)
        await expect(sync.locator('.activityClear')).toBeEnabled()
        await expect(prompt).toHaveCount(0)
        await sync.locator('.activityClear').click()
        await expect(prompt).toBeVisible()
      })
    }

    test('dismisses a pending account prompt and permits retry after failure', async ({ app, page }) => {
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerUrl', '')
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerEnabled', true)
        store._actions.deleteSyncServerAccount = [password => {
          window.accountDeletionPassword = password
          return new Promise((resolve, reject) => {
            window.failAccountDeletion = () => reject(new Error('Account deletion failed'))
          })
        }]
      })
      const openPrompt = sync.getByRole('button', { name: 'Delete sync account', exact: true })
      await openPrompt.click()
      const prompt = page.getByRole('dialog', { name: 'Delete sync account?', exact: true })
      await prompt.getByLabel('Password', { exact: true }).fill('account-password')
      await prompt.getByRole('button', { name: 'Delete account', exact: true }).click()
      await expect(prompt).toHaveAttribute('inert', '')
      await page.keyboard.press('Escape')
      await expect(prompt).toBeVisible()
      await toggleSettingsFromPreferences(app)
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(prompt).toHaveCount(0)
      await expectPromptResourcesReleased(page)
      expect(await page.evaluate(() => window.accountDeletionPassword)).toBe('account-password')
      await page.evaluate(() => window.failAccountDeletion())
      await expect(openPrompt).toBeEnabled()
      await openPrompt.click()
      await expect(prompt).toBeVisible()
      await expect(prompt.getByLabel('Password', { exact: true })).toHaveValue('')
    })

    test.describe('late prompts', () => {
      test.use({
        seed: {
          settings: {
            uiScale,
            settingsPassword,
            syncServerEnabled: true,
            syncServerToken: 'test-token',
            syncServerUrl: 'https://sync.example',
            syncServerUsername: 'test-user',
            syncServerPrivacyMode: 'legacy',
            syncServerAutoSync: false,
            syncServerSyncSubscriptions: false,
            syncServerSyncPlaylists: false,
            syncServerSyncHistory: false,
            syncServerSyncProfiles: true,
            syncServerSnapshot: JSON.stringify({
              profiles: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
                `removed-profile-${index}`,
                { remoteId: `removed-profile-${index}`, metadata: { title: `Removed profile ${index}` }, channels: [] }
              ]))
            })
          }
        }
      })

      test('dismisses a prompt created while Settings is already locked', async ({ app, page }) => {
        await page.route('https://sync.example/**', route => route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(route.request().url().endsWith('/health')
            ? { capabilities: { encrypted_sync: 0 } }
            : [])
        }))
        await goTo(page, 'settings')
        const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        const sync = await goToSettingsSection(page, 'sync')
        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          const syncAction = store._actions.syncWithSyncServer[0]
          store._actions.syncWithSyncServer = [payload => new Promise((resolve, reject) => {
            window.finishLateSettingsSync = () => {
              const result = syncAction(payload)
              result.then(resolve, reject)
              return result.catch(error => { window.lateSettingsSyncError = { name: error.name, message: error.message } })
            }
          })]
        })
        await sync.getByRole('button', { name: 'Sync now', exact: true }).click()
        await toggleSettingsFromPreferences(app)
        await expect(page.locator('.settingsWindow')).toBeHidden()
        await goTo(page, 'settings')
        await expect(passwordInput).toBeFocused()
        await page.evaluate(() => window.finishLateSettingsSync())
        expect(await page.evaluate(() => window.lateSettingsSyncError)).toMatchObject({ name: 'SyncServerDataLossError' })
        const prompt = page.getByRole('dialog', { name: 'Confirm destructive sync?', exact: true })
        await expect(prompt).toHaveCount(0)
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        await expect(page.locator('.settingsPassword')).toHaveCount(0)
        await expect(prompt).toHaveCount(0)
        await expectPromptResourcesReleased(page)
      })
    })

    for (const picker of ['select', 'color']) {
      test(`dismisses a teleported ${picker} picker when Preferences closes settings`, async ({ app, page }) => {
        if (uiScale === 125) await setWindowSize(app, page, { width: 500, height: 700 })
        await goTo(page, 'settings')
        const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        await expect(page.locator('.settingsPassword')).toHaveCount(0)
        const appearance = await goToSettingsSection(page, 'appearance')
        await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
        const editor = page.locator('.customThemeEditor')
        const trigger = picker === 'select'
          ? editor.getByRole('combobox', { name: 'Based on', exact: true })
          : editor.locator('.colorFieldTrigger').first()
        const popup = page.locator(picker === 'select' ? '.selectDropdown' : '.colorPickerPopover')
        await trigger.click()
        await expect(popup).toBeVisible()
        await toggleSettingsFromPreferences(app)
        await expect(page.locator('.settingsWindow')).toBeHidden()
        await expect(popup).toHaveCount(0)
        await goTo(page, 'settings')
        await expect(passwordInput).toBeFocused()
        await expect(popup).toHaveCount(0)
        await passwordInput.fill(password)
        await passwordInput.press('Enter')
        await expect(page.locator('.settingsPassword')).toHaveCount(0)
        await expect(editor).toBeVisible()
        await trigger.click()
        await expect(popup).toBeVisible()
      })
    }

    test('keeps an unsaved theme draft through closing the locked password screen', async ({ app, page }) => {
      if (uiScale === 125) await setWindowSize(app, page, { width: 500, height: 700 })
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Create custom theme', exact: true }).click()
      const themeName = page.locator('.customThemeEditor .themeNameField input')
      await themeName.fill('Unfinished theme')
      await toggleSettingsFromPreferences(app)
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await expect(page.locator('.settingsBreadcrumb')).toHaveText('Settings')
      await expect(page.locator('.settingsBackButton, .settingsBreadcrumbRoot, .settingsBreadcrumbParent')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      await expect(page.locator('.settingsBreadcrumb')).toContainText('Custom theme creator')
      await expect(themeName).toHaveValue('Unfinished theme')
    })

    test('keeps Customize navigation and scroll after unlocking again', async ({ app, page }) => {
      await setWindowSize(app, page, uiScale === 125 ? { width: 500, height: 700 } : { width: 1100, height: 600 })
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Customize navigation', exact: true }).click()
      const subpage = page.locator('.selectedItem').first()
      await expect(subpage).toBeVisible()
      const scroller = page.locator('.settingsSubpageScroll:visible')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      const scrollTop = await scroller.evaluate(element => element.scrollTop)
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await expect(subpage).toBeHidden()
      await expect(page.locator('.settingsBreadcrumb')).toHaveText('Settings')
      await expect(page.locator('.settingsBackButton, .settingsBreadcrumbRoot, .settingsBreadcrumbParent')).toHaveCount(0)
      await passwordInput.fill('wrong-password')
      await passwordInput.press('Enter')
      await expect(page.getByRole('alert')).toHaveText('Incorrect password')
      await expect(subpage).toBeHidden()
      await toggleSettingsFromPreferences(app)
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await toggleSettingsFromPreferences(app)
      await expect(passwordInput).toBeFocused()
      await expect(subpage).toBeHidden()
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      await expect(page.locator('.settingsBreadcrumb')).toContainText('Customize navigation')
      await expect(page.locator('.selectedItem').last()).toBeVisible()
      await expect.poll(async () => Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollTop))
        .toBeLessThanOrEqual(1)
    })
  })
}

for (const uiScale of [100, 125]) {
  test.describe(`settings subpage reopening at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale } } })

    test('opens a command-palette category before compact Settings first mounts', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 375, height: 700 })
      await page.keyboard.press('Control+k')
      await page.getByRole('combobox', { name: 'Search commands' }).fill('appearance')
      await page.locator('[role="option"][id$="-settings-appearance"]').click()
      await expect(page.locator('.section[data-section="appearance"]')).toBeVisible()
      await expect(page.locator('.mobileSettingsMenu')).toBeHidden()
    })

    test('keeps the compact category menu when Settings is reopened', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 375, height: 700 })
      await goToSettingsSection(page, 'appearance')
      await page.locator('.settingsBackButton').click()
      const menu = page.locator('.mobileSettingsMenu')
      await expect(menu).toBeVisible()
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(menu).toBeVisible()
      await expect(page.locator('.settingsContentPane')).toBeHidden()
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await page.keyboard.press('Control+k')
      await page.getByRole('combobox', { name: 'Search commands' }).fill('appearance')
      await page.locator('[role="option"][id$="-settings-appearance"]').click()
      await expect(page.locator('.section[data-section="appearance"]')).toBeVisible()
    })

    test('keeps search results when Settings is reopened', async ({ page }) => {
      await goToSettingsSection(page, 'appearance')
      const search = page.getByRole('searchbox', { name: 'Search settings' })
      await search.fill('thumbnail')
      const results = page.locator('.settingsSearchResults')
      await expect(results).toBeVisible()
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(search).toHaveValue('thumbnail')
      await expect(results).toBeVisible()
      await search.fill('')
      await expect(page.locator('.section[data-section="appearance"]')).toBeVisible()
    })

    for (const { section, label, title, content } of [
      { section: 'appearance', label: 'Customize navigation', content: '.selectedItem' },
      { section: 'appearance', label: 'Customize quick settings', content: '.selectedSection' },
      { section: 'appearance', label: 'Customize fullscreen actions', content: '.selectedAction' },
      { section: 'appearance', label: 'Create custom theme', title: 'Custom theme creator', content: '.customThemeEditor' },
      { section: 'playback', label: 'Manage Saved Channels', title: 'Saved Channel Settings', content: '.channelListContainer' },
    ]) {
      test(`keeps ${label} when settings is closed and reopened`, async ({ app, page }) => {
        if (uiScale === 125) await setWindowSize(app, page, { width: 500, height: 700 })
        const category = await goToSettingsSection(page, section)
        await category.getByRole('button', { name: label }).click()
        const breadcrumb = page.locator('.settingsBreadcrumb')
        const subpage = page.locator(content).first()
        await expect(breadcrumb).toContainText(title ?? label)
        await expect(subpage).toBeVisible()

        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt === 0) {
            await page.locator('.settingsCloseButton').click()
          } else {
            await toggleSettingsFromPreferences(app)
          }
          await expect(page.locator('.settingsWindow')).toBeHidden()
          await goTo(page, 'settings')
          await expect(breadcrumb).toContainText(title ?? label)
          await expect(subpage).toBeVisible()
        }

        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await expect(category).toBeVisible()
        await expect(subpage).toHaveCount(0)
        await page.locator('.settingsCloseButton').click()
        await expect(page.locator('.settingsWindow')).toBeHidden()
        await goTo(page, 'settings')
        await expect(category).toBeVisible()
        await expect(subpage).toHaveCount(0)

        if (uiScale === 125) await page.getByRole('button', { name: 'Back', exact: true }).click()
        await page.locator('.settingsMenu [data-section="privacy"]').click()
        await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()
      })
    }
  })
}
