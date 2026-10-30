import path from 'node:path'

import { test, expect, goTo, goToSettingsSection, repoRoot } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
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
    await window.$store.dispatch('updateBufferBeforePlaying', 4)
  })
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  // Progressive files ignore the rebuffering goal
  expect(await readPlayerBuffering(page)).toEqual({ bufferingGoal: 45, bufferBehind: 20, rebufferingGoal: 0.02 })

  // Streams use it, so keep a DASH manifest loading
  const manifestUrl = 'https://media.test/buffer-settings.mpd'
  let releaseManifest
  const manifestReady = new Promise(resolve => { releaseManifest = resolve })
  let manifestRequested
  const requested = new Promise(resolve => { manifestRequested = resolve })
  await page.route(manifestUrl, async route => {
    manifestRequested()
    await manifestReady
    await route.abort()
  })
  try {
    const watch = await page.evaluateHandle(findWatchComponent)
    await watch.evaluate((component, url) => {
      component.proxy.manifestMimeType = 'application/dash+xml'
      component.proxy.manifestSrc = url
      component.proxy.activeFormat = 'dash'
      component.proxy.playerLoadGeneration++
    }, manifestUrl)
    await requested
    await expect.poll(() => readPlayerBuffering(page)).toEqual({ bufferingGoal: 45, bufferBehind: 20, rebufferingGoal: 4 })

    await page.evaluate(() => window.$store.dispatch('updateBufferBeforePlaying', 5))
    await expect.poll(() => readPlayerBuffering(page)).toEqual({ bufferingGoal: 45, bufferBehind: 20, rebufferingGoal: 5 })
  } finally {
    releaseManifest()
  }
})

test.describe('downloaded files', () => {
  const mediaPath = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
  test.use({
    seed: {
      settings: { enableDownloads: true, bufferAhead: 600, bufferBehind: 300, bufferBeforePlaying: 3 },
      downloads: [{
        id: 1,
        videoId: 'offline0001',
        title: 'Offline download',
        status: 'completed',
        mode: 'video',
        destination: mediaPath,
        destinations: [mediaPath],
        files: [{ videoId: 'offline0001', path: mediaPath, extension: 'webm' }],
      }],
    },
  })

  // Long downloads only have about 2 seconds loaded ahead, so waiting for more stalled them for good (#2532)
  test('play without waiting for the rebuffering goal', async ({ page }) => {
    await goTo(page, 'downloads')
    await page.getByRole('button', { name: 'Play download', exact: true }).click()
    await expect(page.locator(`${activeTab} video`)).toHaveJSProperty('readyState', 4)

    expect(await readPlayerBuffering(page)).toEqual({ bufferingGoal: 600, bufferBehind: 300, rebufferingGoal: 0.02 })

    await page.evaluate(() => window.$store.dispatch('updateBufferBeforePlaying', 5))
    await expect.poll(() => page.evaluate(() => window.$store.getters.getBufferBeforePlaying)).toBe(5)
    expect(await readPlayerBuffering(page)).toEqual({ bufferingGoal: 600, bufferBehind: 300, rebufferingGoal: 0.02 })
  })
})
