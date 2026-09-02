import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'

async function openPreloadSettings(page) {
  const section = await goToSettingsSection(page, 'playback')
  return {
    toggle: section.getByRole('checkbox', { name: 'Preload Upcoming Videos' }),
    toggleLabel: section.locator('label.switch-label').filter({ hasText: 'Preload Upcoming Videos' }),
    slider: section.getByRole('slider', { name: /Upcoming Videos to Preload/ })
  }
}

test.describe('yt-dlp playback preloading', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'yt-dlp',
        ytDlpPlaybackEngineDefaultMigration: true
      }
    }
  })

  test('persists the switch and number of upcoming videos', async ({ app }) => {
    const { toggle, toggleLabel, slider } = await openPreloadSettings(app.page)

    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled()
    await expect(slider).toBeDisabled()
    await expect(slider).toHaveValue('2')
    await expect(slider).toHaveAttribute('min', '1')
    await expect(slider).toHaveAttribute('max', '10')

    await toggleLabel.click()
    await expect(toggle).toBeChecked()
    await expect(slider).toBeEnabled()
    await slider.fill('4')

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return {
        enabled: settings.ytDlpPreloadEnabled,
        count: settings.ytDlpPreloadCount
      }
    }).toEqual({ enabled: true, count: 4 })

    const relaunched = await app.relaunch()
    const reloaded = await openPreloadSettings(relaunched.page)
    await expect(reloaded.toggle).toBeChecked()
    await expect(reloaded.slider).toHaveValue('4')
  })
})
