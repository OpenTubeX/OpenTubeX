import { MIXED_SEARCH_HISTORY_ENTRIES_DISPLAY_LIMIT } from '../../../constants'
import { DBSearchHistoryHandlers } from '../../../datastores/handlers/index'
import {
  getSearchHistoryEntryQuery,
  mergeSearchHistoryEntries,
  normalizeSearchHistoryEntry,
  resolveSearchHistoryEntry,
  sortSearchHistoryByLastUpdatedAt,
} from '../../../search-history'

const state = {
  searchHistoryEntries: []
}

const getters = {
  getSearchHistoryEntries: (state) => {
    return state.searchHistoryEntries
  },

  getLatestSearchHistoryEntries: (state) => {
    return state.searchHistoryEntries
  },

  getLatestMatchingSearchHistoryEntries: (state) => (query) => {
    const matches = []

    for (const entry of state.searchHistoryEntries) {
      if (getSearchHistoryEntryQuery(entry).startsWith(query)) {
        matches.push(entry)

        if (matches.length === MIXED_SEARCH_HISTORY_ENTRIES_DISPLAY_LIMIT) {
          break
        }
      }
    }

    // prioritize more concise matches
    return matches.sort((a, b) => {
      return getSearchHistoryEntryQuery(a).length - getSearchHistoryEntryQuery(b).length
    })
  },
}
const actions = {
  async grabSearchHistoryEntries({ commit }) {
    try {
      const results = await DBSearchHistoryHandlers.find()
      commit('mergeLoadedSearchHistoryEntries', results)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSearchHistoryEntry({ state, commit }, searchHistoryEntry) {
    try {
      const updatedEntry = resolveSearchHistoryEntry(searchHistoryEntry, state.searchHistoryEntries)
      const persistedEntry = await DBSearchHistoryHandlers.upsert(updatedEntry)
      commit('upsertSearchHistoryEntryToList', persistedEntry ?? updatedEntry)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  /**
   * @param {any} param0
   * @param {{ _id: string, lastUpdatedAt: number }[]} historyItems
   */
  async overwriteSearchHistory({ commit }, historyItems) {
    try {
      // sort before sending saving to the database and passing to other windows
      // so that the other windows can use it as is, without having to sort the array themselves
      sortSearchHistoryByLastUpdatedAt(historyItems)

      await DBSearchHistoryHandlers.overwrite(historyItems)
      commit('setSearchHistoryEntries', historyItems)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeSearchHistoryEntry({ commit }, _id) {
    try {
      await DBSearchHistoryHandlers.delete(_id)
      commit('removeSearchHistoryEntryFromList', _id)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeAllSearchHistoryEntries({ commit }) {
    try {
      await DBSearchHistoryHandlers.deleteAll()
      commit('setSearchHistoryEntries', [])
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },
}

const mutations = {
  mergeLoadedSearchHistoryEntries(state, searchHistoryEntries) {
    state.searchHistoryEntries = mergeSearchHistoryEntries(searchHistoryEntries, state.searchHistoryEntries)
    sortSearchHistoryByLastUpdatedAt(state.searchHistoryEntries)
  },

  setSearchHistoryEntries(state, searchHistoryEntries) {
    state.searchHistoryEntries = searchHistoryEntries.map(normalizeSearchHistoryEntry)
  },

  upsertSearchHistoryEntryToList(state, updatedSearchHistoryEntry) {
    updatedSearchHistoryEntry = normalizeSearchHistoryEntry(updatedSearchHistoryEntry)
    state.searchHistoryEntries = state.searchHistoryEntries.filter((p) => {
      return p._id !== updatedSearchHistoryEntry._id
    })

    state.searchHistoryEntries.unshift(updatedSearchHistoryEntry)
  },

  removeSearchHistoryEntryFromList(state, _id) {
    state.searchHistoryEntries = state.searchHistoryEntries.filter((searchHistoryEntry) => searchHistoryEntry._id !== _id)
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
