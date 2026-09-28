import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchTwitchSubOnlyVod, getTwitchVodId } from '../../src/twitchSubOnlyVod.js'

test('only accepts Twitch VOD URLs for the fallback', () => {
  assert.equal(getTwitchVodId('https://www.twitch.tv/videos/12345?t=1h'), '12345')
  assert.equal(getTwitchVodId('https://www.twitch.tv/example'), null)
  assert.equal(getTwitchVodId('https://twitch.tv.evil.example/videos/12345'), null)
})

test('builds a playable HLS master from accessible Twitch VOD qualities', async () => {
  const requests = []
  const fetcher = async (url) => {
    requests.push(url)
    if (url === 'https://gql.twitch.tv/gql') {
      return Response.json({ data: { video: {
        title: 'Subscriber archive',
        broadcastType: 'ARCHIVE',
        seekPreviewsURL: 'https://example.cloudfront.net/cf_vods/archive-key/storyboards/1.jpg',
        owner: { login: 'example' }
      } } })
    }
    return new Response(url.includes('/720p60/') ? '#EXTM3U\nsegment-1.ts\n' : '', {
      status: url.includes('/720p60/') ? 200 : 404
    })
  }

  const result = await fetchTwitchSubOnlyVod('12345', fetcher)
  assert.equal(result.video.title, 'Subscriber archive')
  assert.match(result.playlist, /#EXT-X-STREAM-INF:BANDWIDTH=5040000,CODECS="avc1\.4D001E,mp4a\.40\.2",RESOLUTION=1280x720,FRAME-RATE=60/)
  assert.match(result.playlist, /https:\/\/example\.cloudfront\.net\/archive-key\/720p60\/index-dvr\.m3u8/)
  assert.equal((result.playlist.match(/#EXT-X-STREAM-INF/g) ?? []).length, 1)
  assert.equal(requests.length, 8)
})

test('rejects an unsafe preview URL before fetching a quality', async () => {
  let requests = 0
  const fetcher = async () => {
    requests++
    return Response.json({ data: { video: { seekPreviewsURL: 'https://localhost/private/storyboards/1.jpg' } } })
  }
  await assert.rejects(fetchTwitchSubOnlyVod('12345', fetcher), /preview host is invalid/)
  assert.equal(requests, 1)
})

test('reads an MP4 highlight codec from its playlist init segment', async () => {
  const box = (type, data) => {
    const result = Buffer.alloc(8 + data.length)
    result.writeUInt32BE(result.length)
    result.write(type, 4, 4, 'ascii')
    data.copy(result, 8)
    return result
  }
  const init = (type, profile, compatibility, level) => {
    const config = Buffer.from([1, profile, compatibility, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, level])
    const sample = box(type, Buffer.concat([Buffer.alloc(78), box('hvcC', config)]))
    return box('stsd', Buffer.concat([Buffer.alloc(4), Buffer.from([0, 0, 0, 1]), sample]))
  }
  const requested = []
  const fetcher = async url => {
    requested.push(url)
    if (url === 'https://gql.twitch.tv/gql') return Response.json({ data: { video: {
      broadcastType: 'HIGHLIGHT',
      seekPreviewsURL: 'https://example.cloudfront.net/archive-key/storyboards/1.jpg'
    } } })
    if (url.endsWith('/360p30/highlight-12345.m3u8') || url.endsWith('/720p60/highlight-12345.m3u8')) {
      return new Response('#EXTM3U\n#EXT-X-MAP:URI="init-0.mp4"\n#EXTINF:4,\nsegment-0.mp4\n')
    }
    if (url.endsWith('/360p30/init-0.mp4')) return new Response(init('hvc1', 1, 0x60, 93))
    if (url.endsWith('/720p60/init-0.mp4')) return new Response(init('hev1', 2, 0x40, 120))
    return new Response('', { status: 404 })
  }

  const result = await fetchTwitchSubOnlyVod('12345', fetcher)
  assert.match(result.playlist, /CODECS="hvc1\.1\.6\.L93\.B0,mp4a\.40\.2"/)
  assert.match(result.playlist, /CODECS="hev1\.2\.2\.L120\.B0,mp4a\.40\.2"/)
  assert.match(result.playlist, /\/360p30\/highlight-12345\.m3u8/)
  assert.ok(requested.includes('https://example.cloudfront.net/archive-key/360p30/init-0.mp4'))
})
