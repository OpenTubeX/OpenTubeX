import { DBWatchStatsHandlers } from '../../../datastores/handlers/index'

const state = {
  watchSecondsByDate: {},
  hasHistoricalWatchTimeEstimate: false,
  watchStatsResetVersion: 0
}

const getters = {
  getWatchSecondsByDate(state) {
    return state.watchSecondsByDate
  },

  getHasHistoricalWatchTimeEstimate(state) {
    return state.hasHistoricalWatchTimeEstimate
  },

  getWatchStatsResetVersion(state) {
    return state.watchStatsResetVersion
  }
}

const actions = {
  async grabWatchStats({ commit }) {
    try {
      const hasHistoricalEstimate = await DBWatchStatsHandlers.migrateHistory()
      const records = await DBWatchStatsHandlers.find()
      commit('setWatchStats', records)
      commit('setHasHistoricalWatchTimeEstimate', hasHistoricalEstimate)
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
    } catch (errMessage) {
      console.error(errMessage)
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

  resetWatchStats(state) {
    state.watchSecondsByDate = {}
    state.hasHistoricalWatchTimeEstimate = false
    state.watchStatsResetVersion++
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
