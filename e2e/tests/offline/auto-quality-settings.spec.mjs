import { test, expect, goTo } from '../../helpers/app.mjs'

async function openDefaultQualitySelect(page) {
  await goTo(page, 'settings')
  await page.locator('.settingsMenu [data-section="player"]').click()

  return page.locator('[data-section="player"] .select')
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
})
