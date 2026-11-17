import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchTwitchAdFreeLivePlaylist, hasTwitchAd, stripTrailingTwitchAds } from '../../src/twitchLiveAds.js'

const HEADER = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:40\n'
const AD_RANGE = '#EXT-X-DATERANGE:ID="stitched-ad-1-30",CLASS="twitch-stitched-ad",START-DATE="2026-01-01T00:00:08.000Z",DURATION=30.000,X-TV-TWITCH-AD-ROLL-TYPE="MIDROLL"\n'
const live = index => `#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:0${index * 2}.000Z\n#EXTINF:2.000,live\nhttps://segments.example.test/live-${index}.mp4\n`
const ad = index => `#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:0${index * 2}.000Z\n#EXTINF:2.000,Advertiser|1234\nhttps://segments.example.test/ad-${index}.mp4\n`

test('finds Twitch ads by their date ranges and segment titles', () => {
  assert.equal(hasTwitchAd(HEADER + live(0) + live(1)), false)
  assert.equal(hasTwitchAd(HEADER + AD_RANGE + live(0) + live(1)), true)
  assert.equal(hasTwitchAd(HEADER + live(0) + ad(1)), true)
  // Recordings of broadcasts leave their segments untitled
  assert.equal(hasTwitchAd(`${HEADER}#EXTINF:10.000,\n0.ts\n#EXTINF:10.000\n1.ts\n`), false)
})

test('removes only the ads that follow the last segment of the stream', () => {
  const discontinuity = '#EXT-X-DISCONTINUITY\n#EXT-X-MAP:URI="https://segments.example.test/ad-init.mp4"\n'
  assert.equal(
    stripTrailingTwitchAds(HEADER + AD_RANGE + live(0) + live(1) + discontinuity + ad(2) + ad(3)),
    HEADER + AD_RANGE + live(0) + live(1)
  )
  // The player cannot start on a playlist without segments
  const preroll = HEADER + AD_RANGE + discontinuity + ad(0) + ad(1)
  assert.equal(stripTrailingTwitchAds(preroll), preroll)
  // At the end of a break, the stream's segments follow the ads
  const ending = HEADER + AD_RANGE + ad(0) + '#EXT-X-DISCONTINUITY\n' + live(1)
  assert.equal(stripTrailingTwitchAds(ending), ending)
})

test('returns the master playlist of the first player whose session has no ads', async () => {
  const masters = {
    embed: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\nhttps://euc1.playlist.ttvnw.net/v1/playlist/embed.m3u8\n',
    popout: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\nhttps://euc2.playlist.ttvnw.net/v1/playlist/popout.m3u8\n',
    mobile_web: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\nhttps://euc3.playlist.ttvnw.net/v1/playlist/mobile_web.m3u8\n'
  }
  const tokens = new Map()
  const fetcher = async (url, options) => {
    if (url === 'https://gql.twitch.tv/gql') {
      const playerType = /playerType: "(\w+)"/.exec(JSON.parse(options.body).query)[1]
      return Response.json({ data: { streamPlaybackAccessToken: { value: `token-${playerType}`, signature: `signature-${playerType}` } } })
    }
    const parsed = new URL(url)
    if (parsed.hostname === 'usher.ttvnw.net') {
      assert.equal(parsed.pathname, '/api/channel/hls/examplechannel.m3u8')
      const playerType = parsed.searchParams.get('token').slice('token-'.length)
      tokens.set(playerType, parsed.searchParams.get('sig'))
      return new Response(masters[playerType])
    }
    // The website's other players still have ads, so the popout player wins
    if (url.endsWith('/popout.m3u8')) return new Response(HEADER + live(0) + live(1))
    return new Response(HEADER + AD_RANGE + live(0) + ad(1))
  }

  assert.equal(await fetchTwitchAdFreeLivePlaylist('ExampleChannel', fetcher), masters.popout)
  assert.equal(tokens.get('popout'), 'signature-popout')
})

test('returns no playlist when every player has ads, unless ads are allowed, or the channel is invalid', async () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://euc1.playlist.ttvnw.net/v1/playlist/session.m3u8\n'
  const requests = []
  const fetcher = async (url) => {
    requests.push(url)
    if (url === 'https://gql.twitch.tv/gql') {
      return Response.json({ data: { streamPlaybackAccessToken: { value: 'token', signature: 'signature' } } })
    }
    if (url.startsWith('https://usher.ttvnw.net/')) return new Response(master)
    return new Response(HEADER + AD_RANGE + ad(0))
  }

  assert.equal(await fetchTwitchAdFreeLivePlaylist('examplechannel', fetcher), null)
  // iOS cannot fall back to yt-dlp's playlists
  assert.equal(await fetchTwitchAdFreeLivePlaylist('examplechannel', fetcher, true), master)
  requests.length = 0
  assert.equal(await fetchTwitchAdFreeLivePlaylist('example") { id } #', fetcher), null)
  assert.deepEqual(requests, [])
})
