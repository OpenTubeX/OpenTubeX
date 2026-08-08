import { test, expect, goTo } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_NAME = 'Alpha Channel'

test.use({
  seed: {
    settings: {
      channelPlaybackSpeeds: JSON.stringify({
        [CHANNEL_ID]: 1.5
      })
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
  test('saved channels in the manager open their channel page', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="channel"]').click()

    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()

    const dialog = page.getByRole('dialog', { name: 'Saved Channel Settings' })
    await expect(dialog).toBeVisible()

    const channelLink = dialog.getByRole('link', { name: CHANNEL_NAME })
    await expect(channelLink).toHaveAttribute('href', `#/channel/${CHANNEL_ID}`)

    await channelLink.click()

    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`#/channel/${CHANNEL_ID}`))
  })

  test('saved channels are not links when channel links are disabled', async ({ page }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateDisableChannelLinks', true)
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="channel"]').click()
    await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()

    const dialog = page.getByRole('dialog', { name: 'Saved Channel Settings' })
    const channel = dialog.locator('.channelLink', { hasText: CHANNEL_NAME })
    await expect(channel).toBeVisible()
    await expect(channel).not.toHaveAttribute('href')
    await expect(channel).toHaveJSProperty('tagName', 'SPAN')
  })
})
