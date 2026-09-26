import { DBActions, IpcChannels, PlaylistVideoAddResult, SyncEvents } from '../constants.js'

/** @typedef {{ _id: string, value?: unknown }} SettingRecord */
/** @typedef {{ action: number, data?: unknown }} DatastoreIpcRequest */
/** @typedef {{ videoId: string, watchProgress: number }} WatchProgressRecord */

/**
 * @param {unknown} payload
 * @returns {DatastoreIpcRequest}
 */
export function requireDatastoreIpcRequest(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.action !== 'number' || !Number.isInteger(payload.action)) {
    throw new TypeError('invalid datastore request')
  }
  return /** @type {DatastoreIpcRequest} */ (payload)
}

/**
 * @param {unknown} data
 * @returns {Record<string, unknown>}
 */
function requireDataRecord(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('invalid datastore record')
  }
  return data
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @returns {value is string} */
function isId(value) {
  return typeof value === 'string' && value.length > 0
}

/** @param {unknown} value @returns {value is string[]} */
function isIdArray(value) {
  return Array.isArray(value) && value.every(isId)
}

/** @param {unknown} value */
function isHistoryRecord(value) {
  return isRecord(value) && isId(value.videoId)
}

/** @param {unknown} value */
function isDocument(value) {
  return isRecord(value) && isId(value._id)
}

/**
 * The channel distinguishes action IDs shared by different datastores. Read
 * actions are absent because they intentionally have no data payload.
 * @type {Record<string, Record<number, (data: unknown) => boolean>>}
 */
const actionDataValidators = {
  [IpcChannels.DB_HISTORY]: {
    [DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE]: data => isRecord(data) &&
      (data.records === undefined || (Array.isArray(data.records) && data.records.every(isHistoryRecord))) &&
      (data.metadata === undefined || (Array.isArray(data.metadata) && data.metadata.every(isHistoryRecord))) &&
      (data.unseenVideo === undefined || isHistoryRecord(data.unseenVideo)),
    [DBActions.GENERAL.UPSERT]: isHistoryRecord,
    [DBActions.GENERAL.OVERWRITE]: data => Array.isArray(data) && data.every(isHistoryRecord),
    [DBActions.HISTORY.APPLY_SYNC_CHANGES]: data => isRecord(data) &&
      Array.isArray(data.insertions) && data.insertions.every(isHistoryRecord) &&
      Array.isArray(data.updates) && data.updates.every(isHistoryRecord) &&
      isIdArray(data.deletions),
    [DBActions.HISTORY.UPDATE_PLAYLIST]: data => isRecord(data) && isId(data.videoId),
    [DBActions.GENERAL.DELETE]: isId
  },
  [IpcChannels.DB_RECOMMENDATIONS]: {
    [DBActions.GENERAL.UPSERT]: data => isRecord(data) && isRecord(data.video) && isId(data.video.videoId),
    [DBActions.GENERAL.DELETE_MULTIPLE]: isIdArray
  },
  [IpcChannels.DB_WATCH_STATS]: {
    [DBActions.WATCH_STATS.MERGE_BACKUP]: data => isRecord(data) && Array.isArray(data.records) &&
      (data.adjustment === null || isRecord(data.adjustment)),
    [DBActions.WATCH_STATS.ADD_WATCH_TIME]: data => isRecord(data) &&
      typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) &&
      typeof data.seconds === 'number' && Number.isFinite(data.seconds) && data.seconds > 0,
    [DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME]: data => isRecord(data) &&
      Number.isFinite(Number(data.defaultSpeed)) && Number(data.defaultSpeed) > 0 &&
      (data.channelPlaybackSpeeds === undefined || isRecord(data.channelPlaybackSpeeds))
  },
  [IpcChannels.DB_PROFILES]: {
    [DBActions.GENERAL.CREATE]: isRecord,
    [DBActions.GENERAL.UPSERT]: isDocument,
    [DBActions.PROFILES.ADD_CHANNEL]: data => isRecord(data) && isRecord(data.channel) &&
      isId(data.channel.id) && isIdArray(data.profileIds),
    [DBActions.PROFILES.REMOVE_CHANNEL]: data => isRecord(data) &&
      isId(data.channelId) && isIdArray(data.profileIds),
    [DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS]: data => isRecord(data) &&
      isRecord(data.channel) && isId(data.channel.id) && isIdArray(data.profileIds),
    [DBActions.GENERAL.DELETE]: isId
  },
  [IpcChannels.DB_PLAYLISTS]: {
    [DBActions.GENERAL.CREATE]: data => isDocument(data) ||
      (Array.isArray(data) && data.every(isDocument)),
    [DBActions.GENERAL.UPSERT]: isDocument,
    [DBActions.PLAYLISTS.UPSERT_VIDEO]: data => isRecord(data) && isId(data._id) &&
      typeof data.lastUpdatedAt === 'number' && Number.isFinite(data.lastUpdatedAt) &&
      isRecord(data.videoData) && isId(data.videoData.videoId),
    [DBActions.PLAYLISTS.UPSERT_VIDEOS]: data => isRecord(data) && isId(data._id) &&
      typeof data.lastUpdatedAt === 'number' && Number.isFinite(data.lastUpdatedAt) &&
      Array.isArray(data.videos) && data.videos.every(isRecord),
    [DBActions.GENERAL.DELETE]: isId,
    [DBActions.PLAYLISTS.DELETE_VIDEO_ID]: data => isRecord(data) && isId(data._id) &&
      typeof data.lastUpdatedAt === 'number' && Number.isFinite(data.lastUpdatedAt) &&
      (isId(data.videoId) || isId(data.playlistItemId)),
    [DBActions.PLAYLISTS.DELETE_VIDEO_IDS]: data => isRecord(data) && isId(data._id) &&
      typeof data.lastUpdatedAt === 'number' && Number.isFinite(data.lastUpdatedAt) &&
      isIdArray(data.playlistItemIds),
    [DBActions.PLAYLISTS.DELETE_ALL_VIDEOS]: isId,
    [DBActions.GENERAL.DELETE_MULTIPLE]: isIdArray
  },
  [IpcChannels.DB_SEARCH_HISTORY]: {
    [DBActions.GENERAL.UPSERT]: data => isRecord(data) && (isId(data.query) || isId(data._id)) &&
      typeof data.lastUpdatedAt === 'number' && Number.isFinite(data.lastUpdatedAt),
    [DBActions.GENERAL.OVERWRITE]: data => Array.isArray(data) && data.every(isDocument),
    [DBActions.GENERAL.DELETE]: isId
  },
  [IpcChannels.DB_SUBSCRIPTION_CACHE]: {
    [DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL]: data => isFeedUpdate(data, 'videoId'),
    [DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL]: data => isFeedUpdate(data, 'videoId'),
    [DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL]: data => isFeedUpdate(data, 'videoId'),
    [DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL]: data =>
      isRecord(data) && isId(data.channelId) && isFeedEntries(data.entries, 'videoId'),
    [DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL]: data => isFeedUpdate(data, 'postId'),
    [DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN]: isSeenUpdate,
    [DBActions.GENERAL.DELETE_MULTIPLE]: isIdArray
  }
}

/** @param {unknown} entries @param {'videoId' | 'postId'} idKey */
function isFeedEntries(entries, idKey) {
  return Array.isArray(entries) && entries.every(entry => isRecord(entry) && isId(entry[idKey]))
}

/** @param {unknown} timestamp */
function isFeedTimestamp(timestamp) {
  if (timestamp instanceof Date) return Number.isFinite(timestamp.getTime())
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return false
  return Number.isFinite(new Date(timestamp).getTime())
}

/** @param {unknown} data @param {'videoId' | 'postId'} idKey */
function isFeedUpdate(data, idKey) {
  return isRecord(data) && isId(data.channelId) && isFeedEntries(data.entries, idKey) &&
    isFeedTimestamp(data.timestamp)
}

/** @param {unknown} data */
function isSeenUpdate(data) {
  if (!isRecord(data) || !isId(data.channelId)) return false
  if (data.tab === 'posts') return isFeedEntries(data.entries, 'postId')
  return (data.tab === 'videos' || data.tab === 'live' || data.tab === 'shorts') &&
    isFeedEntries(data.entries, 'videoId')
}

/** @param {string} channel @param {number} action @param {unknown} data */
function requireDatastoreActionData(channel, action, data) {
  const validate = actionDataValidators[channel]?.[action]
  if (validate && !validate(data)) throw new TypeError('invalid datastore action data')
}

/**
 * @param {unknown} data
 * @returns {SettingRecord}
 */
export function requireSettingRecord(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('invalid settings record')
  }
  const record = data
  if (typeof record._id !== 'string') throw new TypeError('invalid settings record')
  return /** @type {SettingRecord} */ (record)
}

/** @param {unknown} data @returns {WatchProgressRecord} */
export function requireWatchProgressRecord(data) {
  requireDataRecord(data)
  if (typeof data.videoId !== 'string' || data.videoId.length === 0 ||
      typeof data.watchProgress !== 'number' || !Number.isFinite(data.watchProgress)) {
    throw new TypeError('invalid watch progress record')
  }
  return /** @type {WatchProgressRecord} */ (data)
}

/**
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   handlers: typeof import('../datastores/handlers/base'),
 *   isTrustedUrl: (url: string) => boolean,
 *   syncOtherWindows: (channel: string, event: import('electron').IpcMainInvokeEvent, payload: unknown) => void,
 *   getPlayingVideoIds: () => string[]
 * }} DatastoreIpcDependencies
 */

/** @param {DatastoreIpcDependencies} dependencies */
export function registerDatastoreIpc({ ipcMain, handlers, isTrustedUrl, syncOtherWindows, getPlayingVideoIds }) {
  // *********** //
  // History
  ipcMain.handle(IpcChannels.DB_HISTORY, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }
    const { action, data } = requireDatastoreIpcRequest(payload)
    requireDatastoreActionData(IpcChannels.DB_HISTORY, action, data)

    try {
      switch (action) {
        case DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE: {
          const result = await handlers.history.updateSubscriptionState(data)
          if (result.records.length > 0) {
            syncOtherWindows(IpcChannels.SYNC_HISTORY, event, result.records.length === 1
              ? { event: SyncEvents.GENERAL.UPSERT, data: result.records[0] }
              : {
                  event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES,
                  data: { insertions: [], updates: result.records, deletions: [] }
                })
          }
          if (result.seenVideos != null) {
            syncOtherWindows(IpcChannels.SYNC_SETTINGS, event, {
              event: SyncEvents.GENERAL.UPSERT,
              data: { _id: 'subscriptionSeenVideos', value: result.seenVideos }
            })
          }
          return result
        }

        case DBActions.GENERAL.FIND:
          return await handlers.history.find()

        case DBActions.GENERAL.UPSERT:
          await handlers.history.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.GENERAL.OVERWRITE:
          await handlers.history.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.HISTORY.APPLY_SYNC_CHANGES:
          await handlers.history.applySyncChanges(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES, data }
          )
          return null

        case DBActions.HISTORY.UPDATE_WATCH_PROGRESS:
          requireWatchProgressRecord(data)
          await handlers.history.updateWatchProgress(data.videoId, data.watchProgress)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_WATCH_PROGRESS, data }
          )
          return null

        case DBActions.HISTORY.UPDATE_PLAYLIST:
          requireDataRecord(data)
          await handlers.history.updateLastViewedPlaylist(data.videoId, data.lastViewedPlaylistId, data.lastViewedPlaylistType, data.lastViewedPlaylistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_PLAYLIST, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS:
          requireDataRecord(data)
          await handlers.history.unsetLastViewedPlaylistForVideos(data.videoIds, data.lastViewedPlaylistId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLISTS:
          await handlers.history.unsetLastViewedPlaylists(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLISTS, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await handlers.history.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.HISTORY.DELETE_OLDER_THAN: {
          if (
            typeof data !== 'number' ||
            !Number.isFinite(data) ||
            data < 0 ||
            data > Date.now()
          ) {
            throw new TypeError('invalid history cutoff')
          }

          const videoIds = await handlers.history.deleteOlderThan(data, getPlayingVideoIds())
          if (videoIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_HISTORY,
              event,
              { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data: videoIds }
            )
          }
          return videoIds
        }

        case DBActions.GENERAL.DELETE_ALL:
          await handlers.history.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid history db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Recommendation learning
  ipcMain.handle(IpcChannels.DB_RECOMMENDATIONS, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    const { action, data } = requireDatastoreIpcRequest(payload)
    requireDatastoreActionData(IpcChannels.DB_RECOMMENDATIONS, action, data)
    let result
    if (action === DBActions.GENERAL.FIND) result = await handlers.recommendations.find()
    else if (action === DBActions.GENERAL.UPSERT) result = await handlers.recommendations.record(data)
    else if (action === DBActions.GENERAL.DELETE_MULTIPLE) result = await handlers.recommendations.remove(data)
    else if (action === DBActions.GENERAL.DELETE_ALL) result = await handlers.recommendations.reset()
    else throw new Error('Invalid recommendation action')
    syncOtherWindows(IpcChannels.SYNC_RECOMMENDATIONS, event, result)
    return result
  })

  // Watch Stats
  ipcMain.handle(IpcChannels.DB_WATCH_STATS, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }
    const { action, data } = requireDatastoreIpcRequest(payload)
    requireDatastoreActionData(IpcChannels.DB_WATCH_STATS, action, data)

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await handlers.watchStats.find()

        case DBActions.WATCH_STATS.MERGE_BACKUP: {
          requireDataRecord(data)
          const merged = await handlers.watchStats.mergeBackup(data)
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data: merged }
          )
          return merged
        }

        case DBActions.WATCH_STATS.ADD_WATCH_TIME:
          requireDataRecord(data)
          await handlers.watchStats.addWatchTime(data.date, data.seconds)
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.WATCH_STATS.ADD_WATCH_TIME, data }
          )
          return null

        case DBActions.WATCH_STATS.MIGRATE_HISTORY:
          return await handlers.watchStats.migrateHistory()

        case DBActions.WATCH_STATS.GET_HISTORICAL_ADJUSTMENT:
          return await handlers.watchStats.getHistoricalAdjustment()

        case DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME: {
          requireDataRecord(data)
          const result = await handlers.watchStats.adjustHistoricalWatchTime(
            data.defaultSpeed,
            data.channelPlaybackSpeeds
          )
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME, data: result }
          )
          return result
        }

        case DBActions.GENERAL.DELETE_ALL:
          await handlers.watchStats.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid watch stats db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Profiles
  ipcMain.handle(IpcChannels.DB_PROFILES, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }
    const { action, data } = requireDatastoreIpcRequest(payload)
    requireDatastoreActionData(IpcChannels.DB_PROFILES, action, data)

    try {
      switch (action) {
        case DBActions.GENERAL.CREATE: {
          const newProfile = await handlers.profiles.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.CREATE, data: newProfile }
          )
          return newProfile
        }

        case DBActions.GENERAL.FIND:
          return await handlers.profiles.find()

        case DBActions.GENERAL.UPSERT:
          await handlers.profiles.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PROFILES.ADD_CHANNEL:
          requireDataRecord(data)
          await handlers.profiles.addChannelToProfiles(data.channel, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.ADD_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.REMOVE_CHANNEL:
          requireDataRecord(data)
          await handlers.profiles.removeChannelFromProfiles(data.channelId, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.REMOVE_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS: {
          requireDataRecord(data)
          const profileIds = await handlers.profiles
            .updateChannelSettings(data.channel, data.profileIds)
          if (profileIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_PROFILES,
              event,
              {
                event: SyncEvents.PROFILES.UPDATE_CHANNEL_SETTINGS,
                data: { channel: data.channel, profileIds }
              }
            )
          }
          return profileIds
        }

        case DBActions.GENERAL.DELETE:
          await handlers.profiles.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid profile db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Playlists
  // ! NOTE: A lot of these actions are currently not used for anything
  // As such, only the currently used actions have synchronization implemented
  // The remaining should have it implemented only when playlists
  // get fully implemented into the app
  ipcMain.handle(IpcChannels.DB_PLAYLISTS, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }
    const { action, data } = requireDatastoreIpcRequest(payload)
    requireDatastoreActionData(IpcChannels.DB_PLAYLISTS, action, data)

    try {
      switch (action) {
        case DBActions.GENERAL.CREATE:
          await handlers.playlists.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.CREATE, data }
          )
          return null

        case DBActions.GENERAL.FIND:
          return await handlers.playlists.find()

        case DBActions.GENERAL.UPSERT:
          await handlers.playlists.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PLAYLISTS.UPSERT_VIDEO: {
          requireDataRecord(data)
          const result = await handlers.playlists.upsertVideoByPlaylistId(data._id, data.lastUpdatedAt, data.videoData)

          // Nothing was written when the video is already in the playlist or the
          // playlist is gone, so the other windows have nothing to apply
          if (result === PlaylistVideoAddResult.ADDED) {
            syncOtherWindows(
              IpcChannels.SYNC_PLAYLISTS,
              event,
              { event: SyncEvents.PLAYLISTS.UPSERT_VIDEO, data }
            )
          }

          return result
        }

        case DBActions.PLAYLISTS.UPSERT_VIDEOS:
          requireDataRecord(data)
          await handlers.playlists.upsertVideosByPlaylistId(data._id, data.lastUpdatedAt, data.videos)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.UPSERT_VIDEOS, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await handlers.playlists.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_ID:
          requireDataRecord(data)
          await handlers.playlists.deleteVideoIdByPlaylistId(data._id, data.lastUpdatedAt, data.videoId, data.playlistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEO, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_IDS:
          requireDataRecord(data)
          await handlers.playlists.deleteVideoIdsByPlaylistId(data._id, data.lastUpdatedAt, data.playlistItemIds)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEOS, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_ALL_VIDEOS:
          await handlers.playlists.deleteAllVideosByPlaylistId(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await handlers.playlists.deleteMultiple(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await handlers.playlists.deleteAll()
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid playlist db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //

  // ************** //
  // Search History
  ipcMain.handle(IpcChannels.DB_SEARCH_HISTORY, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }
    const { action, data } = requireDatastoreIpcRequest(payload)
    requireDatastoreActionData(IpcChannels.DB_SEARCH_HISTORY, action, data)

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await handlers.searchHistory.find()

        case DBActions.GENERAL.UPSERT: {
          const updatedEntry = await handlers.searchHistory.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data: updatedEntry }
          )
          return updatedEntry
        }

        case DBActions.GENERAL.OVERWRITE:
          await handlers.searchHistory.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await handlers.searchHistory.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await handlers.searchHistory.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid search history db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Profiles
  ipcMain.handle(IpcChannels.DB_SUBSCRIPTION_CACHE, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }
    const { action, data } = requireDatastoreIpcRequest(payload)
    requireDatastoreActionData(IpcChannels.DB_SUBSCRIPTION_CACHE, action, data)

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await handlers.subscriptionCache.find()

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL:
          requireDataRecord(data)
          if (!await handlers.subscriptionCache.updateVideosByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN:
          requireDataRecord(data)
          await handlers.subscriptionCache.markEntriesAsSeen(data.channelId, data.tab, data.entries)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL:
          requireDataRecord(data)
          if (!await handlers.subscriptionCache.updateLiveStreamsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL:
          requireDataRecord(data)
          if (!await handlers.subscriptionCache.updateShortsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL:
          requireDataRecord(data)
          await handlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId(data.channelId, data.entries)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL:
          requireDataRecord(data)
          if (!await handlers.subscriptionCache.updateCommunityPostsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await handlers.subscriptionCache.deleteMultipleChannels(data)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data }
          )
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await handlers.subscriptionCache.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL, data }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid subscriptionCache db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })
}
