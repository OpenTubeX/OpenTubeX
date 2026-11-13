import { test, expect, goTo } from '../../helpers/app.mjs'

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
          videoPlaybackEngine: 'built-in'
        }
      }
    })

    test('is offered and kept with automatic streams', async ({ page }) => {
      const defaultQuality = await openDefaultQualitySelect(page)

      await expect(defaultQuality).toHaveValue('auto')
      await expect(defaultQuality.locator('option[value="auto"]')).toHaveCount(1)
    })
  })

  test.describe('with SABR only built-in streams', () => {
    test.use({
      seed: {
        settings: {
          defaultQuality: 'auto',
          videoPlaybackEngine: 'built-in',
          builtInStreams: 'sabr'
        }
      }
    })

    test('is hidden and falls back to a fixed quality', async ({ page }) => {
      const defaultQuality = await openDefaultQualitySelect(page)

      // Which one depends on the screen size
      await expect(defaultQuality).toHaveValue(/^\d+$/)
      await expect(defaultQuality.locator('option[value="auto"]')).toHaveCount(0)
    })
  })
})
