import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { repoRoot } from '../helpers/app.mjs'
import { fixtureDirFor, setupInnertube } from '../helpers/innertube.mjs'
import { demoPlayerResponse, routeDemoMedia } from '../helpers/media.mjs'

const fixturesDir = path.join(repoRoot, 'e2e', 'fixtures', 'theme-previews')
const imagesDir = path.join(fixturesDir, 'images')
const watchMediaPath = path.join(fixturesDir, 'watch.webm')
const watchPlayerPath = path.join(fixturesDir, 'watch-player.json')
// Thumbnails, avatars, and chat emoji.
const IMAGE_URL = /^https:\/\/(?:(?:i\d*\.ytimg\.com|yt\d\.ggpht\.com|yt\d\.googleusercontent\.com)\/|fonts\.gstatic\.com\/s\/e\/notoemoji\/|www\.youtube\.com\/s\/gaming\/emoji\/)/
// Thumbnails are displayed up to about 300 CSS pixels wide.
const MAX_IMAGE_WIDTH = 480

function imageKey(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
}

/**
 * GitHub-hosted runners are blocked from YouTube, so theme previews replay the
 * README scenes from fixtures. `E2E_RECORD=1` refreshes them from the live app.
 * @param {import('../helpers/app.mjs').App} app
 * @param {import('@playwright/test').TestInfo} testInfo
 */
export async function setupThemePreviewFixtures(app, testInfo) {
  const { page } = app
  const record = !!process.env.E2E_RECORD
  if (record) {
    // Drop responses the new recording no longer requests.
    for (const directory of [fixtureDirFor(testInfo), fixturesDir]) {
      await rm(directory, { recursive: true, force: true })
    }
  }
  await setupInnertube(app, testInfo, { alwaysReplay: true })

  if (record) {
    /** @type {Map<string, { contentType: string, body: Buffer }>} */
    const responses = new Map()
    await page.route(IMAGE_URL, async route => {
      const response = await route.fetch().catch(() => null)
      if (!response) return route.abort().catch(() => {})
      if (response.ok()) {
        responses.set(route.request().url(), { contentType: response.headers()['content-type'], body: await response.body() })
      }
      await route.fulfill({ response }).catch(() => {})
    })
    // Keep the watch page metadata of the live player response, without its expiring streams.
    let player
    page.on('response', async response => {
      if (!response.url().includes('/youtubei/v1/player') || !response.ok()) return
      const { playabilityStatus, videoDetails, microformat } = await response.json().catch(() => ({}))
      if (playabilityStatus?.status === 'OK') player = { videoDetails, microformat }
    })
    return {
      record,
      /**
       * Keep only the images a captured scene shows, downscaled to what it displays.
       * @param {'subscriptions'|'watch'|'settings'} view
       */
      async recordScene(view) {
        const urls = await page.locator('img').evaluateAll(images => images
          .filter(image => {
            const rect = image.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
              rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
          })
          .map(image => image.currentSrc || image.src))
        await mkdir(imagesDir, { recursive: true })
        for (const url of new Set(urls)) {
          const response = responses.get(url)
          if (!response) continue
          // Chat emoji need their transparency and are already small.
          if (response.contentType === 'image/png') {
            await writeFile(path.join(imagesDir, `${imageKey(url)}.png`), response.body)
            continue
          }
          const jpeg = await app.electronApp.evaluate(({ nativeImage }, { base64, maxWidth }) => {
            const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
            return image.isEmpty()
              ? null
              : image.resize({ width: Math.min(maxWidth, image.getSize().width), quality: 'best' }).toJPEG(80).toString('base64')
          }, { base64: response.body.toString('base64'), maxWidth: MAX_IMAGE_WIDTH })
          if (!jpeg) throw new Error(`Cannot decode ${url}`)
          await writeFile(path.join(imagesDir, `${imageKey(url)}.jpg`), Buffer.from(jpeg, 'base64'))
        }
        if (view === 'watch') {
          if (!player) throw new Error('The live player response was not recorded')
          await writeFile(watchPlayerPath, `${JSON.stringify(player, null, 2)}\n`)
          await recordWatchFrame(page)
        }
      },
    }
  }

  const images = new Map((await readdir(imagesDir)).map(file => [path.parse(file).name, file]))
  await page.route(IMAGE_URL, async route => {
    // Images outside the captured scenes were not recorded.
    const file = images.get(imageKey(route.request().url()))
    if (!file) return route.abort()
    await route.fulfill({
      contentType: file.endsWith('.png') ? 'image/png' : 'image/jpeg',
      body: await readFile(path.join(imagesDir, file)),
    })
  })

  // The watch page shows a still of the README frame for the video's full length.
  const media = await readFile(watchMediaPath)
  const player = JSON.parse(await readFile(watchPlayerPath, 'utf8'))
  await routeDemoMedia(page, media)
  await page.route(/\/youtubei\/v1\/player/, route => {
    const { videoId } = JSON.parse(route.request().postData() ?? '{}')
    const response = { ...demoPlayerResponse(videoId), ...(videoId === player.videoDetails.videoId ? player : {}) }
    Object.assign(response.streamingData.formats[0], {
      mimeType: 'video/webm; codecs="vp9"',
      contentLength: String(media.length),
    })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
  })
  return { record }
}

/**
 * Save the paused watch frame as a still video with the recorded duration.
 * @param {import('@playwright/test').Page} page
 */
async function recordWatchFrame(page) {
  const { duration, frame } = await page.locator('.ftVideoPlayer video').evaluate(video => {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return { duration: video.duration, frame: canvas.toDataURL('image/png') }
  })
  const directory = await mkdtemp(path.join(tmpdir(), 'theme-preview-'))
  try {
    await writeFile(path.join(directory, 'frame.png'), Buffer.from(frame.split(',')[1], 'base64'))
    // Repeating the last entry makes ffmpeg honor its duration.
    await writeFile(path.join(directory, 'frames.txt'),
      `ffconcat version 1.0\nfile frame.png\nduration ${duration}\nfile frame.png\n`)
    await promisify(execFile)('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'concat', '-i', path.join(directory, 'frames.txt'),
      '-fps_mode', 'vfr', '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-pix_fmt', 'yuv420p', watchMediaPath,
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
