import { toRaw } from 'vue'
import {
  DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo,
  mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote,
} from './sync-history-merge.js'
import { runBackgroundJob } from './background-jobs.js'
import { MAIN_PROFILE_ID } from '../../constants'
import i18n from '../i18n/index'
import {
  CUSTOM_THEMES_SYNC_KEY,
  customThemeIdFromValue,
  normalizeCustomThemes,
} from '../../customTheme'
import {
  SyncServerDataLossError,
  SyncServerCancelledError,
  SyncServerTabRevocationPendingError,
  SyncServerError,
  SyncServerUnsupportedError,
  SYNC_SERVER_UPDATE_REQUIRED_MESSAGE,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  isExpiredSessionReauthentication,
  isSessionExpiredError,
} from './sync-server-errors'
import { getSyncableSettingKeys, isSettingSyncEnabled } from '../store/modules/settings'
import { deepCopy } from './utils'
import { replaceCustomThemes } from './customTheme'
import { repairSystemThemeSettings } from './customThemeSync'
import { generateRandomUniqueId, isPlaylistSortOrder } from './playlists'
import { normalizePlaylistThumbnail } from './playlist-thumbnails'
import {
  getMergedProfileBackground,
  getMergedProfileTextColor,
  getSyncProfileBackground,
  getSyncProfileTextColor
} from './profile-sync.js'
import { isValidPlaylistBookmark, playlistBookmarkForSync } from './playlist-bookmarks'
import { getOtherDeviceSessions, getRevokedSyncSessionLogins, mergeSyncSessions } from './sync-sessions'
import { isValidSyncServerDeviceId } from './sync-server-sessions'
import { areSyncSettingValuesEqual, mergeSettingEntry, resolveMergedThemeEntry } from './sync-settings-conflict'
import { getCapacitorTabService } from '../tabs/CapacitorTabService'
import { SyncServerClient, normalizeSyncServerUrl } from './sync-server-client'

import {
  SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY,
  getSubscriptionSettingsForSync,
  mergeSubscriptionSettingsEntry,
  applySubscriptionSettingsSync
} from './subscription-settings-sync'

const BULK_SYNC_CHUNK_SIZE = 100
const LEGACY_SYNC_CONCURRENCY = 4

export {
  SyncServerClient,
  normalizeSyncServerUrl,
  SyncServerDataLossError,
  SyncServerCancelledError,
  SyncServerTabRevocationPendingError,
  SyncServerError,
  SyncServerUnsupportedError,
  SYNC_SERVER_UPDATE_REQUIRED_MESSAGE,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  isExpiredSessionReauthentication,
  isSessionExpiredError,
}

function mapBy(items, getId) {
  return new Map(items.map(item => [getId(item), item]))
}

async function uploadInChunks(items, supportsBulk, uploadBulk, uploadSingle) {
  if (items.length === 0) return

  if (supportsBulk) {
    for (let index = 0; index < items.length; index += BULK_SYNC_CHUNK_SIZE) {
      await uploadBulk(items.slice(index, index + BULK_SYNC_CHUNK_SIZE))
    }
    return
  }

  // Older LibreTube-compatible servers do not expose bulk endpoints.
  for (let index = 0; index < items.length; index += LEGACY_SYNC_CONCURRENCY) {
    const chunk = items.slice(index, index + LEGACY_SYNC_CONCURRENCY)
    const results = await Promise.allSettled(chunk.map(uploadSingle))

    for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
      const result = results[resultIndex]
      if (result.status === 'fulfilled') continue

      const status = result.reason?.status
      const retryable = status === 409 || status === 423 || status === 429 || status >= 500
      if (!retryable) throw result.reason

      // Some legacy SQLite servers reject concurrent writes instead of queuing them.
      await uploadSingle(chunk[resultIndex])
    }
  }
}

export function mergeIds(...args) {
  return mergeSyncIds(...args)
}

function channelToRemote(channel) {
  return {
    id: channel.id,
    name: channel.name || channel.id,
    avatar: normalizeChannelAvatar(channel.thumbnail) || DEFAULT_CHANNEL_AVATAR,
    verified: false,
  }
}

function channelToLocal(channel) {
  return {
    id: channel.id,
    name: channel.name,
    thumbnail: normalizeChannelAvatar(channel.avatar),
  }
}

function videoToRemote(video, options) {
  return syncVideoToRemote(video, options)
}

function videoToLocal(video, timeAdded = Date.now()) {
  return {
    videoId: video.id,
    title: video.title,
    ...uploaderToLocal(video.uploader),
    lengthSeconds: video.duration,
    published: video.upload_date,
    timeAdded,
    playlistItemId: generateRandomUniqueId(),
    type: 'video',
  }
}

/** `null` follows the default sort order. */
function playlistSortOrder(sortOrder) {
  return isPlaylistSortOrder(sortOrder) ? sortOrder : null
}

function playlistMetadataFromLocal(playlist, features) {
  return {
    id: playlist._id,
    title: playlist.playlistName,
    description: playlist.description || '',
    thumbnail_url: null,
    ...(features.thumbnails ? { custom_thumbnail: playlist.customThumbnail || null } : {}),
    ...(features.sortOrder ? { sort_order: playlistSortOrder(playlist.sortOrder) } : {}),
  }
}

function playlistMetadataFromRemote(playlist, features) {
  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description || '',
    thumbnail_url: null,
    ...(features.thumbnails ? { custom_thumbnail: playlist.custom_thumbnail || null } : {}),
    ...(features.sortOrder ? { sort_order: playlistSortOrder(playlist.sort_order) } : {}),
  }
}

// Baselines only detect cover edits. A fingerprint avoids repeating every
// image in each snapshot write.
function thumbnailFingerprint(thumbnail) {
  if (!thumbnail) return null
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (let index = 0; index < thumbnail.length; index++) {
    const code = thumbnail.charCodeAt(index)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)
  return `${thumbnail.length}:${(second >>> 0).toString(36)}${(first >>> 0).toString(36)}`
}

function playlistBaselineMetadata(metadata) {
  if (!Object.hasOwn(metadata, 'custom_thumbnail')) return metadata
  return { ...metadata, custom_thumbnail: thumbnailFingerprint(metadata.custom_thumbnail) }
}

function metadataEquals(first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function selectPlaylistMetadata(local, remote, previous, features) {
  if (!local) return playlistMetadataFromRemote(remote, features)
  if (!remote) return playlistMetadataFromLocal(local, features)

  const localMetadata = playlistMetadataFromLocal(local, features)
  const remoteMetadata = playlistMetadataFromRemote(remote, features)
  if (!previous) return localMetadata

  const previousMetadata = playlistMetadataFromRemote(previous, features)
  const localBaseline = playlistBaselineMetadata(localMetadata)
  const merged = { ...localMetadata }
  const fields = ['title', 'description', ...(features.thumbnails ? ['custom_thumbnail'] : []), ...(features.sortOrder ? ['sort_order'] : [])]
  for (const field of fields) {
    if (localBaseline[field] === previousMetadata[field]) {
      merged[field] = remoteMetadata[field]
    }
  }
  return merged
}

function isSameLocalPlaylist(playlist, metadata, videos) {
  return playlist.playlistName === metadata.title &&
    (playlist.description || '') === metadata.description &&
    (!Object.hasOwn(metadata, 'custom_thumbnail') || (playlist.customThumbnail || null) === metadata.custom_thumbnail) &&
    (!Object.hasOwn(metadata, 'sort_order') || playlistSortOrder(playlist.sortOrder) === metadata.sort_order) &&
    playlist.videos.length === videos.length &&
    playlist.videos.every((video, index) => metadataEquals(video, videos[index]))
}

export async function syncSubscriptions(client, store, previousIds = [], options = {}) {
  const profiles = store.state.profiles.profileList
  const mainProfile = profiles.find(profile => profile._id === MAIN_PROFILE_ID) ?? profiles[0]
  const localSubscriptions = mainProfile.subscriptions.map(channel => ({
    ...channel,
    thumbnail: normalizeChannelAvatar(channel.thumbnail),
  }))
  const localById = mapBy(localSubscriptions, channel => channel.id)
  const remoteSubscriptions = await client.getSubscriptions()
  const remoteById = mapBy(remoteSubscriptions, channel => channel.id)
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), previousIds, {
    ...options,
    collection: 'subscriptions',
    getItemName: id => localById.get(id)?.name || remoteById.get(id)?.name,
  })

  for (const id of remoteById.keys()) {
    if (!mergedIds.has(id)) {
      await client.unsubscribe(id)
    }
  }
  const subscriptionsToAdd = Array.from(mergedIds)
    .filter(id => !remoteById.has(id))
    .map(id => channelToRemote(localById.get(id)))
  await uploadInChunks(
    subscriptionsToAdd,
    await client.supportsBulkSync(),
    channels => client.subscribeBulk(channels),
    channel => client.subscribe(channel)
  )

  const mergedSubscriptions = Array.from(mergedIds).map(id => {
    return localById.get(id) ?? channelToLocal(remoteById.get(id))
  })
  const mergedIdSet = new Set(mergedIds)

  for (const profile of profiles) {
    const updatedProfile = deepCopy(profile)
    updatedProfile.subscriptions = profile._id === mainProfile._id
      ? mergedSubscriptions
      : updatedProfile.subscriptions.filter(channel => mergedIdSet.has(channel.id))

    if (!metadataEquals(profile.subscriptions, updatedProfile.subscriptions)) {
      await store.dispatch('updateProfile', updatedProfile)
    }
  }

  return Array.from(mergedIds)
}

export async function syncPlaylistBookmarks(client, store, previousIds = [], options = {}) {
  const localBookmarks = (Array.isArray(store.state.settings.playlistBookmarks)
    ? store.state.settings.playlistBookmarks
    : []).filter(isValidPlaylistBookmark)
  const localById = mapBy(localBookmarks, bookmark => bookmark.playlist.id)
  const remoteBookmarks = (await client.getPlaylistBookmarks()).filter(isValidPlaylistBookmark)
  const remoteById = mapBy(remoteBookmarks, bookmark => bookmark.playlist.id)
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), previousIds, {
    ...options,
    collection: 'saved playlists',
    getItemName: id => localById.get(id)?.playlist.title || remoteById.get(id)?.playlist.title,
  })

  for (const id of remoteById.keys()) {
    if (!mergedIds.has(id)) {
      await client.deletePlaylistBookmark(id)
    }
  }

  for (const id of localById.keys()) {
    if (!remoteById.has(id) && mergedIds.has(id)) {
      await client.createPlaylistBookmark(playlistBookmarkForSync(localById.get(id)))
    }
  }

  const mergedBookmarks = Array.from(mergedIds).map(id => {
    return localById.get(id) ?? { ...remoteById.get(id), savedAt: Date.now() }
  })

  if (!metadataEquals(localBookmarks, mergedBookmarks)) {
    const saved = await store.dispatch('replacePlaylistBookmarks', mergedBookmarks)
    if (!saved) throw new Error('Could not save synced playlist bookmarks')
  }

  return Array.from(mergedIds)
}

export async function syncPlaylists(client, store, previous = {}, options = {}) {
  const features = {
    thumbnails: typeof client.supportsPlaylistThumbnails === 'function' && await client.supportsPlaylistThumbnails(),
    sortOrder: typeof client.supportsPlaylistSortOrder === 'function' && await client.supportsPlaylistSortOrder(),
  }
  const localPlaylists = deepCopy(store.state.playlists.playlists)
  const localById = mapBy(localPlaylists, playlist => playlist._id)
  const remotePlaylistHeaders = await client.getPlaylists()
  const remotePlaylists = await Promise.all(
    remotePlaylistHeaders.map(playlist => client.getPlaylist(playlist.id))
  )
  const localIdByRemoteId = new Map(Object.entries(previous).map(([localId, snapshot]) => {
    return [snapshot.remoteId ?? localId, localId]
  }))
  const remoteById = new Map(remotePlaylists.map(entry => {
    const remoteId = entry.playlist.id
    const localId = localIdByRemoteId.get(remoteId) ?? remoteId
    return [localId, { ...entry, remoteId }]
  }))
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), Object.keys(previous), {
    ...options,
    collection: 'playlists',
    getItemName: id => localById.get(id)?.playlistName || remoteById.get(id)?.playlist.title || previous[id]?.metadata?.title,
  })
  const nextSnapshot = {}
  const assertCurrent = (local, id) => {
    const current = store.state.playlists.playlists.find(playlist => playlist._id === id)
    if (!metadataEquals(local, current)) throw new Error('Playlist changed during sync. Try again.')
  }

  for (const [id, remote] of remoteById) {
    if (!mergedIds.has(id)) {
      await client.deletePlaylist(remote.remoteId)
    }
  }

  for (const id of localById.keys()) {
    if (!mergedIds.has(id)) {
      await store.dispatch('removePlaylist', id)
    }
  }

  for (const id of mergedIds) {
    let local = localById.get(id)
    let remote = remoteById.get(id)
    const rawRemoteMetadata = remote ? playlistMetadataFromRemote({ ...remote.playlist, id }, features) : null
    const metadata = selectPlaylistMetadata(local, rawRemoteMetadata, previous[id]?.metadata, features)
    if (metadata.custom_thumbnail) {
      for (const candidate of new Set([metadata.custom_thumbnail, local?.customThumbnail])) {
        if (!candidate) continue
        try {
          metadata.custom_thumbnail = await normalizePlaylistThumbnail(candidate)
          break
        } catch (error) {
          console.warn('Could not load synced playlist thumbnail', id, error)
          metadata.custom_thumbnail = null
        }
      }
    }
    let remoteId = remote?.remoteId ?? id
    assertCurrent(local, id)

    if (!remote) {
      const createdPlaylist = await client.createPlaylist(metadata)
      remoteId = createdPlaylist?.id ?? id
      // Keep the generated ID even if a later stale-state guard aborts this
      // sync. A retry must recognize our copy instead of importing it as new.
      await store.persistPlaylistSyncBaseline(id, { remoteId, metadata: playlistBaselineMetadata(metadata) })
      remote = { playlist: { ...metadata, id: remoteId }, videos: [], remoteId }
    } else if (!metadataEquals(metadata, rawRemoteMetadata)) {
      await client.updatePlaylist(remoteId, metadata)
    }

    const localVideos = local?.videos ?? []
    const remoteVideosById = mapBy(remote.videos, video => video.id)
    const localVideosById = mapBy(
      localVideos.filter(video => videoToRemote(video, options) !== null || remoteVideosById.has(video.videoId)),
      video => video.videoId
    )
    const localMetadataById = new Map()
    for (const video of localVideos) {
      const payload = videoToRemote(video, options)
      if (!payload) continue
      const existing = localMetadataById.get(video.videoId)
      localMetadataById.set(video.videoId, existing ? enrichSyncVideo(existing, payload) : payload)
    }
    const mergedVideoIds = mergeIds(
      localVideosById.keys(),
      remoteVideosById.keys(),
      previous[id]?.videos,
      {
        ...options,
        collection: `videos in playlist ${metadata.title}`,
        getItemName: videoId => localVideosById.get(videoId)?.title || remoteVideosById.get(videoId)?.title,
      }
    )
    const remoteVideosToAdd = []
    for (const videoId of mergedVideoIds) {
      const localMetadata = localMetadataById.get(videoId)
      const existing = remoteVideosById.get(videoId)
      if (!localMetadata) continue
      const enriched = existing ? enrichSyncVideo(existing, localMetadata) : localMetadata
      if (!metadataEquals(existing, enriched)) remoteVideosToAdd.push(enriched)
      remoteVideosById.set(videoId, enriched)
    }

    let added = []
    const removed = []
    try {
      if (remoteVideosToAdd.length > 0) {
        await client.addPlaylistVideos(remoteId, remoteVideosToAdd)
        added = remoteVideosToAdd.map(video => video.id)
      }
      for (const videoId of remoteVideosById.keys()) {
        if (!mergedVideoIds.has(videoId)) {
          await client.removePlaylistVideo(remoteId, videoId)
          removed.push(videoId)
        }
      }
    } finally {
      // Record completed writes once, including when a later removal fails.
      if (added.length > 0 || removed.length > 0) {
        await store.persistPlaylistSyncBaseline(id, { remoteId, metadata: playlistBaselineMetadata(metadata), added, removed })
      }
    }

    // Preserve each local occurrence and its identity/order when metadata alone
    // changes. The membership map intentionally deduplicates only remote IDs.
    const retainedVideos = localVideos
      .filter(video => videoToRemote(video, options) === null || mergedVideoIds.has(video.videoId))
      .map(video => {
        const current = video.authorId === UNKNOWN_SYNC_UPLOADER_ID
          ? { ...video, ...uploaderToLocal({ id: video.authorId, name: video.author }) }
          : video
        const remoteVideo = remoteVideosById.get(video.videoId)
        if (!remoteVideo) return current
        const uploader = uploaderToLocal(remoteVideo.uploader)
        const identified = current.authorId || !uploader.authorId ? current : { ...current, authorId: uploader.authorId }
        const payload = videoToRemote(identified, options)
        if (!payload) return current
        const enriched = enrichSyncVideo(payload, remoteVideo)
        const result = { ...identified }
        if (payload.title !== enriched.title) result.title = enriched.title
        if (payload.uploader.name !== enriched.uploader.name) result.author = enriched.uploader.name
        if (payload.upload_date !== enriched.upload_date) result.published = enriched.upload_date
        if ((!Number.isFinite(video.lengthSeconds) || video.lengthSeconds <= 0) && payload.duration !== enriched.duration) {
          result.lengthSeconds = enriched.duration
          result.isLive = false
          result.liveNow = false
          result.isUpcoming = false
        }
        return result
      })
    const addedVideos = Array.from(mergedVideoIds)
      .filter(videoId => !localVideosById.has(videoId))
      .map(videoId => videoToLocal(remoteVideosById.get(videoId)))
    const mergedVideos = local?.addVideosToTop === true
      ? addedVideos.concat(retainedVideos)
      : retainedVideos.concat(addedVideos)

    assertCurrent(local, id)
    if (!local) {
      local = {
        _id: id,
        playlistName: metadata.title,
        description: metadata.description,
        customThumbnail: metadata.custom_thumbnail || '',
        ...(metadata.sort_order ? { sortOrder: metadata.sort_order } : {}),
        protected: false,
        videos: mergedVideos,
      }
      await store.dispatch('addPlaylist', local)
    } else if (!isSameLocalPlaylist(local, metadata, mergedVideos)) {
      const saved = await store.dispatch('updatePlaylistFromSync', {
        previous: local,
        // Sorting is a view preference, so a sort order change alone keeps `lastUpdatedAt`
        keepLastUpdatedAt: isSameLocalPlaylist({ ...local, sortOrder: metadata.sort_order }, metadata, mergedVideos),
        playlist: {
          ...local,
          playlistName: metadata.title,
          description: metadata.description,
          ...(features.thumbnails ? { customThumbnail: metadata.custom_thumbnail || '' } : {}),
          ...(features.sortOrder ? { sortOrder: metadata.sort_order } : {}),
          videos: mergedVideos,
        },
      })
      if (!saved) throw new Error('Playlist changed during sync. Try again.')
    }

    await store.persistPlaylistSyncBaseline(id, { remoteId, metadata: playlistBaselineMetadata(metadata), applied: true, videos: Array.from(mergedVideoIds) })
    nextSnapshot[id] = {
      remoteId,
      metadata: playlistBaselineMetadata(metadata),
      videos: Array.from(mergedVideoIds),
    }
  }

  return nextSnapshot
}

export async function syncHistory(client, store, previous = {}, options = {}) {
  const historyChanged = new Error('Watch history changed during sync. Try again.')
  const legacy = typeof client.applyWatchHistoryChanges !== 'function'
  const acknowledgedUpserts = new Map()
  const acknowledgedDeletions = new Set()
  const acknowledge = (upserts, deletions = []) => {
    for (const id of deletions) {
      acknowledgedUpserts.delete(id)
      acknowledgedDeletions.add(id)
    }
    for (const entry of upserts) {
      acknowledgedDeletions.delete(entry.video.id)
      acknowledgedUpserts.set(entry.video.id, entry.metadata)
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    store.assertActive?.()
    const remoteHistory = await client.getWatchHistory()
    if (remoteHistory === null) return null
    const revision = store.state.history.historyRevision
    const localHistory = toRaw(store.state.history.historyCacheSorted).slice()
    const assertHistoryCurrent = () => {
      store.assertActive?.()
      if (store.state.history.historyRevision !== revision) throw historyChanged
    }
    let merged
    try {
      merged = await runBackgroundJob('mergeHistory', {
        localHistory,
        remoteHistory,
        previous,
        options: { ...options, deferRepairAcknowledgement: !legacy },
        acknowledged: { upserts: Array.from(acknowledgedUpserts), deletions: Array.from(acknowledgedDeletions) },
      })
      assertHistoryCurrent()
    } catch (error) {
      store.assertActive?.()
      // Even a failed merge can be based on mixed chunks and report false data
      // loss. Only retry stale computations; rejected writes have uncertain effects.
      if (store.state.history.historyRevision !== revision) continue
      throw error
    }
    const { next, baselineChanged, historyToUpload, remoteDeletions, insertions, updates, deletions } = merged
    let completed = false
    try {
      if (!legacy) {
        if (historyToUpload.length || remoteDeletions.length) {
          await client.applyWatchHistoryChanges(historyToUpload, remoteDeletions)
          acknowledge(historyToUpload, remoteDeletions)
        }
      } else {
        for (const id of remoteDeletions) {
          await client.deleteWatchHistory(id)
          acknowledge([], [id])
        }
        await uploadInChunks(
          historyToUpload,
          await client.supportsBulkSync(),
          async entries => { await client.putWatchHistoryBulk(entries); acknowledge(entries) },
          async entry => { await client.putWatchHistory(entry); acknowledge([entry]) }
        )
      }

      store.assertActive?.()
      if (store.state.history.historyRevision !== revision) continue
      if (insertions.length > 0 || updates.length > 0 || deletions.length > 0) {
        try {
          await store.dispatch('applyHistorySyncChanges', {
            insertions,
            updates,
            deletions,
            ...(store.assertActive || revision !== undefined ? { assertActive: assertHistoryCurrent } : {}),
          })
        } catch (error) {
          if (error !== historyChanged) throw error
          store.assertActive?.()
          continue
        }
      }
      completed = true
      return next
    } finally {
      // Legacy requests already changed the server even if a later write,
      // local application, or collection fails. Encrypted adapter writes only
      // change its in-memory document and must wait for the actual upload.
      const acknowledged = acknowledgedUpserts.size > 0 || acknowledgedDeletions.size > 0
      if (legacy && ((completed && baselineChanged) || acknowledged)) {
        await store.persistHistorySyncBaseline?.({
          previous,
          acknowledged: { upserts: Array.from(acknowledgedUpserts), deletions: Array.from(acknowledgedDeletions) },
          ...(completed ? { next } : {}),
        })
      }
    }
  }
  throw historyChanged
}

function profileMetadata(profile, fallback = {}) {
  return {
    title: profile.name,
    bgColor: getSyncProfileBackground(profile.bgColor, fallback.bgColor),
    textColor: getSyncProfileTextColor(profile.textColor, fallback.textColor),
  }
}

function remoteProfileMetadata(group, fallback = {}) {
  return {
    title: group.title,
    bgColor: getSyncProfileBackground(group.bg_color, fallback.bgColor),
    textColor: group.text_color ?? fallback.textColor ?? '#FFFFFF',
  }
}

export async function syncProfiles(client, store, previous = {}, options = {}) {
  const profiles = store.state.profiles.profileList
  const localProfiles = profiles.filter(profile => profile._id !== MAIN_PROFILE_ID)
  const localById = mapBy(localProfiles, profile => profile._id)
  const remoteGroups = await client.getSubscriptionGroups()
  if (remoteGroups === null) return null
  const localIdByRemoteId = new Map(Object.entries(previous).map(([localId, snapshot]) => {
    return [snapshot.remoteId ?? localId, localId]
  }))
  const remoteById = new Map(remoteGroups.map(entry => {
    const remoteId = entry.group.id
    const localId = entry.group.local_id ?? localIdByRemoteId.get(remoteId) ?? remoteId
    return [localId, { ...entry, remoteId }]
  }))
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), Object.keys(previous), {
    ...options,
    collection: 'profiles',
    getItemName: id => localById.get(id)?.name || remoteById.get(id)?.group.title || previous[id]?.metadata?.title,
  })
  const mainSubscriptions = profiles.find(profile => profile._id === MAIN_PROFILE_ID)?.subscriptions ?? []
  const subscriptionsById = mapBy(mainSubscriptions, channel => channel.id)
  const next = {}

  for (const [id, remote] of remoteById) {
    if (!mergedIds.has(id)) await client.deleteSubscriptionGroup(remote.remoteId)
  }
  for (const id of localById.keys()) {
    if (!mergedIds.has(id)) await store.dispatch('removeProfile', id)
  }

  for (const id of mergedIds) {
    const local = localById.get(id)
    let remote = remoteById.get(id)
    const oldMetadata = previous[id]?.metadata
    const localMetadata = local ? profileMetadata(local, oldMetadata) : null
    const remoteMetadata = remote
      ? remoteProfileMetadata(remote.group, oldMetadata ?? localMetadata ?? {})
      : null
    const localChanged = localMetadata && !metadataEquals(localMetadata, oldMetadata)
    const remoteChanged = remoteMetadata && !metadataEquals(remoteMetadata, oldMetadata)
    const metadata = remoteChanged && !localChanged ? remoteMetadata : localMetadata ?? remoteMetadata
    let remoteId = remote?.remoteId ?? id

    const groupPayload = {
      id,
      local_id: id,
      title: metadata.title,
      bg_color: metadata.bgColor,
      text_color: metadata.textColor,
    }
    if (!remote) {
      const created = await client.createSubscriptionGroup(groupPayload)
      remoteId = created?.id ?? id
      remote = { group: { ...groupPayload, id: remoteId }, channels: [], remoteId }
    } else if (!metadataEquals(metadata, remoteMetadata)) {
      await client.updateSubscriptionGroup(remoteId, groupPayload)
    }

    const localChannelIds = local?.subscriptions.map(channel => channel.id) ?? []
    const remoteChannelIds = remote.channels.map(channel => channel.id)
    const mergedChannelIds = mergeIds(
      localChannelIds,
      remoteChannelIds,
      previous[id]?.channels,
      {
        ...options,
        collection: `channels in profile ${metadata.title}`,
        getItemName: channelId => subscriptionsById.get(channelId)?.name ||
          local?.subscriptions.find(channel => channel.id === channelId)?.name ||
          remote.channels.find(channel => channel.id === channelId)?.name,
      }
    )
    for (const channelId of remoteChannelIds) {
      if (!mergedChannelIds.has(channelId)) {
        await client.removeSubscriptionGroupChannel(remoteId, channelId)
      }
    }
    for (const channelId of mergedChannelIds) {
      if (!remoteChannelIds.includes(channelId)) {
        await client.addSubscriptionGroupChannel(remoteId, channelId)
      }
    }

    const mergedSubscriptions = Array.from(mergedChannelIds)
      .map(channelId => subscriptionsById.get(channelId))
      .filter(Boolean)
    const mergedProfile = {
      _id: id,
      name: metadata.title,
      bgColor: getMergedProfileBackground(local, metadata.bgColor),
      textColor: getMergedProfileTextColor(local, metadata.textColor),
      ...(local && Object.hasOwn(local, 'icon') ? { icon: local.icon } : {}),
      subscriptions: mergedSubscriptions,
    }
    if (!local || !metadataEquals(local, mergedProfile)) {
      await store.dispatch('updateProfile', mergedProfile)
    }

    next[id] = {
      remoteId,
      metadata,
      channels: Array.from(mergedChannelIds),
    }
  }

  return next
}

function settingUpdater(key) {
  return `update${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

async function repairCustomThemeReferences(store, previousThemes, themes) {
  const themeIds = new Set(themes.map(theme => theme.id))
  const previousById = new Map(previousThemes.map(theme => [theme.id, theme]))
  const fallbacks = {
    baseTheme: 'system',
    systemLightTheme: 'light',
    systemDarkTheme: 'dark',
  }

  for (const [key, defaultTheme] of Object.entries(fallbacks)) {
    const id = customThemeIdFromValue(store.state.settings[key])
    if (id === null || themeIds.has(id)) continue

    const deletedTheme = previousById.get(id)
    if (key === 'baseTheme' && deletedTheme) {
      await store.dispatch('updateMainColor', deletedTheme.mainColor)
      await store.dispatch('updateSecColor', deletedTheme.secondaryColor)
    }
    await store.dispatch(settingUpdater(key), deletedTheme?.basedOn ?? defaultTheme)
  }

  await repairSystemThemeSettings(store, themes)
}

const SYNC_DEVICE_ID_KEY = 'opentubex-sync-device-id'
let volatileSyncDeviceId = null

function getSyncDeviceId() {
  try {
    let deviceId = localStorage.getItem(SYNC_DEVICE_ID_KEY)
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      localStorage.setItem(SYNC_DEVICE_ID_KEY, deviceId)
    }
    return deviceId
  } catch {
    volatileSyncDeviceId ??= crypto.randomUUID()
    return volatileSyncDeviceId
  }
}

function getTabSessionDeviceIdentity(settings = {}) {
  const legacyDeviceId = getSyncDeviceId()
  const deviceId = isValidSyncServerDeviceId(settings.syncServerDeviceId)
    ? settings.syncServerDeviceId
    : legacyDeviceId
  return {
    deviceId,
    legacyDeviceIds: deviceId === legacyDeviceId ? [] : [legacyDeviceId],
  }
}

export function getSavedOtherDeviceSessions(snapshot, settings) {
  const { deviceId, legacyDeviceIds } = getTabSessionDeviceIdentity(settings)
  return getOtherDeviceSessions(
    snapshot?.sessionsV2 ?? snapshot?.sessions,
    deviceId,
    legacyDeviceIds
  )
}

function getTabSyncAdapter() {
  if (process.env.IS_ELECTRON) return window.ftElectron?.tabs ?? null
  if (process.env.IS_CAPACITOR) {
    try {
      return getCapacitorTabService()
    } catch {
      return null
    }
  }
  return null
}

export async function syncSessions(client, store, previous = null, { accountClient = client } = {}) {
  if (process.env.IS_CAPACITOR && store.state.settings.enableMobileTabs === false) return null

  const tabs = getTabSyncAdapter()
  if (typeof tabs?.getSyncSessions !== 'function' ||
      typeof tabs?.applySyncSessions !== 'function') {
    return null
  }

  const local = await tabs.getSyncSessions()
  const remote = await client.getSessions()
  if (process.env.IS_CAPACITOR && store.state.settings.enableMobileTabs === false) return null
  const { deviceId, legacyDeviceIds } = getTabSessionDeviceIdentity(store.state.settings)
  const revokedLogins = getRevokedSyncSessionLogins(remote, deviceId)
  let reclaimDeviceSessions = false
  let activeRevokedLogins = []
  if (revokedLogins.length > 0) {
    const response = await accountClient.getAccountSessions()
    const current = Array.isArray(response?.sessions)
      ? response.sessions.filter(session => session?.current === true)
      : []
    if (current.length !== 1 || current[0].device_id !== deviceId ||
        response.sessions.some(session => typeof session?.id !== 'string' || session.id.length === 0)) {
      throw new Error(i18n.global.t('Settings.Sync Settings.Account Management Failed'))
    }
    // Block this login's entire upload, including windows opened after cleanup.
    // Keep local tabs intact while the account-session DELETE is pending.
    if (revokedLogins.includes(current[0].id)) {
      throw new SyncServerTabRevocationPendingError(i18n.global.t('Settings.Sync Settings.Tab Sync Revocation Pending'))
    }
    activeRevokedLogins = revokedLogins.filter(id => response.sessions.some(session => session.id === id))
    reclaimDeviceSessions = true
  }
  const merged = mergeSyncSessions({
    localSessions: local,
    remoteValue: remote,
    previousValue: previous,
    deviceId,
    platform: process.env.IS_CAPACITOR ? 'mobile' : 'desktop',
    preferredMode: store.state.settings.syncServerSharedTabs ? 'shared' : 'separate',
    legacyDeviceIds,
    reclaimDeviceSessions,
    activeRevokedLogins,
  })

  if (!metadataEquals(local, merged.sessionsToApply) && merged.sessionsToApply.length > 0) {
    const applied = await tabs.applySyncSessions(merged.sessionsToApply)
    if (!applied) throw new Error('Failed to apply synced tab sessions')
  }
  if (process.env.IS_CAPACITOR && store.state.settings.enableMobileTabs === false) return null
  if (!metadataEquals(remote, merged.document)) {
    await client.putSessions(merged.document)
  }
  if ((merged.mode === 'shared') !== store.state.settings.syncServerSharedTabs) {
    await store.dispatch('updateSyncServerSharedTabs', merged.mode === 'shared')
  }

  return merged
}

export async function syncSettings(client, store, previous = {}) {
  const remoteEntries = await client.getSettings()
  const remote = Object.fromEntries(remoteEntries.map(entry => [entry.key, entry]))
  // Keep the server's entry order even when devices sync different keys.
  // Reordering unchanged settings would create revisions that wake each other.
  const merged = { ...remote }
  const now = Date.now()
  const localUpdatedAt = store.state.settings.syncServerSettingUpdatedAt !== null &&
    typeof store.state.settings.syncServerSettingUpdatedAt === 'object' &&
    !Array.isArray(store.state.settings.syncServerSettingUpdatedAt)
    ? store.state.settings.syncServerSettingUpdatedAt
    : {}
  const local = Object.fromEntries([
    [CUSTOM_THEMES_SYNC_KEY, normalizeCustomThemes(store.state.utils.customThemes)],
    ...getSyncableSettingKeys(store.state.settings).map(key => (
      [key, deepCopy(store.state.settings[key])]
    )),
  ])

  if (isSettingSyncEnabled(store.state.settings, SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY)) {
    local[SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY] = getSubscriptionSettingsForSync(store)
  }

  for (const [key, value] of Object.entries(local)) {
    const old = previous[key]
    const remoteEntry = remote[key]
    const mergeEntry = key === SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY
      ? mergeSubscriptionSettingsEntry
      : mergeSettingEntry
    let entry = mergeEntry({
      key,
      value,
      old,
      remoteEntry,
      localUpdatedAt: localUpdatedAt[key],
      now,
    })

    entry = resolveMergedThemeEntry(
      entry, store.state.utils.customThemes, local[CUSTOM_THEMES_SYNC_KEY], now
    )
    merged[key] = entry
    if (key === 'defaultProfile' &&
        !store.state.profiles.profileList.some(profile => profile._id === entry.value)) {
      entry = { key, value: MAIN_PROFILE_ID, updatedAt: now }
      merged[key] = entry
    }
    const currentValue = key === CUSTOM_THEMES_SYNC_KEY || key === SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY
      ? value
      : store.state.settings[key]
    const valuesEqual = key === CUSTOM_THEMES_SYNC_KEY
      ? areSyncSettingValuesEqual(key, currentValue, entry.value)
      : metadataEquals(currentValue, entry.value)
    if (!valuesEqual) {
      if (key === SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY) {
        await applySubscriptionSettingsSync(store, entry.value)
      } else if (key === CUSTOM_THEMES_SYNC_KEY) {
        const previousThemes = store.state.utils.customThemes
        const themes = await replaceCustomThemes(entry.value)
        store.commit('setCustomThemes', themes)
        await repairCustomThemeReferences(store, previousThemes, themes)
      } else {
        await store.dispatch(settingUpdater(key), deepCopy(entry.value))
      }
    }
  }

  await client.putSettings(Object.values(merged))
  return merged
}
