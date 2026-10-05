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
  const segment = Buffer.alloc(188)
  segment[0] = 0x47
  Buffer.from([0, 0, 1, 0x67, 0x64, 0, 0x28]).copy(segment, 24)
  const fetcher = async (url) => {
    requests.push(url)
    if (url === 'https://gql.twitch.tv/gql') {
      return Response.json({ data: { video: {
        title: 'Subscriber archive',
        lengthSeconds: 10,
        broadcastType: 'ARCHIVE',
        seekPreviewsURL: 'https://example.cloudfront.net/cf_vods/archive-key/storyboards/metadata.json',
        owner: { login: 'example' }
      } } })
    }
    if (url.endsWith('/storyboards/metadata.json')) return Response.json([{
      width: 80, height: 45, rows: 2, cols: 2, count: 5,
      images: ['low-0.jpg', 'low-1.jpg']
    }, {
      width: 160, height: 90, rows: 2, cols: 2, count: 5,
      images: ['0.jpg', '1.jpg']
    }])
    if (url.endsWith('/720p60/segment-1.ts')) return new Response(segment)
    return new Response(url.includes('/720p60/') ? '#EXTM3U\nsegment-1.ts\n' : '', {
      status: url.includes('/720p60/') ? 200 : 404
    })
  }

  const result = await fetchTwitchSubOnlyVod('12345', fetcher)
  assert.equal(result.video.title, 'Subscriber archive')
  assert.match(result.playlist, /#EXT-X-STREAM-INF:BANDWIDTH=5040000,CODECS="avc1\.640028,mp4a\.40\.2",RESOLUTION=1280x720,FRAME-RATE=60/)
  assert.match(result.playlist, /https:\/\/example\.cloudfront\.net\/archive-key\/720p60\/index-dvr\.m3u8/)
  assert.equal((result.playlist.match(/#EXT-X-STREAM-INF/g) ?? []).length, 1)
  assert.match(result.storyboardVtt, /00:00:00\.000 --> 00:00:02\.000\nhttps:\/\/example\.cloudfront\.net\/cf_vods\/archive-key\/storyboards\/0\.jpg#xywh=0,0,160,90/)
  assert.match(result.storyboardVtt, /00:00:02\.000 --> 00:00:04\.000\n.*0\.jpg#xywh=160,0,160,90/)
  assert.match(result.storyboardVtt, /00:00:08\.000 --> 00:00:10\.000\n.*1\.jpg#xywh=0,0,160,90/)
  assert.equal((result.storyboardVtt.match(/ --> /g) ?? []).length, 5)
  assert.doesNotMatch(result.storyboardVtt, /low-/)
  assert.equal(requests.length, 10)
})

test('unavailable or invalid seekbar previews do not prevent Twitch VOD playback', async t => {
  const valid = { width: 160, height: 90, rows: 2, cols: 2, count: 5, images: ['0.jpg', '1.jpg'] }
  const scenarios = [
    ['network error', () => { throw new Error('preview request failed') }],
    ['HTTP error', () => new Response('', { status: 403 })],
    ['invalid JSON', () => new Response('not JSON')],
    ['invalid metadata', () => Response.json({})],
    ['invalid dimensions', () => Response.json([{ ...valid, cols: 0 }])],
    ['unsafe image URL', () => Response.json([{ ...valid, images: ['http://localhost/private.jpg'] }])]
  ]
  for (const [name, previewResponse] of scenarios) {
    await t.test(name, async () => {
      const segment = Buffer.from([0, 0, 1, 0x67, 0x64, 0, 0x28])
      const fetcher = async url => {
        if (url === 'https://gql.twitch.tv/gql') return Response.json({ data: { video: {
          lengthSeconds: 10,
          seekPreviewsURL: 'https://example.cloudfront.net/archive-key/storyboards/metadata.json'
        } } })
        if (url.endsWith('/storyboards/metadata.json')) return previewResponse()
        if (url.endsWith('/720p60/index-dvr.m3u8')) return new Response('#EXTM3U\nsegment-1.ts\n')
        if (url.endsWith('/720p60/segment-1.ts')) return new Response(segment)
        return new Response('', { status: 404 })
      }
      const result = await fetchTwitchSubOnlyVod('12345', fetcher)
      assert.equal(result.storyboardVtt, null)
      assert.match(result.playlist, /#EXT-X-STREAM-INF/)
    })
  }
})

test('uses each Twitch transport stream quality’s declared H.264 codec', async () => {
  const segment = (profile, constraints, level) => {
    const bytes = Buffer.alloc(188)
    bytes[0] = 0x47
    Buffer.from([0, 0, 1, 0x67, profile, constraints, level]).copy(bytes, 24)
    return bytes
  }
  const fetcher = async (url, options) => {
    if (url === 'https://gql.twitch.tv/gql') return Response.json({ data: { video: {
      seekPreviewsURL: 'https://example.cloudfront.net/archive-key/storyboards/1.jpg'
    } } })
    if (url.endsWith('/chunked/index-dvr.m3u8') || url.endsWith('/480p30/index-dvr.m3u8')) {
      return new Response('#EXTM3U\n#EXTINF:10,\nsegment-1.ts\n')
    }
    if (url.endsWith('/chunked/segment-1.ts')) {
      assert.equal(options.headers.Range, 'bytes=0-65535')
      return new Response(segment(0x64, 0, 0x28))
    }
    if (url.endsWith('/480p30/segment-1.ts')) {
      assert.equal(options.headers.Range, 'bytes=0-65535')
      return new Response(segment(0x4d, 0x40, 0x1f))
    }
    return new Response('', { status: 404 })
  }

  const result = await fetchTwitchSubOnlyVod('12345', fetcher)
  assert.match(result.playlist, /CODECS="avc1\.640028,mp4a\.40\.2"/)
  assert.match(result.playlist, /CODECS="avc1\.4D401F,mp4a\.40\.2"/)
})

test('keeps a Twitch VOD quality playable when its first segment is muted', async () => {
  const requests = []
  const segment = Buffer.alloc(188)
  segment[0] = 0x47
  Buffer.from([0, 0, 1, 0x67, 0x64, 0, 0x28]).copy(segment, 24)
  const fetcher = async url => {
    requests.push(url)
    if (url === 'https://gql.twitch.tv/gql') return Response.json({ data: { video: {
      seekPreviewsURL: 'https://example.cloudfront.net/archive-key/storyboards/1.jpg'
    } } })
    if (url.endsWith('/720p60/index-dvr.m3u8')) {
      return new Response('#EXTM3U\n#EXTINF:10,\n0-unmuted.ts\n')
    }
    if (url.endsWith('/720p60/0-muted.ts')) return new Response(segment)
    return new Response('', { status: 403 })
  }

  const result = await fetchTwitchSubOnlyVod('12345', fetcher)
  assert.match(result.playlist, /CODECS="avc1\.640028,mp4a\.40\.2"/)
  assert.match(result.playlist, /\/720p60\/index-dvr\.m3u8/)
  assert.ok(requests.includes('https://example.cloudfront.net/archive-key/720p60/0-muted.ts'))
  assert.ok(!requests.some(url => url.endsWith('0-unmuted.ts')))
})

test('muted segment probing preserves directory names and signed query strings', async () => {
  const requests = []
  const segment = Buffer.alloc(188)
  Buffer.from([0, 0, 1, 0x67, 0x64, 0, 0x28]).copy(segment, 24)
  const expectedUrl = 'https://example.cloudfront.net/archive-key/720p60/parts-unmuted/0-muted.ts?token=keep-unmuted'
  const fetcher = async url => {
    requests.push(url)
    if (url === 'https://gql.twitch.tv/gql') return Response.json({ data: { video: {
      seekPreviewsURL: 'https://example.cloudfront.net/archive-key/storyboards/1.jpg'
    } } })
    if (url.endsWith('/720p60/index-dvr.m3u8')) {
      return new Response('#EXTM3U\n#EXTINF:10,\nparts-unmuted/0-unmuted.ts?token=keep-unmuted\n')
    }
    if (url === expectedUrl) return new Response(segment)
    return new Response('', { status: 403 })
  }

  const result = await fetchTwitchSubOnlyVod('12345', fetcher)
  assert.match(result.playlist, /CODECS="avc1\.640028,mp4a\.40\.2"/)
  assert.ok(requests.includes(expectedUrl))
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
