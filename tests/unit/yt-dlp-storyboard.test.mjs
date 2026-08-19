import assert from 'node:assert/strict'
import test from 'node:test'

import { buildYtDlpStoryboardVtt } from '../../src/main/ytDlpStoryboard.js'

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
