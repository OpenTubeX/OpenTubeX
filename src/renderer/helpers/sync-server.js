import { toRaw } from 'vue'
import {
  DEFAULT_CHANNEL_AVATAR, normalizeChannelAvatar,
  mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote,
} from './sync-history-merge.js'
import { runBackgroundJob } from './background-jobs.js'
import { MAIN_PROFILE_ID } from '../../constants'
import i18n from '../i18n/index'
import packageDetails from '../../../package.json'
import { applySyncServerUserAgent } from '../../syncServerUserAgent'
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
import { generateRandomUniqueId } from './playlists'
import {
  getMergedProfileBackground,
  getMergedProfileTextColor,
  getSyncProfileBackground,
  getSyncProfileTextColor
} from './profile-sync.js'
import { createSyncServerRequestHeaders } from './sync-server-request'
import { isValidPlaylistBookmark, playlistBookmarkForSync } from './playlist-bookmarks'
import { getOtherDeviceSessions, getRevokedSyncSessionLogins, mergeSyncSessions } from './sync-sessions'
import { isValidSyncServerDeviceId } from './sync-server-sessions'
import { areSyncSettingValuesEqual, mergeSettingEntry, resolveMergedThemeEntry } from './sync-settings-conflict'
import { getCapacitorTabService } from '../tabs/CapacitorTabService'
import { capacitorHttpFetch } from './api/capacitor-http'

import {
  SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY,
  getSubscriptionSettingsForSync,
  mergeSubscriptionSettingsEntry,
  applySubscriptionSettingsSync
} from './subscription-settings-sync'

const LEGACY_HISTORY_PAGE_SIZE = 50
const BULK_SYNC_CHUNK_SIZE = 100
const LEGACY_SYNC_CONCURRENCY = 4
const REQUEST_TIMEOUT_MS = 20_000
const MAX_ENCRYPTED_SYNC_TIMEOUT_MS = 5 * 60 * 1000

function syncServerFetch(input, init, timeoutMs) {
  return process.env.IS_CAPACITOR
    ? capacitorHttpFetch(input, {
        ...init,
        // Encrypted transfers may outlast the native client's 30-second default.
        nativeTimeoutMs: timeoutMs,
        // The user may explicitly configure an HTTP server on their local network.
        allowHttp: true,
        headers: applySyncServerUserAgent(Object.fromEntries(new Headers(init.headers))),
      })
    : fetch(input, init)
}

export {
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

export function normalizeSyncServerUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new SyncServerError('Invalid sync server URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SyncServerError('Sync server URL must use HTTP or HTTPS')
  }

  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname
    .replace(/\/(?:docs|v1)\/?$/, '')
    .replace(/\/$/, '')

  return url.toString().replace(/\/$/, '')
}

export class SyncServerClient {
  constructor(serverUrl, token = '') {
    this.serverUrl = normalizeSyncServerUrl(serverUrl)
    this.token = token
    this.apiPrefix = null
    this.serverInfoPromise = null
    this.requestControllers = new Set()
    this.cancelled = false
  }

  cancel() {
    this.cancelled = true
    for (const controller of this.requestControllers) controller.abort()
  }

  async request(path, { timeoutMs = REQUEST_TIMEOUT_MS, ...options } = {}) {
    if (this.cancelled) throw new SyncServerCancelledError()
    const controller = new AbortController()
    this.requestControllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const headers = createSyncServerRequestHeaders({
      hasBody: options.body != null,
      headers: options.headers,
      token: this.token,
      version: process.env.IS_ELECTRON || process.env.IS_CAPACITOR ? packageDetails.version : '',
    })

    try {
      const response = await syncServerFetch(`${this.serverUrl}${path}`, {
        ...options,
        redirect: 'error',
        headers,
        body: options.body == null
          ? undefined
          : options.body.payload?.length > 65_536
            ? await runBackgroundJob('stringify', { value: options.body })
            : JSON.stringify(options.body),
        signal: controller.signal,
      }, timeoutMs)
      const text = await response.text()

      if (!response.ok) {
        throw new SyncServerError(text || `Sync server returned ${response.status}`, response.status)
      }

      if (!text) return null

      try {
        return text.length > 65_536 ? await runBackgroundJob('parse', { value: text }) : JSON.parse(text)
      } catch (error) {
        if (error.name !== 'SyntaxError') throw error
        return text
      }
    } catch (error) {
      if (error instanceof SyncServerError) {
        throw error
      }
      if (error?.name === 'AbortError') {
        if (this.cancelled) throw new SyncServerCancelledError()
        throw new SyncServerError('Sync server request timed out')
      }
      throw new SyncServerError(error?.message || 'Unable to reach sync server')
    } finally {
      clearTimeout(timeout)
      this.requestControllers.delete(controller)
    }
  }

  health() {
    return this.request('/health')
  }

  getServerInfo() {
    this.serverInfoPromise ??= this.health().then(response => {
      // Existing LibreTube servers return the plain text "OK". A structured
      // health response advertises the optional OpenTubeX extensions.
      if (!response || typeof response !== 'object' || Array.isArray(response)) return {}
      return response
    }).catch(error => {
      this.serverInfoPromise = null
      throw error
    })
    return this.serverInfoPromise
  }

  async getCapabilities() {
    const { capabilities } = await this.getServerInfo()
    const supported = capabilities && typeof capabilities === 'object' ? capabilities : {}
    if (supported.encrypted_sync === 1 && supported.live_sync !== 1) {
      throw new SyncServerUnsupportedError()
    }
    return supported
  }

  async getPrivacyPolicyUrl() {
    const { privacy_policy_url: value } = await this.getServerInfo()
    if (typeof value !== 'string') return null
    try {
      const url = new URL(value)
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
        ? url.href
        : null
    } catch {
      return null
    }
  }

  async supportsEncryptedSync() {
    const capabilities = await this.getCapabilities()
    return capabilities.encrypted_sync === 1
  }

  async supportsBulkSync() {
    const capabilities = await this.getCapabilities()
    return capabilities.bulk_sync === 1
  }

  async supportsSeenVideosSync() {
    const capabilities = await this.getCapabilities()
    return capabilities.seen_videos === 1
  }

  async supportsKeyPairing() {
    const capabilities = await this.getCapabilities()
    return capabilities.key_pairing === 1
  }

  async supportsAccountSessions() {
    const capabilities = await this.getCapabilities()
    return capabilities.account_sessions === 1
  }

  createPairingSession(recipient) {
    return this.request('/v1/pairing', {
      method: 'POST',
      body: {
        version: 1,
        id: recipient.sessionId,
        recipient_public_key: recipient.recipientPublicKey,
        recipient_device_id: recipient.recipientDeviceId,
        recipient_device_name: recipient.recipientDeviceName,
        recipient_token_hash: recipient.recipientTokenHash,
      },
    })
  }

  getPairingSession(sessionId, recipientToken) {
    return this.request(`/v1/pairing/${encodeURIComponent(sessionId)}`, {
      headers: { 'X-Pairing-Token': recipientToken },
    })
  }

  claimPairingSession(request, encryptedDeviceInfo) {
    return this.request(`/v1/pairing/${encodeURIComponent(request.sessionId)}/claim`, {
      method: 'POST',
      body: {
        version: request.version,
        recipient_public_key: request.recipientPublicKey,
        recipient_device_id: request.recipientDeviceId,
        recipient_device_name: request.recipientDeviceName,
        encrypted_device_info: encryptedDeviceInfo,
      },
    })
  }

  approvePairingSession(sessionId, approvingDeviceId, encryptedPayload) {
    return this.request(`/v1/pairing/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      body: {
        approving_device_id: approvingDeviceId,
        encrypted_payload: encryptedPayload,
      },
    })
  }

  consumePairingSession(sessionId, recipientToken) {
    return this.request(`/v1/pairing/${encodeURIComponent(sessionId)}/consume`, {
      method: 'POST',
      headers: { 'X-Pairing-Token': recipientToken },
    })
  }

  cancelPairingSession(sessionId, recipientToken) {
    return this.request(`/v1/pairing/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { 'X-Pairing-Token': recipientToken },
    })
  }

  getEncryptedSyncManifest({ playbackSpeedsInSettings = false } = {}) {
    const query = playbackSpeedsInSettings ? '?playback_speeds_in_settings=true' : ''
    return this.request(`/v1/encrypted_sync${query}`, { timeoutMs: MAX_ENCRYPTED_SYNC_TIMEOUT_MS })
  }

  getEncryptedSyncCollection(collection) {
    return this.request(
      `/v1/encrypted_sync/${encodeURIComponent(collection)}`,
      { timeoutMs: MAX_ENCRYPTED_SYNC_TIMEOUT_MS }
    )
  }

  getLegacyEncryptedSync() {
    return this.request('/v1/encrypted_sync/legacy', { timeoutMs: MAX_ENCRYPTED_SYNC_TIMEOUT_MS })
  }

  putEncryptedSyncCollection(collection, revision, payload, activity) {
    // Upload throughput and server commit latency cannot be inferred from size.
    // Allow the same bounded transfer window as encrypted downloads.
    return this.request(`/v1/encrypted_sync/${encodeURIComponent(collection)}`, {
      method: 'PUT',
      body: { revision, payload, ...(activity ? { activity } : {}) },
      timeoutMs: MAX_ENCRYPTED_SYNC_TIMEOUT_MS,
    })
  }

  waitForSyncChanges(cursor) {
    return this.request(`/v1/encrypted_sync/changes?since=${encodeURIComponent(cursor)}`, { timeoutMs: 35000 })
  }

  getSyncEvents(since = '') {
    // Activity is encrypted and padded too; accumulated events can be several
    // megabytes even when the library collections need no further changes.
    return this.request(`/v1/encrypted_sync/events?since=${encodeURIComponent(since)}`, { timeoutMs: MAX_ENCRYPTED_SYNC_TIMEOUT_MS })
  }

  sendDeviceRequest(recipient, payload) {
    return this.request('/v1/encrypted_sync/events', { method: 'POST', body: { recipient, payload } })
  }

  acknowledgeDeviceRequest(id) {
    return this.request(`/v1/encrypted_sync/events/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async apiRequest(path, options = {}) {
    if (this.apiPrefix !== null) {
      return this.request(`${this.apiPrefix}${path}`, options)
    }

    try {
      const response = await this.request(`/v1${path}`, options)
      this.apiPrefix = '/v1'
      return response
    } catch (error) {
      if (error.status !== 404) throw error
      const response = await this.request(path, options)
      this.apiPrefix = ''
      return response
    }
  }

  async authenticate(mode, name, password, deviceId) {
    // Account operations use the v1 contract, independent of legacy sync routing.
    const response = await this.request(`/v1/account/${mode}`, {
      method: 'POST',
      body: { name, password, device_id: deviceId },
    })
    this.token = response.jwt
    return response.jwt
  }

  deleteAccount(password) {
    return this.request('/v1/account/delete', {
      method: 'DELETE',
      body: { password },
    })
  }

  getAccountSessions() {
    return this.request('/v1/account/sessions')
  }

  updateAccountSession(sessionId, encryptedDeviceInfo) {
    return this.request(`/v1/account/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: { encrypted_device_info: encryptedDeviceInfo },
    })
  }

  revokeAccountSession(sessionId) {
    return this.request(`/v1/account/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
  }

  changePassword(currentPassword, newPassword) {
    return this.request('/v1/account/password', {
      method: 'PUT',
      body: {
        current_password: currentPassword,
        new_password: newPassword,
      },
    })
  }

  getSubscriptions() {
    return this.apiRequest('/subscriptions/')
  }

  async getSubscriptionGroups() {
    try {
      return await this.apiRequest('/subscriptions/groups/')
    } catch (error) {
      if (error.status === 404) return null
      throw error
    }
  }

  createSubscriptionGroup(group) {
    return this.apiRequest('/subscriptions/groups/', { method: 'POST', body: group })
  }

  updateSubscriptionGroup(groupId, group) {
    return this.apiRequest(`/subscriptions/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      body: group,
    })
  }

  deleteSubscriptionGroup(groupId) {
    return this.apiRequest(`/subscriptions/groups/${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    })
  }

  addSubscriptionGroupChannel(groupId, channelId) {
    return this.apiRequest(
      `/subscriptions/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}`,
      { method: 'PUT' }
    )
  }

  removeSubscriptionGroupChannel(groupId, channelId) {
    return this.apiRequest(
      `/subscriptions/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}`,
      { method: 'DELETE' }
    )
  }

  subscribe(channel) {
    return this.apiRequest('/subscriptions/', { method: 'PUT', body: channel })
  }

  subscribeBulk(channels) {
    return this.apiRequest('/subscriptions/bulk', { method: 'PUT', body: channels })
  }

  unsubscribe(channelId) {
    return this.apiRequest(`/subscriptions/${encodeURIComponent(channelId)}`, { method: 'DELETE' })
  }

  getPlaylists() {
    return this.apiRequest('/playlists/')
  }

  getPlaylistBookmarks() {
    return this.apiRequest('/playlist_bookmarks/')
  }

  createPlaylistBookmark(bookmark) {
    return this.apiRequest('/playlist_bookmarks/', { method: 'POST', body: bookmark })
  }

  deletePlaylistBookmark(playlistId) {
    return this.apiRequest(
      `/playlist_bookmarks/${encodeURIComponent(playlistId)}`,
      { method: 'DELETE' }
    )
  }

  getPlaylist(playlistId) {
    return this.apiRequest(`/playlists/${encodeURIComponent(playlistId)}`)
  }

  createPlaylist(playlist) {
    return this.apiRequest('/playlists/', { method: 'POST', body: playlist })
  }

  updatePlaylist(playlistId, playlist) {
    return this.apiRequest(`/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'PATCH',
      body: playlist,
    })
  }

  deletePlaylist(playlistId) {
    return this.apiRequest(`/playlists/${encodeURIComponent(playlistId)}`, { method: 'DELETE' })
  }

  addPlaylistVideos(playlistId, videos) {
    return this.apiRequest(`/playlists/${encodeURIComponent(playlistId)}/videos`, {
      method: 'POST',
      body: videos,
    })
  }

  removePlaylistVideo(playlistId, videoId) {
    return this.apiRequest(
      `/playlists/${encodeURIComponent(playlistId)}/videos/${encodeURIComponent(videoId)}`,
      { method: 'DELETE' }
    )
  }

  async getWatchHistory() {
    const history = []
    const capabilities = await this.getCapabilities()
    const pageSize = Number.isInteger(capabilities.history_page_size)
      ? capabilities.history_page_size
      : LEGACY_HISTORY_PAGE_SIZE
    const pageSizeQuery = capabilities.history_page_size ? `&page_size=${pageSize}` : ''

    for (let page = 1; ; page++) {
      let entries
      try {
        entries = await this.apiRequest(
          `/watch_history/?page=${page}&order=added_date_desc${pageSizeQuery}`
        )
      } catch (error) {
        if (error.status === 404) return null
        throw error
      }
      history.push(...entries)
      if (entries.length < pageSize) {
        return history
      }
    }
  }

  putWatchHistory(entry) {
    return this.apiRequest('/watch_history/', { method: 'PUT', body: entry })
  }

  putWatchHistoryBulk(entries) {
    return this.apiRequest('/watch_history/bulk', { method: 'PUT', body: entries })
  }

  deleteWatchHistory(videoId) {
    return this.apiRequest(`/watch_history/${encodeURIComponent(videoId)}`, { method: 'DELETE' })
  }

  async getChannelPlaybackSpeeds() {
    try {
      return await this.apiRequest('/channel_playback_speeds/')
    } catch (error) {
      if (error.status === 404) return null
      throw error
    }
  }
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

function videoToRemote(video) {
  return syncVideoToRemote(video)
}

function videoToLocal(video, timeAdded = Date.now()) {
  return {
    videoId: video.id,
    title: video.title,
    author: video.uploader.name,
    authorId: video.uploader.id,
    lengthSeconds: video.duration,
    published: video.upload_date,
    timeAdded,
    playlistItemId: generateRandomUniqueId(),
    type: 'video',
  }
}

function playlistMetadataFromLocal(playlist) {
  return {
    id: playlist._id,
    title: playlist.playlistName,
    description: playlist.description || '',
    thumbnail_url: null,
  }
}

function playlistMetadataFromRemote(playlist) {
  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description || '',
    thumbnail_url: playlist.thumbnail_url ?? null,
  }
}

function metadataEquals(first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function selectPlaylistMetadata(local, remote, previous) {
  if (!local) return playlistMetadataFromRemote(remote)
  if (!remote) return playlistMetadataFromLocal(local)

  const localMetadata = playlistMetadataFromLocal(local)
  const remoteMetadata = playlistMetadataFromRemote(remote)
  if (!previous) return localMetadata

  const localChanged = !metadataEquals(localMetadata, previous)
  const remoteChanged = !metadataEquals(remoteMetadata, previous)
  return remoteChanged && !localChanged ? remoteMetadata : localMetadata
}

function isSameLocalPlaylist(playlist, metadata, videos) {
  return playlist.playlistName === metadata.title &&
    (playlist.description || '') === metadata.description &&
    playlist.videos.length === videos.length &&
    playlist.videos.every((video, index) => video.videoId === videos[index].videoId)
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
  const localPlaylists = store.state.playlists.playlists
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
    const remoteMetadata = remote ? { ...remote.playlist, id } : null
    const metadata = selectPlaylistMetadata(local, remoteMetadata, previous[id]?.metadata)
    let remoteId = remote?.remoteId ?? id

    if (!remote) {
      const createdPlaylist = await client.createPlaylist(metadata)
      remoteId = createdPlaylist?.id ?? id
      remote = { playlist: { ...metadata, id: remoteId }, videos: [], remoteId }
    } else if (!metadataEquals(metadata, playlistMetadataFromRemote(remoteMetadata))) {
      await client.updatePlaylist(remoteId, metadata)
    }

    const localVideos = local?.videos ?? []
    const localVideosById = mapBy(
      localVideos.filter(video => videoToRemote(video) !== null),
      video => video.videoId
    )
    const unsyncableLocalVideos = localVideos.filter(video => videoToRemote(video) === null)
    const remoteVideosById = mapBy(remote.videos, video => video.id)
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
    const remoteVideosToAdd = Array.from(mergedVideoIds)
      .filter(videoId => !remoteVideosById.has(videoId))
      .map(videoId => videoToRemote(localVideosById.get(videoId)))
      .filter(Boolean)

    if (remoteVideosToAdd.length > 0) {
      await client.addPlaylistVideos(remoteId, remoteVideosToAdd)
    }
    for (const videoId of remoteVideosById.keys()) {
      if (!mergedVideoIds.has(videoId)) {
        await client.removePlaylistVideo(remoteId, videoId)
      }
    }

    const mergedVideos = Array.from(mergedVideoIds).map(videoId => {
      return localVideosById.get(videoId) ?? videoToLocal(remoteVideosById.get(videoId))
    }).concat(unsyncableLocalVideos)

    if (!local) {
      local = {
        _id: id,
        playlistName: metadata.title,
        description: metadata.description,
        protected: false,
        videos: mergedVideos,
      }
      await store.dispatch('addPlaylist', local)
    } else if (!isSameLocalPlaylist(local, metadata, mergedVideos)) {
      await store.dispatch('updatePlaylist', {
        ...deepCopy(local),
        playlistName: metadata.title,
        description: metadata.description,
        videos: mergedVideos,
      })
    }

    nextSnapshot[id] = {
      remoteId,
      metadata,
      videos: Array.from(mergedVideoIds),
    }
  }

  return nextSnapshot
}

export async function syncHistory(client, store, previous = {}, options = {}) {
  const historyChanged = new Error('Watch history changed during sync. Try again.')
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
        options,
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
    const { next, historyToUpload, remoteDeletions, insertions, updates, deletions } = merged
    const legacy = typeof client.applyWatchHistoryChanges !== 'function'
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
      if (legacy && (completed || acknowledgedUpserts.size || acknowledgedDeletions.size)) {
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
