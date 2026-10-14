import { toRaw } from 'vue'
import model from '@seald-io/nedb/lib/model.js'
import { getContinueWatchingCandidates } from '../../helpers/homeSections'
import { DBHistoryHandlers } from '../../../datastores/handlers/index'
import { clearExternalMediaPositions, removeExternalMediaPositionsBefore } from '../../helpers/externalMediaPosition'
import {
  canMarkHistoryEntryAsWatched,
  migrateLegacyHistoryRecord,
} from '../../helpers/history'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

function indexHistoryByVideoId(records) {
  const byId = new Map()
  for (const record of records) {
    if (typeof record.videoId !== 'string') continue
    const previous = byId.get(record.videoId)
    if (!previous || (model.compareThings(record.timeWatched, previous.timeWatched) || model.compareThings(record._id, previous._id)) > 0) byId.set(record.videoId, record)
  }
  return Object.fromEntries(byId)
}

function getRetentionCutoff(days) {
  const parsedDays = Number(days)
  if (!Number.isInteger(parsedDays) || parsedDays < 1) {
    return null
  }

  return Date.now() - parsedDays * MILLISECONDS_PER_DAY
}

const historyRecordPositions = new WeakMap()
const HISTORY_STRUCTURE_MUTATIONS = new Set([
  'setHistoryCacheSorted', 'upsertToHistoryCache', 'removeFromHistoryCacheById',
  'removeMultipleFromHistoryCache', 'applyHistorySyncChanges',
])

function indexHistoryRecords(state) {
  const positions = new Map()
  const byId = Object.create(null)
  state.historyCacheSorted.forEach((record, index) => {
    if (record._id == null) return
    positions.set(record._id, index)
    byId[record._id] = record
  })
  state.historyCacheByRecordId = byId
  historyRecordPositions.set(state.historyCacheSorted, positions)
  return positions
}

const continueWatchingCache = new WeakMap()
const CONTINUE_WATCHING_MUTATIONS = new Set([
  'setHistoryCacheSorted',
  'upsertToHistoryCache',
  'updateRecordWatchProgressInHistoryCache',
  'removeFromHistoryCacheById',
  'removeMultipleFromHistoryCache',
  'applyHistorySyncChanges',
  'applyHistoryMetadata',
])

const state = {
  historyRevision: 0,
  continueWatchingRevision: 0,
  historyCacheSorted: [],
  historyCacheByRecordId: Object.create(null),

  // Vuex doesn't support Maps, so we have to use an object here instead
  // TODO: switch to a Map during the Pinia migration
  historyCacheById: {}
}

const getters = {
  // Invalidate through mutations instead of collecting reactive dependencies
  // on tens of thousands of records. Share the result across Home tabs/mounts.
  getContinueWatchingHistory: state => () => {
    const history = toRaw(state.historyCacheSorted)
    let cached = continueWatchingCache.get(history)
    if (!cached || cached.revision !== state.continueWatchingRevision) {
      cached = { revision: state.continueWatchingRevision, candidates: getContinueWatchingCandidates(history), entries: [] }
      continueWatchingCache.set(history, cached)
    }
    // Reopening Home must recheck premieres that started without a history
    // mutation. Keep the unchanged shelf identity for ordinary visits.
    const entries = cached.candidates.filter(canMarkHistoryEntryAsWatched)
    if (entries.length !== cached.entries.length || entries.some((entry, index) => entry !== cached.entries[index])) {
      cached.entries = entries
    }
    return cached.entries
  },

  getHistoryCacheSorted(state) {
    return state.historyCacheSorted
  },

  getHistoryCacheByRecordId(state) {
    return state.historyCacheByRecordId
  },

  getHistoryCacheById(state) {
    return state.historyCacheById
  }
}

const actions = {
  async grabHistory({ commit, rootGetters }) {
    try {
      const cutoff = getRetentionCutoff(rootGetters.getHistoryRetentionDays)
      if (cutoff !== null) {
        await DBHistoryHandlers.deleteOlderThan(cutoff)
        removeExternalMediaPositionsBefore(cutoff)
      }

      const results = await DBHistoryHandlers.find()

      commit('setHistoryCacheSorted', results)
      commit('setHistoryCacheById', indexHistoryByVideoId(results))
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionHistory({ commit, dispatch }, update) {
    const result = await DBHistoryHandlers.updateSubscriptionState(update)
    if (update.metadata) {
      commit('applyHistoryMetadata', result.records)
    } else if (result.records.length === 1) {
      commit('upsertToHistoryCache', result.records[0])
    } else if (result.records.length > 1) {
      commit('applyHistorySyncChanges', { insertions: [], updates: result.records, deletions: [] })
    }
    if (result.seenVideos != null) await dispatch('applySubscriptionSeenVideos', result.seenVideos)
    return update.metadata
      ? { repaired: result.records.length, failed: result.failedCount }
      : result.records.length
  },

  async updateHistory({ dispatch }, record) {
    try {
      await dispatch('updateSubscriptionHistory', { records: [record] })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  /**
   * @param {any} param0
   * @param {Map<string, any>} historyItems
   */
  async overwriteHistory({ commit }, historyItems) {
    try {
      const migratedHistoryItems = new Map(
        Array.from(historyItems, ([videoId, record]) => [videoId, migrateLegacyHistoryRecord(record)])
      )
      const sortedRecords = Array.from(migratedHistoryItems.values())

      // sort before sending saving to the database and passing to other windows
      // so that the other windows can use it as is, without having to sort the array themselves
      sortedRecords.sort((a, b) => model.compareThings(b.timeWatched, a.timeWatched) || model.compareThings(a._id, b._id))

      // The datastore assigns IDs to imported records. Cache its saved copies
      // directly so a failed reread cannot hide an already successful write.
      const savedRecords = await DBHistoryHandlers.overwrite(sortedRecords)
      commit('setHistoryCacheSorted', savedRecords)
      commit('setHistoryCacheById', indexHistoryByVideoId(savedRecords))
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async applyHistorySyncChanges({ commit }, changes) {
    const migratedChanges = {
      insertions: changes.insertions.map(migrateLegacyHistoryRecord),
      updates: changes.updates.map(migrateLegacyHistoryRecord),
      deletions: changes.deletions,
    }
    await DBHistoryHandlers.applySyncChanges(migratedChanges, changes.assertActive)
    commit('applyHistorySyncChanges', migratedChanges)
  },

  async markAllHistoryAsWatched({ dispatch, state }) {
    const records = state.historyCacheSorted
      .filter(record => record.isWatched !== true && canMarkHistoryEntryAsWatched(record))
      .map(record => ({ ...record, isWatched: true }))
    if (records.length === 0) return 0
    try {
      return await dispatch('updateSubscriptionHistory', { records })
    } catch (errMessage) {
      console.error(errMessage)
      return 0
    }
  },

  async removeFromHistory({ commit }, videoId) {
    try {
      await DBHistoryHandlers.delete(videoId)
      commit('removeFromHistoryCacheById', videoId)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeHistoryOlderThan({ commit }, days) {
    const cutoff = getRetentionCutoff(days)
    if (cutoff === null) {
      return 0
    }

    try {
      const videoIds = await DBHistoryHandlers.deleteOlderThan(cutoff)
      removeExternalMediaPositionsBefore(cutoff)
      commit('removeMultipleFromHistoryCache', videoIds)
      return videoIds.length
    } catch (errMessage) {
      console.error(errMessage)
      return 0
    }
  },

  async removeAllHistory({ commit }) {
    try {
      await DBHistoryHandlers.deleteAll()
      clearExternalMediaPositions()
      commit('setHistoryCacheSorted', [])
      commit('setHistoryCacheById', {})
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async updateWatchProgress({ commit }, { videoId, watchProgress }) {
    try {
      await DBHistoryHandlers.updateWatchProgress(videoId, watchProgress)
      commit('updateRecordWatchProgressInHistoryCache', { videoId, watchProgress })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateLastViewedPlaylist({ commit }, { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId }) {
    try {
      await DBHistoryHandlers.updateLastViewedPlaylist(videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId)
      commit('updateRecordLastViewedPlaylistIdInHistoryCache', { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async unsetLastViewedPlaylistForVideos({ commit }, { videoIds, lastViewedPlaylistId }) {
    try {
      await DBHistoryHandlers.unsetLastViewedPlaylistForVideos(videoIds, lastViewedPlaylistId)
      commit('unsetRecordsLastViewedPlaylistIdInHistoryCache', { videoIds, lastViewedPlaylistId })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async unsetLastViewedPlaylists({ commit }, lastViewedPlaylistIds) {
    try {
      await DBHistoryHandlers.unsetLastViewedPlaylists(lastViewedPlaylistIds)
      commit('unsetRecordsLastViewedPlaylistIdsInHistoryCache', lastViewedPlaylistIds)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },
}

const mutations = {
  setHistoryCacheSorted(state, historyCacheSorted) {
    state.historyCacheSorted = historyCacheSorted
  },

  setHistoryCacheById(state, historyCacheById) {
    state.historyCacheById = historyCacheById
  },

  upsertToHistoryCache(state, record) {
    const i = state.historyCacheSorted.findIndex((currentRecord) => {
      return record.videoId === currentRecord.videoId
    })

    if (i !== -1) {
      const currentRecord = state.historyCacheSorted[i]

      // Watched-status and other metadata-only updates keep their current position.
      // A newer timeWatched means the video was watched again and should become the
      // most recent history entry.
      if (record.timeWatched === currentRecord.timeWatched) {
        state.historyCacheSorted.splice(i, 1, record)
        state.historyCacheById[record.videoId] = record
        const positions = historyRecordPositions.get(state.historyCacheSorted)
        if (positions && record._id === currentRecord._id) {
          // The positions stay valid. Duplicate cache IDs retain the same
          // last-occurrence lookup as a complete index rebuild.
          if (positions.get(record._id) === i && state.historyCacheByRecordId[record._id] === currentRecord) state.historyCacheByRecordId[record._id] = record
          return true
        }
        return
      }

      state.historyCacheSorted.splice(i, 1)
    }

    state.historyCacheSorted.unshift(record)
    state.historyCacheById[record.videoId] = record
  },

  updateRecordWatchProgressInHistoryCache(state, { videoId, watchProgress }) {
    // historyCacheById and historyCacheSorted reference the same object instances,
    // so modifying an existing object in one of them will update both.

    const record = state.historyCacheById[videoId]

    // Don't set, if the item was removed from the watch history, as we don't have any video details
    if (record) {
      record.watchProgress = watchProgress
    }
  },

  updateRecordLastViewedPlaylistIdInHistoryCache(state, { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId }) {
    // historyCacheById and historyCacheSorted reference the same object instances,
    // so modifying an existing object in one of them will update both.

    const record = state.historyCacheById[videoId]

    // Don't set, if the item was removed from the watch history, as we don't have any video details
    if (record) {
      record.lastViewedPlaylistId = lastViewedPlaylistId
      record.lastViewedPlaylistType = lastViewedPlaylistType
      record.lastViewedPlaylistItemId = lastViewedPlaylistItemId
    }
  },

  unsetRecordsLastViewedPlaylistIdInHistoryCache(state, { videoIds, lastViewedPlaylistId }) {
    for (const videoId of videoIds) {
      // historyCacheById and historyCacheSorted reference the same object instances,
      // so modifying an existing object in one of them will update both.

      const record = state.historyCacheById[videoId]

      // Don't unset if the item was removed from the watch history or if the last viewed playlist does not match
      if (record && record.lastViewedPlaylistId === lastViewedPlaylistId) {
        delete record.lastViewedPlaylistId
        delete record.lastViewedPlaylistType
        delete record.lastViewedPlaylistItemId
      }
    }
  },

  unsetRecordsLastViewedPlaylistIdsInHistoryCache(state, playlistIds) {
    const playlistIdSet = new Set(playlistIds)

    for (const record of state.historyCacheSorted) {
      // Don't unset if the item was removed from the watch history or if the last viewed playlist does not match
      if (record && playlistIdSet.has(record.lastViewedPlaylistId)) {
        delete record.lastViewedPlaylistId
        delete record.lastViewedPlaylistType
        delete record.lastViewedPlaylistItemId
      }
    }
  },

  removeFromHistoryCacheById(state, videoId) {
    for (let i = 0; i < state.historyCacheSorted.length; i++) {
      if (state.historyCacheSorted[i].videoId === videoId) {
        state.historyCacheSorted.splice(i, 1)
        break
      }
    }

    delete state.historyCacheById[videoId]
  },

  removeMultipleFromHistoryCache(state, videoIds) {
    const videoIdSet = new Set(videoIds)
    state.historyCacheSorted = state.historyCacheSorted.filter(record => !videoIdSet.has(record.videoId))

    for (const videoId of videoIds) {
      delete state.historyCacheById[videoId]
    }
  },

  applyHistoryMetadata(state, records) {
    // Structural mutations rebuild positions for the current array. Metadata
    // patches leave record IDs and positions unchanged.
    const positions = historyRecordPositions.get(state.historyCacheSorted) ?? indexHistoryRecords(state)
    for (const record of records) {
      const position = positions.get(record._id)
      const previous = position === undefined ? null : state.historyCacheSorted[position]
      if (previous && previous.videoId === record.videoId) {
        state.historyCacheSorted[position] = record
        // Distinct legacy ID types can coerce to the same object key. Preserve
        // the last indexed occurrence when replacing an earlier one.
        if (state.historyCacheByRecordId[record._id] === previous) state.historyCacheByRecordId[record._id] = record
      }
      if (state.historyCacheById[record.videoId]?._id === record._id) state.historyCacheById[record.videoId] = record
    }
  },

  applyHistorySyncChanges(state, { insertions, updates, deletions }) {
    const upserts = [...insertions, ...updates]
    const deletedIds = new Set(deletions)
    const upsertsById = new Map(upserts.map(record => [record.videoId, record]))
    const retained = state.historyCacheSorted
      .filter(record => !deletedIds.has(record.videoId))
      .map(record => upsertsById.get(record.videoId) ?? record)
    const retainedIds = new Set(retained.map(record => record.videoId))

    // Replace existing entries in place so stable sorting preserves timestamp ties.
    state.historyCacheSorted = retained
      .concat(upserts.filter(record => !retainedIds.has(record.videoId)))
      .sort((a, b) => b.timeWatched - a.timeWatched)

    for (const videoId of deletions) {
      delete state.historyCacheById[videoId]
    }
    for (const record of upserts) {
      state.historyCacheById[record.videoId] = record
    }
  }
}

export default {
  state,
  getters,
  actions,
  // Only changes to shelf records invalidate selection. Playlist-only metadata
  // edits cannot affect membership or any details displayed by Home.
  mutations: Object.fromEntries(Object.entries(mutations).map(([name, mutation]) => [name, (state, payload) => {
    const previousHistory = state.historyCacheSorted
    const indexRetained = mutation(state, payload) === true
    state.historyRevision++
    if (state.historyCacheSorted !== previousHistory || (HISTORY_STRUCTURE_MUTATIONS.has(name) && !indexRetained)) indexHistoryRecords(state)
    if (CONTINUE_WATCHING_MUTATIONS.has(name)) state.continueWatchingRevision++
  }]))
}
