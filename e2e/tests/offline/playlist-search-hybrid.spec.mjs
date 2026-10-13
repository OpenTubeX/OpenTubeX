import { test, expect } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'

test.use({
  // Blink's pointer bitmask combines coarse (2) and fine (4) input.
  launchArgs: ['--blink-settings=availablePointerTypes=6,primaryPointerType=4'],
  seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true }, playlists: [{ _id: 'layout-test', playlistName: 'Layout test', videos: [] }] }
})

test('preserves playlist search height with both touch and mouse input', async ({ app, page }) => {
  expect(await page.evaluate(() => ({ fine: matchMedia('(any-pointer: fine)').matches, coarse: matchMedia('(any-pointer: coarse)').matches }))).toEqual({ fine: true, coarse: true })
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const inheritedHeight = await page.locator('body').evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--form-control-height')))
  await page.locator('.videoOptions').getByRole('button', { name: /^Add to playlist$/i }).click()
  const field = page.locator('.playlistSearch input')
  await expect.poll(() => field.evaluate(input => input.getBoundingClientRect().height)).toBeCloseTo(inheritedHeight, 0)
})
