import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, sel, abortUnmockedRequest, goToSettingsSection, repoRoot } from '../../helpers/app.mjs'
import { activeTab, waitForPlayback } from '../../helpers/player.mjs'

const SERVER = 'https://yattee.test'
const VIDEO_ID = 'jNQXAC9IVRw'
const AUTHORIZATION = `Basic ${Buffer.from('alex:secret').toString('base64')}`
// The server builds absolute URLs from the Host header it sees behind a reverse proxy
const INTERNAL_ORIGIN = 'http://127.0.0.1:8085'

const media = {
  video: readFile(path.join(repoRoot, 'e2e', 'fixtures', 'media', 'dash-demo-video.webm')),
  audio: readFile(path.join(repoRoot, 'e2e', 'fixtures', 'media', 'dash-demo-audio.webm'))
}

/**
 * @param {'video' | 'audio'} kind
 */
function relayUrl(kind) {
  const upstream = new URL('https://rr1---sn-yattee-e2e.googlevideo.com/videoplayback')
  upstream.searchParams.set('itag', kind === 'video' ? '248' : '251')
  upstream.searchParams.set('dur', '6.000')
  upstream.searchParams.set('expire', '4102444800')
  if (kind === 'audio') upstream.searchParams.set('xtags', 'lang=en:acont=original')

  const relay = new URL(`${INTERNAL_ORIGIN}/proxy/relay`)
  relay.searchParams.set('url', upstream.toString())
  relay.searchParams.set('sig', 'signature')
  relay.searchParams.set('exp', '4102444800')
  return relay.toString()
}

const videoResponse = {
  videoId: VIDEO_ID,
  title: 'Yattee playback test',
  author: 'Test Channel',
  authorId: 'UC-test-channel-id',
  authorThumbnails: [],
  description: 'Played through a Yattee server',
  descriptionHtml: null,
  subCountText: '1.2K',
  lengthSeconds: 6,
  published: 1700000000,
  viewCount: 42,
  likeCount: 1,
  videoThumbnails: [],
  liveNow: false,
  isUpcoming: false,
  hlsUrl: null,
  dashUrl: null,
  // An HLS manifest that the server did not relay must not be used while proxying
  formatStreams: [{
    url: 'https://manifest.googlevideo.com/api/manifest/hls_variant/expire/4102444800/file/index.m3u8',
    itag: '96',
    type: 'application/vnd.apple.mpegurl',
    quality: '1080p',
    container: 'hls'
  }],
  adaptiveFormats: [
    {
      url: relayUrl('video'),
      itag: '248',
      type: 'video/webm; codecs="vp9"',
      container: 'webm',
      resolution: '360p',
      width: 640,
      height: 360,
      bitrate: '300000',
      fps: 30,
      encoding: 'vp9'
    },
    {
      url: relayUrl('audio'),
      itag: '251',
      type: 'audio/webm; codecs="opus"',
      container: 'webm',
      bitrate: '64000',
      encoding: 'opus',
      audioQuality: 'medium',
      audioTrack: { id: 'en', displayName: 'medium', isDefault: false }
    }
  ],
  captions: [{
    label: 'English',
    languageCode: 'en',
    url: `${INTERNAL_ORIGIN}/api/v1/captions/${VIDEO_ID}/content?lang=en&token=caption-token`,
    auto_generated: false
  }],
  storyboards: [],
  recommendedVideos: [],
  extractionMethod: 'hybrid'
}

/**
 * Serves byte ranges like the server's relay does.
 * @param {import('@playwright/test').Route} route
 * @param {Buffer} body
 */
function fulfillRange(route, body) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
  if (!range) {
    return route.fulfill({ status: 200, contentType: 'video/webm', body })
  }
  const start = Number(range[1])
  const end = range[2] === '' ? body.length - 1 : Math.min(Number(range[2]), body.length - 1)
  return route.fulfill({
    status: 206,
    contentType: 'video/webm',
    headers: { 'content-range': `bytes ${start}-${end}/${body.length}` },
    body: body.subarray(start, end + 1)
  })
}

const SETTINGS = {
  currentLocale: 'en-US',
  backendPreference: 'yattee',
  yatteeServerUrl: `${SERVER}/`,
  yatteeUsername: 'alex',
  yatteePassword: 'secret',
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true,
  defaultVideoFormat: 'dash',
  useSponsorBlock: false,
  useDeArrowTitles: false,
  useDeArrowThumbnails: false
}

test.use({ seed: { settings: SETTINGS } })

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
})

test('plays relayed DASH streams through the Yattee server without contacting YouTube', async ({ page }) => {
  const youtubeRequests = []
  page.on('request', request => {
    if (/googlevideo\.com|youtube\.com/.test(new URL(request.url()).hostname)) youtubeRequests.push(request.url())
  })

  const videoRequests = []
  await page.route(`${SERVER}/api/v1/videos/**`, route => {
    videoRequests.push(route.request())
    return route.fulfill({ json: videoResponse })
  })
  await page.route(`${SERVER}/api/v1/comments/**`, route => route.fulfill({ json: { comments: [], continuation: null } }))
  await page.route(`${SERVER}/proxy/relay?**`, async route => {
    const upstream = new URL(new URL(route.request().url()).searchParams.get('url'))
    return fulfillRange(route, await media[upstream.searchParams.get('itag') === '248' ? 'video' : 'audio'])
  })
  const captionRequests = []
  await page.route(`${SERVER}/api/v1/captions/**`, route => {
    captionRequests.push(route.request().url())
    return route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00.000 --> 00:06.000\nYattee caption\n' })
  })

  await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .videoTitle`).first()).toHaveText('Yattee playback test')
  await waitForPlayback(page)

  expect(videoRequests).toHaveLength(1)
  expect(new URL(videoRequests[0].url()).searchParams.get('proxy')).toBe('true')
  expect(videoRequests[0].headers().authorization).toBe(AUTHORIZATION)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const tracks = await player.evaluate(element => {
    const shaka = element.ui.getControls().getPlayer()
    return {
      variants: shaka.getVariantTracks().map(track => `${track.height}p ${track.videoCodec} ${track.audioCodec}`),
      text: shaka.getTextTracks().map(track => track.language)
    }
  })
  expect(tracks).toEqual({ variants: ['360p vp9 opus'], text: ['en'] })

  await player.locator('.shaka-overflow-menu-button').click()
  await player.locator('.shaka-overflow-menu').getByRole('button', { name: /Captions/ }).click()
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'English' }).click()
  await expect.poll(() => captionRequests).toEqual([
    `${SERVER}/api/v1/captions/${VIDEO_ID}/content?lang=en&token=caption-token`
  ])
  expect(youtubeRequests).toEqual([])
})

test('reports rejected credentials when loading a video', async ({ page }) => {
  await page.route(`${SERVER}/api/v1/videos/**`, route => route.fulfill({ status: 401, json: { detail: 'Invalid credentials' } }))

  await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .errorContainer`)).toContainText('The Yattee server rejected the username or password.')
})

/**
 * A live stream for which the server returned no streams
 * @param {import('@playwright/test').Page} page
 */
async function openLiveStreamWithoutStreams(page) {
  await page.route(`${SERVER}/api/v1/videos/**`, route => route.fulfill({
    json: { ...videoResponse, liveNow: true, lengthSeconds: 0, formatStreams: [], adaptiveFormats: [] }
  }))
  await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
  await page.locator(sel.searchInput).press('Enter')
  return page.locator(`${activeTab} .errorContainer`)
}

test('explains that the server did not relay the streams of a live stream', async ({ page }) => {
  await expect(await openLiveStreamWithoutStreams(page)).toContainText('The Yattee server did not relay the streams of this video.')
})

test.describe('without proxying', () => {
  test.use({ seed: { settings: { ...SETTINGS, yatteeProxyVideos: false } } })

  test('does not blame relaying for missing live streams', async ({ page }) => {
    const error = await openLiveStreamWithoutStreams(page)
    await expect(error).toContainText('Could not load the streams of this video from the Yattee server.')
    await expect(error).not.toContainText('relay')
  })
})

test('reports a failure to load live chat directly from YouTube', async ({ page }) => {
  await page.route(`${SERVER}/api/v1/videos/**`, route => route.fulfill({
    json: { ...videoResponse, liveNow: true, lengthSeconds: 0, hlsUrl: `${SERVER}/proxy/relay?url=live`, formatStreams: [], adaptiveFormats: [] }
  }))
  await page.route(`${SERVER}/proxy/relay?**`, route => route.fulfill({ status: 404 }))

  await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
  await page.locator(sel.searchInput).press('Enter')
  const chatError = page.locator(`${activeTab} .messageContainer.hasError`)
  await expect(chatError).toContainText('Live Chat is currently not supported with the Yattee server.')

  // An aborted request would wait for the connection to return, so YouTube answers with an error instead
  await page.route(/^https:\/\/(www\.)?youtube\.com\//, route => route.fulfill({ status: 400, body: 'Bad Request' }))
  await chatError.getByRole('button', { name: 'Enable Live Chat' }).click()
  await expect(chatError).toBeVisible()
  await expect(chatError).not.toContainText('not supported')
  await expect(page.locator(`${activeTab} .liveChatSkeleton`)).toHaveCount(0)
})

test('shows channel handles and subscriber counts in search results', async ({ page }) => {
  await page.route(`${SERVER}/api/v1/search?**`, route => route.fulfill({
    json: new URL(route.request().url()).searchParams.get('page') !== '1'
      ? []
      : [{
          type: 'channel',
          authorId: 'UCXuqSBlHAE6Xw-yeJA0Tunw',
          author: 'Linus Tech Tips',
          description: '',
          subCount: null,
          subCountText: '@LinusTechTips',
          videoCount: 16900000,
          authorThumbnails: [],
          authorVerified: true
        }]
  }))

  await page.locator(sel.searchInput).fill('linus tech tips')
  await page.locator(sel.searchInput).press('Enter')
  const channel = page.locator(`${activeTab} .ft-list-channel`)
  await expect(channel.locator('.handle')).toHaveText('@LinusTechTips')
  await expect(channel.locator('.subscriberCount')).toHaveText('16,900,000 subscribers')
})

test('only offers the search filters that the server supports', async ({ page }) => {
  await page.locator('.navFilterButton').click()
  const prompt = page.locator('.searchFiltersCard')
  await expect(prompt.getByRole('radio', { name: 'Any Time', exact: true })).toBeVisible()
  await expect(prompt.getByText('Features', { exact: true })).toHaveCount(0)
  await expect(prompt.getByText('Subtitles', { exact: true })).toHaveCount(0)
})

test('opens channels by handle with only the tabs the server provides', async ({ page }) => {
  const channel = {
    authorId: 'UC-test-channel-id',
    author: 'Test Channel',
    description: 'About the channel',
    subCount: 1200,
    totalViews: null,
    authorThumbnails: [],
    authorBanners: [],
    authorVerified: false
  }
  const channelRequests = []
  await page.route(`${SERVER}/api/v1/channels/**`, route => {
    const { pathname } = new URL(route.request().url())
    channelRequests.push(decodeURIComponent(pathname))
    if (/\/(videos|shorts|streams)$/.test(pathname)) {
      return route.fulfill({
        json: {
          videos: [{
            type: 'video',
            videoId: 'aaaaaaaaaaa',
            title: 'Latest upload',
            author: '',
            authorId: '',
            authorUrl: '',
            lengthSeconds: 60,
            published: 1700000000,
            publishedText: '1 day ago',
            viewCount: 10,
            videoThumbnails: [],
            liveNow: false,
            isUpcoming: false
          }, {
            type: 'video',
            videoId: 'bbbbbbbbbbb',
            title: 'Older upload',
            author: '',
            authorId: '',
            authorUrl: '',
            lengthSeconds: 60,
            published: 1700000000,
            publishedText: '1 day ago',
            viewCount: 10,
            videoThumbnails: [],
            liveNow: false,
            isUpcoming: false
          }],
          continuation: null
        }
      })
    }
    if (pathname.endsWith('/playlists')) return route.fulfill({ json: { playlists: [], continuation: null } })
    return route.fulfill({ json: channel })
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/@TestChannel')
  await page.locator(sel.searchInput).press('Enter')
  const tabs = page.locator(`${activeTab} .channelDetails [role="tab"]`)
  await expect(tabs).toHaveText(['Videos', 'Shorts', 'Live', 'Playlists', 'About'])
  await expect(page.locator(`${activeTab} .ft-list-video`).first()).toContainText('Latest upload')
  // The server ignores the sort order
  await expect(page.locator(`${activeTab} .channelContent .select`)).toHaveCount(0)

  // Keyboard navigation reaches the About tab, which needs no request of its own
  await tabs.filter({ hasText: 'Playlists' }).click()
  await tabs.filter({ hasText: 'Playlists' }).press('ArrowRight')
  await expect(tabs.filter({ hasText: 'About' })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/\/channel\/UC-test-channel-id\/about$/)
  expect(channelRequests[0]).toBe('/api/v1/channels/@TestChannel')
  expect(channelRequests).not.toContain('/api/v1/channels/UC-test-channel-id/community')
})

test('explains that hashtags need the local API fallback', async ({ page }) => {
  const hashtagRequests = []
  await page.route(`${SERVER}/api/v1/hashtag/**`, route => {
    hashtagRequests.push(route.request().url())
    return route.fulfill({ status: 404, json: { detail: 'Not Found' } })
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/music')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('This page is not available with the Yattee server.')).toBeVisible()
  expect(hashtagRequests).toEqual([])
})

test('checks the connection and credentials from the settings', async ({ page }) => {
  let status = 200
  const authorizations = []
  await page.route(`${SERVER}/info`, route => {
    authorizations.push(route.request().headers().authorization)
    return status === 200
      ? route.fulfill({ json: { name: 'Yattee Server', version: '1.0.9-fa6b55f' } })
      : route.fulfill({ status, json: { detail: 'Invalid credentials' } })
  })

  const section = await goToSettingsSection(page, 'advanced')
  await expect(section.getByRole('textbox', { name: 'Yattee server URL' })).toHaveValue(`${SERVER}/`)
  const testButton = section.getByRole('button', { name: 'Test Connection' })
  await testButton.click()
  await expect(section.getByRole('status')).toHaveText('Connected to Yattee Server 1.0.9')
  expect(authorizations).toEqual([AUTHORIZATION])

  status = 401
  await section.getByRole('textbox', { name: 'Password' }).fill('wrong')
  await expect(section.getByRole('status')).toBeHidden()
  await testButton.click()
  await expect(section.getByRole('status')).toHaveText('The server rejected the username or password.')
  expect(authorizations.at(-1)).toBe(`Basic ${Buffer.from('alex:wrong').toString('base64')}`)
  await expect.poll(() => page.evaluate(() => window.$store.getters.getYatteePassword)).toBe('wrong')
})
