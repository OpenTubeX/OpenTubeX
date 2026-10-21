import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test('codec preference defaults to auto and persists independently of quality', { tag: '@scale' }, async ({ page, attachScreenshot }) => {
  await goToSettingsSection(page, 'advanced')
  const select = page.locator('.select').filter({ hasText: 'Preferred video codec' }).locator('select')
  await expect(select).toHaveValue('auto')
  await expect(select.locator('option')).toHaveText(['Auto', 'AV1', 'VP9', 'H.264'])
  const quality = await page.evaluate(() => window.$store.getters.getDefaultQuality)
  await select.selectOption('vp9')
  await expect.poll(() => page.evaluate(() => window.$store.getters.getPreferredVideoCodec)).toBe('vp9')
  await page.reload()
  await goToSettingsSection(page, 'advanced')
  await expect(select).toHaveValue('vp9')
  expect(await page.evaluate(() => window.$store.getters.getDefaultQuality)).toBe(quality)
  await expect(page.getByText('Auto prefers hardware decoding.', { exact: false })).toBeVisible()
  await select.scrollIntoViewIfNeeded()
  await expect(select).toBeInViewport()
  await page.locator('.settingsWindow').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  await attachScreenshot('experimental-codec-preference')
})

for (const preference of ['auto', 'vp9']) {
  test(`player keeps automatic HDR selection with ${preference}`, async ({ app, page }) => {
    await page.evaluate(async value => {
      await window.$store.dispatch('updateVideoPlaybackEngine', 'built-in')
      await window.$store.dispatch('updatePreferredVideoCodec', value)
    }, preference)
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const preferences = await page.locator(`${activeTab} .ftVideoPlayer`).evaluate(element => {
      const overlay = element.ui ?? element.querySelector('video')?.ui
      return overlay.getControls().getPlayer().getConfiguration().preferredVideo
    })
    expect(preferences.map(entry => entry.codec)).toEqual(preference === 'auto' ? [''] : ['vp09', 'vp9', ''])
    expect(preferences.every(entry => entry.hdrLevel === 'AUTO')).toBe(true)
  })
}
