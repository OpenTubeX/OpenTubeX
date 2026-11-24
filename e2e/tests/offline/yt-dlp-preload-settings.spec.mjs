import { test, expect, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'

async function openYtDlpStreamingSettings(page) {
  const section = await goToSettingsSection(page, 'advanced')
  const heading = section.getByRole('heading', { name: 'yt-dlp Streaming', exact: true })
  const ytDlpSection = heading.locator('xpath=../..')
  return {
    segmentSlider: ytDlpSection.getByRole('slider', { name: /Parallel Segment Loading/ }),
    countSlider: ytDlpSection.getByRole('slider', { name: /Upcoming Videos to Preload/ }),
    countValue: ytDlpSection.locator('label.pure-material-slider')
      .filter({ hasText: 'Upcoming Videos to Preload' })
      .locator('.valueText')
  }
}

test.describe('yt-dlp playback preloading', () => {
  test.use({
    seed: {
      settings: { videoPlaybackEngine: 'built-in' }
    }
  })

  test('turns preloading on with a count and persists it', async ({ app }) => {
    const { segmentSlider, countSlider, countValue } = await openYtDlpStreamingSettings(app.page)

    await expect(segmentSlider).toBeEnabled()
    await expect(countSlider).toHaveValue('0')
    await expect(countValue).toHaveText('Off')

    await countSlider.fill('3')
    await expect(countValue).toHaveText('3')

    await expect.poll(() => latestSettings(
      readDatastore(app.userDataDir, 'settings')
    ).ytDlpPreloadCount).toBe(3)

    const relaunched = await app.relaunch()
    const reloaded = await openYtDlpStreamingSettings(relaunched.page)
    await expect(reloaded.countSlider).toHaveValue('3')
  })
})
