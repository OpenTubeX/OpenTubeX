import { reactive } from 'vue'

import store from '../store/index'
import i18n from '../i18n/index'
import { usesInvidiousApi } from '../../apiBackends'
import { getPlaylistSnapshot } from './api/playlist-snapshot'
import { createLocalPlaylistAvailabilityChecker } from './api/local'
import { getInvidiousPlaylistAvailability } from './api/invidious'
import { findDeadPlaylistItems, isUnavailableInvidiousResponse, isUnavailablePlayerResponse } from './playlist-dead-videos'
import { startProgressBarOperation } from './progressBar'
import { isVideoHiddenByPreferences } from './subscriptions'
import { showToast } from './utils'

// Playlist actions that page through YouTube run here instead of in the page
// that started them, so leaving the page does not cancel them. Each one shows
// its progress in a progress toast and reports its result in a toast.

/** Ids of the user playlists that are getting their missing videos added */
export const addingMissingVideos = reactive(new Set())

/**
 * Running unavailable video checks, by user playlist id
 * @type {Map<string, { checked: number, total: number, uncertain: number, cancel: () => void }>}
 */
export const unavailableVideoScans = reactive(new Map())

function showUpdateFailedToast(playlistName) {
  showToast({
    message: `${playlistName}: ${i18n.global.t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]')}`,
    icon: ['fas', 'circle-exclamation'],
  })
}

/**
 * Loads every video of a remote playlist, without the ones hidden by the
 * members-only preferences. Resolves to `null` when loading fails or is
 * cancelled; failures have already been reported.
 * @param {string} id
 * @param {{ icon: string[], message: string }} progress
 * @returns {{ promise: Promise<object[] | null>, cancel: () => void }}
 */
export function loadPlaylistVideos(id, { icon, message }) {
  const controller = new AbortController()
  const progress = startProgressBarOperation(store, { icon, message, percentage: 0 })
  const loaded = getPlaylistSnapshot(id, {
    backend: store.getters.getBackendPreference,
    fallback: store.getters.getBackendFallback,
    signal: controller.signal,
    onProgress: (count, total) => {
      if (total > 0) progress.update({ percentage: Math.min(100, count / total * 100) })
    },
  }).then((snapshot) => {
    const membersOnlyChannelIds = store.getters.getMembersOnlyChannelIdSet
    return snapshot.videos.filter(video => !isVideoHiddenByPreferences(video, { membersOnlyChannelIds }))
  }, (error) => {
    if (!controller.signal.aborted) {
      console.error(error)
      showToast({
        message: i18n.global.t("User Playlists.SinglePlaylistView['This playlist could not be loaded.']"),
        icon: ['fas', 'circle-exclamation'],
      })
    }
    return null
  })
  // Requests already sent are not interrupted, so cancelling settles right away
  // instead of when they come back.
  const cancelled = new Promise((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(null), { once: true })
  })
  const promise = Promise.race([loaded, cancelled]).finally(() => progress.finish())

  return { promise, cancel: () => controller.abort() }
}

/**
 * Adds the videos of a user playlist's source playlist that it does not contain yet.
 * @param {string} playlistId
 */
export async function addMissingPlaylistVideos(playlistId) {
  const playlist = store.getters.getPlaylist(playlistId)
  if (!playlist?.sourcePlaylistId || addingMissingVideos.has(playlistId)) return

  addingMissingVideos.add(playlistId)
  try {
    const videos = await loadPlaylistVideos(playlist.sourcePlaylistId, {
      icon: ['fas', 'playlist-merge'],
      message: i18n.global.t('User Playlists.Background Tasks.Adding missing videos to {playlistName}', { playlistName: playlist.playlistName }),
    }).promise
    if (!videos) return

    const playlistName = store.getters.getPlaylist(playlistId)?.playlistName ?? playlist.playlistName
    // Insert the snapshot as one ordered, deduplicated batch so a concurrent
    // preference change cannot split the refresh between the two ends.
    if (await store.dispatch('addVideos', { _id: playlistId, videos, deduplicate: true })) {
      showToast({
        message: `${playlistName}: ${i18n.global.t('User Playlists.SinglePlaylistView.Toast["Playlist has been updated."]')}`,
        icon: ['fas', 'check'],
      })
    } else {
      showUpdateFailedToast(playlistName)
    }
  } finally {
    addingMissingVideos.delete(playlistId)
  }
}

/**
 * Checks which videos of a user playlist are no longer available, then offers
 * to remove them. Videos that could not be checked are kept.
 * @param {string} playlistId
 */
export async function scanPlaylistForUnavailableVideos(playlistId) {
  const playlist = store.getters.getPlaylist(playlistId)
  if (!playlist || unavailableVideoScans.has(playlistId)) return

  const { playlistName } = playlist
  const videos = [...playlist.videos]
  const controller = new AbortController()
  const { signal } = controller
  const total = new Set(videos.map(video => video.videoId)).size
  unavailableVideoScans.set(playlistId, { checked: 0, total, uncertain: 0, cancel: () => controller.abort() })
  const scan = unavailableVideoScans.get(playlistId)
  const progressMessage = checked => i18n.global.t('User Playlists.Background Tasks.Checking {playlistName} for unavailable videos', { playlistName, checked, total })
  const progressOperation = startProgressBarOperation(store, {
    icon: ['fas', 'link-slash'],
    message: progressMessage(0),
    percentage: 0,
  })

  try {
    const useLocal = process.env.SUPPORTS_LOCAL_API && !usesInvidiousApi(store.getters.getBackendPreference)
    const checkLocal = useLocal ? await createLocalPlaylistAvailabilityChecker(signal) : null
    const result = await findDeadPlaylistItems(videos, async (videoId, scanSignal) => {
      const timeoutSignal = AbortSignal.any([scanSignal, AbortSignal.timeout(20_000)])
      if (checkLocal) {
        const response = await checkLocal(videoId, timeoutSignal)
        return isUnavailablePlayerResponse(response, videoId)
      }
      return isUnavailableInvidiousResponse(await getInvidiousPlaylistAvailability(videoId, timeoutSignal), videoId)
    }, signal, (progress) => {
      Object.assign(scan, progress)
      progressOperation.update({
        message: progressMessage(progress.checked),
        percentage: progress.total === 0 ? 0 : progress.checked / progress.total * 100,
      })
    })

    if (result.itemIds.size === 0) {
      showToast({
        message: `${playlistName}: ${i18n.global.t('User Playlists.SinglePlaylistView.Toast["There were no videos to remove."]')}`,
        icon: ['fas', 'check'],
      })
      return
    }

    showToast({
      message: `${playlistName}: ${i18n.global.t('User Playlists.Remove Unavailable Videos Confirmation', { count: result.itemIds.size, uncertain: result.uncertain })}`,
      icon: ['fas', 'link-slash'],
      time: Infinity,
      buttons: [
        { label: i18n.global.t('Cancel'), icon: ['fas', 'xmark'] },
        {
          label: i18n.global.t('Yes, Delete'),
          icon: ['fas', 'trash'],
          primary: true,
          action: () => removePlaylistItems(playlistId, playlistName, result.itemIds),
        },
      ],
    })
  } catch (error) {
    if (!signal.aborted) {
      console.error(error)
      showToast({ message: i18n.global.t("User Playlists.SinglePlaylistView['This playlist could not be loaded.']"), icon: ['fas', 'circle-exclamation'] })
    }
  } finally {
    progressOperation.finish()
    unavailableVideoScans.delete(playlistId)
  }
}

/**
 * @param {string} playlistId
 * @param {string} playlistName shown if the playlist was deleted in the meantime
 * @param {Set<string>} itemIds
 */
async function removePlaylistItems(playlistId, playlistName, itemIds) {
  const playlist = store.getters.getPlaylist(playlistId)
  if (!playlist) {
    showUpdateFailedToast(playlistName)
    return
  }

  const videos = playlist.videos.filter(video => !itemIds.has(video.playlistItemId))
  const removed = playlist.videos.length - videos.length
  if (removed === 0) return

  if (await store.dispatch('updatePlaylist', { ...playlist, videos })) {
    showToast({
      message: `${playlist.playlistName}: ${i18n.global.t('User Playlists.SinglePlaylistView.Toast.{videoCount} video(s) have been removed', { videoCount: removed }, removed)}`,
      icon: ['fas', 'trash'],
    })
  } else {
    showUpdateFailedToast(playlist.playlistName)
  }
}
