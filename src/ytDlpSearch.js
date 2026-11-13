const SEARCH_PAGE_SIZE = 20
const MAX_SEARCH_PAGES = 100

export function buildYtDlpSearchArguments(query, params = '', page = 1) {
  if (typeof query !== 'string' || !query.trim() || query.length > 100 ||
    typeof params !== 'string' || params.length > 2048 ||
    !Number.isInteger(page) || page < 1 || page > MAX_SEARCH_PAGES) {
    throw new Error('Invalid search request')
  }
  const url = new URL('https://www.youtube.com/results')
  url.searchParams.set('search_query', query)
  // YouTube.js already URI-encodes the protobuf filter value.
  if (params) url.searchParams.set('sp', decodeURIComponent(params))
  return [
    '--ignore-config', '--flat-playlist', '--dump-single-json',
    '--playlist-start', String((page - 1) * SEARCH_PAGE_SIZE + 1),
    '--playlist-end', String(page * SEARCH_PAGE_SIZE),
    '--no-warnings', '--no-progress', '--socket-timeout', '15',
    '--', url.toString()
  ]
}

export function normalizeYtDlpSearchResults(info, page = 1) {
  if (!Array.isArray(info?.entries)) throw new Error('Invalid search response')
  const results = info.entries.flatMap(entry => {
    if (!entry || typeof entry.title !== 'string' || !entry.title.trim()) return []
    const thumbnail = entry.thumbnails?.find(item => typeof item.url === 'string')?.url ?? ''
    if (/^UC[\w-]{22}$/.test(entry.id)) {
      // The Invidious card rewrites YouTube image URLs to its instance. Cookie
      // search uses YouTube directly, just like the other local channel results.
      return [{ type: 'channel', dataSource: 'local', id: entry.id, name: entry.title, thumbnail: thumbnail.replace(/^\/\//, 'https://'), subscribers: entry.channel_follower_count ?? 0 }]
    }
    if (entry.ie_key === 'YoutubeTab' && /^[\w-]+$/.test(entry.id)) {
      return [{ type: 'playlist', dataSource: 'local', playlistId: entry.id, title: entry.title, channelName: entry.channel ?? entry.uploader ?? '', channelId: entry.channel_id ?? '', thumbnail, videoCount: entry.playlist_count ?? undefined }]
    }
    if (!/^[\w-]{11}$/.test(entry.id)) return []
    return [{
      type: 'video',
      videoId: entry.id,
      title: entry.title,
      author: entry.channel ?? entry.uploader ?? '',
      authorId: entry.channel_id ?? '',
      videoThumbnails: entry.thumbnails ?? [],
      viewCount: entry.view_count ?? 0,
      lengthSeconds: entry.duration ?? '',
      liveNow: entry.live_status === 'is_live',
      isUpcoming: entry.live_status === 'is_upcoming',
      isShort: typeof entry.url === 'string' && entry.url.includes('/shorts/'),
      ...(Number.isFinite(entry.timestamp) ? { published: entry.timestamp * 1000 } : {})
    }]
  })
  return { results, hasMoreResults: page < MAX_SEARCH_PAGES && info.entries.length >= SEARCH_PAGE_SIZE }
}

export async function completeYtDlpSearchPlaylists(results, loadPlaylist) {
  const completed = results.slice()
  const controller = new AbortController()
  // Optional metadata gets a shared budget, including time spent queued.
  const timeout = setTimeout(() => controller.abort(), 10_000)
  let nextIndex = 0
  async function worker() {
    while (!controller.signal.aborted && nextIndex < results.length) {
      const index = nextIndex++
      const result = results[index]
      if (result.type !== 'playlist' || (result.videoCount != null && result.thumbnail)) continue
      try {
        const info = await loadPlaylist(result.playlistId, controller.signal)
        if (controller.signal.aborted) return
        completed[index] = {
          ...result,
          videoCount: info.playlist_count ?? result.videoCount,
          thumbnail: result.thumbnail || info.thumbnails?.find(item => typeof item.url === 'string')?.url || ''
        }
      } catch {
        // A single unavailable playlist must not discard the search results.
      }
    }
  }
  try {
    await Promise.all([worker(), worker()])
    return completed
  } finally {
    clearTimeout(timeout)
  }
}
