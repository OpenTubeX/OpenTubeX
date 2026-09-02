import {
  test,
  expect,
  goToSettingsSection,
  updateInputWithoutScrolling
} from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_NAME = 'Alpha Channel'
const NEW_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const NEW_CHANNEL_NAME = 'Beta Channel'
const OTHER_CHANNEL_ID = 'UCcccccccccccccccccccccc'
const OTHER_CHANNEL_NAME = 'Gamma Channel'
const EXTRA_SUBSCRIPTIONS = Array.from({ length: 30 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: `Extra Channel ${index + 1}`,
  thumbnail: ''
}))

test.use({
  seed: {
    settings: {
      channelPlaybackSpeeds: JSON.stringify({
        [CHANNEL_ID]: 1.5
      }),
      defaultPlayback: 1.25,
      defaultVolume: 0.4,
      rememberPlaybackSpeedPerChannel: true,
      rememberVolumePerChannel: true,
      syncServerSettingsExcluded: ['channelPlaybackSpeeds'],
      syncServerAutoSync: false,
      syncServerEnabled: true,
      syncServerPrivacyMode: 'enhanced',
      syncServerSyncSettings: true,
      syncServerToken: 'e2e-sync-token'
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: CHANNEL_ID, name: CHANNEL_NAME, thumbnail: '' },
          { id: NEW_CHANNEL_ID, name: NEW_CHANNEL_NAME, thumbnail: '' },
          { id: OTHER_CHANNEL_ID, name: OTHER_CHANNEL_NAME, thumbnail: '' },
          ...EXTRA_SUBSCRIPTIONS
        ]
      }
    ]
  }
})

test.describe('channel settings', () => {
  test('configures saved channel setting sync beside the manager and in its breadcrumb', async ({ page }) => {
    await goToSettingsSection(page, 'playback')

    const manageButton = page.getByRole('button', { name: 'Manage Saved Channels (1)' })
    const manageControls = manageButton.locator('..')
    const disableSync = manageControls.getByRole('button', {
      name: 'Stop syncing saved channel settings'
    })
    await expect(disableSync).toBeVisible()
    await expect(manageButton.getByRole('button')).toHaveCount(0)

    await manageButton.click()

    const breadcrumb = page.locator('.settingsWindow .settingsBreadcrumb')
    const breadcrumbSync = breadcrumb.getByRole('button', {
      name: 'Stop syncing saved channel settings'
    })
    await expect(breadcrumbSync).toBeVisible()
    await breadcrumbSync.click()

    const channelSettingKeys = [
      'channelPlaybackSpeeds',
      'channelVideoQualities',
      'channelSubtitlesStates',
      'channelVolumes'
    ]
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.state.settings.syncServerSettingsExcluded
    })).toEqual(expect.arrayContaining(channelSettingKeys))

    const enableSync = breadcrumb.getByRole('button', {
      name: 'Sync saved channel settings'
    })
    await enableSync.click()
    await expect.poll(() => page.evaluate(channelSettingKeys => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.state.settings.syncServerSettingsExcluded.filter(
        settingKey => channelSettingKeys.includes(settingKey)
      )
    }, channelSettingKeys)).toEqual([])
  })

  test('saved channels in the manager open their channel page', async ({ page }) => {
    await goToSettingsSection(page, 'playback')

    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()

    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow.locator('.settingsBreadcrumb')).toContainText('Saved Channel Settings')

    const channelLink = settingsWindow.getByRole('link', { name: CHANNEL_NAME })
    await expect(channelLink).toHaveAttribute('href', `#/channel/${CHANNEL_ID}`)

    await channelLink.click()

    await expect(page).toHaveURL(new RegExp(`#/channel/${CHANNEL_ID}`))
    await expect(settingsWindow).toBeVisible()
    await expect(settingsWindow.locator('.settingsBreadcrumb')).toContainText('Saved Channel Settings')
  })

  test('adds subscriptions without saved channel settings', async ({ attachScreenshot, page }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()

    const settingsWindow = page.locator('.settingsWindow')
    const addChannel = settingsWindow.getByRole('button', { name: 'Add subscribed channel' })
    await addChannel.click()

    const picker = page.getByRole('dialog', { name: 'Add subscribed channel' })
    const search = picker.getByPlaceholder('Search channels')
    await expect(search).toBeVisible()
    await expect(search).toBeFocused()
    await expect(search).toHaveAttribute('type', 'search')
    await expect(picker.getByRole('button', { name: 'Clear Input' })).toHaveCount(0)
    const scroller = picker.locator('.promptContentScroller')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await updateInputWithoutScrolling(search, NEW_CHANNEL_NAME)
    await expect(picker.getByRole('button', { name: CHANNEL_NAME, exact: true })).toHaveCount(0)
    await expect(picker.getByRole('button', { name: NEW_CHANNEL_NAME, exact: true })).toBeVisible()
    await expect(picker.getByRole('button', { name: OTHER_CHANNEL_NAME, exact: true })).toHaveCount(0)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    await attachScreenshot('add subscription to saved channel settings')

    await picker.getByRole('button', { name: NEW_CHANNEL_NAME, exact: true }).click()
    const newChannel = settingsWindow.locator('.channelEntry', { hasText: NEW_CHANNEL_NAME })
    await expect(newChannel).toBeVisible()
    await expect(newChannel.locator('.channelPreference')).toHaveCount(2)

    await expect.poll(() => page.evaluate(channelId => {
      const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings
      return {
        playbackSpeed: JSON.parse(settings.channelPlaybackSpeeds)[channelId],
        volume: JSON.parse(settings.channelVolumes)[channelId]
      }
    }, NEW_CHANNEL_ID)).toEqual({ playbackSpeed: 1.25, volume: 0.4 })

    await addChannel.click()
    const reopenedPicker = page.getByRole('dialog', { name: 'Add subscribed channel' })
    await expect(reopenedPicker.getByRole('button', { name: NEW_CHANNEL_NAME, exact: true })).toHaveCount(0)
    await expect(reopenedPicker.getByRole('button', { name: OTHER_CHANNEL_NAME, exact: true })).toBeVisible()
  })

  test('keeps the subscribed-channel picker open when initialization fails', async ({ page }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()
    await page.getByRole('button', { name: 'Add subscribed channel' }).click()

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.updateChannelVolumes = store._actions.updateChannelVolumes[0]
      store._actions.updateChannelVolumes = [() => Promise.reject(new Error('write failed'))]
    })

    const picker = page.getByRole('dialog', { name: 'Add subscribed channel' })
    const channel = picker.getByRole('button', { name: NEW_CHANNEL_NAME, exact: true })
    await channel.click()

    await expect(picker).toBeVisible()
    await expect(page.locator('.toast', {
      hasText: 'Failed to save channel settings'
    })).toBeVisible()
    await expect(channel).toBeEnabled()
    await expect.poll(() => page.evaluate(channelId => {
      const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings
      return {
        playbackSpeed: JSON.parse(settings.channelPlaybackSpeeds)[channelId],
        volume: JSON.parse(settings.channelVolumes)[channelId]
      }
    }, NEW_CHANNEL_ID)).toEqual({ playbackSpeed: undefined, volume: undefined })

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store._actions.updateChannelVolumes = [window.updateChannelVolumes]
    })
    await channel.click()

    await expect(picker).toHaveCount(0)
  })

  test('preserves newer edits when initialization rolls back', async ({ page }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()
    await page.getByRole('button', { name: 'Add subscribed channel' }).click()

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store._actions.updateChannelVolumes = [() => new Promise((_resolve, reject) => {
        window.rejectChannelVolumeUpdate = reject
      })]
    })

    const picker = page.getByRole('dialog', { name: 'Add subscribed channel' })
    await picker.getByRole('button', { name: NEW_CHANNEL_NAME, exact: true }).click()
    await expect.poll(() => page.evaluate(() => (
      typeof window.rejectChannelVolumeUpdate === 'function'
    ))).toBe(true)
    await picker.getByRole('button', { name: 'Close' }).click()

    await page.evaluate(async ({ channelId, newChannelId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const playbackSpeeds = JSON.parse(store.state.settings.channelPlaybackSpeeds)
      playbackSpeeds[channelId] = 1.75
      playbackSpeeds[newChannelId] = 1.5
      await store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(playbackSpeeds))
      window.rejectChannelVolumeUpdate(new Error('write failed'))
    }, { channelId: CHANNEL_ID, newChannelId: NEW_CHANNEL_ID })

    await expect(page.locator('.toast', {
      hasText: 'Failed to save channel settings'
    })).toBeVisible()
    await expect.poll(() => page.evaluate(({ channelId, newChannelId }) => {
      const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings
      const playbackSpeeds = JSON.parse(settings.channelPlaybackSpeeds)
      return {
        existingChannel: playbackSpeeds[channelId],
        newChannel: playbackSpeeds[newChannelId]
      }
    }, { channelId: CHANNEL_ID, newChannelId: NEW_CHANNEL_ID })).toEqual({
      existingChannel: 1.75,
      newChannel: 1.5
    })
  })

  test('points to Playback settings when channel settings are disabled', async ({ page }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await Promise.all([
        store.dispatch('updateRememberPlaybackSpeedPerChannel', false),
        store.dispatch('updateRememberVideoQualityPerChannel', false),
        store.dispatch('updateRememberSubtitlesStatePerChannel', false),
        store.dispatch('updateRememberVolumePerChannel', false)
      ])
    })

    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()
    await page.getByRole('button', { name: 'Add subscribed channel' }).click()

    const picker = page.getByRole('dialog', { name: 'Add subscribed channel' })
    const message = picker.getByText(
      'Enable at least one channel setting in Playback settings before adding a channel'
    )
    await expect(message).toBeVisible()

    const [pickerBox, messageBox] = await Promise.all([
      picker.boundingBox(),
      message.boundingBox()
    ])
    expect(Math.abs(
      pickerBox.x + pickerBox.width / 2 - (messageBox.x + messageBox.width / 2)
    )).toBeLessThanOrEqual(1)
  })

  test('saved channels are not links when channel links are disabled', async ({ page }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateDisableChannelLinks', true)
    })

    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()

    const channel = page.locator('.settingsWindow .channelLink', { hasText: CHANNEL_NAME })
    await expect(channel).toBeVisible()
    await expect(channel).not.toHaveAttribute('href')
    await expect(channel).toHaveJSProperty('tagName', 'SPAN')
  })
})
