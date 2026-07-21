import {
  SyncServerClient,
  normalizeSyncServerUrl,
  syncHistory,
  syncPlaylists,
  syncSubscriptions,
} from '../../helpers/sync-server'

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000

let activeSyncPromise = null
let autoSyncTimer = null

const state = {
  syncServerStatus: 'idle',
  syncServerError: '',
  syncServerLastResult: null,
  syncServerHistorySupported: null,
}

const getters = {
  getSyncServerStatus: state => state.syncServerStatus,
  getSyncServerError: state => state.syncServerError,
  getSyncServerLastResult: state => state.syncServerLastResult,
  getSyncServerHistorySupported: state => state.syncServerHistorySupported,
}

function parseSnapshot(value) {
  try {
    const snapshot = JSON.parse(value)
    return snapshot && typeof snapshot === 'object' ? snapshot : {}
  } catch {
    return {}
  }
}

function withSyncLock(callback) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('opentubex-sync-server', callback)
  }
  return callback()
}

async function runSync(context) {
  const { commit, dispatch, rootState } = context
  const settings = rootState.settings
  const client = new SyncServerClient(settings.syncServerUrl, settings.syncServerToken)
  const previous = parseSnapshot(settings.syncServerSnapshot)
  const next = { ...previous }
  const result = {}
  const store = { state: rootState, dispatch }

  commit('setSyncServerStatus', 'syncing')
  commit('setSyncServerError', '')

  try {
    if (settings.syncServerSyncSubscriptions) {
      next.subscriptions = await syncSubscriptions(client, store, previous.subscriptions)
      result.subscriptions = next.subscriptions.length
    }
    if (settings.syncServerSyncPlaylists) {
      next.playlists = await syncPlaylists(client, store, previous.playlists)
      result.playlists = Object.keys(next.playlists).length
    }
    if (settings.syncServerSyncHistory) {
      const history = await syncHistory(client, store, previous.history)
      if (history !== null) {
        commit('setSyncServerHistorySupported', true)
        next.history = history
        result.history = history.length
      } else {
        commit('setSyncServerHistorySupported', false)
      }
    }

    const lastSyncAt = Date.now()
    await Promise.all([
      dispatch('updateSyncServerSnapshot', JSON.stringify(next), { root: true }),
      dispatch('updateSyncServerLastSyncAt', lastSyncAt, { root: true }),
    ])
    commit('setSyncServerLastResult', result)
    commit('setSyncServerStatus', 'success')
    return result
  } catch (error) {
    commit('setSyncServerError', error.message)
    commit('setSyncServerStatus', 'error')
    throw error
  }
}

const actions = {
  async authenticateSyncServer({ dispatch }, { mode, serverUrl, username, password }) {
    if (mode !== 'login' && mode !== 'register') {
      throw new Error('Invalid authentication mode')
    }

    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      throw new Error('Username and password are required')
    }

    const client = new SyncServerClient(normalizedUrl)
    const token = await client.authenticate(mode, trimmedUsername, password)

    // Keep writes to the shared settings datastore ordered. In particular,
    // the URL must be committed before the token enables the initial sync.
    await dispatch('updateSyncServerUrl', normalizedUrl, { root: true })
    await dispatch('updateSyncServerUsername', trimmedUsername, { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerToken', token, { root: true })

    await dispatch('startSyncServerAutoSync')
    return dispatch('syncWithSyncServer')
  },

  async disconnectSyncServer({ commit, dispatch }) {
    await dispatch('stopSyncServerAutoSync')
    await dispatch('updateSyncServerUsername', '', { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerToken', '', { root: true })
    commit('setSyncServerError', '')
    commit('setSyncServerLastResult', null)
    commit('setSyncServerHistorySupported', null)
    commit('setSyncServerStatus', 'idle')
  },

  async deleteSyncServerAccount({ commit, dispatch, rootState }, password) {
    if (!rootState.settings.syncServerToken) {
      throw new Error('Connect to a sync server first')
    }
    if (!password) {
      throw new Error('Password is required')
    }

    commit('setSyncServerStatus', 'syncing')
    commit('setSyncServerError', '')
    await dispatch('stopSyncServerAutoSync')

    try {
      const client = new SyncServerClient(
        rootState.settings.syncServerUrl,
        rootState.settings.syncServerToken
      )
      await client.deleteAccount(password)
      await dispatch('disconnectSyncServer')
    } catch (error) {
      commit('setSyncServerError', error.message)
      commit('setSyncServerStatus', 'error')
      await dispatch('startSyncServerAutoSync')
      throw error
    }
  },

  syncWithSyncServer(context) {
    if (!context.rootState.settings.syncServerToken) {
      return Promise.reject(new Error('Connect to a sync server first'))
    }
    if (!activeSyncPromise) {
      activeSyncPromise = withSyncLock(() => runSync(context)).finally(() => {
        activeSyncPromise = null
      })
    }
    return activeSyncPromise
  },

  async initializeSyncServer({ dispatch, rootState }) {
    if (!rootState.settings.syncServerToken) return

    await dispatch('startSyncServerAutoSync')
    if (rootState.settings.syncServerAutoSync) {
      await dispatch('syncWithSyncServer')
    }
  },

  startSyncServerAutoSync({ dispatch, rootState }) {
    if (autoSyncTimer || !rootState.settings.syncServerAutoSync || !rootState.settings.syncServerToken) {
      return
    }

    autoSyncTimer = setInterval(() => {
      dispatch('syncWithSyncServer').catch(error => {
        console.error('Sync server automatic sync failed', error)
      })
    }, AUTO_SYNC_INTERVAL_MS)
  },

  stopSyncServerAutoSync() {
    clearInterval(autoSyncTimer)
    autoSyncTimer = null
  },

  async setSyncServerAutoSync({ dispatch }, enabled) {
    await dispatch('updateSyncServerAutoSync', enabled, { root: true })
    await dispatch(enabled ? 'startSyncServerAutoSync' : 'stopSyncServerAutoSync')
  },
}

const mutations = {
  setSyncServerStatus(state, status) {
    state.syncServerStatus = status
  },
  setSyncServerError(state, error) {
    state.syncServerError = error
  },
  setSyncServerLastResult(state, result) {
    state.syncServerLastResult = result
  },
  setSyncServerHistorySupported(state, supported) {
    state.syncServerHistorySupported = supported
  },
}

export default { state, getters, actions, mutations }
