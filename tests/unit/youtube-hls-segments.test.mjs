import assert from 'node:assert/strict'
import test from 'node:test'

import { renameYouTubeFmp4HlsSegments } from '../../src/renderer/helpers/player/youtubeHlsSegments.js'

const base = 'https://rr1---sn-example.googlevideo.com/videoplayback/id/0123456789abcdef/itag/606/playlist/index.m3u8'

test('YouTube fMP4 segments are named .mp4 so Shaka does not treat VP9 as MPEG-TS', () => {
  const playlist = [
    '#EXTM3U',
    `#EXT-X-MAP:URI="${base}/govp/slices%3D0-1000/gosq/0?is=1&file=seg.ts"`,
    '#EXTINF:5.333,',
    `${base}/govp/slices%3D0-1000/gosq/0/file/seg.ts`,
    '#EXTINF:4.458,',
    `${base}/govp/slices%3D0-218,1001-2000/gosq/1/file/seg.ts`,
    '#EXT-X-ENDLIST',
  ].join('\n')

  assert.equal(renameYouTubeFmp4HlsSegments(playlist), playlist
    .replace('gosq/0/file/seg.ts', 'gosq/0/file/seg.mp4')
    .replace('gosq/1/file/seg.ts', 'gosq/1/file/seg.mp4'))
})

test('YouTube MPEG-TS segments keep their name', () => {
  const playlist = `#EXTM3U\n#EXTINF:5.333333,\n${base}/file/seg.ts\n#EXT-X-ENDLIST\n`
  assert.equal(renameYouTubeFmp4HlsSegments(playlist), null)
})
