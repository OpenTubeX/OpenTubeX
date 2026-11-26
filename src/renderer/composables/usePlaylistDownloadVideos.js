import { ref, shallowRef } from 'vue'

import store from '../store/index'
import { usesInvidiousApi } from '../../apiBackends'
import { getLocalPlaylist, getLocalPlaylistContinuation, parseLocalPlaylistPage } from '../helpers/api/local'
import { invidiousGetPlaylistInfo } from '../helpers/api/invidious'
import { hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos } from '../helpers/api/invidious-playlists'

/**
 * @typedef {{ videos: object[], next: (() => Promise<PlaylistPage>) | null }} PlaylistPage
 */

/**
 * @param {() => Promise<import('youtubei.js').YT.Playlist | null>} request
 * @param {number} offset the number of playlist entries before this page
 * @returns {Promise<PlaylistPage>}
 */
async function getLocalPage(request, offset) {
  const playlist = await request()
  if (playlist == null) return { videos: [], next: null }
  return {
    videos: parseLocalPlaylistPage(playlist.items, offset),
    next: playlist.has_continuation
      ? () => getLocalPage(() => getLocalPlaylistContinuation(playlist), offset + playlist.items.length)
      : null
  }
}

/**
 * Invidious pages overlap, so each later page adds only the videos not seen yet.
 * @param {string} playlistId
 * @param {number} pageNumber
 * @param {object[]} loaded every video the instance returned so far
 * @param {number} [videoCount]
 * @returns {Promise<PlaylistPage>}
 */
async function getInvidiousPage(playlistId, pageNumber, loaded, videoCount) {
  const result = await invidiousGetPlaylistInfo(playlistId, pageNumber === 1 ? undefined : pageNumber)
  videoCount ??= result.videoCount
  const merged = mergeInvidiousPlaylistVideos(loaded, result.videos)
  return {
    videos: merged.slice(loaded.length),
    next: hasMoreInvidiousPlaylistPages(videoCount, pageNumber, merged.length, result.pageVideoCount)
      ? () => getInvidiousPage(playlistId, pageNumber + 1, merged, videoCount)
      : null
  }
}

/**
 * Loads a YouTube playlist's videos for the download prompt's video selection outside the
 * Playlist page: the first page when the prompt opens, the remaining pages once the user
 * opens the selection.
 */
export function usePlaylistDownloadVideos() {
  const videos = shallowRef([])
  const moreVideosAvailable = ref(false)
  const videosLoading = ref(false)
  /** @type {(() => Promise<PlaylistPage>) | null} */
  let nextPage = null
  let generation = 0

  function reset() {
    generation++
    videos.value = []
    moreVideosAvailable.value = false
    videosLoading.value = false
    nextPage = null
  }

  /** @param {PlaylistPage} page */
  function applyPage(page) {
    videos.value = videos.value.concat(page.videos)
    nextPage = page.next
    moreVideosAvailable.value = nextPage !== null
  }

  /** @param {string} playlistId */
  async function loadFirstPage(playlistId) {
    reset()
    const requestGeneration = generation
    const local = () => getLocalPage(() => getLocalPlaylist(playlistId), 0)
    const invidious = () => getInvidiousPage(playlistId, 1, [])
    const preferInvidious = !process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(store.getters.getBackendPreference)
    const requests = preferInvidious ? [invidious, local] : [local, invidious]
    if (!process.env.SUPPORTS_LOCAL_API || !store.getters.getBackendFallback) requests.length = 1

    let loaded = false
    for (const request of requests) {
      try {
        let page = await request()
        if (requestGeneration !== generation) return
        applyPage(page)
        loaded = true
        // The prompt shows the selection for two or more videos, so cross pages
        // whose entries are all unavailable
        while (videos.value.length < 2 && nextPage !== null) {
          page = await nextPage()
          if (requestGeneration !== generation) return
          applyPage(page)
        }
        return
      } catch (error) {
        console.error(error)
        // A later page failing keeps the videos loaded so far
        if (loaded || requestGeneration !== generation) return
      }
    }
  }

  async function loadRemainingPages() {
    if (videosLoading.value || nextPage === null) return
    const requestGeneration = generation
    videosLoading.value = true
    try {
      while (nextPage !== null) {
        const page = await nextPage()
        if (requestGeneration !== generation) return
        applyPage(page)
      }
    } catch (error) {
      console.error(error)
    } finally {
      if (requestGeneration === generation) videosLoading.value = false
    }
  }

  return { videos, moreVideosAvailable, videosLoading, loadFirstPage, loadRemainingPages, reset }
}
