import { test, expect, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'

async function openYtDlpStreamingSettings(page) {
  const section = await goToSettingsSection(page, 'advanced')
  const heading = section.getByRole('heading', { name: 'yt-dlp Streaming', exact: true })
  const ytDlpSection = heading.locator('xpath=../..')
  return {
    segmentSlider: ytDlpSection.getByRole('slider', { name: /Parallel Segment Loading/ }),
    countSlider: ytDlpSection.getByRole('slider', { name: /Upcoming Videos to Preload/ }),
    concurrencySlider: ytDlpSection.getByRole('slider', { name: /Concurrent Preloads/ })
  }
}

test.describe('yt-dlp playback preloading', () => {
  test.use({
    seed: {
      settings: { videoPlaybackEngine: 'built-in' }
    }
  })

  test('turns preloading on with a count and persists it and the concurrency', async ({ app }) => {
    const { segmentSlider, countSlider, concurrencySlider } = await openYtDlpStreamingSettings(app.page)

    await expect(segmentSlider).toBeEnabled()
    // Playlist preloads use the concurrency even while upcoming videos are not preloaded.
    await expect(countSlider).toHaveValue('0')
    await expect(concurrencySlider).toBeEnabled()
    await concurrencySlider.fill('32')
    await countSlider.fill('3')

    await expect.poll(() => {
      const settings = latestSettings(readDatastore(app.userDataDir, 'settings'))
      return { count: settings.ytDlpPreloadCount, concurrency: settings.ytDlpPreloadConcurrency }
    }).toEqual({ count: 3, concurrency: 32 })

    const relaunched = await app.relaunch()
    const reloaded = await openYtDlpStreamingSettings(relaunched.page)
    await expect(reloaded.countSlider).toHaveValue('3')
    await expect(reloaded.concurrencySlider).toHaveValue('32')
  })
})
