import { readFile } from 'node:fs/promises'

import { test, expect, goToSettingsSection, openNewWindowFromTabBar, openThemeGallery, setWindowSize, readDatastore, waitForAppReady } from '../../helpers/app.mjs'
import { expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

// Fractional UI scales round innerWidth, so try neighbouring device widths
// until the window reaches the requested CSS width. Narrow widths at 95% fall
// below Electron's minimum window width, so lift it for the test.
async function resizeToCssWidth(app, page, width, uiScale) {
  const base = Math.round(width * uiScale / 100)
  for (const offset of [0, 1, -1, 2, -2]) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(1, 1)
      window.setBounds({ ...window.getBounds(), width })
    }, base + offset)
    try {
      await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 2000 }).toBe(width)
      return
    } catch {}
  }
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}

const channelAvatar = `data:image/svg+xml;base64,${(await readFile(new URL('../../fixtures/media/avatar.svg', import.meta.url))).toString('base64')}`

// The main profile ('allChannels') must exist in any seeded profiles.db,
// otherwise the app would recreate the store with only the default profile.
const mainProfile = {
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#d50000',
  textColor: '#FFFFFF',
  icon: { type: 'initial' },
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

test.describe('All Channels with a previously saved color', () => {
  test.use({
    seed: {
      profiles: [
        { ...mainProfile, bgColor: '#558B2F', icon: null },
        { ...secondProfile, icon: null }
      ]
    }
  })

  test('adopts the person icon while keeping the saved color and other profile initials', async ({ app, page }) => {
    await expect(profileIconInitial(page).locator('[data-icon="circle-user"] svg')).toBeVisible()
    await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(85, 139, 47)')
    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'profiles')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
    }).toEqual({ ...mainProfile, bgColor: '#558B2F', icon: { type: 'icon', value: 'circle-user' } })
    await openProfileList(page)
    await page.locator('.profileList .profileOption').filter({ hasText: 'Second profile' }).click()
    await expect(profileIconInitial(page)).toHaveText('S')
  })
})

test.describe('existing All Channels without an icon', () => {
  test.use({ seed: { profiles: [{ ...mainProfile, icon: undefined }, secondProfile] } })

  test('uses the person icon and keeps other profiles on their initials', async ({ app, page }) => {
    await expect(profileIconInitial(page).locator('[data-icon="circle-user"] svg')).toBeVisible()
    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'profiles')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
    }).toEqual({ ...mainProfile, icon: { type: 'icon', value: 'circle-user' } })
    await openProfileList(page)
    await page.locator('.profileList .profileOption').filter({ hasText: 'Second profile' }).click()
    await expect(profileIconInitial(page)).toHaveText('S')
  })

  test('keeps the default icon when an older profile arrives from another window', async ({ page }) => {
    const personIcon = profileIconInitial(page).locator('[data-icon="circle-user"] svg')
    await expect(personIcon).toBeVisible()
    await page.evaluate(() => {
      const store = window.$store
      const profile = { ...store.getters.getActiveProfile }
      profile.icon = null
      store.commit('upsertProfileToList', profile)
    })
    await expect(personIcon).toBeVisible()
  })
})

for (const iconPack of ['material']) {
  test.describe(`built-in profile icons (${iconPack})`, () => {
    test.use({ seed: { settings: { iconPack }, profiles: [mainProfile, secondProfile] } })

    test('new profiles use the default icon until named and retain manually chosen icons', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      const createOption = page.locator('.profileSettingsContent .profileList').getByRole('button', { name: 'Create New Profile', exact: true })
      await expect(createOption.locator('[data-icon="user-plus"]')).toHaveAttribute('data-icon-pack', iconPack)
      await expect(createOption.locator('[data-icon="user-plus"]')).toHaveAttribute('aria-hidden', 'true')
      await createOption.focus()
      await createOption.press('Enter')
      const heading = page.getByRole('heading', { name: 'Create New Profile', exact: true })
      await expect(heading).toBeVisible()
      await expect(heading.locator('[data-icon="user-plus"]')).toHaveAttribute('data-icon-pack', iconPack)
      await expect(page.locator('.profileSettingsContent .profileList')).toHaveCount(0)
      const name = page.locator('.profileName input')
      const preview = page.locator('.profilePreviewIcon')
      const person = preview.locator('[data-icon="circle-user"] svg')
      await expect(person).toBeVisible()
      await expect(page.locator('.colorOptions').locator('..').locator('input')).toHaveCount(0)
      await expect.poll(() => page.locator('.profileCreationActions').evaluate(element =>
        element.querySelector('button').getBoundingClientRect().top - element.previousElementSibling.getBoundingClientRect().bottom
      ), { timeout: 2000 }).toBeCloseTo(21, 0)
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      await testInfo.attach(`New profile heading and default icon in ${iconPack}`, {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
      })
      await name.fill('Discarded draft')
      await setWindowSize(app, page, { width: 375, height: 700 })
      const scroller = page.locator('.settingsSubpageScroll')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.locator('.profileSettingsContent .profileList').getByText('Second profile')).toBeVisible()
      await expect(heading).toHaveCount(0)
      await expect(preview).toHaveCount(0)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(1)
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      const records = (readDatastore(app.userDataDir, 'profiles')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      expect(records.some(record => record.name === 'Discarded draft')).toBe(false)
      await setWindowSize(app, page, { width: 1600, height: 900 })
      await page.getByRole('button', { name: 'Create New Profile' }).click()
      await expect(name).toHaveValue('')
      await expect(person).toBeVisible()
      await name.fill('Alice')
      await expect(preview).toHaveText('A')
      await name.fill('Bob')
      await expect(preview).toHaveText('B')
      await name.fill('')
      await expect(person).toBeVisible()
      const gallery = page.locator('.builtinIconOptions')
      await gallery.getByRole('button', { name: 'Person', exact: true }).click()
      await name.fill('Carol')
      await expect(person).toBeVisible()
      await gallery.getByRole('button', { name: 'Gaming', exact: true }).click()
      await name.fill('')
      await expect(preview.locator('[data-icon="gamepad"] svg')).toBeVisible()
      await page.getByRole('button', { name: 'Use Initial' }).click()
      await expect(person).toBeVisible({ timeout: 2000 })
      await name.fill('  ')
      await expect(person).toBeVisible()
      await name.fill('Carol')
      await expect(preview).toHaveText('C')
      await page.locator('.emojiOptions').getByRole('button', { name: '🌈', exact: true }).click()
      await name.fill('Dave')
      await expect(preview).toHaveText('🌈')
      await page.getByRole('textbox', { name: 'Custom Emoji', exact: true }).fill('🐶')
      await name.fill('Eve')
      await expect(preview).toHaveText('🐶')
      await page.getByRole('textbox', { name: 'Custom Emoji', exact: true }).fill('')
      await expect(preview).toHaveText('E')
      await name.fill('')
      await expect(person).toBeVisible()
      await name.fill('Eve')
      await expect(preview).toHaveText('E')
      await page.getByRole('textbox', { name: 'Custom Emoji', exact: true }).fill('🐶')
      await page.locator('.imageInput').setInputFiles({
        name: 'globe.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>')
      })
      await page.getByRole('button', { name: 'Apply Crop' }).click()
      await name.fill('Frank')
      await expect(preview.locator('img')).toBeVisible()
      await page.getByRole('button', { name: 'Use Initial' }).click()
      await name.fill('Grace')
      await expect(preview).toHaveText('G')
      await gallery.getByRole('button', { name: 'Gaming', exact: true }).click()
      await name.fill('Helen')
      await expect(preview.locator('[data-icon="gamepad"] svg')).toBeVisible()
      await page.getByRole('button', { name: 'Create Profile', exact: true }).click()
      await expect(page.locator('.card .profileList').getByText('Helen')).toBeVisible()
      await expect.poll(async () => {
        const contents = readDatastore(app.userDataDir, 'profiles')
        return contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).findLast(record => record.name === 'Helen' && !record.$$deleted)?.icon
      }).toEqual({ type: 'icon', value: 'gamepad' })
    })

    test('previews, saves and resets built-in icons at desktop and phone widths', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader').getByRole('button', { name: 'Profile', exact: true }).click()
      await page.locator('.card .profileList').getByText('All Channels').click()

      const gallery = page.locator('.builtinIconOptions')
      const preview = page.locator('.profilePreviewIcon')
      const themeSwatch = page.locator('.themeColorOption')
      const themeIcon = themeSwatch.locator('.ft-icon')
      await expect(themeSwatch).toHaveAccessibleName('Theme Color')
      await expect(themeIcon).toHaveAttribute('data-icon-pack', iconPack)
      await expect(themeIcon).toHaveAttribute('aria-hidden', 'true')
      await expect(themeIcon.locator('svg')).toBeVisible()
      await expect(gallery.getByRole('button')).toHaveCount(12)
      await expect(gallery.locator('svg')).toHaveCount(12)
      for (const [width, scale] of [[1200, 1], [390, 0.95]]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
        await themeSwatch.scrollIntoViewIfNeeded()
        await expect.poll(() => themeSwatch.evaluate(element => {
          const swatch = element.getBoundingClientRect()
          const icon = element.querySelector('.ft-icon').getBoundingClientRect()
          return Math.max(
            Math.abs((swatch.left + swatch.right - icon.left - icon.right) / 2),
            Math.abs((swatch.top + swatch.bottom - icon.top - icon.bottom) / 2)
          )
        })).toBeLessThan(1)
        await testInfo.attach(`Theme color swatch ${iconPack} at ${scale} scale`, {
          body: await page.screenshot(), contentType: 'image/png'
        })
        for (const label of ['Person', 'Headphones', 'Gaming', 'Art', 'Science']) {
          const option = gallery.getByRole('button', { name: label, exact: true })
          await option.click()
          await expect(option).toHaveAttribute('aria-pressed', 'true')
          await expect(preview.locator('.ft-icon')).toHaveAttribute('data-icon-pack', iconPack)
          await expect(preview.locator('svg')).toBeVisible()
          const galleryBox = await gallery.boundingBox()
          expect(galleryBox.x).toBeGreaterThanOrEqual(0)
          expect(galleryBox.x + galleryBox.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
        }
      }
      await gallery.getByRole('button', { name: 'Gaming', exact: true }).click()
      await page.getByRole('button', { name: 'Update Profile' }).click()
      await expect(profileIconInitial(page).locator('[data-icon="gamepad"] svg')).toBeVisible()
      await expect.poll(async () => {
        const contents = readDatastore(app.userDataDir, 'profiles')
        const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
        return records.findLast(record => record._id === 'allChannels' && !record.$$deleted)?.icon
      }).toEqual({ type: 'icon', value: 'gamepad' })

      await page.evaluate(() => window.ftElectron.setZoomFactor(1))
      await page.setViewportSize({ width: 1200, height: 1000 })
      await page.locator('.profileIconHeading').scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`profile-icons-${iconPack}.png`) })

      await page.getByRole('button', { name: 'Use Initial' }).click()
      await expect(preview).toHaveText('A')
      await page.getByRole('button', { name: 'Update Profile' }).click()
      await expect.poll(async () => {
        const contents = readDatastore(app.userDataDir, 'profiles')
        const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
        return records.findLast(record => record._id === 'allChannels' && !record.$$deleted)?.icon
      }).toEqual({ type: 'initial' })
      await page.reload()
      await expect(profileIconInitial(page)).toHaveText('A')
    })
  })
}

test.describe('profile selector', () => {
  test.use({ seed: { profiles: [mainProfile, secondProfile] } })

  test('ignores stale profile deletion events from another window', async ({ page }) => {
    await openProfileList(page)
    await expect(page.locator('.profileList .profileOption')).toHaveCount(2)

    await page.evaluate(() => {
      const store = window.$store
      store.commit('removeProfileFromList', 'missing-profile')
    })

    await expect(page.locator('.profileList .profileOption')).toHaveCount(2)
    await expect(page.locator('.profileList .profileOption').filter({ hasText: 'Second profile' })).toBeVisible()
  })

  test('switches to All Channels when another window deletes the active profile', async ({ app, page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await openProfileList(page)
    await page.locator('.profileList .profileOption').filter({ hasText: 'Second profile' }).click()
    await expect(profileIconInitial(page)).toHaveText('S')

    const secondWindow = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(secondWindow)
    expect(await secondWindow.evaluate(() => window.$store.dispatch('removeProfile', 'e2eprofile'))).toBe(true)

    await expect(profileIconInitial(page)).toHaveText('A')
    expect(await page.evaluate(() => window.$store.getters.getActiveProfile._id)).toBe('allChannels')
    expect(errors).toEqual([])
  })

  test('ignores channel updates for profiles removed in another window', async ({ page }) => {
    const profileIds = await page.evaluate(() => {
      const store = window.$store
      const payload = {
        channel: { id: 'channel', name: 'Channel', thumbnail: '' },
        profileIds: ['missing-profile']
      }

      store.commit('addChannelToProfiles', payload)
      store.commit('removeChannelFromProfiles', {
        channelIds: [payload.channel.id],
        profileIds: payload.profileIds
      })

      return store.getters.getProfileList.map(profile => profile._id)
    })

    expect(profileIds).toEqual(['allChannels', 'e2eprofile'])
  })

  test('lists seeded profiles and switches the active profile', async ({ page }) => {
    await expect(profileIconInitial(page)).toHaveText('A')

    await openProfileList(page)
    const entries = page.locator('.profileList .profileOption')
    await expect(entries).toHaveCount(2)
    await expect(entries.filter({ hasText: 'Second profile' })).toBeVisible()

    await entries.filter({ hasText: 'Second profile' }).click()
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

test.describe('profile manager presentation', () => {
  test.use({
    seed: {
      settings: { baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', currentLocale: 'en-US' },
      profiles: [mainProfile, {
        ...secondProfile,
        subscriptions: [
          { id: 'channel-one', name: 'Channel one', thumbnail: channelAvatar },
          { id: 'channel-two', name: 'Channel two', thumbnail: channelAvatar }
        ]
      }]
    }
  })

  test('spaces wrapped profile buttons and stacked editor sections on narrow layouts', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
    await resizeToCssWidth(app, page, 350, uiScale)
    const actions = page.locator('.profileActions')
    await expect.soft.poll(() => actions.evaluate(element => {
      const buttons = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect())
      return buttons.slice(1).every((button, index) => button.top - buttons[index].bottom >= 10)
    }), { timeout: 2000 }).toBe(true)
    await expect.poll(() => page.locator('.secondEditRow').evaluate(element => {
      const [controls, preview] = [...element.children].map(child => child.getBoundingClientRect())
      return preview.top - controls.bottom >= 20
    }), { timeout: 2000 }).toBe(true)
    await actions.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect.poll(() => actions.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const viewport = element.closest('.settingsSubpageScroll').getBoundingClientRect()
      return bounds.top >= viewport.top - 1 && bounds.bottom <= viewport.bottom + 1
    })).toBe(true)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    await testInfo.attach(`Wrapped profile buttons at ${uiScale}% scale`, {
      body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
    })
    const scroller = page.locator('.settingsSubpageScroll')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await resizeToCssWidth(app, page, 940, uiScale)
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.firstElementChild
      const contentEnd = content.getBoundingClientRect().bottom -
        element.getBoundingClientRect().top + element.scrollTop +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      return element.scrollTop <= maximumScrollTop + 1 &&
        scrollbar.classList.contains('os-scrollbar-unusable') === (maximumScrollTop <= 1)
    })).toBe(true)
  })

  test('switches profile tabs without losing draft customization across layouts', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
    const customization = page.getByRole('tab', { name: 'Customization', exact: true })
    const subscriptions = page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true })
    const name = page.locator('.profileName input')
    await name.fill('Unsaved profile name')
    await page.locator('.builtinIconOptions').getByRole('button', { name: 'Gaming', exact: true }).click()
    const colorPickerTrigger = page.locator('.profileColorPicker .colorFieldTrigger')
    await colorPickerTrigger.focus()
    await colorPickerTrigger.press('Enter')
    await expect(page.locator('.colorPickerPopover')).toBeVisible()
    await customization.focus()
    await customization.press('ArrowRight')
    await expect(page.locator('.colorPickerPopover')).toHaveCount(0)
    await expect(subscriptions).toBeFocused()
    await customization.click()
    for (const width of [1200, 940, 375]) {
      await resizeToCssWidth(app, page, width, uiScale)
      await expect(customization).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.selectionActions')).toBeHidden()
      await subscriptions.click()
      await expect(subscriptions).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.profileEdit')).toBeHidden()
      await expect(page.locator('.profileSettingsContent').getByRole('tabpanel')).toHaveAttribute('id', await subscriptions.getAttribute('aria-controls'))
      await page.locator('.selectionActions').getByRole('button', { name: 'Select All', exact: true }).click()
      await customization.click()
      await expect(name).toHaveValue('Unsaved profile name')
      await expect(page.locator('.profilePreviewIcon [data-icon="gamepad"] svg')).toBeVisible()
      await subscriptions.click()
      await expect(page.locator('.selectedCount')).toHaveText('2 selected')
      await page.locator('.selectionActions').getByRole('button', { name: 'Select None', exact: true }).click()
      await expect.poll(() => subscriptions.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth
      })).toBe(true)
      if (width === 1200 && uiScale === 100) {
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          await expectImagesLoaded(page.locator('.profileSettingsContent img:visible'))
          // Scroll-linked scrollbar handles never finish
          await page.locator('.profileSettingsContent').evaluate(element => Promise.all(
            element.getAnimations({ subtree: true })
              .filter(animation => animation.timeline === document.timeline)
              .map(animation => animation.finished.catch(() => {}))
          ))
          const path = testInfo.outputPath(`profile-tabs-${theme}.png`)
          await page.locator('.profileSettingsContent').screenshot({ path })
          await testInfo.attach(`Profile tabs in ${theme} theme`, { path, contentType: 'image/png' })
        }
      }
      await customization.click()
    }
    await page.evaluate(() => {
      const createBitmap = window.createImageBitmap.bind(window)
      window.createImageBitmap = async (...args) => {
        await new Promise(resolve => { window.releaseProfileImage = resolve })
        const bitmap = await createBitmap(...args)
        window.profileImageDecoded = true
        return bitmap
      }
    })
    await page.locator('.imageInput').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: await readFile(new URL('../../../src/renderer/assets/img/yt_logo_mono_dark.png', import.meta.url))
    })
    await expect.poll(() => page.evaluate(() => typeof window.releaseProfileImage)).toBe('function')
    await subscriptions.click()
    await page.evaluate(() => window.releaseProfileImage())
    await expect.poll(() => page.evaluate(() => window.profileImageDecoded)).toBe(true)
    await expect(page.getByRole('heading', { name: 'Crop Image', exact: true })).toHaveCount(0)
    await customization.click()
    await customization.focus()
    await customization.press('ArrowRight')
    await expect(subscriptions).toBeFocused()
    await expect(subscriptions).toHaveAttribute('tabindex', '0')
    await expect(customization).toHaveAttribute('tabindex', '-1')
    await subscriptions.press('Home')
    await expect(customization).toBeFocused()
    await customization.press('End')
    await expect(subscriptions).toBeFocused()
    await subscriptions.press('ArrowLeft')
    await expect(customization).toBeFocused()
    await customization.press('ArrowLeft')
    await expect(subscriptions).toBeFocused()
    await page.locator('.profileSettingsContent .profileList').getByText('All Channels').click()
    await expect(customization).toHaveAttribute('aria-selected', 'true')
    await subscriptions.click()
    await expect(page.locator('.profileSettingsContent .select')).toHaveCount(0)
    await page.getByRole('button', { name: 'Create New Profile', exact: true }).click()
    await expect(page.locator('.profileTabs')).toHaveCount(0)
    await expect(page.locator('.profileEdit')).toBeVisible()
  })

  test('balances the space above and below the profile filter after emptying subscriptions', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
    await page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true }).click()
    await setWindowSize(app, page, { width: Math.round(400 * uiScale / 100), height: Math.round(700 * uiScale / 100) })
    await resizeToCssWidth(app, page, 350, uiScale)
    await page.locator('.selectionActions').getByRole('button', { name: 'Select All', exact: true }).click()
    await page.locator('.selectionActions').getByRole('button', { name: 'Delete Selected', exact: true }).click()
    const scroller = page.locator('.settingsSubpageScroll')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Yes, Delete', exact: true }).click()
    await expect(page.locator('.selectedCount')).toHaveText('0 selected')
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.firstElementChild
      const contentEnd = content.getBoundingClientRect().bottom -
        element.getBoundingClientRect().top + element.scrollTop +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      return element.scrollTop <= maximumScrollTop + 1 &&
        scrollbar.classList.contains('os-scrollbar-unusable') === (maximumScrollTop <= 1)
    })).toBe(true)
    for (const width of [1200, 350]) {
      await resizeToCssWidth(app, page, width, uiScale)
      await expect.soft.poll(() => page.locator('.profileSettingsContent .select').evaluate(element => {
        const before = document.querySelector('.selectionActions').getBoundingClientRect()
        const label = element.querySelector('.select-label').getBoundingClientRect()
        const count = element.parentElement.nextElementSibling.getBoundingClientRect()
        const above = label.top - before.bottom
        const below = count.top - element.getBoundingClientRect().bottom
        return Math.abs(above - below)
      }), { timeout: 2000, message: `profile filter has balanced spacing at ${width}px` }).toBeLessThanOrEqual(1.05)
      await page.locator('.profileSettingsContent .select').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      await testInfo.attach(`Balanced profile filter at ${width}px and ${uiScale}% scale`, {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
      })
    }
  })

  test('disables subscription selection actions when they do not apply', async ({ page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.profileSettingsContent .profileList').getByText('All Channels').click()
    await page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true }).click()
    const actions = page.locator('.selectionActions')
    const selectAll = actions.getByRole('button', { name: 'Select All', exact: true })
    const selectNone = actions.getByRole('button', { name: 'Select None', exact: true })
    const deleteSelected = actions.getByRole('button', { name: 'Delete Selected', exact: true })
    await expect(selectAll).toBeDisabled()
    await expect(selectNone).toBeDisabled()
    await expect(deleteSelected).toBeDisabled()

    await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
    await page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true }).click()
    await expect(selectAll).toBeEnabled()
    await expect(selectNone).toBeDisabled()
    await expect(deleteSelected).toBeDisabled()
    await page.locator('.profileSettingsContent').getByRole('checkbox', { name: 'Channel one', exact: true }).click()
    await expect(selectAll).toBeEnabled()
    await expect(selectNone).toBeEnabled()
    await expect(deleteSelected).toBeEnabled()
    await selectAll.click()
    await expect(selectAll).toBeDisabled()
    await selectNone.click()
    await expect(selectAll).toBeEnabled()
    await expect(selectNone).toBeDisabled()
    await expect(deleteSelected).toBeDisabled()
    await selectAll.click()
    await deleteSelected.click()
    await page.getByRole('button', { name: 'Yes, Delete', exact: true }).click()
    await expect(page.locator('.selectedCount')).toHaveText('0 selected')
    await expect(selectAll).toBeDisabled()
    await expect(selectNone).toBeDisabled()
    await expect(deleteSelected).toBeDisabled()
  })
})

test.describe('profile manager', () => {
  test.describe('scroll position', () => {
    test.use({
      seed: {
        profiles: [
          mainProfile,
          {
            ...secondProfile,
            subscriptions: Array.from({ length: 30 }, (_, index) => ({
              id: `channel-${index}`,
              name: `Channel ${index}`,
              thumbnail: ''
            }))
          }
        ]
      }
    })

    for (const scale of [1, 1.25]) {
      test(`resets profile tab scrolling after switching from the bottom at ${scale} scale`, async ({ app, page }) => {
        await openProfileList(page)
        await page.locator('.profilePanelHeader button').last().click()
        await page.locator('.card .profileList').getByText('Second profile').click()
        await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
        await setWindowSize(app, page, { width: Math.round(375 * scale), height: Math.round(700 * scale) })
        const customization = page.getByRole('tab', { name: 'Customization', exact: true })
        const subscriptions = page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true })
        const scroller = page.locator('.settingsSubpageScroll')
        for (const current of [customization, subscriptions]) {
          await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
          await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
          await current.evaluate(element => element.focus({ preventScroll: true }))
          await page.keyboard.press('ArrowRight')
          await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(1)
          await expect.poll(() => scroller.evaluate(element => {
            const content = element.firstElementChild
            const contentEnd = content.getBoundingClientRect().bottom -
              element.getBoundingClientRect().top + element.scrollTop +
              Number.parseFloat(getComputedStyle(element).paddingBottom)
            const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
            const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
            return element.scrollTop <= maximumScrollTop + 1 &&
              scrollbar.classList.contains('os-scrollbar-unusable') === (maximumScrollTop <= 1)
          })).toBe(true)
        }
      })
    }

    test('clamps the scroll position after deleting an open profile', async ({ page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('Second profile').click()

      const scroller = page.locator('.settingsSubpageScroll')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await page.getByRole('button', { name: 'Delete Profile' }).click()
      await page.getByRole('button', { name: 'Yes, Delete' }).click()
      await expect(page.locator('.card .profileList').getByText('Second profile')).toHaveCount(0)

      await expect.poll(() => scroller.evaluate(element => {
        const content = element.firstElementChild
        const contentEnd = content.getBoundingClientRect().bottom -
          element.getBoundingClientRect().top + element.scrollTop +
          Number.parseFloat(getComputedStyle(element).paddingBottom)
        const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
        return element.scrollTop - maximumScrollTop
      })).toBeLessThanOrEqual(1)
    })

    test('clamps the scroll positions after searching and deleting from the bottom', { tag: '@scale' }, async ({ page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('Second profile').click()
      await page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true }).click()

      // The channels scroll on their own, inside the scrolling settings window
      const scroller = page.locator('.settingsSubpageScroll')
      const channelScroller = page.locator('.channelScroller').first()
      for (const element of [scroller, channelScroller]) {
        await element.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => element.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      }

      // Typing would scroll the field into view, which hides the stale offset
      const search = page.getByRole('searchbox', { name: 'Search channels', exact: true })
      await search.evaluate(input => {
        input.value = 'no such channel'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await expect(page.getByText('No channels match your search', { exact: true })).toBeVisible()

      await expect.poll(() => scroller.evaluate(element => {
        const content = element.firstElementChild
        const contentEnd = content.getBoundingClientRect().bottom -
          element.getBoundingClientRect().top + element.scrollTop +
          Number.parseFloat(getComputedStyle(element).paddingBottom)
        const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        return element.scrollTop <= maximumScrollTop + 1 &&
          scrollbar.classList.contains('os-scrollbar-unusable') === (maximumScrollTop <= 1)
      })).toBe(true)
      await expect(channelScroller).toBeHidden()

      await search.evaluate(input => {
        input.value = 'Channel 1'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await expect(channelScroller.getByRole('checkbox')).toHaveCount(11)
      const channelScrollRangeIsValid = () => channelScroller.evaluate(element => {
        const content = [...element.children].filter(child => !child.classList.contains('os-scrollbar')).at(-1)
        const contentEnd = content.getBoundingClientRect().bottom - element.getBoundingClientRect().top + element.scrollTop
        const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        return element.scrollTop <= maximumScrollTop + 1 &&
          scrollbar.classList.contains('os-scrollbar-unusable') === (maximumScrollTop <= 1)
      })
      await expect.poll(channelScrollRangeIsValid).toBe(true)

      // Deleting the channels at the end shortens the list below its offset
      await search.fill('')
      await expect(channelScroller.getByRole('checkbox')).toHaveCount(30)
      const actions = page.locator('.selectionActions')
      await actions.getByRole('button', { name: 'Select All', exact: true }).click()
      for (const index of [0, 1, 10, 11]) {
        await channelScroller.getByRole('checkbox', { name: `Channel ${index}`, exact: true }).click()
      }
      await channelScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => channelScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await actions.getByRole('button', { name: 'Delete Selected', exact: true }).click()
      await page.getByRole('button', { name: 'Yes, delete', exact: true }).click()
      await expect(channelScroller.getByRole('checkbox')).toHaveCount(4)
      await expect.poll(channelScrollRangeIsValid).toBe(true)
    })
  })

  test.describe('large subscription lists', () => {
    const subscriptions = Array.from({ length: 101 }, (_, index) => ({
      id: `UC${String(index).padStart(22, '0')}`,
      name: `Channel ${String(index).padStart(3, '0')}`,
      thumbnail: ''
    }))
    test.use({
      seed: {
        settings: { generalAutoLoadMorePaginatedItemsEnabled: false },
        profiles: [{ ...mainProfile, subscriptions }, secondProfile]
      }
    })

    test('pages channel lists and still selects and adds every channel', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('Second profile').click()
      await page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true }).click()

      const lists = page.locator('.profileSettingsContent').getByRole('tabpanel').locator('.card')
      const otherChannels = lists.nth(1)
      await expect(otherChannels.getByRole('checkbox')).toHaveCount(100)
      // Selection covers channels that have not been rendered yet
      await otherChannels.getByRole('button', { name: 'Select All', exact: true }).click()
      await expect(otherChannels.getByText('101 selected', { exact: true })).toBeVisible()
      await otherChannels.getByRole('button', { name: 'Load more channels', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(otherChannels.getByRole('checkbox')).toHaveCount(101)
      await expect(otherChannels.getByRole('checkbox', { name: 'Channel 100', exact: true })).toBeFocused()
      await expect(otherChannels.getByRole('checkbox', { name: 'Channel 100', exact: true })).toBeChecked()
      await expect(otherChannels.getByRole('button', { name: 'Load more channels', exact: true })).toHaveCount(0)
      await otherChannels.getByRole('button', { name: 'Add Selected To Profile', exact: true }).click()

      const profileChannels = lists.first()
      await expect(profileChannels.getByRole('checkbox')).toHaveCount(100)
      await expect(profileChannels.getByRole('button', { name: 'Load more channels', exact: true })).toBeVisible()
      const storedChannelIds = () => {
        const records = readDatastore(app.userDataDir, 'profiles').trim().split('\n').map(line => JSON.parse(line))
        return records.findLast(record => record._id === secondProfile._id)?.subscriptions.map(channel => channel.id)
      }
      await expect.poll(() => storedChannelIds()?.length).toBe(101)

      // Select All and Delete Selected only cover the search results
      const search = page.getByRole('searchbox', { name: 'Search channels', exact: true })
      await search.fill('05')
      await expect(profileChannels.getByRole('checkbox')).toHaveCount(11)
      await expect(profileChannels.getByRole('button', { name: 'Load more channels', exact: true })).toHaveCount(0)
      await profileChannels.getByRole('button', { name: 'Select All', exact: true }).click()
      await expect(profileChannels.getByText('11 selected', { exact: true })).toBeVisible()
      await profileChannels.getByRole('button', { name: 'Delete Selected', exact: true }).click()
      await page.getByRole('button', { name: 'Yes, delete', exact: true }).click()
      await expect(profileChannels.getByText('No channels match your search', { exact: true })).toBeVisible()
      await expect.poll(() => storedChannelIds()?.length).toBe(90)
      expect(storedChannelIds()).not.toContain(subscriptions[5].id)
      expect(storedChannelIds()).toContain(subscriptions[60].id)

      await search.fill('')
      await expect(profileChannels.getByRole('checkbox')).toHaveCount(90)
    })
  })

  test('a profile can be created through the UI and persists', async ({ app, page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Profile Manager')

    await page.getByRole('button', { name: 'Create New Profile' }).click()
    const heading = page.locator('.profileSettingsContent').getByRole('heading', { name: 'Create New Profile', exact: true })
    await expect(heading).toBeVisible()
    await expect(heading.locator('[data-icon="user-plus"] svg')).toBeVisible()
    await expect(heading.locator('[data-icon="user-plus"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.profileSettingsContent .profileList')).toHaveCount(0)
    await expect(page.locator('.profileColorPicker .colorFieldTrigger')).toBeVisible()
    await expect(page.locator('.colorOptions').locator('..').locator('input')).toHaveCount(0)
    await page.locator('.profileName input').fill('Created via UI')
    await page.getByRole('button', { name: 'Create Profile', exact: true }).click()

    // Both the settings page and the top-nav selector render a .profileList,
    // so scope to the settings page's profile bubbles.
    await expect(page.locator('.card .profileList').getByText('Created via UI')).toBeVisible()
    await expect(heading).toHaveCount(0)

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'profiles')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return records.some((record) => record.name === 'Created via UI')
    }).toBe(true)

    ;({ page } = await app.relaunch())
    await openProfileList(page)
    await expect(page.locator('.profileList .profileOption').filter({ hasText: 'Created via UI' })).toBeVisible()
  })

  test.describe('theme color profiles', () => {
    // The default Tally themes have no main color, so use one that does.
    test.use({ seed: { settings: { baseTheme: 'dark', mainColor: 'Green' } } })

    test('keeps a keyboard-selected swatch when the custom picker was open', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()
      await page.locator('.themeColorOption').click()
      await page.locator('.profileColorPicker .colorFieldTrigger').click()

      const redSwatch = page.locator('.colorOptions .colorOption').nth(1)
      await redSwatch.focus()
      await redSwatch.press('Enter')
      await expect(page.locator('.colorPickerPopover')).toHaveCount(0)
      await expect(page.locator('.profilePreviewIcon')).toHaveCSS('background-color', 'rgb(213, 0, 0)')

      await page.getByRole('button', { name: 'Update Profile' }).click()
      await expect.poll(async () => {
        const contents = readDatastore(app.userDataDir, 'profiles')
        const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('#d50000')
    })

    test('follows the theme color when the theme color option is picked', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()

      await page.locator('.themeColorOption').click()

      // 'Green' is the seeded main color theme
      const preview = page.locator('.profilePreviewIcon')
      await expect(preview).toHaveCSS('background-color', 'rgb(76, 175, 80)')
      await expect(page.locator('.profileColorPicker code')).toHaveText('#4caf50')
      await expect(page.locator('.profileColorPicker .swatchColor')).toHaveCSS('background-color', 'rgb(76, 175, 80)')

      await page.locator('.profileColorPicker .colorFieldTrigger').click()
      const colorPicker = page.locator('.colorPickerPopover')
      await colorPicker.locator('input[type="text"]').fill('#123456')
      await colorPicker.locator('input[type="text"]').press('Enter')
      await page.getByRole('heading', { name: 'Profile Preview' }).click()
      await expect(preview).toHaveCSS('background-color', 'rgb(76, 175, 80)')

      await page.locator('.profileColorPicker .colorFieldTrigger').click()
      await page.evaluate(() => {
        const store = window.$store
        return store.dispatch('updateMainColor', 'Orange')
      })
      await expect(preview).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      await expect(page.locator('.profileColorPicker code')).toHaveText('#ff9800')
      await expect(page.locator('.profileColorPicker .swatchColor')).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      await page.getByRole('heading', { name: 'Profile Preview' }).click()
      await expect(preview).toHaveCSS('background-color', 'rgb(255, 152, 0)')

      await page.getByRole('button', { name: 'Update Profile' }).click()

      await expect.poll(async () => {
        const contents = readDatastore(app.userDataDir, 'profiles')
        const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('var(--primary-color)')

      ;({ page } = await app.relaunch())
      // the profile keeps the resolved theme color after restart
      await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      // switching the theme color has to repaint the profile, without touching the profile itself
      await goToSettingsSection(page, 'theme')
      const gallery = await openThemeGallery(page)

      // the labels are translated, so find the main color select and its 'Blue'
      // option through the values of the hidden native select instead
      const mainColorSelect = gallery.locator('.select')
        .filter({ has: page.locator('select option[value="Blue"]') })
        .first()
      const blueIndex = await mainColorSelect.locator('option[value="Blue"]').evaluate(option => option.index)
      await mainColorSelect.getByRole('combobox').click()
      await page.locator('.selectDropdown .selectOption').nth(blueIndex).click()
      await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(33, 150, 243)')
    })
  })

  test.describe('shorthand theme color profiles', () => {
    test.use({ seed: { settings: { baseTheme: 'hotPink' } } })

    test('preserves the theme color when cancelling picker changes', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()
      await page.locator('.themeColorOption').click()

      const preview = page.locator('.profilePreviewIcon')
      await expect(preview).toHaveCSS('background-color', 'rgb(0, 0, 0)')

      await page.locator('.profileColorPicker .colorFieldTrigger').click()
      const colorPicker = page.locator('.colorPickerPopover')
      await colorPicker.locator('input[type="text"]').fill('#123456')
      await colorPicker.locator('input[type="text"]').press('Enter')
      await page.getByRole('heading', { name: 'Profile Preview' }).click()
      await page.getByRole('button', { name: 'Update Profile' }).click()

      await expect.poll(async () => {
        const contents = readDatastore(app.userDataDir, 'profiles')
        const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('var(--primary-color)')
    })
  })

  test('applies opaque black to an image profile that was transparent', async ({ app, page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.card .profileList').getByText('All Channels').click()

    await page.locator('.imageInput').setInputFiles({
      name: 'globe.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>')
    })
    await page.getByRole('button', { name: 'Apply Crop' }).click()

    await page.locator('.profileColorPicker .colorFieldTrigger').click()
    const colorPicker = page.locator('.colorPickerPopover')
    await colorPicker.locator('input[type="text"]').fill('#000000')
    await colorPicker.locator('input[type="text"]').press('Enter')
    await colorPicker.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.profilePreviewIcon')).toHaveCSS('background-color', 'rgb(0, 0, 0)')

    await page.getByRole('button', { name: 'Update Profile' }).click()
    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'profiles')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.findLast(record => record._id === 'allChannels' && !record.$$deleted)?.bgColor
    }).toBe('#000000')
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
    const zoom = page.locator('.cropZoom').getByRole('slider')
    const zoomLabel = page.locator('.cropZoom .label')
    await zoomLabel.evaluate(element => Promise.all(
      element.closest('.promptCard').getAnimations().map(animation => animation.finished)
    ))
    for (const scale of [1, 0.95]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      await zoom.fill('1')
      const initialWidth = (await zoomLabel.boundingBox()).width
      for (const value of ['1.01', '2.5', '4', '1']) {
        await zoom.fill(value)
        await expect.poll(async () => (await zoomLabel.boundingBox()).width)
          .toBeCloseTo(initialWidth, 0)
        await expect(zoomLabel).toContainText(Number(value).toFixed(2))
      }
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await page.getByRole('button', { name: 'Apply Crop' }).click()

    const preview = page.locator('.profilePreviewIcon')
    await expect(preview.locator('img')).toBeVisible()
    await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await page.locator('.profileColorPicker .colorFieldTrigger').click()
    const colorPicker = page.locator('.colorPickerPopover')
    await colorPicker.locator('input[type="text"]').fill('#123456')
    await colorPicker.locator('input[type="text"]').press('Enter')
    await page.getByRole('heading', { name: 'Profile Preview' }).click()
    await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await page.getByRole('button', { name: 'Update Profile' }).click()

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'profiles')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
      return profile?.icon?.type === 'image' && profile.bgColor === 'transparent'
    }).toBe(true)

    const customEmoji = page.getByRole('textbox', { name: 'Custom Emoji', exact: true })
    expect((await customEmoji.boundingBox()).width).toBeLessThanOrEqual(64)
    await expect(page.locator('.customEmojiPlaceholder')).toBeVisible()
    await expect(page.locator('.customEmojiPlaceholder')).toHaveCSS('filter', 'grayscale(1)')
    await customEmoji.fill('A')
    await expect(customEmoji).toHaveValue('')
    await expect(preview.locator('img')).toBeVisible()

    await page.locator('.profileColorPicker .colorFieldTrigger').click()
    await colorPicker.locator('input[type="text"]').fill('#123456')
    await colorPicker.locator('input[type="text"]').press('Enter')
    await customEmoji.fill('❤')
    await expect(customEmoji).toHaveValue('❤')
    await expect(preview).toContainText('❤')
    await expect(preview).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await customEmoji.fill('🌍')
    await expect(page.locator('.customEmojiPlaceholder')).toHaveCount(0)
    await expect(preview.locator('img')).toHaveCount(0)
    await expect(preview).toContainText('🌍')
    await expect(preview).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.getByRole('button', { name: 'Update Profile' }).click()

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'profiles')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
      return profile?.icon?.value === '🌍' && profile.bgColor !== 'transparent'
    }).toBe(true)
  })
})
