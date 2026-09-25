import assert from 'node:assert/strict'
import test from 'node:test'

import { buildYtDlpStoryboardVtt } from '../../src/main/ytDlpStoryboard.js'
import { PLAYBACK_INFO_OUTPUT_TEMPLATE, PLAYBACK_INFO_WITH_COOKIES_OUTPUT_TEMPLATE, parseYtDlpPlaybackInfo } from '../../src/ytDlpMetadata.js'

test('only desktop playback projects storyboard cookies', () => {
  assert.match(PLAYBACK_INFO_WITH_COOKIES_OUTPUT_TEMPLATE, /storyboard.*http_headers,cookies/)
  assert.doesNotMatch(PLAYBACK_INFO_OUTPUT_TEMPLATE, /storyboard.*http_headers,cookies/)
})

test('uses an external site storyboard without replacing the selected media metadata', () => {
  const media = { title: 'Twitch VOD', duration: 10, formats: [{ protocol: 'm3u8_native' }], storyboard: { protocol: 'm3u8_native' } }
  const storyboard = {
    protocol: 'mhtml',
    width: 160,
    height: 90,
    fps: 0.5,
    rows: 2,
    columns: 2,
    fragments: [{ url: 'https://example.com/storyboard.jpg', duration: 8 }]
  }
  const info = parseYtDlpPlaybackInfo(`${JSON.stringify(media)}\n${JSON.stringify({ ...media, storyboard })}\n`)

  assert.equal(info.title, media.title)
  assert.deepEqual(info.formats, media.formats)
  assert.match(buildYtDlpStoryboardVtt([info.storyboard], info.duration), /storyboard\.jpg#xywh=0,0,160,90/)
})

test('keeps external playback metadata when no storyboard is available', () => {
  const info = { title: 'Video', formats: [{ protocol: 'https' }], storyboard: { protocol: 'https' } }
  assert.deepEqual(parseYtDlpPlaybackInfo(`${JSON.stringify(info)}\n`), info)
})

test('rejects partial playback metadata after a yt-dlp request timeout', () => {
  const partial = { title: 'Video', formats: [{ protocol: 'https', height: 360 }] }
  const stderr = 'WARNING: [youtube] abc123: Unable to download web client API page: The read operation timed out'

  assert.deepEqual(parseYtDlpPlaybackInfo(`${JSON.stringify(partial)}\n`, stderr), { ...partial, incomplete: true })
  assert.deepEqual(parseYtDlpPlaybackInfo(`${JSON.stringify(partial)}\n`, ''), partial)
})

test('accepts metadata after a yt-dlp timeout that was retried successfully', () => {
  const complete = { title: 'Video', formats: [{ protocol: 'https', height: 1080 }] }
  const stderr = 'WARNING: [youtube] abc123: The read operation timed out. Retrying (1/3)...'

  assert.deepEqual(parseYtDlpPlaybackInfo(`${JSON.stringify(complete)}\n`, stderr), complete)
})

test('builds seekbar thumbnails from the highest-resolution yt-dlp storyboard', () => {
  const formats = [
    {
      protocol: 'mhtml',
      format_note: 'storyboard',
      width: 48,
      height: 27,
      fps: 0.5,
      rows: 2,
      columns: 2,
      fragments: [{ url: 'https://i.ytimg.com/low.jpg', duration: 8 }]
    },
    {
      protocol: 'mhtml',
      format_note: 'storyboard',
      width: 160,
      height: 90,
      fps: 0.5,
      rows: 2,
      columns: 2,
      fragments: [
        { url: 'https://i.ytimg.com/high-0.jpg', duration: 8 },
        { url: 'https://i.ytimg.com/high-1.jpg', duration: 2 }
      ]
    }
  ]

  const vtt = buildYtDlpStoryboardVtt(formats, 10)

  assert.match(vtt, /^WEBVTT/)
  assert.match(vtt, /00:00:00\.000 --> 00:00:02\.000\nhttps:\/\/i\.ytimg\.com\/high-0\.jpg#xywh=0,0,160,90/)
  assert.match(vtt, /00:00:08\.000 --> 00:00:10\.000\nhttps:\/\/i\.ytimg\.com\/high-1\.jpg#xywh=0,0,160,90/)
  assert.doesNotMatch(vtt, /low\.jpg/)
})

test('limits seekbar thumbnails from oversized yt-dlp storyboard metadata', () => {
  const vtt = buildYtDlpStoryboardVtt([{
    protocol: 'mhtml',
    width: 160,
    height: 90,
    fps: 1000,
    rows: 1000000,
    columns: 1000000,
    fragments: [{ url: 'https://i.ytimg.com/oversized.jpg', duration: 100 }]
  }], null)

  assert.equal((vtt.match(/ --> /g) || []).length, 50000)
  assert.match(vtt, /00:00:49\.999 --> 00:00:50\.000/)
  assert.doesNotMatch(vtt, /00:00:50\.000 -->/)
})
