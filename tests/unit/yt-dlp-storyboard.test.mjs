import assert from 'node:assert/strict'
import test from 'node:test'

import { buildYtDlpStoryboardVtt } from '../../src/main/ytDlpStoryboard.js'
import { parseYtDlpPlaybackInfo } from '../../src/ytDlpMetadata.js'

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

test('keeps the extractor reason for missing formats', () => {
  const media = { title: 'Post', formats: [] }
  const stderr = [
    'WARNING: [Instagram] abc123: No CSRF token set by Instagram API',
    'WARNING: [Instagram] There is no video in this post',
    'WARNING: No video formats found!',
    'WARNING: Requested format is not available'
  ].join('\n')

  assert.deepEqual(parseYtDlpPlaybackInfo(`${JSON.stringify(media)}\n`, stderr), { ...media, noFormatsReason: '[Instagram] There is no video in this post' })
  assert.equal(parseYtDlpPlaybackInfo(`${JSON.stringify(media)}\n`, 'WARNING: This video is DRM protected').noFormatsReason, 'This video is DRM protected')
  assert.equal(parseYtDlpPlaybackInfo(`${JSON.stringify(media)}\n`, 'WARNING: No video formats found!').noFormatsReason, undefined)
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

test('skips storyboard fragment URLs that could add WebVTT cues', () => {
  const format = { protocol: 'mhtml', width: 160, height: 90, fps: 0.5, rows: 1, columns: 1 }
  const fragments = ['https://example.com/a.jpg\n\n00:00.000 --> 99:00.000\nfile:///etc/passwd', 'javascript:alert(1)', 'https://example.com/b-->c.jpg']
    .map(url => ({ url, duration: 2 }))
  assert.equal(buildYtDlpStoryboardVtt([{ ...format, fragments }], 10), null)

  // a rejected fragment keeps its time span, so the next thumbnail stays in place
  const vtt = buildYtDlpStoryboardVtt([{ ...format, fragments: [fragments[1], { url: 'https://example.com/d.jpg', duration: 2 }] }], 10)
  assert.match(vtt, /^WEBVTT\n\n00:00:02\.000 --> 00:00:04\.000\nhttps:\/\/example\.com\/d\.jpg#/)

  // skipping a rejected fragment of an oversized grid must not visit its cells
  const huge = { ...format, rows: 1e8, columns: 1e8 }
  const hugeVtt = buildYtDlpStoryboardVtt([{ ...huge, fragments: [{ url: 'javascript:bad' }, { url: 'https://example.com/ok.jpg', duration: 1 }] }], null)
  assert.match(hugeVtt, /https:\/\/example\.com\/ok\.jpg#/)
})
