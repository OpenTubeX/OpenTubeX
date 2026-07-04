/**
 * Vuex module for managing tab state in the renderer
 */

const state = {
  tabs: [],
  activeTabId: null,
  tabBarScrollPosition: 0,
  currentWatchTimestamp: null
}

const getters = {
  getTabs: (state) => state.tabs,
  getActiveTabId: (state) => state.activeTabId,
  getActiveTab: (state) => state.tabs.find(tab => tab.id === state.activeTabId),
  getTabCount: (state) => state.tabs.length,
  getTabBarScrollPosition: (state) => state.tabBarScrollPosition,
  getCurrentWatchTimestamp: (state) => state.currentWatchTimestamp
}

const mutations = {
  setTabsState(state, { tabs, activeTabId, tabBarScrollPosition }) {
    state.tabs = tabs
    state.activeTabId = activeTabId
    if (tabBarScrollPosition != null) {
      state.tabBarScrollPosition = tabBarScrollPosition
    }
  },
  setCurrentWatchTimestamp(state, value) {
    state.currentWatchTimestamp = value
  }
}

const actions = {
  /**
   * Initialize tab state from main process
   */
  async initializeTabs({ commit }) {
    if (!process.env.IS_ELECTRON) return

    const state = await window.ftElectron.tabs.getState()
    if (state) {
      commit('setTabsState', state)
    }

    // Listen for state updates from main process
    window.ftElectron.tabs.onStateUpdated((newState) => {
      commit('setTabsState', newState)
    })
  },

  /**
   * Create a new tab
   * @param {object} _context - Vuex action context
   * @param {object} [options] - Tab creation options
   * @param {string} [options.url] - Full URL
   * @param {string} [options.route] - Hash route
   * @param {object} [options.query] - Query params
   * @param {boolean} [options.makeActive=true] - Whether to activate
   * @param {boolean} [options.inheritColorFromOpener=false] - Whether to inherit the opener tab color
   */
  async createTab(_context, options = {}) {
    if (!process.env.IS_ELECTRON) return null

    const tab = await window.ftElectron.tabs.create(options)
    return tab
  },

  /**
   * Activate a tab
   * @param {string} tabId
   */
  activateTab({ commit }, tabId) {
    if (!process.env.IS_ELECTRON) return

    window.ftElectron.tabs.activate(tabId)
  },

  /**
   * Close a tab
   * @param {object} _context - Vuex action context
   * @param {string} tabId
   * @returns {Promise<boolean>} Whether there are remaining tabs
   */
  async closeTab(_context, tabId) {
    if (!process.env.IS_ELECTRON) return false

    const result = await window.ftElectron.tabs.close(tabId)
    return result?.hasRemainingTabs ?? false
  },

  /**
   * Close the current active tab
   */
  async closeActiveTab({ state, dispatch }) {
    if (state.activeTabId) {
      return await dispatch('closeTab', state.activeTabId)
    }
    return false
  },

  /**
   * Duplicate a tab
   * @param {object} _context - Vuex action context
   * @param {string} tabId
   */
  async duplicateTab(_context, tabId) {
    if (!process.env.IS_ELECTRON) return null

    return await window.ftElectron.tabs.duplicate(tabId)
  },

  /**
   * Move a tab to a new position
   * @param {object} _context - Vuex action context
   * @param {{ tabId: string, toIndex: number }} payload
   */
  moveTab(_context, { tabId, toIndex }) {
    if (!process.env.IS_ELECTRON) return

    window.ftElectron.tabs.move(tabId, toIndex)
  },

  /**
   * Pin or unpin a tab.
   * @param {object} _context - Vuex action context
   * @param {{ tabId: string, isPinned: boolean }} payload
   */
  setTabPinned(_context, { tabId, isPinned }) {
    if (!process.env.IS_ELECTRON) return

    window.ftElectron.tabs.setPinned(tabId, isPinned)
  },

  /**
   * Set a tab color.
   * @param {object} _context - Vuex action context
   * @param {{ tabId: string, color: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | null }} payload
   */
  setTabColor(_context, { tabId, color }) {
    if (!process.env.IS_ELECTRON) return

    window.ftElectron.tabs.setColor(tabId, color)
  },

  /**
   * Restore the last closed tab
   */
  async restoreClosedTab(_context) {
    if (!process.env.IS_ELECTRON) return null

    return await window.ftElectron.tabs.restoreClosed()
  },

  /**
   * Reload a tab
   */
  reloadTab(_context) {
    if (!process.env.IS_ELECTRON) return

    window.ftElectron.tabs.reload()
  },

  /**
   * Reload the current active tab
   */
  reloadActiveTab({ dispatch }) {
    if (!process.env.IS_ELECTRON) return

    dispatch('reloadTab')
  },

  /**
   * Go to next tab
   */
  nextTab({ state }) {
    if (!process.env.IS_ELECTRON || state.tabs.length <= 1) return

    const currentIndex = state.tabs.findIndex(tab => tab.id === state.activeTabId)
    const nextIndex = (currentIndex + 1) % state.tabs.length
    window.ftElectron.tabs.activate(state.tabs[nextIndex].id)
  },

  /**
   * Go to previous tab
   */
  prevTab({ state }) {
    if (!process.env.IS_ELECTRON || state.tabs.length <= 1) return

    const currentIndex = state.tabs.findIndex(tab => tab.id === state.activeTabId)
    const prevIndex = (currentIndex - 1 + state.tabs.length) % state.tabs.length
    window.ftElectron.tabs.activate(state.tabs[prevIndex].id)
  }
}

export default {
  state,
  getters,
  mutations,
  actions
}
