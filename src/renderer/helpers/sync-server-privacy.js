import * as privacy from './sync-server-privacy-crypto.js'
import { runBackgroundJob } from './background-jobs.js'

export const PRIVACY_VERSION = privacy.PRIVACY_VERSION
export const getPrivacySalt = privacy.getPrivacySalt
export const preparePrivacyKey = privacy.preparePrivacyKey

export function decryptSyncDocument(payload, exportedKey) {
  return runBackgroundJob('decryptSyncDocument', { payload, exportedKey })
}

export function decryptLegacySyncDocument(payload, exportedKey) {
  return runBackgroundJob('decryptLegacySyncDocument', { payload, exportedKey })
}

export function encryptSyncDocument(data, exportedKey, salt) {
  return runBackgroundJob('encryptSyncDocument', { data, exportedKey, salt })
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

export class EncryptedSyncAdapter {
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

  async getSubscriptions() { return structuredClone(this.document.subscriptions) }
  async supportsBulkSync() { return true }
  async subscribe(channel) { this.document.subscriptions.push(structuredClone(channel)) }
  async subscribeBulk(channels) { this.document.subscriptions.push(...structuredClone(channels)) }
  async unsubscribe(id) {
    this.document.subscriptions = this.document.subscriptions.filter(channel => channel.id !== id)
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
    this.document.playlistBookmarks.push(structuredClone(bookmark))
  }

  async deletePlaylistBookmark(id) {
    this.document.playlistBookmarks = this.document.playlistBookmarks
      .filter(entry => entry.playlist.id !== id)
  }

  async createPlaylist(playlist) {
    this.document.playlists.push({ playlist: structuredClone(playlist), videos: [] })
    return structuredClone(playlist)
  }

  async updatePlaylist(id, playlist) {
    const entry = this.document.playlists.find(entry => entry.playlist.id === id)
    entry.playlist = { ...entry.playlist, ...structuredClone(playlist), id }
  }

  async deletePlaylist(id) {
    this.document.playlists = this.document.playlists.filter(entry => entry.playlist.id !== id)
  }

  async addPlaylistVideos(id, videos) {
    this.document.playlists.find(entry => entry.playlist.id === id).videos.push(...structuredClone(videos))
  }

  async removePlaylistVideo(playlistId, videoId) {
    const entry = this.document.playlists.find(entry => entry.playlist.id === playlistId)
    entry.videos = entry.videos.filter(video => video.id !== videoId)
  }

  async getWatchHistory() { return runBackgroundJob('clone', { value: this.document.history }) }
  async getWatchStats() { return structuredClone(this.document.watchStats) }
  async putWatchStats(value) { this.document.watchStats = structuredClone(value) }
  async getLiveReminders() { return structuredClone(this.document.liveReminders) }
  async putLiveReminders(value) { this.document.liveReminders = structuredClone(value) }

  async getSeenVideos() { return structuredClone(this.document.seenVideos) }

  async putSeenVideos(entries) { this.document.seenVideos = structuredClone(entries) }

  async getSeenPosts() { return structuredClone(this.document.seenPosts) }

  async putSeenPosts(entries) { this.document.seenPosts = structuredClone(entries) }

  async getSessions() {
    return structuredClone(this.document.sessionsV2 ?? this.document.sessions)
  }

  async putSessions(sessions) {
    this.document.sessionsV2 = structuredClone(sessions)
  }

  async putWatchHistory(entry) {
    this.document.history = this.document.history.filter(item => item.video.id !== entry.video.id)
    this.document.history.push(structuredClone(entry))
  }

  async putWatchHistoryBulk(entries) {
    for (const entry of entries) await this.putWatchHistory(entry)
  }

  async applyWatchHistoryChanges(upserts, deletions) {
    this.document.history = await runBackgroundJob('applyRemoteHistoryChanges', {
      history: this.document.history, upserts, deletions,
    })
  }

  async deleteWatchHistory(id) {
    this.document.history = this.document.history.filter(entry => entry.video.id !== id)
  }

  async getChannelPlaybackSpeeds() { return structuredClone(this.document.playbackSpeeds) }

  async getSubscriptionGroups() { return structuredClone(this.document.profiles) }

  async createSubscriptionGroup(group) {
    const created = { ...structuredClone(group), id: group.id }
    this.document.profiles.push({ group: created, channels: [] })
    return structuredClone(created)
  }

  async updateSubscriptionGroup(id, group) {
    const entry = this.document.profiles.find(entry => entry.group.id === id)
    entry.group = { ...entry.group, ...structuredClone(group), id }
  }

  async deleteSubscriptionGroup(id) {
    this.document.profiles = this.document.profiles.filter(entry => entry.group.id !== id)
  }

  async addSubscriptionGroupChannel(groupId, channelId) {
    const entry = this.document.profiles.find(entry => entry.group.id === groupId)
    const channel = this.document.subscriptions.find(channel => channel.id === channelId) ?? {
      id: channelId,
    }
    if (!entry.channels.some(item => item.id === channelId)) {
      entry.channels.push(structuredClone(channel))
    }
  }

  async removeSubscriptionGroupChannel(groupId, channelId) {
    const entry = this.document.profiles.find(entry => entry.group.id === groupId)
    entry.channels = entry.channels.filter(channel => channel.id !== channelId)
  }

  async getSettings() { return structuredClone(this.document.settings) }
  async putSettings(settings) { this.document.settings = structuredClone(settings) }
}
