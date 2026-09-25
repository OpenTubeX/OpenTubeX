import { CHANNEL_HANDLE_REGEX } from './feed-metadata.js'

/**
 * @typedef {object} YoutubeUrlInfoOptions
 * @property {(url: string) => { videoId: string | null, timestamp: string | number | null, playlistId: string | null, commentId: string | null, isShort: boolean }} getVideoParamsFromUrl
 * @property {(id: string) => boolean} checkYoutubeChannelId
 * @property {{ prioritize: string, time: string, type: string, duration: string, features: string[] } | undefined} searchSettings
 * @property {string} backendPreference
 * @property {boolean} hideChannelHome
 * @property {boolean} supportsLocalApi
 */

/**
 * @typedef {
 *   | { urlType: 'video', videoId: string, playlistId: string | null, timestamp: string | number | null, commentId: string | null, isShort: boolean }
 *   | { urlType: 'playlist', playlistId: string, query?: Record<string, string> }
 *   | { urlType: 'search', searchQuery: string, query: Record<string, unknown> }
 *   | { urlType: 'hashtag', hashtag: string }
 *   | { urlType: 'post', postId: string, query: { authorId: string | null } }
 *   | { urlType: 'channel', channelId: string, subPath: string, url: string }
 *   | { urlType: 'userplaylists' | 'trending' | 'subscriptions' | 'history' | 'unknown' | 'invalid_url' }
 * } YoutubeUrlInfo
 */

/**
 * @param {string} urlStr
 * @param {YoutubeUrlInfoOptions} options
 * @returns {YoutubeUrlInfo}
 */
export function parseYoutubeUrlInfo(urlStr, {
  getVideoParamsFromUrl, checkYoutubeChannelId, searchSettings,
  backendPreference, hideChannelHome, supportsLocalApi
}) {
  if (CHANNEL_HANDLE_REGEX.test(urlStr)) {
    urlStr = `https://www.youtube.com/${urlStr}`
  }

  const { videoId, timestamp, playlistId, commentId, isShort } = getVideoParamsFromUrl(urlStr)
  if (videoId) {
    return {
      urlType: 'video',
      videoId,
      playlistId,
      timestamp,
      commentId,
      isShort
    }
  }

  let url
  try {
    url = new URL(urlStr)
  } catch {
    return {
      urlType: 'invalid_url'
    }
  }
  let urlType = 'unknown'

  const channelPattern =
    /^\/(?:(?:channel|user|c)\/)?(?<channelId>[^/]+)(?:\/(?<tab>join|featured|videos|shorts|live|streams|podcasts|releases|courses|playlists|about|community|channels))?\/?$/

  const hashtagPattern = /^\/hashtag\/(?<tag>[^#&/?]+)$/
  const postPattern = /^\/post\/(?<postId>.+)/
  const showPattern = /^\/show\/VL(?<playlistId>.+)/
  const feedPattern = /^\/feed\/(?<type>trending|subscriptions|history|playlists|you|library)/
  const typePatterns = new Map([
    ['playlist', /^(\/playlist\/?|\/embed(\/?videoseries)?)$/],
    ['show', showPattern],
    ['search', /^\/results|search\/?$/],
    ['hashtag', hashtagPattern],
    ['post', postPattern],
    ['feed', feedPattern],
    ['channel', channelPattern]
  ])

  for (const [type, pattern] of typePatterns) {
    const matchFound = pattern.test(url.pathname)
    if (matchFound) {
      urlType = type
      break
    }
  }

  switch (urlType) {
    case 'playlist': {
      if (!url.searchParams.has('list')) {
        return { urlType: 'unknown' }
      }

      const playlistId = url.searchParams.get('list')
      url.searchParams.delete('list')

      const query = {}
      for (const [param, value] of url.searchParams) {
        query[param] = value
      }

      return {
        urlType: 'playlist',
        playlistId,
        query
      }
    }

    case 'show': {
      const match = url.pathname.match(showPattern)
      return {
        urlType: 'playlist',
        playlistId: match.groups.playlistId
      }
    }

    case 'search': {
      let searchQuery = null
      if (url.searchParams.has('search_query')) {
        // https://www.youtube.com/results?search_query={QUERY}
        searchQuery = url.searchParams.get('search_query')
        url.searchParams.delete('search_query')
      }
      if (url.searchParams.has('q')) {
        // https://redirect.invidious.io/search?q={QUERY}
        searchQuery = url.searchParams.get('q')
        url.searchParams.delete('q')
      }
      if (searchQuery == null) {
        return { urlType: 'unknown' }
      }

      const query = {
        prioritize: searchSettings.prioritize,
        time: searchSettings.time,
        type: searchSettings.type,
        duration: searchSettings.duration,
        features: searchSettings.features
      }

      for (const [param, value] of url.searchParams) {
        query[param] = value
      }

      return {
        urlType: 'search',
        searchQuery,
        query
      }
    }

    case 'hashtag': {
      const match = url.pathname.match(hashtagPattern)
      const hashtag = match.groups.tag

      return {
        urlType: 'hashtag',
        hashtag
      }
    }

    case 'post': {
      const match = url.pathname.match(postPattern)
      const postId = match.groups.postId
      const query = { authorId: url.searchParams.get('ucid') }
      return {
        urlType: 'post',
        postId,
        query
      }
    }
    /*
    Using RegExp named capture groups from ES2018
    To avoid access to specific captured value broken

    Channel URL (ID-based)
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/about
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/channels
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/community
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/featured
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/join
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/playlists
    https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/videos

    Custom URL

    https://www.youtube.com/c/YouTubeCreators
    https://www.youtube.com/c/YouTubeCreators/about
    etc.

    Legacy Username URL

    https://www.youtube.com/user/ufoludek
    https://www.youtube.com/user/ufoludek/about
    etc.

    */
    case 'channel': {
      const match = url.pathname.match(channelPattern)
      const rawChannelId = match.groups.channelId
      let channelId = rawChannelId
      if (rawChannelId.startsWith('@') && checkYoutubeChannelId(rawChannelId.slice(1))) {
        channelId = rawChannelId.slice(1)
      }
      if (!channelId) {
        return { urlType: 'unknown' }
      }

      let channelUrlPath = url.pathname
      if (channelId !== rawChannelId) {
        channelUrlPath = `/channel/${channelId}${match.groups.tab ? `/${match.groups.tab}` : ''}`
      }

      let subPath
      switch (match.groups.tab) {
        case 'shorts':
          subPath = 'shorts'
          break
        case 'live':
        case 'streams':
          subPath = 'live'
          break
        case 'playlists':
          subPath = 'playlists'
          break
        case 'podcasts':
          subPath = 'podcasts'
          break
        case 'courses':
          subPath = 'courses'
          break
        case 'releases':
          subPath = 'releases'
          break
        case 'channels':
        case 'about':
          subPath = 'about'
          break
        case 'community':
          if (url.searchParams.has('lb')) {
            // if it has the lb search parameter then it is linking a specific community post
            const postId = url.searchParams.get('lb')
            const query = { authorId: channelId }
            return {
              urlType: 'post',
              postId,
              query
            }
          }
          subPath = 'community'
          break
        case 'videos':
          subPath = 'videos'
          break
        default:
          subPath = backendPreference === 'local' && !hideChannelHome ? 'home' : 'videos'
          break
      }
      return {
        urlType: 'channel',
        channelId,
        subPath,
        // The original URL could be from Invidious.
        // We need to make sure it starts with youtube.com, so that YouTube's resolve endpoint can recognise it
        url: `https://www.youtube.com${channelUrlPath}`
      }
    }
    case 'feed': {
      /** @type {'trending' | 'subscriptions' | 'history' | 'playlists' | 'you' | 'library'} */
      const feedType = url.pathname.match(feedPattern).groups.type

      if (feedType === 'playlists' || feedType === 'you' || feedType === 'library') {
        return { urlType: 'userplaylists' }
      } else if (supportsLocalApi || feedType !== 'trending') {
        return { urlType: feedType }
      }
      // Can fall through if a trending URL is detected in a build without the local API
    }

    default: {
      // Unknown URL type
      return {
        urlType: 'unknown'
      }
    }
  }
}
