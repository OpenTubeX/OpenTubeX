// @ts-check
// The playlist store reports edits of playlists synced from YouTube here.
// YouTube sync, which needs the store itself, listens and sends them to YouTube.

/**
 * @typedef {{ _id: string, playlistName: string, description?: string, youTube?: { playlistId: string, accountKey: string }, videos: { videoId: string, playlistItemId: string, youTubeSetVideoId?: string | null }[] }} SyncedPlaylist
 * @typedef {{ type: 'add', localId: string, videoIds: string[] }
 *   | { type: 'remove', playlist: SyncedPlaylist, videos: SyncedPlaylist['videos'] }
 *   | { type: 'reorder', playlist: SyncedPlaylist, previous: SyncedPlaylist['videos'] }
 *   | { type: 'details', playlist: SyncedPlaylist, playlistName: string | null, description: string | null }
 *   | { type: 'delete', playlist: SyncedPlaylist }} YouTubePlaylistChange
 */

/** @type {((change: YouTubePlaylistChange) => void) | null} */
let listener = null

/** @param {((change: YouTubePlaylistChange) => void) | null} callback */
export function setYouTubePlaylistChangeListener(callback) {
  listener = callback
}

/**
 * Called right after the edit is saved here. The playlist is a copy taken
 * then, or for additions, the ID to look up.
 * @param {YouTubePlaylistChange} change
 */
export function reportYouTubePlaylistChange(change) {
  if (!('playlist' in change) || change.playlist.youTube) listener?.(change)
}
