import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '../../helpers/app.mjs'

// The main profile ('allChannels') must exist in any seeded profiles.db,
// otherwise the app would recreate the store with only the default profile.
const mainProfile = {
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#000000',
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

const profileIcon = (page) => page.locator('.topNav .profiles .colorOption').first()
const profileIconInitial = (page) => profileIcon(page).locator('.initial')

test.describe('profile selector', () => {
  test.use({ seed: { profiles: [mainProfile, secondProfile] } })

  test('lists seeded profiles and switches the active profile', async ({ page }) => {
    await expect(profileIconInitial(page)).toHaveText('A')

    await profileIcon(page).click()
    const entries = page.locator('.profileList .profile')
    await expect(entries).toHaveCount(2)
    await expect(entries.filter({ hasText: 'Second profile' })).toBeVisible()

    await page.locator('.profileList .profile[data-profile-id="e2eprofile"]').click()
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
    await profileIcon(page).click()
    await page.locator('.profileList .profileSettings').click()
    await expect(page).toHaveURL(/#\/settings\/profile/)

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
    await profileIcon(page).click()
    await expect(page.locator('.profileList .profile').filter({ hasText: 'Created via UI' })).toBeVisible()
  })
})
