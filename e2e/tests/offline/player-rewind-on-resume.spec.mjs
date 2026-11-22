import { test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

// yt-dlp isn't installed in the test environment, so skip its extraction attempt.
test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} video
 */
async function pause(page, video) {
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('k')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  return video.evaluate(element => element.currentTime)
}

/**
 * Resumes playback and returns the earliest position it played from. Under
 * load, playback advances before events are handled, except while seeking.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} video
 * @param {() => Promise<unknown>} [play] Starts playback, pressing K by default
 */
async function resume(page, video, play = () => page.keyboard.press('k')) {
  await video.evaluate((element) => {
    element.resumeTimes = []
    const track = () => element.resumeTimes.push(element.currentTime)
    element.addEventListener('timeupdate', track)
    element.addEventListener('seeking', track)
  })
  await play()
  await expect.poll(() => video.evaluate(element => !element.paused && !element.seeking && element.resumeTimes.length >= 4)).toBe(true)
  return video.evaluate(element => Math.min(...element.resumeTimes))
}

/**
 * Opens a video, plays it from the given position and returns its locator.
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} page
 * @param {number} rewindOnResume
 * @param {number} [startTime]
 */
async function openPlayingVideo(app, page, rewindOnResume, startTime = 15) {
  await page.evaluate(seconds => window.$store.dispatch('updateRewindOnResume', seconds), rewindOnResume)
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate((element, time) => { element.currentTime = time }, startTime)
  await expect.poll(() => video.evaluate((element, time) => !element.paused && element.currentTime > time + 0.2, startTime)).toBe(true)
  return video
}

test('resuming after a pause rewinds by the configured seconds', async ({ app, page }) => {
  const video = await openPlayingVideo(app, page, 5)

  const pausedAt = await pause(page, video)
  const resumedAt = await resume(page, video)
  // Chromium can settle the paused position slightly after the pause event.
  expect(resumedAt).toBeGreaterThanOrEqual(pausedAt - 5)
  expect(resumedAt).toBeLessThan(pausedAt - 4.5)
})

test('the rewind stays out of the seek history', async ({ app, page }) => {
  await page.evaluate(() => window.$store.dispatch('updateEnableSeekHistory', true))
  // Seek history only records jumps of at least 15 seconds.
  const video = await openPlayingVideo(app, page, 20, 24)

  const pausedAt = await pause(page, video)
  expect(await resume(page, video)).toBeLessThan(pausedAt - 19.5)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
  const seekHistoryButton = player.locator('.shaka-overflow-menu .seek-history-button')
  await expect(seekHistoryButton).toHaveCount(1)
  await expect(seekHistoryButton).toBeHidden()
})

test('a seek while paused resumes from the chosen position', async ({ app, page }) => {
  const video = await openPlayingVideo(app, page, 5)

  await pause(page, video)
  await video.evaluate((element) => { element.currentTime = 20 })
  await expect.poll(() => video.evaluate(element => !element.seeking && element.currentTime)).toBe(20)
  expect(await resume(page, video)).toBeGreaterThanOrEqual(20)
})

test('only pauses of the minimum length rewind', async ({ app, page }) => {
  const video = await openPlayingVideo(app, page, 5)
  const setMinimumPause = seconds => page.evaluate(value => window.$store.dispatch('updateRewindOnResumeMinimumPause', value), seconds)

  await setMinimumPause(30)
  let pausedAt = await pause(page, video)
  expect(await resume(page, video)).toBeGreaterThanOrEqual(pausedAt)

  await setMinimumPause(1)
  pausedAt = await pause(page, video)
  // The minimum is wall-clock time, so the pause has to last that long.
  await page.waitForTimeout(1100)
  const resumedAt = await resume(page, video)
  expect(resumedAt).toBeGreaterThanOrEqual(pausedAt - 5)
  expect(resumedAt).toBeLessThan(pausedAt - 4.5)
})

test('a seek that starts playback resumes from the chosen position', async ({ app, page }) => {
  const video = await openPlayingVideo(app, page, 5)

  await pause(page, video)
  // Like a transcript segment, which seeks and plays in the same task.
  const watch = await page.evaluateHandle(findWatchComponent)
  const resumedAt = await resume(page, video, () => watch.evaluate((component) => {
    component.refs.player.setCurrentTime(20, true)
    component.proxy.$el.querySelector('video').play()
  }))
  expect(resumedAt).toBeGreaterThanOrEqual(20)
})

test('saving a screenshot through a file picker resumes without rewinding', async ({ app, page }) => {
  await page.evaluate(async () => {
    await window.$store.dispatch('updateEnableScreenshot', true)
    await window.$store.dispatch('updateScreenshotMode', 'prompt_folder')
    await window.$store.dispatch('updateScreenshotFormat', 'png')
  })
  const video = await openPlayingVideo(app, page, 5)
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) })
    })
    document.activeElement?.blur()
  })

  const startedAt = await video.evaluate(element => element.currentTime)
  const resumedAt = await resume(page, video, async () => {
    await page.keyboard.press('u')
    await expect(page.locator('.toast', { hasText: 'Saved screenshot' })).toBeVisible()
  })
  expect(resumedAt).toBeGreaterThanOrEqual(startedAt)
})

test('resuming does not rewind when the setting is 0', async ({ app, page }) => {
  const video = await openPlayingVideo(app, page, 0)

  const pausedAt = await pause(page, video)
  expect(await resume(page, video)).toBeGreaterThanOrEqual(pausedAt)
})
