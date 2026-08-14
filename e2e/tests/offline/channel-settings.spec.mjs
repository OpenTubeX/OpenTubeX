import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_NAME = 'Alpha Channel'

test.use({
  seed: {
    settings: {
      channelPlaybackSpeeds: JSON.stringify({
        [CHANNEL_ID]: 1.5
      }),
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
          { id: CHANNEL_ID, name: CHANNEL_NAME, thumbnail: '' }
        ]
      }
    ]
  }
})

test.describe('channel settings', () => {
  test('configures saved channel setting sync beside the manager and in its breadcrumb', async ({ page }) => {
    await goToSettingsSection(page, 'channel')

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
    await goToSettingsSection(page, 'channel')

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

  test('saved channels are not links when channel links are disabled', async ({ page }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateDisableChannelLinks', true)
    })

    await goToSettingsSection(page, 'channel')
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()

    const channel = page.locator('.settingsWindow .channelLink', { hasText: CHANNEL_NAME })
    await expect(channel).toBeVisible()
    await expect(channel).not.toHaveAttribute('href')
    await expect(channel).toHaveJSProperty('tagName', 'SPAN')
  })
})
