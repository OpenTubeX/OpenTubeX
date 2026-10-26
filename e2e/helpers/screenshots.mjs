import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, goTo, goToSettingsSection, sel } from './app.mjs'
import { expectImagesLoaded } from './visual-fixtures.mjs'

/** Capture the complete Electron framebuffer after pending layout has rendered. */
export async function captureAppFramebuffer(app, testInfo, name) {
  await app.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const framebuffer = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  const destination = testInfo.outputPath(`${name}.png`)
  await writeFile(destination, Buffer.from(framebuffer, 'base64'))
  await testInfo.attach(name, { path: destination, contentType: 'image/png' })
  return destination
}

const SIZE = { width: 1710, height: 1026 }
const CHANNEL_ID = 'UCsXVk37bltHxD1rDPwtNM8Q'
const VIDEO_ID = 'AY5qcIq5u2g'
const TIMESTAMP = 3 * 3600 + 41 * 60 + 58

/** Open a YouTube URL from the search bar, or by route where the phone layout hides it. */
async function openScreenshotUrl(page, url, route) {
  const search = page.locator(sel.searchInput)
  if (!await search.isVisible()) {
    await page.evaluate(route => { location.hash = route }, route)
    return
  }
  await search.fill(url)
  await search.press('Enter')
}

async function clearScreenshotSearch(page) {
  const search = page.locator(sel.searchInput)
  if (await search.isVisible()) await search.fill('')
}

/** Load the same public subscription feed for README and discussion screenshots. */
export async function openScreenshotSubscriptions(page) {
  // Call after capturing Settings with all app defaults intact.
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateFetchSubscriptionsAutomatically', false)
    await store.dispatch('updateVideoPlaybackEngine', 'yt-dlp')
  })
  await openScreenshotUrl(page, `https://www.youtube.com/channel/${CHANNEL_ID}`, `/channel/${CHANNEL_ID}`)
  const subscribe = page.locator('.ftSubscribeButton .subscribeButton').first()
  await expect(subscribe).toHaveText(/^\s*Subscribe/, { timeout: 60_000 })
  await subscribe.click()
  await expect(subscribe).toHaveText(/^\s*Unsubscribe/)
  await clearScreenshotSearch(page)
  await goTo(page, 'subscriptions')
  await page.locator('.subscriptionsHeaderRefreshWidget .refreshButton').click()
  await expect(page.locator('.ft-list-video').nth(3)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.subscriptionsHeaderRefreshWidget .refreshButton button'))
    .toHaveAttribute('title', /Refresh/)
}

/** Load the README's public video and pause on its selected decoded frame. */
export async function openScreenshotWatch(page) {
  await openScreenshotUrl(page, `https://www.youtube.com/watch?v=${VIDEO_ID}&t=${TIMESTAMP}`, `/watch/${VIDEO_ID}?timestamp=${TIMESTAMP}`)
  await expect(page.locator('.videoTitle')).toContainText('FLYING OVER JAPAN', { timeout: 60_000 })
  const video = page.locator('.ftVideoPlayer video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => ({
    ready: await video.evaluate(element => element.readyState >= 2),
    errors: await page.locator('.errorMessage:visible').allTextContents(),
  }), { timeout: 60_000, message: 'waiting for a playable frame from YouTube' })
    .toEqual({ ready: true, errors: [] })
  await video.evaluate((element, timestamp) => {
    element.pause()
    element.currentTime = timestamp
  }, TIMESTAMP)
  await expectPausedFrame(page)
  await clearScreenshotSearch(page)
}

export async function expectPausedFrame(page) {
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(element => ({
    paused: element.paused,
    seeking: element.seeking,
    ready: element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    time: element.currentTime,
  }))).toEqual({ paused: true, seeking: false, ready: true, time: TIMESTAMP })
}

/** Keep screenshot content dimensions independent of native window decorations. */
export async function sizeScreenshotWindow(app) {
  await app.electronApp.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
  }, SIZE)
  await expect.poll(() => app.page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual(SIZE)
}

export async function openScreenshotSettings(page) {
  await goToSettingsSection(page, 'general')
  const dialog = page.locator('.settingsWindow')
  await dialog.getByRole('button', { name: /^Maximi[sz]e$/ }).click()
  await expect(dialog).toHaveClass(/maximized/)
  await expect.poll(async () => {
    const { width, height } = await dialog.boundingBox()
    return { width, height }
  }).toEqual(SIZE)
  return dialog
}

/**
 * Wait until one of the README and theme-preview scenes is ready to capture.
 * @param {import('@playwright/test').Page} page
 * @param {'subscriptions'|'watch'|'settings'} view
 */
export async function prepareAppScreenshot(page, view) {
  // Content scenes must contain their expected imagery, even if a regression
  // removes the img elements entirely. Settings has no required imagery.
  if (view === 'subscriptions') {
    // The phone layout only renders the videos near its smaller viewport.
    const videos = page.locator('.ft-list-video')
    await expect(videos.nth(3)).toBeVisible()
    const count = await videos.evaluateAll(items => items.filter(item => item.getBoundingClientRect().top < innerHeight).length)
    for (let index = 0; index < count; index++) {
      const thumbnail = videos.nth(index).locator('img.thumbnailImage').first()
      await expect(thumbnail).toBeVisible()
      await expectImagesLoaded(thumbnail)
    }
  } else if (view === 'watch') {
    await expectPausedFrame(page)
    const avatar = page.locator('.watchVideoInfo img.channelThumbnail').first()
    await expect(avatar).toBeVisible()
    await expectImagesLoaded(avatar)
    const recommendation = page.locator('.watchVideoRecommendations img.thumbnailImage').first()
    await expect(recommendation).toBeVisible()
    await expectImagesLoaded(recommendation)
  }

  await expect.poll(() => page.locator('img').evaluateAll(images => images
    .filter(image => {
      const rect = image.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
        rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth &&
        image.checkVisibility()
    })
    .filter(image => !image.complete || image.naturalWidth === 0)
    .map(image => image.currentSrc || image.src)), {
    message: 'visible thumbnails and avatars must finish loading',
  }).toEqual([])
  await page.evaluate(async () => {
    await document.fonts.ready
    document.activeElement?.blur()
  })
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  // Overlay scrollbars show briefly after content loads or scrolls.
  await expect(page.locator('.os-scrollbar-visible:not(.os-scrollbar-unusable):not(.app-scrollbar-idle)')).toHaveCount(0)
}

/**
 * Capture one of the README and theme-preview scenes once its content is ready.
 * @param {import('@playwright/test').Page} page
 * @param {'subscriptions'|'watch'|'settings'} view
 * @param {string} destination
 */
export async function captureAppScreenshot(page, view, destination) {
  await prepareAppScreenshot(page, view)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: destination, animations: 'disabled' })
  if (view === 'watch') await expectPausedFrame(page)
}

/** Call only after all scenes succeed, so failed captures do not replace images. */
export async function copyScreenshots(testInfo, names, destination) {
  await mkdir(destination, { recursive: true })
  for (const name of names) {
    await copyFile(testInfo.outputPath(name), path.join(destination, name))
  }
}
