import { DBWatchStatsHandlers } from '../../../datastores/handlers/index'

import { createWatchStatsReset } from '../../helpers/sync-watch-stats'

const state = {
  watchSecondsByDate: {},
  watchStatsLoaded: false,
  syncedWatchStats: [],
  hasHistoricalWatchTimeEstimate: false,
  historicalWatchTimePlaybackSpeed: null,
  // When the statistics were last cleared in this window, which its views watch
  watchStatsResetAt: 0
}

const getters = {
  getWatchSecondsByDate(state) {
    return state.watchSecondsByDate
  },

  getSyncedWatchStats(state) {
    return state.syncedWatchStats
  },

  getHasHistoricalWatchTimeEstimate(state) {
    return state.hasHistoricalWatchTimeEstimate
  },

  getHistoricalWatchTimePlaybackSpeed(state) {
    return state.historicalWatchTimePlaybackSpeed
  },

  getWatchStatsResetAt(state) {
    return state.watchStatsResetAt
  }
}

const actions = {
  async grabWatchStats({ commit }) {
    try {
      const hasHistoricalEstimate = await DBWatchStatsHandlers.migrateHistory()
      const [records, historicalAdjustment] = await Promise.all([
        DBWatchStatsHandlers.find(),
        DBWatchStatsHandlers.getHistoricalAdjustment(),
      ])
      commit('setWatchStats', records)
      commit('setHasHistoricalWatchTimeEstimate', hasHistoricalEstimate)
      commit('setHistoricalWatchTimePlaybackSpeed', historicalAdjustment?.defaultSpeed ?? null)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async recordWatchTime({ commit }, { date, seconds }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(seconds) || seconds <= 0) {
      return
    }

    try {
      await DBWatchStatsHandlers.addWatchTime(date, seconds)
      commit('addWatchTime', { date, seconds })
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async clearWatchStats({ commit, dispatch, rootState, state }) {
    try {
      const previous = rootState.settings.syncServerWatchStatsReset
      // Windows order clears by this time, so it grows even when the clock moved back
      const at = Math.max(Date.now(), (previous?.at ?? 0) + 1)
      const reset = createWatchStatsReset(state.syncedWatchStats, rootState.settings.syncServerDeviceId, at)
      await dispatch('updateSyncServerWatchStatsReset', reset)
      // Confirm this marker persisted, not just that the write did not fail: a newer
      // write can supersede it. A failed save must not lose local history.
      if (rootState.settings.syncServerWatchStatsReset?.id !== reset.id) return false
      try {
        await DBWatchStatsHandlers.deleteAll(reset.at)
      } catch (error) {
        await dispatch('updateSyncServerWatchStatsReset', previous)
        throw error
      }
      commit('resetWatchStats', reset.at)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async adjustHistoricalWatchTime({ commit }, { defaultSpeed, channelPlaybackSpeeds }) {
    try {
      const result = await DBWatchStatsHandlers.adjustHistoricalWatchTime(
        defaultSpeed,
        channelPlaybackSpeeds
      )
      commit('setWatchStats', result.records)
      commit('setHistoricalWatchTimePlaybackSpeed', result.defaultSpeed)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  }
}

const mutations = {
  setWatchStats(state, records) {
    state.watchSecondsByDate = Object.fromEntries(
      records.map(({ date, seconds }) => [date, seconds])
    )
    state.watchStatsLoaded = true
  },

  setSyncedWatchStats(state, devices) {
    state.syncedWatchStats = devices
  },

  addWatchTime(state, { date, seconds }) {
    state.watchSecondsByDate[date] = (state.watchSecondsByDate[date] ?? 0) + seconds
  },

  setHasHistoricalWatchTimeEstimate(state, value) {
    state.hasHistoricalWatchTimeEstimate = value
  },

  setHistoricalWatchTimePlaybackSpeed(state, value) {
    state.historicalWatchTimePlaybackSpeed = value
  },

  resetWatchStats(state, resetAt) {
    state.watchSecondsByDate = {}
    state.hasHistoricalWatchTimeEstimate = false
    state.historicalWatchTimePlaybackSpeed = null
    state.watchStatsResetAt = resetAt
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
