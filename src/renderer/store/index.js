import { createStore } from 'vuex'
// import createPersistedState from 'vuex-persistedstate'

import downloads from './modules/downloads'
import history from './modules/history'
import invidious from './modules/invidious'
import playlists from './modules/playlists'
import profiles from './modules/profiles'
import settings from './modules/settings'
import searchHistory from './modules/search-history'
import subscriptionCache from './modules/subscription-cache'
import utils from './modules/utils'
import player from './modules/player'
import tabs from './modules/tabs'
import watchStats from './modules/watch-stats'
import syncServer from './modules/sync-server'

export default createStore({
  modules: {
    downloads,
    history,
    invidious,
    playlists,
    profiles,
    settings,
    searchHistory,
    subscriptionCache,
    utils,
    player,
    tabs,
    watchStats,
    syncServer,
  },

  // Detects unsafe changes to the store state e.g. outside of mutations
  // but we have to turn it off despite its usefulness as we have so much data in the store
  // that it causes a noticable slow-down :(
  strict: false

  // TODO: Enable when deploy
  // plugins: [createPersistedState()]
})
