import { BrowserWindow } from 'electron'

import { DBActions, IpcChannels, PlaylistVideoAddResult, SyncEvents } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { handleTrusted, sendToOtherAppWindows } from './ipc'
import { numberSyncMessage, readSynced, settingSyncMessage, writeSynced } from './datastoreSync'
import { canRendererWriteSetting } from './settingWriteGuard'
import { TabManager } from './tabs/TabManager'
import { recordSubscriptionFeedTitles } from './videoMetadataCache'

/**
 * Whether a datastore request reads the whole datastore.
 * @param {{ action: number, data?: unknown }} request
 */
function isFullRead({ action, data }) {
  return action === DBActions.GENERAL.FIND && data === undefined
}

/**
 * Registers the handlers through which windows read and write the datastores.
 * Changes are forwarded to the other windows.
 * @param {{
 *   datastoreRequests: ReturnType<typeof import('./datastoreRequests').createDatastoreRequestTracker>,
 *   onSettingUpserted: (setting: { _id: string, value: any }) => Promise<void>,
 *   onSettingDeleted: (id: string) => void
 * }} options
 */
export function setupDatastoreIpc({ datastoreRequests, onSettingUpserted, onSettingDeleted }) {
  /**
   * @param {string} channel
   * @param {(event: import('electron').IpcMainInvokeEvent, request: { action: number, data: any }) => Promise<unknown>} handler
   */
  function handleDatastoreRequests(channel, handler) {
    handleTrusted(channel, (event, request) => datastoreRequests.track(handler(event, request)))
  }

  function syncOtherWindows(channel, event, payload) {
    sendToOtherAppWindows(event.sender, channel, numberSyncMessage(payload))
  }

  /**
   * Like `handleDatastoreRequests` for datastores whose changes are sent to the
   * other windows on `syncChannel`. Replies are `{ result, revision }` for full
   * reads, which a starting window uses to skip the messages they contain, and
   * `{ result }` otherwise. Other requests can change the datastore, so they
   * hold back full reads until their messages are sent, along with those on
   * `otherSyncChannels`.
   * @param {string} channel
   * @param {string} syncChannel
   * @param {(event: import('electron').IpcMainInvokeEvent, request: { action: number, data: any }) => Promise<unknown>} handler
   * @param {string[]} [otherSyncChannels]
   */
  function handleSyncedDatastoreRequests(channel, syncChannel, handler, otherSyncChannels = []) {
    handleDatastoreRequests(channel, async (event, request) => {
      if (isFullRead(request)) return readSynced(syncChannel, () => handler(event, request))
      return { result: await writeSynced([syncChannel, ...otherSyncChannels], () => handler(event, request)) }
    })
  }

  /**
   * Like `handleSyncedDatastoreRequests` for requests that can save settings.
   * Their replies also hold `savedSetting`, the revision of the setting the
   * request saved, so the window can drop older broadcasts that arrive after
   * the reply. `afterSave` runs when full reads may run again, as it can save
   * settings itself.
   * @param {string} channel
   * @param {string} syncChannel
   * @param {(
   *   event: import('electron').IpcMainInvokeEvent,
   *   request: { action: number, data: any },
   *   syncSetting: (_id: string, value: unknown) => void
   * ) => Promise<unknown>} handler
   * @param {(request: { action: number, data: any }) => Promise<void> | void} [afterSave]
   */
  function handleRequestsSavingSettings(channel, syncChannel, handler, afterSave = () => {}) {
    handleDatastoreRequests(channel, async (event, request) => {
      /** @type {{ _id: string, revision: number } | null} */
      let savedSetting = null
      /** @type {(_id: string, value: unknown) => void} */
      const syncSetting = (_id, value) => {
        const message = settingSyncMessage(_id, value)
        sendToOtherAppWindows(event.sender, IpcChannels.SYNC_SETTINGS, message)
        savedSetting = { _id, revision: message.revision }
      }
      if (isFullRead(request)) return readSynced(syncChannel, () => handler(event, request, syncSetting))

      const result = await writeSynced([syncChannel, IpcChannels.SYNC_SETTINGS], () => handler(event, request, syncSetting))
      if (savedSetting) {
        try {
          await afterSave(request)
        } catch (err) {
          throw typeof err === 'string' ? err : err.toString()
        }
      }
      return { result, savedSetting }
    })
  }

  // Settings
  handleRequestsSavingSettings(IpcChannels.DB_SETTINGS, IpcChannels.SYNC_SETTINGS, async (event, { action, data }, syncSetting) => {
    try {
      switch (action) {
        case DBActions.SETTINGS.MERGE_SEEN_VIDEOS: {
          const value = await baseHandlers.settings.mergeSeenVideos(data)
          syncSetting('subscriptionSeenVideos', value)
          return value
        }

        case DBActions.SETTINGS.MERGE_SEEN_POSTS: {
          const value = await baseHandlers.settings.mergeSeenPosts(data)
          syncSetting('subscriptionSeenPosts', value)
          return value
        }

        case DBActions.SETTINGS.MERGE_SEEN_RSS_ITEMS: {
          const value = await baseHandlers.settings.mergeSeenRssItems(data)
          syncSetting('rssFeedSeenItems', value)
          return value
        }

        case DBActions.GENERAL.FIND:
          return await baseHandlers.settings.find()

        case DBActions.SETTINGS.FIND_ONE:
          return typeof data === 'string' ? (await baseHandlers.settings._findOne(data))?.value : undefined

        case DBActions.GENERAL.UPSERT:
          // Destinations and executables require a native picker. Backup status is written by the scheduler.
          if (!canRendererWriteSetting(data._id, data.value)) {
            console.warn(`Refused a renderer write to the ${String(data._id)} setting`)
            return null
          }

          await baseHandlers.settings.upsert(data._id, data.value)
          syncSetting(data._id, data.value)
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.settings.delete(data)
          onSettingDeleted(data)
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid settings db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  }, ({ action, data }) => action === DBActions.GENERAL.UPSERT ? onSettingUpserted(data) : undefined)

  // History
  handleRequestsSavingSettings(IpcChannels.DB_HISTORY, IpcChannels.SYNC_HISTORY, async (event, { action, data }, syncSetting) => {
    try {
      switch (action) {
        case DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE: {
          const result = await baseHandlers.history.updateSubscriptionState(data)
          if (result.records.length > 0) {
            syncOtherWindows(IpcChannels.SYNC_HISTORY, event, result.records.length === 1
              ? { event: SyncEvents.GENERAL.UPSERT, data: result.records[0] }
              : {
                  event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES,
                  data: { insertions: [], updates: result.records, deletions: [] }
                })
          }
          if (result.seenVideos != null) syncSetting('subscriptionSeenVideos', result.seenVideos)
          return result
        }

        case DBActions.GENERAL.FIND:
          // Strings cross IPC and the context bridge far faster than records.
          return await baseHandlers.history._findSerialized()

        case DBActions.HISTORY.REMOVE_DUPLICATES:
          return await baseHandlers.history.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.history.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.GENERAL.OVERWRITE:
          if (typeof data === 'string') data = JSON.parse(data)
          await baseHandlers.history.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.HISTORY.MERGE_BACKUP:
        case DBActions.HISTORY.IMPORT: {
          if (typeof data === 'string') data = JSON.parse(data)
          const updates = action === DBActions.HISTORY.IMPORT
            ? await baseHandlers.history.importRecords(data.records, data.rule)
            : await baseHandlers.history.mergeBackup(data)
          const changes = { insertions: [], updates, deletions: [] }
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES, data: changes }
          )
          // Strings cross IPC and the context bridge far faster than records.
          return JSON.stringify(updates)
        }

        case DBActions.HISTORY.APPLY_SYNC_CHANGES: {
          if (typeof data === 'string') data = JSON.parse(data)
          // Other windows must keep stored records that were newer than the sync.
          const skipped = new Set(await baseHandlers.history.applySyncChanges(data))
          if (skipped.size > 0) data.insertions = data.insertions.filter(record => !skipped.has(record.videoId))
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES, data }
          )
          return [...skipped]
        }

        case DBActions.HISTORY.UPDATE_WATCH_PROGRESS:
          await baseHandlers.history.updateWatchProgress(data.videoId, data.watchProgress)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_WATCH_PROGRESS, data }
          )
          return null

        case DBActions.HISTORY.UPDATE_PLAYLIST:
          await baseHandlers.history.updateLastViewedPlaylist(data.videoId, data.lastViewedPlaylistId, data.lastViewedPlaylistType, data.lastViewedPlaylistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_PLAYLIST, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS:
          await baseHandlers.history.unsetLastViewedPlaylistForVideos(data.videoIds, data.lastViewedPlaylistId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLISTS:
          await baseHandlers.history.unsetLastViewedPlaylists(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLISTS, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.history.delete(data)
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

          const videoIds = await baseHandlers.history.deleteOlderThan(data, getPlayingVideoIds())
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
          await baseHandlers.history.deleteAll()
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

  // Recommendation learning
  handleDatastoreRequests(IpcChannels.DB_RECOMMENDATIONS, async (event, { action, data }) => {
    let result
    if (action === DBActions.GENERAL.FIND) result = await baseHandlers.recommendations.find()
    else if (action === DBActions.GENERAL.UPSERT) result = await baseHandlers.recommendations.record(data)
    else if (action === DBActions.GENERAL.DELETE_MULTIPLE) result = await baseHandlers.recommendations.remove(data)
    else if (action === DBActions.GENERAL.DELETE_ALL) result = await baseHandlers.recommendations.reset()
    else throw new Error('Invalid recommendation action')
    // The result carries its own revision.
    sendToOtherAppWindows(event.sender, IpcChannels.SYNC_RECOMMENDATIONS, result)
    return result
  })

  // Watch Stats
  handleDatastoreRequests(IpcChannels.DB_WATCH_STATS, async (event, { action, data }) => {
    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.watchStats.find()

        case DBActions.WATCH_STATS.MERGE_BACKUP: {
          const merged = await baseHandlers.watchStats.mergeBackup(data)
          syncOtherWindows(IpcChannels.SYNC_WATCH_STATS, event, { event: SyncEvents.GENERAL.OVERWRITE, data: merged })
          return merged
        }

        case DBActions.WATCH_STATS.ADD_WATCH_TIME:
          await baseHandlers.watchStats.addWatchTime(data.date, data.seconds)
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.WATCH_STATS.ADD_WATCH_TIME, data }
          )
          return null

        case DBActions.WATCH_STATS.MIGRATE_HISTORY:
          return await baseHandlers.watchStats.migrateHistory()

        case DBActions.WATCH_STATS.GET_HISTORICAL_ADJUSTMENT:
          return await baseHandlers.watchStats.getHistoricalAdjustment()

        case DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME: {
          const result = await baseHandlers.watchStats.adjustHistoricalWatchTime(
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
          await baseHandlers.watchStats.deleteAll()
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

  // Profiles
  handleSyncedDatastoreRequests(IpcChannels.DB_PROFILES, IpcChannels.SYNC_PROFILES, async (event, { action, data }) => {
    try {
      switch (action) {
        case DBActions.GENERAL.CREATE: {
          const newProfile = await baseHandlers.profiles.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.CREATE, data: newProfile }
          )
          return newProfile
        }

        case DBActions.GENERAL.FIND:
          return await baseHandlers.profiles.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.profiles.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PROFILES.ADD_CHANNEL:
          await baseHandlers.profiles.addChannelToProfiles(data.channel, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.ADD_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.REMOVE_CHANNEL:
          await baseHandlers.profiles.removeChannelFromProfiles(data.channelIds, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.REMOVE_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.UPDATE_DETAILS: {
          const { numAffected } = await baseHandlers.profiles.updateDetails(data.profileId, data.details)
          if (numAffected > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_PROFILES,
              event,
              { event: SyncEvents.PROFILES.UPDATE_DETAILS, data }
            )
          }
          return null
        }

        case DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS:
        case DBActions.PROFILES.BATCH_UPDATE_CHANNEL_SETTINGS: {
          const profileIds = data.updates
            ? await baseHandlers.profiles.batchUpdateChannelSettings(data.updates, data.profileIds)
            : await baseHandlers.profiles.updateChannelSettings(data.channel, data.profileIds)
          if (profileIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_PROFILES,
              event,
              {
                event: SyncEvents.PROFILES.UPDATE_CHANNEL_SETTINGS,
                data: { ...data, profileIds }
              }
            )
          }
          return profileIds
        }

        case DBActions.PROFILES.UPDATE_SUBSCRIPTION_DETAILS: {
          const result = await baseHandlers.profiles.updateSubscriptionDetails(data)
          const { profileIds } = result
          if (profileIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_PROFILES,
              event,
              { event: SyncEvents.PROFILES.UPDATE_SUBSCRIPTION_DETAILS, data: { channels: data, profileIds } }
            )
          }
          return result
        }

        case DBActions.PROFILES.SAVE_FROM_SYNC_IF_UNCHANGED: {
          const profile = await baseHandlers.profiles.saveFromSyncIfUnchanged(data.profile, data.previous)
          if (profile !== null) {
            syncOtherWindows(IpcChannels.SYNC_PROFILES, event, { event: SyncEvents.GENERAL.UPSERT, data: profile })
          }
          return profile
        }

        case DBActions.PROFILES.UPDATE_SUBSCRIPTIONS_IF_UNCHANGED: {
          const profile = await baseHandlers.profiles.updateSubscriptionsIfUnchanged(data.profileId, data.subscriptions, data.previous)
          if (profile !== null) {
            syncOtherWindows(IpcChannels.SYNC_PROFILES, event, { event: SyncEvents.GENERAL.UPSERT, data: profile })
          }
          return profile
        }

        case DBActions.PROFILES.MERGE_BACKUP:
        case DBActions.PROFILES.MERGE_IMPORTED: {
          const profile = action === DBActions.PROFILES.MERGE_IMPORTED
            ? await baseHandlers.profiles.mergeImported(data)
            : await baseHandlers.profiles.mergeBackup(data)
          syncOtherWindows(IpcChannels.SYNC_PROFILES, event, { event: SyncEvents.GENERAL.UPSERT, data: profile })
          return profile
        }

        case DBActions.GENERAL.DELETE:
          await baseHandlers.profiles.delete(data)
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

  // Playlists
  // ! NOTE: A lot of these actions are currently not used for anything
  // As such, only the currently used actions have synchronization implemented
  // The remaining should have it implemented only when playlists
  // get fully implemented into the app
  handleSyncedDatastoreRequests(IpcChannels.DB_PLAYLISTS, IpcChannels.SYNC_PLAYLISTS, async (event, { action, data }) => {
    try {
      switch (action) {
        case DBActions.GENERAL.CREATE:
          await baseHandlers.playlists.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.CREATE, data }
          )
          return null

        case DBActions.GENERAL.FIND:
          // Strings cross IPC and the context bridge far faster than large
          // playlists' object graphs, as with history.
          return (await baseHandlers.playlists.find()).map(playlist => JSON.stringify(playlist))

        case DBActions.GENERAL.UPSERT:
          if (typeof data === 'string') data = JSON.parse(data)
          await baseHandlers.playlists.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PLAYLISTS.UPDATE: {
          if (typeof data === 'string') data = JSON.parse(data)
          const saved = await baseHandlers.playlists.update(data)
          if (saved) {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.GENERAL.UPSERT, data })
          }
          return saved
        }

        case DBActions.PLAYLISTS.REORDER_VIDEOS: {
          const videos = await baseHandlers.playlists.reorderVideos(data._id, data.lastUpdatedAt, data.playlistItemIds)
          if (videos) {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.GENERAL.UPSERT, data: { _id: data._id, lastUpdatedAt: data.lastUpdatedAt, videos } })
          }
          return videos
        }

        case DBActions.PLAYLISTS.MERGE_BACKUP: {
          if (typeof data === 'string') data = JSON.parse(data)
          const playlist = await baseHandlers.playlists.mergeBackup(data)
          syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.GENERAL.UPSERT, data: playlist })
          // Strings cross IPC and the context bridge far faster than records.
          return JSON.stringify(playlist)
        }

        case DBActions.PLAYLISTS.UPSERT_IF_UNCHANGED: {
          const saved = await baseHandlers.playlists.upsertIfUnchanged(data.playlist, data.previous)
          if (saved) {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.GENERAL.UPSERT, data: data.playlist })
          }
          return saved
        }

        case DBActions.PLAYLISTS.UPDATE_SORT_ORDER: {
          const saved = await baseHandlers.playlists.updateSortOrder(data._id, data.sortOrder)
          if (saved) {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.GENERAL.UPSERT, data })
          }
          return saved
        }

        case DBActions.PLAYLISTS.REPAIR_METADATA:
          return await baseHandlers.playlists.repairMetadata(data, update => {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.PLAYLISTS.REPAIR_METADATA, data: update })
          })

        case DBActions.PLAYLISTS.UPSERT_VIDEO: {
          const result = await baseHandlers.playlists.upsertVideoByPlaylistId(data._id, data.lastUpdatedAt, data.videoData)

          // Nothing was written when the video is already in the playlist or the
          // playlist is gone, so the other windows have nothing to apply
          if (result.status === PlaylistVideoAddResult.ADDED) {
            data.addVideosToTop = result.addVideosToTop
            data.lastUpdatedAt = result.lastUpdatedAt
            syncOtherWindows(
              IpcChannels.SYNC_PLAYLISTS,
              event,
              { event: SyncEvents.PLAYLISTS.UPSERT_VIDEO, data }
            )
          }

          return result
        }

        case DBActions.PLAYLISTS.UPSERT_VIDEOS: {
          const result = await baseHandlers.playlists.upsertVideosByPlaylistId(data._id, data.lastUpdatedAt, data.videos, data.deduplicate)
          if (result.status === PlaylistVideoAddResult.ADDED) {
            data.videos = result.videos
            data.addVideosToTop = result.addVideosToTop
            data.lastUpdatedAt = result.lastUpdatedAt
            syncOtherWindows(
              IpcChannels.SYNC_PLAYLISTS,
              event,
              { event: SyncEvents.PLAYLISTS.UPSERT_VIDEOS, data }
            )
          }
          return result
        }

        case DBActions.GENERAL.DELETE:
          await baseHandlers.playlists.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_ID:
          await baseHandlers.playlists.deleteVideoIdByPlaylistId(data._id, data.lastUpdatedAt, data.videoId, data.playlistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEO, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_IDS:
          await baseHandlers.playlists.deleteVideoIdsByPlaylistId(data._id, data.lastUpdatedAt, data.playlistItemIds)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEOS, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_ALL_VIDEOS:
          await baseHandlers.playlists.deleteAllVideosByPlaylistId(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await baseHandlers.playlists.deleteMultiple(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.playlists.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
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

  // ************** //
  // Search History
  handleSyncedDatastoreRequests(IpcChannels.DB_SEARCH_HISTORY, IpcChannels.SYNC_SEARCH_HISTORY, async (event, { action, data }) => {
    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.searchHistory.find()

        case DBActions.GENERAL.UPSERT: {
          const updatedEntry = await baseHandlers.searchHistory.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data: updatedEntry }
          )
          return updatedEntry
        }

        case DBActions.SEARCH_HISTORY.MERGE_IMPORTED: {
          const entries = await baseHandlers.searchHistory.mergeImported(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data: entries }
          )
          return entries
        }

        case DBActions.GENERAL.DELETE:
          await baseHandlers.searchHistory.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.SEARCH_HISTORY.DELETE_OLDER_THAN: {
          if (
            typeof data !== 'number' ||
            !Number.isFinite(data) ||
            data < 0 ||
            data > Date.now()
          ) {
            throw new TypeError('invalid search history cutoff')
          }

          const remaining = await baseHandlers.searchHistory.deleteOlderThan(data)
          if (remaining !== null) {
            // find() sorts the list, as OVERWRITE expects.
            syncOtherWindows(
              IpcChannels.SYNC_SEARCH_HISTORY,
              event,
              { event: SyncEvents.GENERAL.OVERWRITE, data: remaining }
            )
          }
          return remaining
        }

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.searchHistory.deleteAll()
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

  // Subscription cache
  handleSyncedDatastoreRequests(IpcChannels.DB_SUBSCRIPTION_CACHE, IpcChannels.SYNC_SUBSCRIPTION_CACHE, async (event, { action, data }) => {
    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          // Strings cross IPC and the context bridge far faster than records.
          return await baseHandlers.subscriptionCache._findSerialized()

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateVideosByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN:
          await baseHandlers.subscriptionCache.markEntriesAsSeen(data.channelId, data.tab, data.entries)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN_MANY:
          await baseHandlers.subscriptionCache.markEntriesAsSeenMany(data)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN_MANY, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_FEEDS: {
          const applied = await baseHandlers.subscriptionCache.updateFeeds(data)
          const updates = data.filter((_, index) => applied[index])
          recordSubscriptionFeedTitles(updates)
          if (updates.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_SUBSCRIPTION_CACHE,
              event,
              { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_FEEDS, data: updates }
            )
          }
          return applied
        }

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateLiveStreamsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateShortsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL:
          await baseHandlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId(data.channelId, data.entries)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateCommunityPostsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await baseHandlers.subscriptionCache.deleteMultipleChannels(data)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data }
          )
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.subscriptionCache.deleteAll()
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

  function getPlayingVideoIds() {
    const videoIds = []

    for (const window of BrowserWindow.getAllWindows()) {
      const tabManager = TabManager.getForWindow(window.id)
      if (!tabManager) { continue }

      for (const tab of tabManager.tabs.values()) {
        if (!tab.isPlaying) { continue }

        const videoId = URL.parse(tab.url)?.hash.match(/^#\/watch\/(?<videoId>[^/?]+)/)?.groups?.videoId
        if (videoId) {
          videoIds.push(decodeURIComponent(videoId))
        }
      }
    }

    return videoIds
  }
}
