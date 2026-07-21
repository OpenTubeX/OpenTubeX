import { MAIN_PROFILE_ID } from '../../constants'
import { deepCopy } from './utils'
import { generateRandomUniqueId } from './playlists'

const HISTORY_PAGE_SIZE = 50
const BULK_SYNC_CHUNK_SIZE = 100
const REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_CHANNEL_AVATAR = 'https://yt3.googleusercontent.com/ytc/default'
const YOUTUBE_VIDEO_THUMBNAIL_REGEX = /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\//

export class SyncServerError extends Error {
  constructor(message, status = null) {
    super(message)
    this.name = 'SyncServerError'
    this.status = status
  }
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
  }

  async request(path, options = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const headers = { Accept: 'application/json', ...options.headers }

    if (options.body != null) {
      headers['Content-Type'] = 'application/json'
    }
    if (this.token) {
      headers.Authorization = this.token
    }

    try {
      const response = await fetch(`${this.serverUrl}${path}`, {
        ...options,
        headers,
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })
      const text = await response.text()

      if (!response.ok) {
        throw new SyncServerError(text || `Sync server returned ${response.status}`, response.status)
      }

      if (!text) return null

      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    } catch (error) {
      if (error instanceof SyncServerError) {
        throw error
      }
      if (error?.name === 'AbortError') {
        throw new SyncServerError('Sync server request timed out')
      }
      throw new SyncServerError(error?.message || 'Unable to reach sync server')
    } finally {
      clearTimeout(timeout)
    }
  }

  health() {
    return this.request('/health')
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

  async authenticate(mode, name, password) {
    const response = await this.apiRequest(`/account/${mode}`, {
      method: 'POST',
      body: { name, password },
    })
    this.token = response.jwt
    return response.jwt
  }

  deleteAccount(password) {
    return this.apiRequest('/account/delete', {
      method: 'DELETE',
      body: { password },
    })
  }

  getSubscriptions() {
    return this.apiRequest('/subscriptions/')
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

    for (let page = 1; ; page++) {
      let entries
      try {
        entries = await this.apiRequest(`/watch_history/?page=${page}&order=added_date_desc`)
      } catch (error) {
        if (error.status === 404) return null
        throw error
      }
      history.push(...entries)
      if (entries.length < HISTORY_PAGE_SIZE) {
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

  putChannelPlaybackSpeed(speed) {
    return this.apiRequest('/channel_playback_speeds/', { method: 'PUT', body: speed })
  }

  deleteChannelPlaybackSpeed(channelId) {
    return this.apiRequest(
      `/channel_playback_speeds/${encodeURIComponent(channelId)}`,
      { method: 'DELETE' }
    )
  }
}

function mapBy(items, getId) {
  return new Map(items.map(item => [getId(item), item]))
}

async function uploadInChunks(items, uploadBulk, uploadSingle) {
  if (items.length === 0) return

  try {
    for (let index = 0; index < items.length; index += BULK_SYNC_CHUNK_SIZE) {
      await uploadBulk(items.slice(index, index + BULK_SYNC_CHUNK_SIZE))
    }
    return
  } catch (error) {
    if (error.status !== 404) throw error
  }

  // Older LibreTube-compatible servers do not expose bulk endpoints.
  for (const item of items) {
    await uploadSingle(item)
  }
}

function mergeIds(localIds, remoteIds, previousIds = []) {
  const local = new Set(localIds)
  const remote = new Set(remoteIds)
  const previous = new Set(previousIds)
  const allIds = new Set([...local, ...remote, ...previous])

  return new Set(Array.from(allIds).filter(id => {
    if (!previous.has(id)) {
      return local.has(id) || remote.has(id)
    }

    // Once both sides have seen an item, a deletion on either side wins.
    return local.has(id) && remote.has(id)
  }))
}

function normalizeChannelAvatar(avatar) {
  if (!avatar || avatar === DEFAULT_CHANNEL_AVATAR || YOUTUBE_VIDEO_THUMBNAIL_REGEX.test(avatar)) {
    return null
  }

  return avatar
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
  const videoId = video.videoId
  const uploaderId = video.authorId

  if (!videoId || !uploaderId) {
    return null
  }

  return {
    id: videoId,
    title: video.title || videoId,
    upload_date: Number.isFinite(video.published) ? video.published : 0,
    uploader: {
      id: uploaderId,
      name: video.author || uploaderId,
      avatar: normalizeChannelAvatar(video.authorThumbnail) || DEFAULT_CHANNEL_AVATAR,
      verified: false,
    },
    thumbnail_url: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: Number.isFinite(video.lengthSeconds) ? Math.round(video.lengthSeconds) : 0,
  }
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

export async function syncSubscriptions(client, store, previousIds = []) {
  const profiles = store.state.profiles.profileList
  const mainProfile = profiles.find(profile => profile._id === MAIN_PROFILE_ID) ?? profiles[0]
  const localSubscriptions = mainProfile.subscriptions.map(channel => ({
    ...channel,
    thumbnail: normalizeChannelAvatar(channel.thumbnail),
  }))
  const localById = mapBy(localSubscriptions, channel => channel.id)
  const remoteSubscriptions = await client.getSubscriptions()
  const remoteById = mapBy(remoteSubscriptions, channel => channel.id)
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), previousIds)

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

function parseChannelPlaybackSpeeds(value) {
  try {
    const speeds = JSON.parse(value)
    return Object.fromEntries(Object.entries(speeds).filter(([, speed]) => {
      return Number.isFinite(speed) && speed > 0.07
    }))
  } catch {
    return {}
  }
}

export async function syncChannelPlaybackSpeeds(client, store, previous = {}) {
  const local = parseChannelPlaybackSpeeds(store.state.settings.channelPlaybackSpeeds)
  const remoteEntries = await client.getChannelPlaybackSpeeds()
  if (remoteEntries === null) return null

  const remote = Object.fromEntries(remoteEntries.map(entry => {
    return [entry.channel_id, entry.playback_speed]
  }))
  const mergedIds = mergeIds(Object.keys(local), Object.keys(remote), Object.keys(previous))
  const merged = {}

  for (const channelId of Object.keys(remote)) {
    if (!mergedIds.has(channelId)) {
      await client.deleteChannelPlaybackSpeed(channelId)
    }
  }

  for (const channelId of mergedIds) {
    const localSpeed = local[channelId]
    const remoteSpeed = remote[channelId]
    const previousSpeed = previous[channelId]
    const localChanged = localSpeed !== previousSpeed
    const remoteChanged = remoteSpeed !== previousSpeed
    const speed = remoteSpeed !== undefined && remoteChanged && !localChanged
      ? remoteSpeed
      : localSpeed ?? remoteSpeed

    merged[channelId] = speed
    if (remoteSpeed !== speed) {
      await client.putChannelPlaybackSpeed({
        channel_id: channelId,
        playback_speed: speed,
      })
    }
  }

  if (!metadataEquals(local, merged)) {
    await store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(merged))
  }

  return merged
}

export async function syncPlaylists(client, store, previous = {}) {
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
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), Object.keys(previous))
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
      previous[id]?.videos
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

function historyToRemote(record) {
  const video = videoToRemote(record)
  if (!video) return null

  const watchProgress = Number.isFinite(record.watchProgress) ? record.watchProgress : 0
  return {
    video,
    metadata: {
      added_date: Number.isFinite(record.timeWatched) ? record.timeWatched : Date.now(),
      watched_state: record.isWatched ? 'completed' : watchProgress > 0 ? 'watching' : 'planned',
      position_millis: Math.max(0, Math.round(watchProgress * 1000)),
    },
  }
}

function historyToLocal(entry) {
  return {
    videoId: entry.video.id,
    title: entry.video.title,
    author: entry.video.uploader.name,
    authorId: entry.video.uploader.id,
    published: entry.video.upload_date,
    description: '',
    lengthSeconds: entry.video.duration,
    watchProgress: (entry.metadata.position_millis ?? 0) / 1000,
    isWatched: entry.metadata.watched_state === 'completed',
    timeWatched: entry.metadata.added_date,
    isLive: entry.video.duration <= 0,
    type: 'video',
  }
}

export async function syncHistory(client, store, previousIds = []) {
  const localHistory = store.state.history.historyCacheSorted
  const syncableLocalHistory = localHistory.filter(record => historyToRemote(record) !== null)
  const unsyncableLocalHistory = localHistory.filter(record => historyToRemote(record) === null)
  const localById = mapBy(syncableLocalHistory, record => record.videoId)
  const remoteHistory = await client.getWatchHistory()
  if (remoteHistory === null) return null
  const remoteById = mapBy(remoteHistory, entry => entry.video.id)
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), previousIds)
  const mergedHistory = [...unsyncableLocalHistory]
  const historyToUpload = []

  for (const id of remoteById.keys()) {
    if (!mergedIds.has(id)) {
      await client.deleteWatchHistory(id)
    }
  }

  for (const id of mergedIds) {
    const local = localById.get(id)
    const remote = remoteById.get(id)
    const useLocal = local && (!remote || local.timeWatched >= remote.metadata.added_date)
    const merged = useLocal ? local : historyToLocal(remote)
    const remotePayload = historyToRemote(merged)

    if (useLocal && remotePayload) {
      historyToUpload.push(remotePayload)
    }
    mergedHistory.push(merged)
  }

  await uploadInChunks(
    historyToUpload,
    entries => client.putWatchHistoryBulk(entries),
    entry => client.putWatchHistory(entry)
  )

  await store.dispatch('overwriteHistory', new Map(
    mergedHistory.map(record => [record.videoId, record])
  ))

  return Array.from(mergedIds)
}
