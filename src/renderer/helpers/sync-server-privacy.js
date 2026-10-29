// @ts-check
import * as privacy from './sync-server-privacy-crypto.js'
import { runBackgroundJob } from './background-jobs.js'
import { applyRemoteHistoryChanges } from './sync-history-merge.js'

export const PRIVACY_VERSION = privacy.PRIVACY_VERSION
export const getPrivacySalt = privacy.getPrivacySalt
export const preparePrivacyKey = privacy.preparePrivacyKey

export function decryptSyncDocument(payload, exportedKey) {
  return runBackgroundJob('decryptSyncDocument', { payload, exportedKey })
}

export function decryptLegacySyncDocument(payload, exportedKey) {
  return runBackgroundJob('decryptLegacySyncDocument', { payload, exportedKey })
}

export function encryptSyncDocument(data, exportedKey, salt, options) {
  return runBackgroundJob('encryptSyncDocument', { data, exportedKey, salt, options })
}

// A change usually holds a few entries. Collection-sized padding would make
// each one as large as a small collection.
const SYNC_CHANGE_PADDING_BYTES = 4 * 1024

/** Collections whose sync uploads may append a change instead of the full value. */
export const SYNC_CHANGE_COLLECTIONS = new Set(['history'])

export function encryptSyncChange(change, exportedKey, salt) {
  return encryptSyncDocument(change, exportedKey, salt, { paddingBytes: SYNC_CHANGE_PADDING_BYTES })
}

function applySyncChange(collection, data, change) {
  if (!SYNC_CHANGE_COLLECTIONS.has(collection) || !change || typeof change !== 'object' ||
      !Array.isArray(change.upserts) || !Array.isArray(change.deletions)) {
    throw new Error('Sync data was saved by a newer OpenTubeX version. Update OpenTubeX to sync.')
  }
  return applyRemoteHistoryChanges({ history: data ?? [], upserts: change.upserts, deletions: change.deletions })
}

/**
 * Decrypts a collection response and applies its appended changes.
 * @param {string} collection
 * @param {{ revision: number, payload?: string | null, base_revision?: number, changes?: { revision: number, payload: string }[] }} response
 * @param {{ revision: number, data: any } | null} base The value the request's `since` revision refers to
 * @param {string} exportedKey
 * @returns {Promise<{ revision: number, data: any }>} `data` is undefined for a collection that was never uploaded
 */
export async function readSyncCollection(collection, response, base, exportedKey) {
  let data
  let revision
  if (response.payload) {
    data = await decryptSyncDocument(response.payload, exportedKey)
    revision = response.base_revision ?? response.revision
  } else if (response.revision > 0) {
    // The server omits the payload when the changes extend `since`.
    if (!base) throw new Error('Invalid encrypted sync response')
    data = base.data
    revision = base.revision
  } else {
    return { revision: 0, data: undefined }
  }
  for (const change of response.changes ?? []) {
    if (change.revision !== revision + 1) throw new Error('Invalid encrypted sync response')
    data = applySyncChange(collection, data, await decryptSyncDocument(change.payload, exportedKey))
    revision = change.revision
  }
  if (revision !== response.revision) throw new Error('Invalid encrypted sync response')
  return { revision, data }
}

export function createEmptySyncDocument() {
  return {
    version: PRIVACY_VERSION,
    subscriptions: [],
    playlists: [],
    history: [],
    watchStats: [],
    liveReminders: [],
    seenVideos: [],
    seenPosts: [],
    playbackSpeeds: [],
    subscriptionGroups: [],
    playlistBookmarks: [],
    profiles: [],
    settings: [],
    sessions: [],
    sessionsV2: null,
  }
}

export function migrateLegacyPlaybackSpeedsToSettings(document, localValue, updatedAt = Date.now()) {
  if (document.settings.some(entry => entry.key === 'channelPlaybackSpeeds')) return false

  const legacy = Object.fromEntries(document.playbackSpeeds
    .filter(entry => entry.channel_id && Number.isFinite(entry.playback_speed) &&
      entry.playback_speed > 0.07)
    .map(entry => [entry.channel_id, entry.playback_speed]))
  if (Object.keys(legacy).length === 0) return false

  let local = {}
  try {
    const parsed = JSON.parse(localValue)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) local = parsed
  } catch {}

  document.settings.push({
    key: 'channelPlaybackSpeeds',
    value: JSON.stringify({ ...legacy, ...local }),
    updatedAt,
  })
  return true
}

export async function loadLegacySyncDocument(client) {
  const [subscriptions, playlistHeaders, history, playbackSpeeds, subscriptionGroups, playlistBookmarks] =
    await Promise.all([
      client.getSubscriptions(),
      client.getPlaylists(),
      client.getWatchHistory(),
      client.getChannelPlaybackSpeeds(),
      client.getSubscriptionGroups(),
      client.getPlaylistBookmarks(),
    ])
  const playlists = await Promise.all(
    playlistHeaders.map(playlist => client.getPlaylist(playlist.id))
  )

  return {
    version: PRIVACY_VERSION,
    subscriptions,
    playlists,
    history: history ?? [],
    playbackSpeeds: playbackSpeeds ?? [],
    profiles: subscriptionGroups,
    playlistBookmarks,
    settings: [],
  }
}

/**
 * Applies a sync's merges to a document of decrypted collections. The
 * collections may be shared with the collection cache, so edits replace the
 * changed arrays and entries instead of modifying them. Collections absent from
 * `touched` still hold their downloaded value.
 */
export class EncryptedSyncAdapter {
  /** @type {Set<string>} */
  touched = new Set()
  /** @type {Map<string, any>} */
  #historyUpserts = new Map()
  /** @type {Set<string>} */
  #historyDeletions = new Set()

  constructor(document) {
    this.document = document
    this.document.subscriptions ??= []
    this.document.playlists ??= []
    this.document.history ??= []
    this.document.watchStats ??= []
    this.document.liveReminders ??= []
    this.document.seenVideos ??= []
    this.document.seenPosts ??= []
    this.document.playbackSpeeds ??= []
    this.document.profiles ??= []
    this.document.settings ??= []
    this.document.sessions ??= []
    this.document.sessionsV2 ??= null
    this.document.playlistBookmarks ??= []
  }

  #set(collection, value) {
    this.touched.add(collection)
    this.document[collection] = value
  }

  #updateEntry(collection, matches, update) {
    this.#set(collection, this.document[collection].map(entry => matches(entry) ? update(entry) : entry))
  }

  async getSubscriptions() { return structuredClone(this.document.subscriptions) }
  async supportsBulkSync() { return true }
  async supportsPlaylistThumbnails() { return true }
  async supportsPlaylistSortOrder() { return true }
  async subscribe(channel) { await this.subscribeBulk([channel]) }
  async subscribeBulk(channels) {
    this.#set('subscriptions', this.document.subscriptions.concat(structuredClone(channels)))
  }

  async unsubscribe(id) {
    this.#set('subscriptions', this.document.subscriptions.filter(channel => channel.id !== id))
  }

  async getPlaylists() {
    return structuredClone(this.document.playlists.map(entry => entry.playlist))
  }

  async getPlaylist(id) {
    return runBackgroundJob('clone', { value: this.document.playlists.find(entry => entry.playlist.id === id) })
  }

  async getPlaylistBookmarks() {
    return structuredClone(this.document.playlistBookmarks)
  }

  async createPlaylistBookmark(bookmark) {
    this.#set('playlistBookmarks', this.document.playlistBookmarks.concat(structuredClone(bookmark)))
  }

  async deletePlaylistBookmark(id) {
    this.#set('playlistBookmarks', this.document.playlistBookmarks
      .filter(entry => entry.playlist.id !== id))
  }

  async createPlaylist(playlist) {
    this.#set('playlists', this.document.playlists.concat({ playlist: structuredClone(playlist), videos: [] }))
    return structuredClone(playlist)
  }

  async updatePlaylist(id, playlist) {
    this.#updateEntry('playlists', entry => entry.playlist.id === id, entry => ({
      ...entry, playlist: { ...entry.playlist, ...structuredClone(playlist), id },
    }))
  }

  async deletePlaylist(id) {
    this.#set('playlists', this.document.playlists.filter(entry => entry.playlist.id !== id))
  }

  async addPlaylistVideos(id, videos) {
    this.#updateEntry('playlists', entry => entry.playlist.id === id, entry => {
      const current = entry.videos.slice()
      const indices = new Map(current.map((video, index) => [video.id, index]))
      for (const video of structuredClone(videos)) {
        const index = indices.get(video.id)
        if (index == null) {
          indices.set(video.id, current.length)
          current.push(video)
        } else {
          current[index] = video
        }
      }
      return { ...entry, videos: current }
    })
  }

  async removePlaylistVideo(playlistId, videoId) {
    this.#updateEntry('playlists', entry => entry.playlist.id === playlistId, entry => ({
      ...entry, videos: entry.videos.filter(video => video.id !== videoId),
    }))
  }

  /** The merge only reads this value, so it is not copied. */
  async getWatchHistory() { return this.document.history }
  async getWatchStats() { return structuredClone(this.document.watchStats) }
  async putWatchStats(value) { this.#set('watchStats', structuredClone(value)) }
  async getLiveReminders() { return structuredClone(this.document.liveReminders) }
  async putLiveReminders(value) { this.#set('liveReminders', structuredClone(value)) }

  async getSeenVideos() { return structuredClone(this.document.seenVideos) }

  async putSeenVideos(entries) { this.#set('seenVideos', structuredClone(entries)) }

  async getSeenPosts() { return structuredClone(this.document.seenPosts) }

  async putSeenPosts(entries) { this.#set('seenPosts', structuredClone(entries)) }

  async getSessions() {
    return structuredClone(this.document.sessionsV2 ?? this.document.sessions)
  }

  async putSessions(sessions) {
    this.#set('sessionsV2', structuredClone(sessions))
  }

  async putWatchHistory(entry) { await this.applyWatchHistoryChanges([structuredClone(entry)], []) }

  async putWatchHistoryBulk(entries) { await this.applyWatchHistoryChanges(structuredClone(entries), []) }

  async applyWatchHistoryChanges(upserts, deletions) {
    // A single pass over the entries costs less than sending them to a worker.
    this.#set('history', applyRemoteHistoryChanges({ history: this.document.history, upserts, deletions }))
    for (const id of deletions) {
      this.#historyUpserts.delete(id)
      this.#historyDeletions.add(id)
    }
    for (const entry of upserts) {
      // Applying the combined change moves upserts to the end in this order.
      this.#historyUpserts.delete(entry.video.id)
      this.#historyUpserts.set(entry.video.id, entry)
    }
  }

  /**
   * The edits since the document was loaded, as one change that turns the
   * loaded collection into the current one.
   * @param {string} collection
   */
  getChange(collection) {
    if (collection !== 'history' || !this.touched.has('history')) return null
    return { upserts: [...this.#historyUpserts.values()], deletions: [...this.#historyDeletions] }
  }

  async deleteWatchHistory(id) { await this.applyWatchHistoryChanges([], [id]) }

  async getChannelPlaybackSpeeds() { return structuredClone(this.document.playbackSpeeds) }

  async getSubscriptionGroups() { return structuredClone(this.document.profiles) }

  async createSubscriptionGroup(group) {
    const created = { ...structuredClone(group), id: group.id }
    this.#set('profiles', this.document.profiles.concat({ group: created, channels: [] }))
    return structuredClone(created)
  }

  async updateSubscriptionGroup(id, group) {
    this.#updateEntry('profiles', entry => entry.group.id === id, entry => ({
      ...entry, group: { ...entry.group, ...structuredClone(group), id },
    }))
  }

  async deleteSubscriptionGroup(id) {
    this.#set('profiles', this.document.profiles.filter(entry => entry.group.id !== id))
  }

  async addSubscriptionGroupChannel(groupId, channelId) {
    const channel = this.document.subscriptions.find(channel => channel.id === channelId) ?? {
      id: channelId,
    }
    this.#updateEntry('profiles', entry => entry.group.id === groupId, entry => (
      entry.channels.some(item => item.id === channelId)
        ? entry
        : { ...entry, channels: entry.channels.concat(structuredClone(channel)) }
    ))
  }

  async removeSubscriptionGroupChannel(groupId, channelId) {
    this.#updateEntry('profiles', entry => entry.group.id === groupId, entry => ({
      ...entry, channels: entry.channels.filter(channel => channel.id !== channelId),
    }))
  }

  async getSettings() { return structuredClone(this.document.settings) }
  async putSettings(settings) { this.#set('settings', structuredClone(settings)) }
}
