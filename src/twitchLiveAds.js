import { queryTwitch } from './twitchSubOnlyVod.js'

// Twitch inserts its ads into the playlists of its website's player, which
// yt-dlp requests. The playlists of these players usually have none.
const AD_FREE_PLAYER_TYPES = ['embed', 'popout', 'mobile_web']

const AD_MARKER = /CLASS="twitch-(?:stitched-)?ad"|\bstitched-ad-|X-TV-TWITCH-AD|#EXT-X-(?:CUE-OUT|SCTE35-OUT)\b/

/**
 * Twitch titles the segments of the stream `live`, and its ads by their advertiser.
 * @param {string} line
 */
function isAdSegmentInfo(line) {
  const comma = line.indexOf(',')
  if (!line.startsWith('#EXTINF:') || comma === -1) return false
  const title = line.slice(comma + 1).trim()
  return title !== '' && title !== 'live'
}

/**
 * @param {string} playlist an HLS media playlist
 */
export function hasTwitchAd(playlist) {
  return AD_MARKER.test(playlist) || playlist.split('\n').some(isAdSegmentInfo)
}

/**
 * Removes the ads that follow the last segment of the stream, which is how an
 * ad break begins, so the player never loads them before it switches to an
 * ad-free playlist. Playlists without segments of the stream stay unchanged,
 * as the player cannot start on an empty playlist.
 * @param {string} playlist an HLS media playlist
 */
export function stripTrailingTwitchAds(playlist) {
  const lines = playlist.split('\n')
  let lastLiveUri = -1
  let isAd = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (line.startsWith('#EXTINF:')) isAd = isAdSegmentInfo(line)
    else if (line !== '' && !line.startsWith('#')) {
      if (!isAd) lastLiveUri = index
      isAd = false
    }
  }
  if (lastLiveUri === -1) return playlist
  return `${lines.slice(0, lastLiveUri + 1).join('\n')}\n`
}

/**
 * @param {string} login
 * @param {string} playerType
 * @param {(url: string, options?: object) => Promise<Response>} fetcher
 * @returns {Promise<{ playlist: string, hasAds: boolean } | null>} the master playlist
 */
async function fetchLivePlaylist(login, playerType, fetcher) {
  const token = (await queryTwitch(
    `query { streamPlaybackAccessToken(channelName: "${login}", params: { platform: "web", playerBackend: "mediaplayer", playerType: "${playerType}" }) { value signature } }`,
    fetcher
  ))?.streamPlaybackAccessToken
  if (typeof token?.value !== 'string' || typeof token.signature !== 'string') return null

  // The parameters yt-dlp requests, so the qualities stay the same
  const url = new URL(`https://usher.ttvnw.net/api/channel/hls/${login.toLowerCase()}.m3u8`)
  url.search = new URLSearchParams({
    allow_source: 'true',
    allow_audio_only: 'true',
    allow_spectre: 'true',
    p: String(Math.floor(1_000_000 + Math.random() * 9_000_000)),
    platform: 'web',
    player: 'twitchweb',
    supported_codecs: 'av1,h265,h264',
    playlist_include_framerate: 'true',
    sig: token.signature,
    token: token.value
  }).toString()
  const master = await fetcher(url.href, { signal: AbortSignal.timeout(5000) })
  if (!master.ok) return null
  const playlist = await master.text()
  if (!playlist.startsWith('#EXTM3U')) return null

  // Ads apply to the whole session, so one of its playlists shows whether it has any
  const variant = playlist.split('\n').map(line => line.trim()).find(line => line !== '' && !line.startsWith('#'))
  if (!variant || new URL(variant).protocol !== 'https:') return null
  const media = await fetcher(variant, { signal: AbortSignal.timeout(5000) })
  if (!media.ok) return null
  const mediaPlaylist = await media.text()
  return mediaPlaylist.startsWith('#EXTM3U') ? { playlist, hasAds: hasTwitchAd(mediaPlaylist) } : null
}

/**
 * Twitch decides about ads per playlist session, so this returns the master
 * playlist it checked, rather than a URL that would start a new session.
 * @param {string} login
 * @param {(url: string, options?: object) => Promise<Response>} fetcher
 * @param {boolean} allowAds whether to return a playlist with ads when every player's playlists have them
 * @returns {Promise<string | null>} null when no playlist qualifies, or the channel is offline
 */
export async function fetchTwitchAdFreeLivePlaylist(login, fetcher, allowAds = false) {
  if (typeof login !== 'string' || !/^[a-zA-Z0-9_]{1,25}$/.test(login)) return null
  const playlists = (await Promise.all(AD_FREE_PLAYER_TYPES.map(playerType =>
    fetchLivePlaylist(login, playerType, fetcher).catch(() => null)
  ))).filter(result => result !== null && (allowAds || !result.hasAds))
  return (playlists.find(result => !result.hasAds) ?? playlists[0])?.playlist ?? null
}
