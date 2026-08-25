import { DBWatchStatsHandlers } from '../../../datastores/handlers/index'

const state = {
  watchSecondsByDate: {},
  hasHistoricalWatchTimeEstimate: false,
  historicalWatchTimePlaybackSpeed: null,
  watchStatsResetVersion: 0
}

const getters = {
  getWatchSecondsByDate(state) {
    return state.watchSecondsByDate
  },

  getHasHistoricalWatchTimeEstimate(state) {
    return state.hasHistoricalWatchTimeEstimate
  },

  getHistoricalWatchTimePlaybackSpeed(state) {
    return state.historicalWatchTimePlaybackSpeed
  },

  getWatchStatsResetVersion(state) {
    return state.watchStatsResetVersion
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
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async clearWatchStats({ commit }) {
    try {
      await DBWatchStatsHandlers.deleteAll()
      commit('resetWatchStats')
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

  resetWatchStats(state) {
    state.watchSecondsByDate = {}
    state.hasHistoricalWatchTimeEstimate = false
    state.historicalWatchTimePlaybackSpeed = null
    state.watchStatsResetVersion++
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
