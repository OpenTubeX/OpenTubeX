/**
 * How many playlists each video id appears in.
 *
 * Every list item asks "is this video saved anywhere?", so deriving the answer
 * by walking all playlists made a single playlist edit rescan every video the
 * user has ever saved and re-render every visible card. The map is kept up to
 * date by the playlist mutations instead, and `has()` on a reactive map only
 * subscribes to the one video id that was looked up.
 *
 * Counts rather than a plain set, because the same video can be in several
 * playlists and removing it from one must not forget the others.
 *
 * @typedef {Map<string, number>} PlaylistVideoCounts
 */

/**
 * @param {PlaylistVideoCounts} counts
 * @param {{ videoId?: string }[] | null | undefined} videos
 */
export function incrementPlaylistVideoCounts(counts, videos) {
  if (!Array.isArray(videos)) {
    return
  }

  for (const { videoId } of videos) {
    if (videoId == null) {
      continue
    }

    counts.set(videoId, (counts.get(videoId) ?? 0) + 1)
  }
}

/**
 * @param {PlaylistVideoCounts} counts
 * @param {{ videoId?: string }[] | null | undefined} videos
 */
export function decrementPlaylistVideoCounts(counts, videos) {
  if (!Array.isArray(videos)) {
    return
  }

  for (const { videoId } of videos) {
    const count = counts.get(videoId)

    if (count === undefined) {
      continue
    }

    if (count > 1) {
      counts.set(videoId, count - 1)
    } else {
      counts.delete(videoId)
    }
  }
}

/**
 * Rebuilds the counts in place, so the map identity that consumers already
 * track survives a bulk replacement of the playlists.
 *
 * @param {PlaylistVideoCounts} counts
 * @param {{ videos?: { videoId?: string }[] }[] | null | undefined} playlists
 */
export function resetPlaylistVideoCounts(counts, playlists) {
  counts.clear()

  if (!Array.isArray(playlists)) {
    return
  }

  for (const playlist of playlists) {
    incrementPlaylistVideoCounts(counts, playlist.videos)
  }
}
