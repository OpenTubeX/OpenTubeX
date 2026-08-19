import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'

async function openPlayerSettings(page) {
  await goToSettingsSection(page, 'playback')

  return page.getByRole('slider', { name: /Parallel Segment Loading/ })
}

test.describe('parallel segment loading slider', () => {
  test('persists the configured limit', async ({ app }) => {
    const slider = await openPlayerSettings(app.page)

    // shaka-player's default, so playback is sequential until the user opts in
    await expect(slider).toHaveValue('1')
    await expect(slider).toHaveAttribute('min', '1')
    await expect(slider).toHaveAttribute('max', '10')

    await slider.fill('4')
    await expect(slider).toHaveValue('4')

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.segmentPrefetchLimit
    }).toBe(4)

    const relaunched = await app.relaunch()
    await expect(await openPlayerSettings(relaunched.page)).toHaveValue('4')
  })
})
