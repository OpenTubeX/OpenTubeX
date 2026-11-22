export const CHANNEL_SEARCH_FILTERS = {
  ALL: 'all',
  VIDEOS: 'videos',
  SHORTS: 'shorts',
  LIVE: 'live',
  PLAYLISTS: 'playlists',
}

const YOUTUBE_SHORT_MAX_DURATION_SECONDS = 180

/**
 * @param {{
 *   type: string,
 *   endpoint?: {
 *     name?: string,
 *     metadata?: { url?: string },
 *   },
 *   is_live?: boolean,
 *   is_upcoming?: boolean,
 *   is_premiere?: boolean,
 *   duration?: { seconds?: number },
 * }} item
 * @returns {'videos' | 'shorts' | 'live' | 'playlists'}
 */
export function getLocalChannelSearchResultType(item) {
  if (item.type === 'Playlist') {
    return CHANNEL_SEARCH_FILTERS.PLAYLISTS
  }

  if (item.is_live || item.is_upcoming || item.is_premiere) {
    return CHANNEL_SEARCH_FILTERS.LIVE
  }

  if (item.endpoint?.name === 'reelWatchEndpoint' ||
      item.endpoint?.metadata?.url?.startsWith('/shorts/')) {
    return CHANNEL_SEARCH_FILTERS.SHORTS
  }

  // YouTube also considers aspect ratio and upload date, but channel search
  // does not expose those fields. Duration is the best available fallback.
  if (item.duration?.seconds > 0 &&
      item.duration.seconds <= YOUTUBE_SHORT_MAX_DURATION_SECONDS) {
    return CHANNEL_SEARCH_FILTERS.SHORTS
  }

  return CHANNEL_SEARCH_FILTERS.VIDEOS
}

/**
 * @param {{
 *   type: string,
 *   liveNow?: boolean,
 *   isUpcoming?: boolean,
 *   lengthSeconds?: number,
 * }} item
 * @returns {'videos' | 'shorts' | 'live' | 'playlists'}
 */
export function getInvidiousChannelSearchResultType(item) {
  if (item.type === 'playlist') {
    return CHANNEL_SEARCH_FILTERS.PLAYLISTS
  }

  if (item.liveNow || item.isUpcoming) {
    return CHANNEL_SEARCH_FILTERS.LIVE
  }

  if (item.lengthSeconds > 0 &&
      item.lengthSeconds <= YOUTUBE_SHORT_MAX_DURATION_SECONDS) {
    return CHANNEL_SEARCH_FILTERS.SHORTS
  }

  return CHANNEL_SEARCH_FILTERS.VIDEOS
}

/**
 * @param {{ channelSearchResultType?: string }[]} results
 * @param {string} filter
 */
export function filterChannelSearchResults(results, filter) {
  if (filter === CHANNEL_SEARCH_FILTERS.ALL) {
    return results
  }

  return results.filter(result => result.channelSearchResultType === filter)
}
