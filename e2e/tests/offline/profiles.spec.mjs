import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

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

test('creates All Channels with the default person icon', async ({ app, page }) => {
  await expect(profileIconInitial(page).locator('[data-icon="circle-user"] svg')).toBeVisible()
  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    return records.findLast(record => record._id === 'allChannels' && !record.$$deleted)?.icon
  }).toEqual({ type: 'icon', value: 'circle-user' })
})

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
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
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
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const profile = { ...store.getters.getActiveProfile }
      profile.icon = null
      store.commit('upsertProfileToList', profile)
    })
    await expect(personIcon).toBeVisible()
  })
})

for (const iconPack of ['material', 'remix']) {
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
      const records = (await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
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
      await page.locator('#profileEmoji').fill('🐶')
      await name.fill('Eve')
      await expect(preview).toHaveText('🐶')
      await page.locator('#profileEmoji').fill('')
      await expect(preview).toHaveText('E')
      await name.fill('')
      await expect(person).toBeVisible()
      await name.fill('Eve')
      await expect(preview).toHaveText('E')
      await page.locator('#profileEmoji').fill('🐶')
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
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        return contents.trim().split('\n').map(line => JSON.parse(line)).findLast(record => record.name === 'Helen' && !record.$$deleted)?.icon
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
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
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
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('removeProfileFromList', 'missing-profile')
    })

    await expect(page.locator('.profileList .profileOption')).toHaveCount(2)
    await expect(page.locator('.profileList .profileOption').filter({ hasText: 'Second profile' })).toBeVisible()
  })

  test('ignores channel updates for profiles removed in another window', async ({ page }) => {
    const profileIds = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const payload = {
        channel: { id: 'channel', name: 'Channel', thumbnail: '' },
        profileIds: ['missing-profile']
      }

      store.commit('addChannelToProfiles', payload)
      store.commit('removeChannelFromProfiles', {
        channelId: payload.channel.id,
        profileIds: payload.profileIds
      })

      return store.getters.getProfileList.map(profile => profile._id)
    })

    expect(profileIds).toEqual(['allChannels', 'e2eprofile'])
  })

  test('opens directly from the profile button context menu', async ({ page }) => {
    await profileIcon(page).click()
    await expect(page.locator('.profileSummaryText')).toContainText('You can also right-click the profile icon to switch profiles')
    await profileIcon(page).click()

    await profileIcon(page).click({ button: 'right' })

    await expect(page.locator('.profileList')).toBeVisible()

    await profileIcon(page).click({ button: 'right' })
    await page.locator('.topNav .logo').click()
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
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

test.describe('profile selector with a custom image', () => {
  test.use({
    seed: {
      profiles: [{
        ...mainProfile,
        icon: {
          type: 'image',
          value: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
        }
      }]
    }
  })

  test('keeps the profile button centered in the top navigation', async ({ page }) => {
    await expect(profileIconInitial(page).locator('img')).toBeVisible()

    const navigationBox = await page.locator('.topNav').boundingBox()
    const profileButtonBox = await profileIcon(page).boundingBox()

    expect(profileButtonBox.y + profileButtonBox.height / 2)
      .toBeCloseTo(navigationBox.y + navigationBox.height / 2, 0)
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

test.describe('profile channel thumbnails', () => {
  test.use({
    seed: {
      settings: { hideUnsubscribeButton: true, uiRoundness: 200 },
      profiles: [{
        ...mainProfile,
        subscriptions: [{
          id: 'UCaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Deleted Channel',
          thumbnail: 'data:image/png;base64,invalid'
        }]
      }]
    }
  })

  test('uses the default avatar when a channel thumbnail fails to load', async ({ page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.card .profileList').getByText('All Channels').click()

    const channel = page.locator('#subscriptionsPanel').getByRole('link', { name: 'Deleted Channel' })
    await expect(channel).toHaveCSS('border-radius', '16px')
    await expect(channel.locator('img.bubble')).toHaveCount(0)
    const fallbackAvatar = channel.locator('.bubble:not(img)')
    await expect(fallbackAvatar).toBeVisible()
    await expect(fallbackAvatar).toHaveCSS('font-size', '50px')
  })
})

for (const uiScale of [100, 125]) {
  test.describe(`profile manager presentation at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { uiScale, baseTheme: 'black', currentLocale: 'en-US' },
        profiles: [mainProfile, {
          ...secondProfile,
          subscriptions: [
            { id: 'channel-one', name: 'Channel one', thumbnail: '' },
            { id: 'channel-two', name: 'Channel two', thumbnail: '' }
          ]
        }]
      }
    })

    test('preserves profile name colors on hover and softly highlights the open profile', async ({ page, attachScreenshot }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      const profiles = page.locator('.profileSettingsContent > .card .profileList .bubblePadding')
      for (const theme of ['black', 'light']) {
        await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', theme), theme)
        for (const profile of await profiles.all()) {
          await page.locator('.settingsBreadcrumb').hover()
          const name = profile.locator('.profileName')
          const color = await name.evaluate(element => getComputedStyle(element).color)
          await profile.hover()
          await expect(name).toHaveCSS('color', color)
          await profile.click()
          await page.locator('.settingsBreadcrumb').hover()
          const openColor = await name.evaluate(element => getComputedStyle(element).color)
          await profile.hover()
          await expect(name).toHaveCSS('color', openColor)
          await page.locator('.settingsBreadcrumb').hover()
          await expect(name).toHaveCSS('color', color)
          await expect.poll(() => profile.evaluate(element => {
            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')
            context.fillStyle = getComputedStyle(element).backgroundColor
            context.fillRect(0, 0, 1, 1)
            return context.getImageData(0, 0, 1, 1).data[3] / 255
          })).toBeLessThan(0.4)
          await profile.hover()
          await expect(name).toHaveCSS('color', color)
        }
        await attachScreenshot(`Profile highlights in ${theme} theme at ${uiScale}% scale`)
      }
    })

    test('places the create option after existing profiles with its label below the icon', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      const list = page.locator('.profileSettingsContent .profileList')
      const createOption = list.getByRole('button', { name: 'Create New Profile', exact: true })
      await expect.poll(() => createOption.evaluate(element => {
        const previous = element.previousElementSibling.getBoundingClientRect()
        const option = element.getBoundingClientRect()
        const icon = element.querySelector('.createProfileIcon').getBoundingClientRect()
        const previousIcon = element.previousElementSibling.querySelector('.bubble').getBoundingClientRect()
        const label = element.querySelector('.createProfileLabel').getBoundingClientRect()
        return option.left >= previous.right - 1 && Math.abs(option.top - previous.top) < 1 &&
          Math.abs(icon.top - previousIcon.top) < 1 && label.top >= icon.bottom
      })).toBe(true)
      await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)
      for (const narrow of [false, true]) {
        if (narrow) {
          await app.electronApp.evaluate(({ BrowserWindow }, width) => {
            const window = BrowserWindow.getAllWindows()[0]
            window.setBounds({ ...window.getBounds(), width })
          }, Math.round(390 * uiScale / 100))
          await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390)
        }
        await expect.poll(() => createOption.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const list = element.parentElement.getBoundingClientRect()
          return bounds.left >= list.left - 1 && bounds.right <= list.right + 1
        })).toBe(true)
        const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
        await testInfo.attach(`Create profile option at ${narrow ? 'narrow' : 'desktop'} ${uiScale}% scale`, {
          body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
        })
      }
      await createOption.click()
      await expect(page.getByRole('heading', { name: 'Create New Profile', exact: true })).toBeVisible()
    })

    test('groups profile tiles with sensible gaps and leaves the create icon unfilled', async ({ page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      const list = page.locator('.profileSettingsContent .profileList')
      await expect.soft.poll(() => list.evaluate(element => {
        const tiles = [...element.children].map(tile => tile.getBoundingClientRect())
        return tiles.slice(1).every((tile, index) => {
          const gap = tile.left - tiles[index].right
          return gap >= 12 && gap <= 24
        })
      }), { timeout: 2000 }).toBe(true)
      await expect(list.locator('.createProfileIcon')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)', { timeout: 2000 })
    })

    test('keeps custom profile controls and preview side by side when space permits', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
      await page.locator('.builtinIconOptions').getByRole('button', { name: 'Gaming', exact: true }).click()
      await app.electronApp.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), width })
      }, Math.round(940 * uiScale / 100))
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(940)
      await expect.poll(() => page.locator('.secondEditRow').evaluate(element => {
        const [controls, preview] = [...element.children].map(child => child.getBoundingClientRect())
        return Math.abs(controls.top - preview.top) < 1 && preview.left - controls.right >= 16
      }), { timeout: 2000 }).toBe(true)
      await page.locator('.secondEditRow > div').last().evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await expect.poll(() => page.locator('.secondEditRow > div').last().evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const viewport = element.closest('.settingsSubpageScroll').getBoundingClientRect()
        return bounds.top >= viewport.top - 1 && bounds.bottom <= viewport.bottom + 1
      })).toBe(true)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      await testInfo.attach(`Custom profile columns at ${uiScale}% scale`, {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
      })
    })

    test('spaces wrapped profile buttons and stacked editor sections on narrow layouts', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
      await app.electronApp.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), width })
      }, Math.round(350 * uiScale / 100))
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(350)
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
      await app.electronApp.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), width })
      }, Math.round(940 * uiScale / 100))
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(940)
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

    test('keeps the subscriptions heading close to the last customization controls after resizing', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
      await page.locator('.builtinIconOptions').getByRole('button', { name: 'Gaming', exact: true }).click()
      for (const width of [1200, 940, 350]) {
        await app.electronApp.evaluate(({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setBounds({ ...window.getBounds(), width })
        }, Math.round(width * uiScale / 100))
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
        await expect.soft.poll(() => page.locator('.profileSubscriptionsHeading').evaluate(element => {
          const controls = [...document.querySelectorAll('.iconActions button, .profileActions button')]
          const controlsEnd = Math.max(...controls.map(control => control.getBoundingClientRect().bottom))
          return element.getBoundingClientRect().top - controlsEnd
        }), { timeout: 2000, message: `heading follows the final customization control at ${width}px` }).toBeLessThanOrEqual(40)
        await page.locator('.profileSubscriptionsHeading').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
        await testInfo.attach(`Compact editor ending at ${width}px and ${uiScale}% scale`, {
          body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
        })
      }
    })

    test('balances profile filter spacing when subscriptions are present', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
      for (const width of [1200, 350]) {
        await app.electronApp.evaluate(({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setBounds({ ...window.getBounds(), width })
        }, Math.round(width * uiScale / 100))
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
        await expect.soft.poll(() => page.locator('.profileSettingsContent .select').evaluate(element => {
          const channels = document.querySelector('.selectionActions').nextElementSibling.getBoundingClientRect()
          const label = element.querySelector('.select-label').getBoundingClientRect()
          const count = element.parentElement.nextElementSibling.getBoundingClientRect()
          return Math.abs(label.top - channels.bottom - (count.top - element.getBoundingClientRect().bottom))
        }), { timeout: 2000 }).toBeLessThanOrEqual(1)
      }
    })

    test('balances the space above and below the profile filter after emptying subscriptions', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
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
        await app.electronApp.evaluate(({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setBounds({ ...window.getBounds(), width })
        }, Math.round(width * uiScale / 100))
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
        await expect.soft.poll(() => page.locator('.profileSettingsContent .select').evaluate(element => {
          const before = document.querySelector('.selectionActions').getBoundingClientRect()
          const label = element.querySelector('.select-label').getBoundingClientRect()
          const count = element.parentElement.nextElementSibling.getBoundingClientRect()
          const above = label.top - before.bottom
          const below = count.top - element.getBoundingClientRect().bottom
          return Math.abs(above - below)
        }), { timeout: 2000, message: `profile filter has balanced spacing at ${width}px` }).toBeLessThanOrEqual(1)
        await page.locator('.profileSettingsContent .select').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
        await testInfo.attach(`Balanced profile filter at ${width}px and ${uiScale}% scale`, {
          body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
        })
      }
    })

    test('places customization and selection actions before subscriptions and keeps selection working', async ({ app, page }, testInfo) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
      const customizer = page.locator('.profileSettingsContent .profileEdit')
      const subscriptionsHeading = page.getByRole('heading', { name: 'Manage profile subscriptions', exact: true })
      const selectAll = page.getByRole('button', { name: 'Select All', exact: true }).first()
      const subscription = page.locator('.profileSettingsContent').getByText('Channel one', { exact: true })
      expect(await customizer.evaluate((element, selector) => Boolean(element.compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING), '.profileSettingsContent .selectedCount')).toBe(true)
      expect((await selectAll.boundingBox()).y).toBeGreaterThan((await customizer.boundingBox()).y)
      expect((await subscription.boundingBox()).y).toBeGreaterThan((await selectAll.boundingBox()).y)
      await expect(subscriptionsHeading).toBeVisible()
      await expect.poll(() => subscriptionsHeading.evaluate(element => {
        const customizer = element.previousElementSibling.querySelector('.card')
        return element.getBoundingClientRect().top - customizer.getBoundingClientRect().bottom
      })).toBeCloseTo(15, 0)
      await expect.poll(() => page.locator('.profileActions').evaluate(element =>
        element.querySelector('button').getBoundingClientRect().top - element.previousElementSibling.getBoundingClientRect().bottom
      ), { timeout: 2000 }).toBeCloseTo(21, 0)
      await expect.poll(() => page.locator('.secondEditRow').evaluate(element =>
        element.getBoundingClientRect().top - element.previousElementSibling.getBoundingClientRect().bottom
      )).toBeGreaterThanOrEqual(19)
      await expect.poll(() => page.locator('.selectionActions').evaluate(element => (
        element.nextElementSibling.getBoundingClientRect().top - element.getBoundingClientRect().bottom
      ))).toBeCloseTo(16, 0)
      await expect.poll(() => page.locator('.selectionActions').evaluate(element => {
        const buttons = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect())
        const count = element.previousElementSibling.getBoundingClientRect()
        const center = (buttons[0].left + buttons.at(-1).right) / 2
        return Math.abs(center - (count.left + count.right) / 2) < 1 &&
          buttons.slice(1).every((button, index) => button.left - buttons[index].right <= 20)
      }), { timeout: 2000, message: 'selection buttons form a compact group centered below the count' }).toBe(true)
      await selectAll.click()
      await expect(page.locator('.selectedCount')).toHaveText('2 selected')
      await page.getByRole('button', { name: 'Select None', exact: true }).first().click()
      await expect(page.locator('.selectedCount')).toHaveText('0 selected')
      await selectAll.click()
      await expect(selectAll).toHaveCSS('opacity', '0.4')
      await expect(page.locator('.selectionActions').getByRole('button', { name: 'Select None', exact: true })).toHaveCSS('opacity', '1')
      await subscription.scrollIntoViewIfNeeded()
      const desktopScreenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      await testInfo.attach(`Profile customization before subscriptions at ${uiScale}% scale`, {
        body: Buffer.from(desktopScreenshot, 'base64'), contentType: 'image/png'
      })
      await app.electronApp.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), width })
      }, Math.round(390 * uiScale / 100))
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390)
      await expect.poll(() => page.locator('.selectionActions').evaluate(element => {
        const count = element.previousElementSibling.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        const rows = []
        for (const button of element.querySelectorAll('button')) {
          const rect = button.getBoundingClientRect()
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) return false
          const row = rows.find(row => Math.abs(row.top - rect.top) < 1)
          if (row) row.right = rect.right
          else rows.push({ top: rect.top, left: rect.left, right: rect.right })
        }
        return rows.every(row => Math.abs((row.left + row.right - count.left - count.right) / 2) < 1)
      })).toBe(true)
      await page.locator('.selectionActions').scrollIntoViewIfNeeded()
      const narrowScreenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      await testInfo.attach(`Centered selection actions at narrow ${uiScale}% scale`, {
        body: Buffer.from(narrowScreenshot, 'base64'), contentType: 'image/png'
      })
      await page.getByRole('button', { name: 'Delete Selected', exact: true }).click()
      await page.getByRole('button', { name: 'Yes, Delete', exact: true }).click()
      await expect(subscription).toHaveCount(0)
      await expect(page.locator('.selectedCount')).toHaveText('0 selected')
    })

    test('disables subscription selection actions when they do not apply', async ({ page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.profileSettingsContent .profileList').getByText('All Channels').click()
      const actions = page.locator('.selectionActions')
      const selectAll = actions.getByRole('button', { name: 'Select All', exact: true })
      const selectNone = actions.getByRole('button', { name: 'Select None', exact: true })
      const deleteSelected = actions.getByRole('button', { name: 'Delete Selected', exact: true })
      await expect(selectAll).toBeDisabled()
      await expect(selectNone).toBeDisabled()
      await expect(deleteSelected).toBeDisabled()

      await page.locator('.profileSettingsContent .profileList').getByText('Second profile').click()
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
}

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

    test('resolves the current theme color after the system theme changes', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateSystemDarkTheme', 'hotPink'))
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateSystemDarkTheme', 'dark'))
      await page.locator('.themeColorOption').click()
      await expect(page.locator('.profilePreviewIcon')).toHaveCSS('background-color', 'rgb(76, 175, 80)')
      await expect(page.locator('.profileColorPicker code')).toHaveText('#4caf50', { timeout: 2000 })
      await expect(page.locator('.profileColorPicker .swatchColor')).toHaveCSS('background-color', 'rgb(76, 175, 80)')

      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateSystemDarkTheme', 'hotPink'))
      await expect(page.locator('.profileColorPicker code')).toHaveText('#000')
      await expect(page.locator('.profileColorPicker .swatchColor')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await page.emulateMedia({ colorScheme: 'light' })
      await expect(page.locator('.profileColorPicker code')).toHaveText('#4caf50')
    })

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
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
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
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('updateMainColor', 'Orange')
      })
      await expect(preview).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      await expect(page.locator('.profileColorPicker code')).toHaveText('#ff9800')
      await expect(page.locator('.profileColorPicker .swatchColor')).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      await page.getByRole('heading', { name: 'Profile Preview' }).click()
      await expect(preview).toHaveCSS('background-color', 'rgb(255, 152, 0)')

      await page.getByRole('button', { name: 'Update Profile' }).click()

      await expect.poll(async () => {
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('var(--primary-color)')

      ;({ page } = await app.relaunch())
      // the profile keeps the resolved theme color after restart
      await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      // switching the theme color has to repaint the profile, without touching the profile itself
      await goToSettingsSection(page, 'theme')

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
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
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
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
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
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
      return profile?.icon?.type === 'image' && profile.bgColor === 'transparent'
    }).toBe(true)

    const customEmoji = page.locator('#profileEmoji')
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
