import { reactive } from 'vue'

import store from '../store'
import { usesInvidiousApi } from '../../apiBackends'
import { getLocalPlaylist, getLocalPlaylistChannelName, parseLocalPlaylistVideos } from './api/local'
import { invidiousGetPlaylistInfo, youtubeImageUrlToInvidious } from './api/invidious'
import { mapConcurrently } from './concurrent-map'
import { extractNumberFromString } from './feed-metadata'
import { isValidPlaylistBookmark, parseLocalPlaylistLastUpdated, updatePlaylistBookmarkMetadata } from './playlist-bookmarks'

const REFRESH_CONCURRENCY = 3

// Shared by every Playlists tab, so only one refresh runs at a time.
export const playlistBookmarkRefreshState = reactive({ running: false })
let refreshController = null

function firstVideoThumbnail(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null
}

// Reads the same metadata as the playlist page, so opening a playlist after
// a refresh does not change it again.
async function getLocalMetadata(playlistId, signal) {
  const { info, items } = await getLocalPlaylist(playlistId, signal)
  return {
    title: info.title,
    description: info.description ?? '',
    thumbnailUrl: info.thumbnails[0]?.url || firstVideoThumbnail(parseLocalPlaylistVideos(items)[0]?.videoId),
    videoCount: extractNumberFromString(info.total_items),
    uploaderId: info.author?.id || playlistId,
    uploaderName: getLocalPlaylistChannelName(info) || info.title,
    uploaderAvatar: info.author?.best_thumbnail?.url ?? null,
    updatedAt: parseLocalPlaylistLastUpdated(info.last_updated),
  }
}

async function getInvidiousMetadata(playlistId) {
  const result = await invidiousGetPlaylistInfo(playlistId)
  return {
    title: result.title,
    description: result.description,
    thumbnailUrl: firstVideoThumbnail(result.videos[0]?.videoId),
    videoCount: result.videoCount,
    uploaderId: result.authorId || playlistId,
    uploaderName: result.author || result.title,
    uploaderAvatar: youtubeImageUrlToInvidious(result.authorThumbnails?.at(-1)?.url ?? null),
    updatedAt: result.updated == null ? null : result.updated * 1000,
  }
}

async function getPlaylistMetadata(playlistId, signal) {
  const useInvidious = !process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(store.getters.getBackendPreference)
  const fallback = process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback
  const [primary, secondary] = useInvidious
    ? [() => getInvidiousMetadata(playlistId), () => getLocalMetadata(playlistId, signal)]
    : [() => getLocalMetadata(playlistId, signal), () => getInvidiousMetadata(playlistId)]

  try {
    return await primary()
  } catch (error) {
    if (!fallback || signal.aborted) throw error
    console.warn(`Refreshing saved playlist ${playlistId} with the fallback backend`, error)
    return await secondary()
  }
}

/**
 * Reloads the metadata of every saved playlist, including when its channel
 * last updated it, which the "last updated" sort orders by.
 * @returns {Promise<{ failed: number } | null>} null when cancelled or already running
 */
export async function refreshPlaylistBookmarks() {
  if (playlistBookmarkRefreshState.running) return null

  const controller = new AbortController()
  refreshController = controller
  playlistBookmarkRefreshState.running = true
  const { signal } = controller

  try {
    const bookmarks = store.getters.getPlaylistBookmarks.filter(isValidPlaylistBookmark)
    let failed = 0
    const results = await mapConcurrently(bookmarks, REFRESH_CONCURRENCY, async ({ playlist }) => {
      if (signal.aborted) return null
      try {
        return [playlist.id, await getPlaylistMetadata(playlist.id, signal)]
      } catch (error) {
        if (!signal.aborted) {
          console.error(`Could not refresh saved playlist ${playlist.id}`, error)
          failed++
        }
        return null
      }
    })

    // A cancelled run saves nothing, so its late responses cannot overwrite
    // the results of a newer refresh.
    if (signal.aborted) return null

    // Applying the results to the saved list keeps bookmarks that were saved
    // or removed in the meantime.
    const metadataById = new Map(results.filter(result => result !== null))
    if (metadataById.size > 0) {
      const saved = await store.dispatch('updatePlaylistBookmarks', savedBookmarks => savedBookmarks.map(bookmark => {
        const metadata = isValidPlaylistBookmark(bookmark) ? metadataById.get(bookmark.playlist.id) : undefined
        return metadata ? updatePlaylistBookmarkMetadata(bookmark, metadata) : bookmark
      }))
      if (!saved) failed += metadataById.size
    }

    return { failed }
  } finally {
    if (refreshController === controller) {
      refreshController = null
      playlistBookmarkRefreshState.running = false
    }
  }
}

export function cancelPlaylistBookmarkRefresh() {
  if (refreshController === null) return
  refreshController.abort()
  // Let a new refresh start right away. The cancelled run discards its
  // results once its requests settle.
  refreshController = null
  playlistBookmarkRefreshState.running = false
}
