import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'
import { activeTab, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// A continuously running public livestream with DVR enabled.
const LIVE_VIDEO_ID = 'B4-L2nfGcuE'
const LIVE_VIDEO_URL = `https://www.youtube.com/watch?v=${LIVE_VIDEO_ID}`
const STORK_VIDEO_ID = '2eNqPqzD4Dw'

test('live SABR playback starts and can seek backward', async ({ page, innertube }) => {
  test.skip(!innertube.playback, 'needs a real live media stream')

  await page.locator(sel.searchInput).fill(LIVE_VIDEO_URL)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#/watch/${LIVE_VIDEO_ID}`))

  const video = await waitForPlaybackOrSkip(test, page)
  await expect(video).toHaveJSProperty('paused', false)
  await expect(page.locator(`${activeTab} .shaka-seek-bar-container`)).toBeVisible()

  const liveTime = await video.evaluate((element) => element.currentTime)
  const seekStart = await video.evaluate((element) => element.seekable.start(0))
  const rewindTarget = Math.max(seekStart + 5, liveTime - 30)

  await video.evaluate(async (element, target) => {
    element.currentTime = target
    await element.play()
  }, rewindTarget)

  await expect.poll(async () => await video.evaluate((element) => element.currentTime), {
    timeout: 30_000,
    message: 'waiting for playback to resume from the rewound position'
  }).toBeGreaterThan(rewindTarget + 1)

  const resumedTime = await video.evaluate((element) => element.currentTime)
  expect(resumedTime).toBeLessThan(liveTime - 10)
  await expect(video).toHaveJSProperty('paused', false)
  await expect(video).toHaveJSProperty('readyState', 4)
})

test('live SABR playback survives repeated DVR rewinds', async ({ page, innertube }) => {
  test.skip(!innertube.playback, 'needs a real live media stream')

  await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${STORK_VIDEO_ID}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#/watch/${STORK_VIDEO_ID}`))

  const video = await waitForPlaybackOrSkip(test, page)
  const initialSource = await video.evaluate((element) => element.currentSrc)

  for (const rewindSeconds of [600, 120]) {
    const beforeSeek = await video.evaluate((element) => element.currentTime)
    const seekStart = await video.evaluate((element) => element.seekable.start(0))
    const target = Math.max(seekStart + 5, beforeSeek - rewindSeconds)

    await video.evaluate((element, seekTarget) => {
      element.currentTime = seekTarget
      void element.play().catch(() => {})
    }, target)

    await expect.poll(async () => await video.evaluate((element) => element.currentTime), {
      timeout: 30_000,
      message: `waiting for playback after rewinding ${rewindSeconds} seconds`
    }).toBeGreaterThan(target + 1)

    expect(await video.evaluate((element) => element.currentTime)).toBeLessThan(target + 15)
    await expect(video).toHaveJSProperty('readyState', 4)
    await expect(video).toHaveJSProperty('paused', false)
    await expect(video).toHaveJSProperty('currentSrc', initialSource)
  }
})
