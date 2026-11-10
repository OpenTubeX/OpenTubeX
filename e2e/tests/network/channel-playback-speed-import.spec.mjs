import { goToSettingsSection } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

// The official Blender channel.
const CHANNEL_ID = 'UCSMOQeBJ2RAnuFungnQOxLg'
const MISSING_HANDLE = '@opentubex-e2e-missing-handle'

test('resolves channel handles when importing playback speeds', async ({ page }) => {
  // YouTube answers unknown handles with a 404, which replays can't record.
  // Aborting the request instead would make the app retry it.
  await page.route('**/youtubei/v1/navigation/resolve_url?**', (route, request) => {
    if (!request.postData()?.includes(MISSING_HANDLE)) return route.fallback()
    return route.fulfill({ status: 404, json: { error: { code: 404, status: 'NOT_FOUND' } } })
  })
  const dataSection = await goToSettingsSection(page, 'data')
  // Newer versions of the userscript save every speed under the handle and the name
  const content = JSON.stringify({
    '@BlenderOfficial': 1.5,
    Blender: 1.5,
    [MISSING_HANDLE]: 2
  })
  await page.evaluate((content) => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{
        getFile: async () => new File([content], 'youtube-speed-by-channel.json', { type: 'application/json' })
      }]
    })
  }, content)

  await dataSection.getByRole('button', { name: 'Import channel playback speeds', exact: true }).click()

  await expect(page.locator('.toast', { hasText: 'Imported the playback speed of 1 channel' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.toast', { hasText: '1 channel could not be found' })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(window.$store.getters.getChannelPlaybackSpeeds))).toEqual({
    [CHANNEL_ID]: 1.5
  })
})
