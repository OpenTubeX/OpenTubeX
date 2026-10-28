import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

/**
 * @param {import('@playwright/test').Page} page
 */
async function openBufferSettings(page) {
  await goToSettingsSection(page, 'advanced')
  const section = page.locator('.settingsSection').filter({
    has: page.getByRole('heading', { name: 'Buffering', exact: true })
  })

  return {
    section,
    preset: section.locator('.select').filter({ hasText: 'Buffering Preset' }).locator('select'),
    bufferAhead: section.getByRole('slider', { name: /Buffer Ahead/ }),
    bufferBehind: section.getByRole('slider', { name: /Rewind Buffer/ }),
    bufferBeforePlaying: section.getByRole('slider', { name: /Buffer Before Playing/ }),
  }
}

/**
 * @param {import('@playwright/test').Page} page
 */
function readBufferSettings(page) {
  return page.evaluate(() => ({
    bufferAhead: window.$store.getters.getBufferAhead,
    bufferBehind: window.$store.getters.getBufferBehind,
    bufferBeforePlaying: window.$store.getters.getBufferBeforePlaying,
  }))
}

/**
 * @param {import('@playwright/test').Page} page
 */
function readPlayerBuffering(page) {
  return page.locator(`${activeTab} .ftVideoPlayer`).evaluate(element => {
    const overlay = element.ui ?? element.querySelector('video')?.ui
    const { bufferingGoal, bufferBehind, rebufferingGoal } = overlay.getControls().getPlayer().getConfiguration().streaming
    return { bufferingGoal, bufferBehind, rebufferingGoal }
  })
}

test('presets and sliders set the buffer sizes', async ({ page, attachScreenshot }) => {
  const { section, preset, bufferAhead, bufferBehind, bufferBeforePlaying } = await openBufferSettings(page)

  await expect(section).toContainText('Choose how much video the player loads in advance and keeps loaded.')
  await expect(preset).toHaveValue('default')
  // Custom only shows up once the values stop matching a preset
  await expect(preset.locator('option')).toHaveText(['Data Saver', 'Default', 'Smooth Playback'])
  await expect(bufferAhead).toHaveValue('180')
  await expect(bufferBehind).toHaveValue('300')
  await expect(bufferBeforePlaying).toHaveValue('0')
  await expect(section.locator('.pure-material-slider').filter({ hasText: 'Buffer Ahead' })).toContainText('Buffer Ahead: 180s')

  await preset.selectOption('smooth')
  await expect.poll(() => readBufferSettings(page)).toEqual({ bufferAhead: 600, bufferBehind: 300, bufferBeforePlaying: 3 })
  await expect(bufferAhead).toHaveValue('600')
  await expect(bufferBeforePlaying).toHaveValue('3')

  await bufferAhead.fill('60')
  await expect.poll(() => readBufferSettings(page)).toEqual({ bufferAhead: 60, bufferBehind: 300, bufferBeforePlaying: 3 })
  await expect(preset).toHaveValue('custom')
  await expect(preset.locator('option')).toHaveText(['Data Saver', 'Default', 'Smooth Playback', 'Custom'])

  await page.reload()
  const reloaded = await openBufferSettings(page)
  await expect(reloaded.preset).toHaveValue('custom')
  await expect(reloaded.bufferAhead).toHaveValue('60')

  await reloaded.section.scrollIntoViewIfNeeded()
  await page.locator('.settingsWindow').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  await attachScreenshot('buffer-settings')

  // Resetting the preset restores every buffer size
  await reloaded.section.locator('.select').filter({ hasText: 'Buffering Preset' })
    .getByRole('button', { name: 'Reset this setting to its default' }).click()
  await expect.poll(() => readBufferSettings(page)).toEqual({ bufferAhead: 180, bufferBehind: 300, bufferBeforePlaying: 0 })
  await expect(reloaded.preset).toHaveValue('default')
})

test('the player uses the buffer settings and follows changes', async ({ app, page }) => {
  await page.evaluate(async () => {
    await window.$store.dispatch('updateVideoPlaybackEngine', 'built-in')
    await window.$store.dispatch('updateBufferAhead', 45)
    await window.$store.dispatch('updateBufferBehind', 20)
  })
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  expect(await readPlayerBuffering(page)).toEqual({ bufferingGoal: 45, bufferBehind: 20, rebufferingGoal: 0.02 })

  await page.evaluate(() => window.$store.dispatch('updateBufferBeforePlaying', 4))
  await expect.poll(() => readPlayerBuffering(page)).toEqual({ bufferingGoal: 45, bufferBehind: 20, rebufferingGoal: 4 })
})
