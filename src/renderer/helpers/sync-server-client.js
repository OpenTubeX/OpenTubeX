import { runBackgroundJob } from './background-jobs.js'
import packageDetails from '../../../package.json'
import { applySyncServerUserAgent } from '../../syncServerUserAgent'
import {
  SyncServerCancelledError,
  SyncServerError,
  SyncServerUnsupportedError,
} from './sync-server-errors'
import { createSyncServerRequestHeaders } from './sync-server-request'
import { capacitorHttpFetch } from './api/capacitor-http'
import { delegateRequests } from './networkRecovery'

const LEGACY_HISTORY_PAGE_SIZE = 50
// The server may wait up to 30 seconds each for a database connection and a
// SQLite lock under load, so leave room for that plus a slow transfer.
const REQUEST_TIMEOUT_MS = 60_000
// The server holds /changes open for 25 seconds before rereading the cursor.
const CHANGES_WAIT_TIMEOUT_MS = 25_000 + REQUEST_TIMEOUT_MS
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
    // Sync retries and times out its own requests. In the app's recovery queue,
    // a long poll held past its header timeout would mark the server as failed
    // and delay every other sync request until the poll itself timed out.
    const releaseRequest = delegateRequests(controller.signal, { ownDeadline: true })
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
      releaseRequest()
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

  async supportsPlaylistThumbnails() {
    const capabilities = await this.getCapabilities()
    return capabilities.playlist_thumbnails === 1
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
    return this.request(`/v1/encrypted_sync/changes?since=${encodeURIComponent(cursor)}`, { timeoutMs: CHANGES_WAIT_TIMEOUT_MS })
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
      // Omitted custom thumbnails are left alone by released clients. An empty
      // value explicitly restores the default without changing thumbnail_url.
      body: {
        ...playlist,
        ...(Object.hasOwn(playlist, 'custom_thumbnail') ? { custom_thumbnail: playlist.custom_thumbnail ?? '' } : {}),
      },
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
    const advertisedPageSize = capabilities.history_page_size
    const hasUsablePageSize = Number.isInteger(advertisedPageSize) && advertisedPageSize > 0
    const pageSize = hasUsablePageSize ? advertisedPageSize : LEGACY_HISTORY_PAGE_SIZE
    const pageSizeQuery = hasUsablePageSize ? `&page_size=${pageSize}` : ''

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
      // An empty page ends paging even if the server ignored the requested
      // size, so a misreported capability cannot keep this loop running.
      if (entries.length === 0 || entries.length < pageSize) {
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
