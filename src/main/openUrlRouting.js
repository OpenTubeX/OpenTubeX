/**
 * Convert supported external URLs into native app routes for protocol opens.
 * @param {{rootAppUrl: string, isTrustedUrl: (url: URL) => boolean}} dependencies
 * @returns {(url: string | null | undefined) => string | null}
 */
export function createOpenUrlRouter({ rootAppUrl, isTrustedUrl }) {
  /**
   * @param {string | null | undefined} url
   * @returns {string | null}
   */
  function getDirectOpenUrl(url) {
    if (typeof url !== 'string' || url.trim().length === 0) {
      return null
    }

    const parsed = URL.parse(url)
    if (!parsed) {
      return null
    }

    if (isTrustedUrl(parsed)) {
      return url
    }

    const videoParams = getDirectVideoParams(parsed)
    if (videoParams.videoId) {
      return createAppRouteUrl(`/watch/${videoParams.videoId}`, {
        timestamp: videoParams.timestamp,
        playlistId: videoParams.playlistId,
        commentId: videoParams.commentId,
        short: videoParams.isShort ? 'true' : null
      })
    }

    const playlistId = getDirectPlaylistId(parsed)
    if (playlistId) {
      return createAppRouteUrl(`/playlist/${encodeURIComponent(playlistId)}`, getRemainingUrlQuery(parsed, ['list']))
    }

    const searchQuery = getDirectSearchQuery(parsed)
    if (searchQuery) {
      return createAppRouteUrl(`/search/${encodeURIComponent(searchQuery)}`, getRemainingUrlQuery(parsed, ['q', 'search_query']))
    }

    const hashtag = parsed.pathname.match(/^\/hashtag\/(?<tag>[^#&/?]+)\/?$/)?.groups?.tag
    if (hashtag) {
      return createAppRouteUrl(`/hashtag/${encodeURIComponent(hashtag)}`)
    }

    const postId = parsed.pathname.match(/^\/post\/(?<postId>.+)/)?.groups?.postId
    if (postId) {
      return createAppRouteUrl(`/post/${encodeURIComponent(postId)}`, {
        authorId: parsed.searchParams.get('ucid')
      })
    }

    const feedType = parsed.pathname.match(/^\/feed\/(?<type>trending|subscriptions|history|playlists|you|library)/)?.groups?.type
    if (feedType) {
      return createAppRouteUrl(feedType === 'playlists' || feedType === 'you' || feedType === 'library'
        ? '/userplaylists'
        : `/${feedType}`)
    }

    return null
  }

  /**
   * @param {URL} url
   * @returns {{ videoId: string | null, timestamp: string | null, playlistId: string | null, commentId: string | null, isShort: boolean }}
   */
  function getDirectVideoParams(url) {
    const params = {
      videoId: null,
      timestamp: null,
      playlistId: null,
      commentId: null,
      isShort: false
    }

    const setVideoId = (value) => {
      const videoId = getYoutubeId(value)
      if (videoId) {
        params.videoId = videoId
        params.timestamp = getDirectTimestamp(url)
        params.playlistId = url.searchParams.get('list')
        params.commentId = url.searchParams.get('lc')
      }
    }

    if (url.pathname === '/watch') {
      setVideoId(url.searchParams.get('v'))
    } else if (url.hostname === 'youtu.be') {
      setVideoId(url.pathname.slice(1))
    } else {
      const videoPath = url.pathname.match(/^\/(?:embed|shorts|live)\/(?<videoId>[\w-]+)/)?.groups?.videoId
      params.isShort = url.pathname.startsWith('/shorts/')
      setVideoId(videoPath)
    }

    return params
  }

  /**
   * @param {string | null | undefined} value
   * @returns {string | null}
   */
  function getYoutubeId(value) {
    return typeof value === 'string'
      ? value.match(/^[\w-]{11}/)?.[0] ?? null
      : null
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectTimestamp(url) {
    const timestamp = url.searchParams.get('t')
    if (!timestamp) {
      return null
    }

    const timeParts = timestamp.match(/^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s?)?$/)?.groups
    if (!timeParts || (!timeParts.hours && !timeParts.minutes && !timeParts.seconds)) {
      return timestamp
    }

    return String(
      Number(timeParts.seconds ?? 0) +
      (Number(timeParts.minutes ?? 0) * 60) +
      (Number(timeParts.hours ?? 0) * 3600)
    )
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectPlaylistId(url) {
    if (!/^(\/playlist\/?|\/embed\/videoseries\/?)$/.test(url.pathname)) {
      return null
    }

    return url.searchParams.get('list')
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectSearchQuery(url) {
    if (!/^(\/results|\/search\/?)$/.test(url.pathname)) {
      return null
    }

    return url.searchParams.get('search_query') ?? url.searchParams.get('q')
  }

  /**
   * @param {URL} url
   * @param {string[]} excludedKeys
   * @returns {Record<string, string>}
   */
  function getRemainingUrlQuery(url, excludedKeys) {
    const excluded = new Set(excludedKeys)
    const query = {}

    for (const [key, value] of url.searchParams) {
      if (!excluded.has(key)) {
        query[key] = value
      }
    }

    return query
  }

  /**
   * @param {string} path
   * @param {Record<string, string | number | null | undefined>} [query]
   * @returns {string}
   */
  function createAppRouteUrl(path, query = {}) {
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && String(value).length > 0) {
        searchParams.set(key, String(value))
      }
    }

    const search = searchParams.toString()
    return `${rootAppUrl}#${path}${search.length > 0 ? `?${search}` : ''}`
  }

  return getDirectOpenUrl
}
