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
import { SYNCABLE_SETTINGS } from '../helpers/sync-server'

const SYNC_TRIGGER_ACTIONS = new Set([
  'addChannelToProfiles',
  'addPlaylist',
  'addPlaylists',
  'addVideo',
  'addVideos',
  'createProfile',
  'markAllHistoryAsWatched',
  'overwriteHistory',
  'removeAllHistory',
  'removeAllPlaylists',
  'removeAllVideos',
  'removeChannelFromProfiles',
  'removeFromHistory',
  'removeHistoryOlderThan',
  'removePlaylist',
  'removePlaylists',
  'removeProfile',
  'removeVideo',
  'removeVideos',
  'updateHistory',
  'updateChannelPlaybackSpeeds',
  'updatePlaylist',
  'updateProfile',
  'updateWatchProgress',
])

function syncOnLocalChanges(store) {
  store.subscribeAction({
    after: action => {
      const setting = action.type.startsWith('update')
        ? action.type.charAt(6).toLowerCase() + action.type.slice(7)
        : ''
      if (SYNC_TRIGGER_ACTIONS.has(action.type) || SYNCABLE_SETTINGS.has(setting)) {
        store.dispatch('scheduleSyncServer', SYNCABLE_SETTINGS.has(setting) ? 'settings' : 'data')
      }
    },
  })
}

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
  strict: false,
  plugins: [syncOnLocalChanges]

  // TODO: Enable when deploy
  // plugins: [createPersistedState()]
})
