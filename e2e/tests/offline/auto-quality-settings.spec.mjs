import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_NAME = 'Alpha Channel'

async function openDefaultQualitySelect(page) {
  await goTo(page, 'settings')
  await page.locator('.settingsMenu [data-section="playback"]').click()

  return page.locator('[data-section="playback"] .select')
    .filter({ hasText: 'Default Quality' })
    .locator('select')
}

test.describe('auto quality setting', () => {
  test.describe('with yt-dlp', () => {
    test.use({ seed: { settings: { defaultQuality: 'auto', videoPlaybackEngine: 'yt-dlp' } } })

    test('is offered and kept', async ({ page }) => {
      const defaultQuality = await openDefaultQualitySelect(page)

      await expect(defaultQuality).toHaveValue('auto')
      await expect(defaultQuality.locator('option[value="auto"]')).toHaveCount(1)
    })
  })

  test.describe('with the built-in engine', () => {
    test.use({
      seed: {
        settings: {
          defaultQuality: 'auto',
          videoPlaybackEngine: 'built-in',
          // the built-in engine is migrated away from on startup otherwise
          ytDlpPlaybackEngineDefaultMigration: true
        }
      }
    })

    test('is hidden and falls back to 720p', async ({ page }) => {
      const defaultQuality = await openDefaultQualitySelect(page)

      await expect(defaultQuality).toHaveValue('720')
      await expect(defaultQuality.locator('option[value="auto"]')).toHaveCount(0)
    })
  })

  test.describe('a stored channel quality of auto', () => {
    test.use({
      seed: {
        settings: {
          // a global default other than the fallback, so displaying the wrong
          // one of the two is visible here
          defaultQuality: '1080',
          channelVideoQualities: JSON.stringify({ [CHANNEL_ID]: 'auto' }),
          videoPlaybackEngine: 'built-in',
          // the built-in engine is migrated away from on startup otherwise
          ytDlpPlaybackEngineDefaultMigration: true
        },
        profiles: [
          {
            _id: 'allChannels',
            name: 'All Channels',
            bgColor: '#000000',
            textColor: '#FFFFFF',
            subscriptions: [{ id: CHANNEL_ID, name: CHANNEL_NAME, thumbnail: '' }]
          }
        ]
      }
    })

    test('is displayed as the quality playback falls back to', async ({ page }) => {
      await goToSettingsSection(page, 'playback')
      await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()

      const quality = page.locator('.settingsWindow .channelPreference select')
      await expect(quality).toHaveValue('720')
    })
  })
})
