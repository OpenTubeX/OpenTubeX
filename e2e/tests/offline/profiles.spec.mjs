import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '../../helpers/app.mjs'

// The main profile ('allChannels') must exist in any seeded profiles.db,
// otherwise the app would recreate the store with only the default profile.
const mainProfile = {
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#d50000',
  textColor: '#FFFFFF',
  subscriptions: []
}

const secondProfile = {
  _id: 'e2eprofile',
  name: 'Second profile',
  bgColor: '#558B2F',
  textColor: '#FFFFFF',
  subscriptions: []
}

const profileIcon = (page) => page.locator('.topNav .profileTrigger')
const profileIconInitial = (page) => profileIcon(page).locator('.profileInitial')

async function openProfileList(page) {
  await profileIcon(page).click()
  await page.locator('.profileSummary').click()
  await expect(page.locator('.profileList')).toBeVisible()
}

test.describe('profile selector', () => {
  test.use({ seed: { profiles: [mainProfile, secondProfile] } })

  test('lists seeded profiles and switches the active profile', async ({ page }) => {
    await expect(profileIconInitial(page)).toHaveText('A')

    await openProfileList(page)
    const entries = page.locator('.profileList .profileOption')
    await expect(entries).toHaveCount(2)
    await expect(entries.filter({ hasText: 'Second profile' })).toBeVisible()

    await entries.filter({ hasText: 'Second profile' }).click()
    await expect(page.locator('.quickSettingsMenu')).toHaveClass(/quick-settings-menu-leave-active/)
    await expect(page.locator('.menuSection')).toHaveCount(0)
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
    await expect(profileIconInitial(page)).toHaveText('S')
  })
})

test.describe('default profile setting', () => {
  test.use({
    seed: {
      settings: { defaultProfile: 'e2eprofile' },
      profiles: [mainProfile, secondProfile]
    }
  })

  test('the configured default profile is active on startup', async ({ page }) => {
    await expect(profileIconInitial(page)).toHaveText('S')
  })
})

test.describe('profile manager', () => {
  test('a profile can be created through the UI and persists', async ({ app, page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Profile Manager')

    await page.getByRole('button', { name: 'Create New Profile' }).click()
    await page.locator('.profileName input').fill('Created via UI')
    await page.getByRole('button', { name: 'Create Profile', exact: true }).click()

    // Both the settings page and the top-nav selector render a .profileList,
    // so scope to the settings page's profile bubbles.
    await expect(page.locator('.card .profileList').getByText('Created via UI')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.some((record) => record.name === 'Created via UI')
    }).toBe(true)

    ;({ page } = await app.relaunch())
    await openProfileList(page)
    await expect(page.locator('.profileList .profileOption').filter({ hasText: 'Created via UI' })).toBeVisible()
  })

  test.describe('theme color profiles', () => {
    test.use({ seed: { settings: { mainColor: 'Green' } } })

    test('follows the theme color when the theme color option is picked', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()

      await page.locator('.themeColorOption').click()

      // 'Green' is the seeded main color theme
      const preview = page.locator('.profilePreviewIcon')
      await expect(preview).toHaveCSS('background-color', 'rgb(76, 175, 80)')
      await page.getByRole('button', { name: 'Update Profile' }).click()

      await expect.poll(async () => {
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('var(--primary-color)')

      // switching the theme color has to repaint the profile, without touching the profile itself
      await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(76, 175, 80)')
      // the narrow layout only shows the section menu after going back to it
      const themeSection = page.locator('.settingsMenu [data-section="theme"]')
      if (!await themeSection.isVisible()) await page.locator('.settingsBreadcrumbRoot').click()
      await themeSection.click()

      // the labels are translated, so find the main color select and its 'Blue'
      // option through the values of the hidden native select instead
      const mainColorSelect = page.locator('.settingsContent .select')
        .filter({ has: page.locator('select option[value="Blue"]') })
        .first()
      const blueIndex = await mainColorSelect.locator('option[value="Blue"]').evaluate(option => option.index)
      await mainColorSelect.getByRole('combobox').click()
      await page.locator('.selectDropdown .selectOption').nth(blueIndex).click()
      await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(33, 150, 243)')
    })
  })

  test('customizes a profile icon with a cropped SVG or emoji', async ({ app, page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.card .profileList').getByText('All Channels').click()

    const makeDefaultButton = page.getByRole('button', { name: 'Make Default Profile' })
    await expect(makeDefaultButton).toBeDisabled()
    await expect(page.locator('.colorOption.selected')).toHaveCount(1)

    await page.locator('.imageInput').setInputFiles({
      name: 'globe.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>')
    })
    await expect(page.getByRole('heading', { name: 'Crop Image' })).toBeVisible()
    await page.getByRole('button', { name: 'Apply Crop' }).click()

    const preview = page.locator('.profilePreviewIcon')
    await expect(preview.locator('img')).toBeVisible()
    await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.getByRole('button', { name: 'Update Profile' }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
      return profile?.icon?.type === 'image' && profile.bgColor === 'transparent'
    }).toBe(true)

    const customEmoji = page.locator('#profileEmoji')
    await customEmoji.fill('A')
    await expect(customEmoji).toHaveValue('')
    await expect(preview.locator('img')).toBeVisible()

    await customEmoji.fill('❤')
    await expect(customEmoji).toHaveValue('❤')
    await expect(preview).toContainText('❤')

    await customEmoji.fill('🌍')
    await expect(preview.locator('img')).toHaveCount(0)
    await expect(preview).toContainText('🌍')
    await expect(preview).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.getByRole('button', { name: 'Update Profile' }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
      return profile?.icon?.value === '🌍' && profile.bgColor !== 'transparent'
    }).toBe(true)
  })
})
