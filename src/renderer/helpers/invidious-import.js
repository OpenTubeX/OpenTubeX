// Invidious's "Export data as JSON" file holds video IDs only: the watch
// history oldest first, and playlists in their saved order. The imported
// entries use the ID as their title, so the History and Playlists repair
// actions find them and load their metadata.

const VIDEO_ID_PATTERN = /^[\w-]{11}$/

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} data */
export function isInvidiousWatchHistoryExport(data) {
  return isObject(data) && Array.isArray(data.watch_history)
}

/** @param {unknown} data */
export function isInvidiousPlaylistsExport(data) {
  return isInvidiousWatchHistoryExport(data) && Array.isArray(data.playlists)
}

/**
 * @param {{ watch_history: unknown[] }} data
 * @param {number} now
 */
export function convertInvidiousWatchHistory(data, now = Date.now()) {
  const records = new Map()
  let skipped = 0
  const history = data.watch_history
  history.forEach((videoId, index) => {
    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
      skipped++
      return
    }
    // Invidious has no watch times; spacing them keeps the newest last entry on top
    const timeWatched = now - (history.length - 1 - index)
    records.delete(videoId)
    records.set(videoId, {
      videoId,
      title: videoId,
      author: '',
      authorId: '',
      published: 0,
      timeWatched,
      description: '',
      lengthSeconds: null,
      watchProgress: 0,
      isWatched: true,
      isLive: false,
      type: 'video',
    })
  })
  return { records: [...records.values()], skipped }
}

/**
 * @param {{ playlists: unknown[] }} data
 * @param {number} now
 */
export function convertInvidiousPlaylists(data, now = Date.now()) {
  // Invidious only saves titled playlists of valid video IDs, so anything else was edited by hand
  const playlists = []
  for (const playlist of data.playlists) {
    if (!isObject(playlist) || typeof playlist.title !== 'string' || !playlist.title.trim() || !Array.isArray(playlist.videos)) {
      console.warn('Skipping invalid Invidious playlist', playlist)
      continue
    }
    const videoIds = playlist.videos.filter(videoId => typeof videoId === 'string' && VIDEO_ID_PATTERN.test(videoId))
    playlists.push({
      playlistName: playlist.title,
      // An empty description must not replace the one of a saved playlist with this name
      ...(typeof playlist.description === 'string' && playlist.description.trim() ? { description: playlist.description } : {}),
      // Spaced add times keep the saved order when sorting by date added
      videos: videoIds.map((videoId, index) => ({ videoId, title: videoId, lengthSeconds: 0, timeAdded: now - (videoIds.length - 1 - index) })),
    })
  }
  return playlists
}
