import { markRaw } from 'vue'

import {
  AI_SLOP_LIST_MAX_AGE_MS,
  AI_SLOP_LIST_URLS,
  loadCachedAiSlopList,
  parseAiSlopList,
  removeCachedAiSlopList,
  saveCachedAiSlopList
} from '../../helpers/aiSlopList'
import { fetchWithTimeout } from '../../helpers/utils'

const EMPTY_SET = markRaw(new Set())

/** @type {Promise<void> | null} */
let pendingLoad = null

const state = {
  aiSlopBlockedChannels: EMPTY_SET,
  aiSlopWarnedChannels: EMPTY_SET,
  aiSlopListFetchedAt: null,
  aiSlopListLoadFailed: false,
}

const getters = {
  getAiSlopBlockedChannels(state, _getters, _rootState, rootGetters) {
    return rootGetters.getUseAiSlopList ? state.aiSlopBlockedChannels : EMPTY_SET
  },

  getAiSlopWarnedChannels(state, _getters, _rootState, rootGetters) {
    return rootGetters.getUseAiSlopList ? state.aiSlopWarnedChannels : EMPTY_SET
  },

  getAiSlopListFetchedAt(state) {
    return state.aiSlopListFetchedAt
  },

  getAiSlopListLoadFailed(state) {
    return state.aiSlopListLoadFailed
  },
}

/**
 * @param {string} url
 */
async function fetchList(url) {
  const response = await fetchWithTimeout(30_000, url, { cache: 'no-cache', credentials: 'omit' })

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }

  return parseAiSlopList(await response.text())
}

const actions = {
  loadAiSlopList({ commit, state, rootGetters }) {
    if (state.aiSlopListFetchedAt === null) {
      const cached = loadCachedAiSlopList()

      if (cached) {
        commit('setAiSlopListEntries', cached)
      }
    }

    if (pendingLoad || (state.aiSlopListFetchedAt !== null && Date.now() - state.aiSlopListFetchedAt < AI_SLOP_LIST_MAX_AGE_MS)) {
      return pendingLoad
    }

    pendingLoad = (async () => {
      try {
        const [blocked, warned] = await Promise.all([
          fetchList(AI_SLOP_LIST_URLS.blocked),
          fetchList(AI_SLOP_LIST_URLS.warned),
        ])
        // The list may have been disabled while it was downloading
        if (!rootGetters.getUseAiSlopList) {
          return
        }

        const lists = { fetchedAt: Date.now(), blocked, warned }

        commit('setAiSlopListEntries', lists)
        saveCachedAiSlopList(lists)
      } catch (error) {
        console.error('Failed to download the AiSList channel lists', error)
        commit('setAiSlopListLoadFailed', true)
      } finally {
        pendingLoad = null
      }
    })()

    return pendingLoad
  },

  clearAiSlopList({ commit }) {
    removeCachedAiSlopList()
    commit('setAiSlopListEntries', { fetchedAt: null, blocked: [], warned: [] })
  },
}

const mutations = {
  setAiSlopListEntries(state, { fetchedAt, blocked, warned }) {
    state.aiSlopBlockedChannels = blocked.length === 0 ? EMPTY_SET : markRaw(new Set(blocked))
    state.aiSlopWarnedChannels = warned.length === 0 ? EMPTY_SET : markRaw(new Set(warned))
    state.aiSlopListFetchedAt = fetchedAt
    state.aiSlopListLoadFailed = false
  },

  setAiSlopListLoadFailed(state, value) {
    state.aiSlopListLoadFailed = value
  },
}

export default {
  state,
  getters,
  actions,
  mutations
}
