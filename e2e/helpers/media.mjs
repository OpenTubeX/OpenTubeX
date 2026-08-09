import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { repoRoot } from './app.mjs'

/**
 * A tiny, offline demo video (VP9 + Opus, 640x360, 30s) that stands in for
 * YouTube's media streams. It burns a timecode into the picture, so failure
 * screenshots show at a glance whether (and how far) playback progressed.
 */
export const DEMO_MEDIA_PATH = path.join(repoRoot, 'e2e', 'fixtures', 'media', 'demo.webm')
export const DEMO_MEDIA_MIME_TYPE = 'video/webm; codecs="vp9, opus"'
export const DEMO_MEDIA_DURATION_SECONDS = 30

/**
 * Looks like a real progressive stream URL, so the app treats it the same way
 * and the route below can recognize it.
 */
export const DEMO_MEDIA_URL =
  'https://rr1---sn-opentubex-e2e.googlevideo.com/videoplayback?id=opentubex-e2e-demo&itag=43&mime=video%2Fwebm'

let demoMedia

function readDemoMedia() {
  demoMedia ??= readFile(DEMO_MEDIA_PATH)
  return demoMedia
}

/**
 * Builds a player response that YouTube would return for a playable video,
 * with a single progressive format pointing at the demo media. Without
 * adaptive formats the app falls back to its legacy (progressive) player
 * path, which needs neither a DASH manifest nor SABR.
 *
 * The metadata here is only a fallback: the accompanying `/next` response
 * (recorded fixtures) provides the title, channel and description the watch
 * page actually renders.
 *
 * @param {string} videoId
 * @param {object} [overrides] extra top-level fields, e.g. `playabilityStatus`
 */
export function demoPlayerResponse(videoId, overrides = {}) {
  const lengthSeconds = String(DEMO_MEDIA_DURATION_SECONDS)

  return {
    responseContext: {},
    playabilityStatus: {
      status: 'OK',
      playableInEmbed: true,
      miniplayer: { miniplayerRenderer: { playbackMode: 'PLAYBACK_MODE_ALLOW' } }
    },
    streamingData: {
      expiresInSeconds: '21540',
      formats: [{
        itag: 43,
        url: DEMO_MEDIA_URL,
        mimeType: DEMO_MEDIA_MIME_TYPE,
        bitrate: 200_000,
        width: 640,
        height: 360,
        lastModified: '1700000000000000',
        quality: 'medium',
        fps: 15,
        qualityLabel: '360p',
        projectionType: 'RECTANGULAR',
        audioQuality: 'AUDIO_QUALITY_LOW',
        approxDurationMs: String(DEMO_MEDIA_DURATION_SECONDS * 1000),
        audioSampleRate: '48000',
        audioChannels: 2
      }],
      // Deliberately empty: the app then uses the progressive format above.
      adaptiveFormats: []
    },
    playerConfig: { audioConfig: { loudnessDb: 0, perceptualLoudnessDb: 0 } },
    // Title, channel and view count are left out on purpose: the app prefers
    // these over the recorded `/next` response, which has the real ones.
    videoDetails: {
      videoId,
      lengthSeconds,
      isOwnerViewing: false,
      isCrawlable: true,
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 }] },
      allowRatings: true,
      isPrivate: false,
      isUnpluggedCorpus: false,
      isLiveContent: false
    },
    // No publish date on purpose: it would win over the recorded `/next`
    // response, which knows the real one.
    microformat: {
      playerMicroformatRenderer: {
        lengthSeconds,
        isFamilySafe: true,
        isUnlisted: false,
        category: 'People & Blogs'
      }
    },
    trackingParams: '',
    ...overrides
  }
}

/**
 * Answers requests for the demo stream with the local media file. Chromium
 * asks for byte ranges, so honour `Range` to keep seeking working.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function routeDemoMedia(page) {
  await page.route(/googlevideo\.com\/videoplayback/, async (route) => {
    const body = await readDemoMedia()
    const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range ?? '')

    if (!range) {
      return route.fulfill({
        status: 200,
        contentType: 'video/webm',
        headers: { 'accept-ranges': 'bytes', 'content-length': String(body.length) },
        body
      })
    }

    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1

    return route.fulfill({
      status: 206,
      contentType: 'video/webm',
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${body.length}`,
        'content-length': String(end - start + 1)
      },
      body: body.subarray(start, end + 1)
    })
  })
}

/**
 * youtubei.js resolves the id of the player script (which deciphers stream
 * URLs) from the IFrame API. Pinning it to a fixed id keeps the follow-up
 * `/s/player/` request predictable for the fixture lookups.
 *
 * The body is matched with a regex on the other end, hence the escaping.
 *
 * @param {import('@playwright/test').Page} page
 */
export function routeIframeApi(page) {
  return page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'player\\/test-player\\/'
  }))
}

/**
 * Replaces the BotGuard-backed poToken generation, which would otherwise
 * need YouTube's attestation servers and fails the video load without them.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 */
export function stubPoToken(electronApp) {
  return electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => 'test-po-token')
  })
}
