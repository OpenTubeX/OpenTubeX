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

    test('hides a busy prompt that cannot cancel while settings is locked', async ({ app, page }) => {
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
        store._actions.clearSyncServerActivity = [() => new Promise(resolve => {
          window.finishOverlayActivityClear = resolve
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
      await page.evaluate(() => window.finishOverlayActivityClear())
      await expect(prompt).toHaveCount(0)
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      await expect(prompt).toHaveCount(0)
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
