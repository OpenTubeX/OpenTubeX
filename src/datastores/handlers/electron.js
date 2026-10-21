import { DBActions } from '../../constants'
import { runBackgroundJob } from '../../renderer/helpers/background-jobs.js'

/**
 * Payloads can contain Vue reactivity proxies (e.g. objects taken from Vuex
 * state), which Electron IPC cannot structured-clone ("An object could not be
 * cloned"). Datastore payloads are plain JSON documents, so strip reactivity
 * once here at the process boundary instead of in every caller.
 * @template T
 * @param {T} data
 * @returns {T}
 */
function toPlain(data) {
  return data === undefined ? undefined : JSON.parse(JSON.stringify(data))
}

// Copying more videos than this across the context bridge blocks the window
// noticeably, so they are serialized in a worker first.
const LARGE_PLAYLIST_VIDEO_COUNT = 1000

/**
 * Sends requests in call order, even while an earlier large payload is still
 * being serialized in a worker, so it cannot overwrite a later write.
 * @param {(action: string, data: unknown) => Promise<unknown>} send
 */
function createOrderedSender(send) {
  let previous = Promise.resolve()
  const sender = (action, data, { inWorker = false, beforeSend } = {}) => {
    const payload = inWorker ? runBackgroundJob('stringify', { value: data }) : toPlain(data)
    const sent = Promise.all([previous, payload]).then(([, value]) => {
      beforeSend?.()
      return { response: send(action, value) }
    })
    previous = sent.then(() => {}, () => {})
    return sent.then(({ response }) => response)
  }
  /** Resolves once every request made so far has been sent. */
  sender.sent = () => previous
  return sender
}

const dbSettings = (action, data) => window.ftElectron.dbSettings(action, toPlain(data))
const dbHistory = createOrderedSender((action, data) => window.ftElectron.dbHistory(action, data))
const dbWatchStats = (action, data) => window.ftElectron.dbWatchStats(action, toPlain(data))
const dbRecommendations = (action, data) => window.ftElectron.dbRecommendations(action, toPlain(data))

export const recommendations = {
  find: () => dbRecommendations(DBActions.GENERAL.FIND),
  record: event => dbRecommendations(DBActions.GENERAL.UPSERT, event),
  remove: ids => dbRecommendations(DBActions.GENERAL.DELETE_MULTIPLE, ids),
  reset: () => dbRecommendations(DBActions.GENERAL.DELETE_ALL),
}
const dbProfiles = (action, data) => window.ftElectron.dbProfiles(action, toPlain(data))
const dbPlaylists = createOrderedSender((action, data) => window.ftElectron.dbPlaylists(action, data))
const dbSearchHistory = (action, data) => window.ftElectron.dbSearchHistory(action, toPlain(data))
const dbSubscriptionCache = (action, data) => window.ftElectron.dbSubscriptionCache(action, toPlain(data))

class Settings {
  static mergeSeenPosts(update) {
    return dbSettings(DBActions.SETTINGS.MERGE_SEEN_POSTS, update)
  }

  static mergeSeenVideos(update) {
    return dbSettings(DBActions.SETTINGS.MERGE_SEEN_VIDEOS, update)
  }

  static find() {
    return dbSettings(DBActions.GENERAL.FIND)
  }

  static upsert(_id, value) {
    return dbSettings(DBActions.GENERAL.UPSERT, { _id, value })
  }

  static delete(_id) {
    return dbSettings(DBActions.GENERAL.DELETE, _id)
  }
}

class History {
  static sent() {
    return dbHistory.sent()
  }

  static updateSubscriptionState(update) {
    return dbHistory(DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE, update)
  }

  static find() {
    return dbHistory(DBActions.GENERAL.FIND)
  }

  static upsert(record) {
    return dbHistory(DBActions.GENERAL.UPSERT, record)
  }

  static overwrite(records) {
    // Imports replace the whole history, which would block this window for
    // seconds while crossing the context bridge.
    return dbHistory(DBActions.GENERAL.OVERWRITE, records, { inWorker: true })
  }

  static applySyncChanges(changes, assertActive) {
    // Large object graphs also block while crossing Electron's context bridge.
    return dbHistory(DBActions.HISTORY.APPLY_SYNC_CHANGES, changes, { inWorker: true, beforeSend: assertActive })
  }

  static updateWatchProgress(videoId, watchProgress) {
    return dbHistory(
      DBActions.HISTORY.UPDATE_WATCH_PROGRESS,
      { videoId, watchProgress }
    )
  }

  static updateLastViewedPlaylist(videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId) {
    return dbHistory(
      DBActions.HISTORY.UPDATE_PLAYLIST,
      { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId }
    )
  }

  static unsetLastViewedPlaylistForVideos(videoIds, lastViewedPlaylistId) {
    return dbHistory(DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, { videoIds, lastViewedPlaylistId })
  }

  static unsetLastViewedPlaylists(lastViewedPlaylistIds) {
    return dbHistory(DBActions.HISTORY.UNSET_PLAYLISTS, lastViewedPlaylistIds)
  }

  static delete(videoId) {
    return dbHistory(DBActions.GENERAL.DELETE, videoId)
  }

  static deleteOlderThan(cutoff) {
    return dbHistory(DBActions.HISTORY.DELETE_OLDER_THAN, cutoff)
  }

  static deleteAll() {
    return dbHistory(DBActions.GENERAL.DELETE_ALL)
  }
}

class WatchStats {
  static find() {
    return dbWatchStats(DBActions.GENERAL.FIND)
  }

  static mergeBackup(backup) {
    return dbWatchStats(DBActions.WATCH_STATS.MERGE_BACKUP, backup)
  }

  static addWatchTime(date, seconds) {
    return dbWatchStats(
      DBActions.WATCH_STATS.ADD_WATCH_TIME,
      { date, seconds }
    )
  }

  static migrateHistory() {
    return dbWatchStats(DBActions.WATCH_STATS.MIGRATE_HISTORY)
  }

  static getHistoricalAdjustment() {
    return dbWatchStats(DBActions.WATCH_STATS.GET_HISTORICAL_ADJUSTMENT)
  }

  static adjustHistoricalWatchTime(defaultSpeed, channelPlaybackSpeeds) {
    return dbWatchStats(
      DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME,
      { defaultSpeed, channelPlaybackSpeeds }
    )
  }

  static deleteAll() {
    return dbWatchStats(DBActions.GENERAL.DELETE_ALL)
  }
}

class Profiles {
  static create(profile) {
    return dbProfiles(DBActions.GENERAL.CREATE, profile)
  }

  static find() {
    return dbProfiles(DBActions.GENERAL.FIND)
  }

  static upsert(profile) {
    return dbProfiles(DBActions.GENERAL.UPSERT, profile)
  }

  static addChannelToProfiles(channel, profileIds) {
    return dbProfiles(DBActions.PROFILES.ADD_CHANNEL, { channel, profileIds })
  }

  static removeChannelFromProfiles(channelId, profileIds) {
    return dbProfiles(DBActions.PROFILES.REMOVE_CHANNEL, { channelId, profileIds })
  }

  static updateChannelSettings(channel, profileIds) {
    return dbProfiles(DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS, { channel, profileIds })
  }

  static batchUpdateChannelSettings(updates, profileIds) {
    // Preserve explicit undefined overrides through IPC; JSON would drop resets.
    const plainUpdates = updates.map(({ channelId, settings, updatedAt }) => ({
      channelId,
      updatedAt,
      settings: Object.fromEntries(Object.entries(settings).map(([key, value]) => [
        key, Array.isArray(value) ? [...value] : value
      ]))
    }))
    return window.ftElectron.dbProfiles(DBActions.PROFILES.BATCH_UPDATE_CHANNEL_SETTINGS, {
      updates: plainUpdates, profileIds: [...profileIds]
    })
  }

  static updateSubscriptionDetails(channels) {
    return dbProfiles(DBActions.PROFILES.UPDATE_SUBSCRIPTION_DETAILS, channels)
  }

  static delete(id) {
    return dbProfiles(DBActions.GENERAL.DELETE, id)
  }
}

class Playlists {
  static upsertIfUnchanged(playlist, previous) {
    return dbPlaylists(DBActions.PLAYLISTS.UPSERT_IF_UNCHANGED, { playlist, previous })
  }

  static repairMetadata(payload) {
    return dbPlaylists(DBActions.PLAYLISTS.REPAIR_METADATA, payload)
  }

  static create(playlists) {
    return dbPlaylists(DBActions.GENERAL.CREATE, playlists)
  }

  static find() {
    return dbPlaylists(DBActions.GENERAL.FIND)
  }

  static sent() {
    return dbPlaylists.sent()
  }

  static upsert(playlist) {
    return dbPlaylists(DBActions.GENERAL.UPSERT, playlist, {
      inWorker: playlist.videos?.length > LARGE_PLAYLIST_VIDEO_COUNT
    })
  }

  static upsertVideoByPlaylistId(_id, lastUpdatedAt, videoData) {
    return dbPlaylists(
      DBActions.PLAYLISTS.UPSERT_VIDEO,
      { _id, lastUpdatedAt, videoData }
    )
  }

  static upsertVideosByPlaylistId(_id, lastUpdatedAt, videos, deduplicate = false) {
    return dbPlaylists(
      DBActions.PLAYLISTS.UPSERT_VIDEOS,
      { _id, lastUpdatedAt, videos, deduplicate }
    )
  }

  static delete(_id) {
    return dbPlaylists(DBActions.GENERAL.DELETE, _id)
  }

  static deleteVideoIdByPlaylistId(_id, lastUpdatedAt, videoId, playlistItemId) {
    return dbPlaylists(
      DBActions.PLAYLISTS.DELETE_VIDEO_ID,
      { _id, lastUpdatedAt, videoId, playlistItemId }
    )
  }

  static deleteVideoIdsByPlaylistId(_id, lastUpdatedAt, playlistItemIds) {
    return dbPlaylists(
      DBActions.PLAYLISTS.DELETE_VIDEO_IDS,
      { _id, lastUpdatedAt, playlistItemIds }
    )
  }

  static deleteAllVideosByPlaylistId(_id) {
    return dbPlaylists(DBActions.PLAYLISTS.DELETE_ALL_VIDEOS, _id)
  }

  static deleteMultiple(ids) {
    return dbPlaylists(DBActions.GENERAL.DELETE_MULTIPLE, ids)
  }

  static deleteAll() {
    return dbPlaylists(DBActions.GENERAL.DELETE_ALL)
  }
}

class SearchHistory {
  static find() {
    return dbSearchHistory(DBActions.GENERAL.FIND)
  }

  static upsert(searchHistoryEntry) {
    return dbSearchHistory(DBActions.GENERAL.UPSERT, searchHistoryEntry)
  }

  static overwrite(records) {
    return dbSearchHistory(DBActions.GENERAL.OVERWRITE, records)
  }

  static delete(_id) {
    return dbSearchHistory(DBActions.GENERAL.DELETE, _id)
  }

  static deleteAll() {
    return dbSearchHistory(DBActions.GENERAL.DELETE_ALL)
  }
}

class SubscriptionCache {
  static markEntriesAsSeen(channelId, tab, entries) {
    return dbSubscriptionCache(DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN, { channelId, tab, entries })
  }

  static find() {
    return dbSubscriptionCache(DBActions.GENERAL.FIND)
  }

  static updateVideosByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static updateLiveStreamsByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static updateShortsByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static updateShortsWithChannelPageShortsByChannelId(channelId, entries) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL,
      { channelId, entries }
    )
  }

  static updateCommunityPostsByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static deleteMultipleChannels(channelIds) {
    return dbSubscriptionCache(DBActions.GENERAL.DELETE_MULTIPLE, channelIds)
  }

  static deleteAll() {
    return dbSubscriptionCache(DBActions.GENERAL.DELETE_ALL)
  }
}

function compactAllDatastores() {
  return window.ftElectron.storage.compactDatabases()
}

export {
  Settings as settings,
  History as history,
  WatchStats as watchStats,
  Profiles as profiles,
  Playlists as playlists,
  SearchHistory as searchHistory,
  SubscriptionCache as subscriptionCache,
  compactAllDatastores,
}
