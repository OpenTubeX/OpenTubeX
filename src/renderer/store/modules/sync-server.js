import {
  SyncServerClient,
  normalizeSyncServerUrl,
  syncChannelPlaybackSpeeds,
  syncHistory,
  syncPlaylists,
  syncSubscriptions,
} from '../../helpers/sync-server'
import {
  EncryptedSyncAdapter,
  decryptSyncDocument,
  encryptSyncDocument,
  getPrivacySalt,
  loadLegacySyncDocument,
  preparePrivacyKey,
} from '../../helpers/sync-server-privacy'

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000

let activeSyncPromise = null
let autoSyncTimer = null

const state = {
  syncServerStatus: 'idle',
  syncServerError: '',
  syncServerLastResult: null,
  syncServerHistorySupported: null,
  syncServerPlaybackSpeedsSupported: null,
}

const getters = {
  getSyncServerStatus: state => state.syncServerStatus,
  getSyncServerError: state => state.syncServerError,
  getSyncServerLastResult: state => state.syncServerLastResult,
  getSyncServerHistorySupported: state => state.syncServerHistorySupported,
  getSyncServerPlaybackSpeedsSupported: state => state.syncServerPlaybackSpeedsSupported,
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
  const networkClient = new SyncServerClient(settings.syncServerUrl, settings.syncServerToken)
  let client = networkClient
  let encryptedSync = null
  const previous = parseSnapshot(settings.syncServerSnapshot)
  const next = { ...previous }
  const result = {}
  const store = { state: rootState, dispatch }

  commit('setSyncServerStatus', 'syncing')
  commit('setSyncServerError', '')

  try {
    if (settings.syncServerPrivacyMode === 'enhanced') {
      if (!settings.syncServerPrivacyKey) {
        throw new Error('Reconnect and enter your privacy passphrase to enable enhanced privacy')
      }
      const remote = await networkClient.getEncryptedSync()
      const document = await decryptSyncDocument(remote.payload, settings.syncServerPrivacyKey)
      // Older v1 enhanced servers did not report legacy_data. Prefer the
      // lossless migration path when the field is absent.
      const migrateLegacyData = !remote.payload && remote.legacy_data !== false
      client = migrateLegacyData ? networkClient : new EncryptedSyncAdapter(document)
      encryptedSync = {
        revision: remote.revision,
        salt: remote.payload ? getPrivacySalt(remote.payload) : settings.syncServerPrivacySalt,
        migrateLegacyData,
      }
    }

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
    if (settings.syncServerSyncPlaybackSpeeds) {
      const speeds = await syncChannelPlaybackSpeeds(client, store, previous.playbackSpeeds)
      if (speeds !== null) {
        commit('setSyncServerPlaybackSpeedsSupported', true)
        next.playbackSpeeds = speeds
        result.playbackSpeeds = Object.keys(speeds).length
      } else {
        commit('setSyncServerPlaybackSpeedsSupported', false)
      }
    }

    if (encryptedSync) {
      const document = encryptedSync.migrateLegacyData
        ? await loadLegacySyncDocument(networkClient)
        : client.document
      const payload = await encryptSyncDocument(
        document,
        settings.syncServerPrivacyKey,
        encryptedSync.salt
      )
      await networkClient.putEncryptedSync(encryptedSync.revision, payload)
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
  async authenticateSyncServer(
    { dispatch },
    { mode, serverUrl, username, password, privacyPassphrase }
  ) {
    if (mode !== 'login' && mode !== 'register') {
      throw new Error('Invalid authentication mode')
    }

    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      throw new Error('Username and password are required')
    }

    const client = new SyncServerClient(normalizedUrl)
    const privacySupported = await client.supportsEncryptedSync()
    if (privacySupported && !privacyPassphrase) {
      throw new Error('A privacy passphrase is required by this server')
    }
    if (privacySupported && privacyPassphrase.length < 12) {
      throw new Error('The privacy passphrase must be at least 12 characters')
    }
    if (privacySupported && privacyPassphrase === password) {
      throw new Error('The privacy passphrase must be different from the account password')
    }
    const token = await client.authenticate(mode, trimmedUsername, password)
    let privacyKey = ''
    let privacySalt = ''

    if (privacySupported) {
      const remote = await client.getEncryptedSync()
      const privacy = await preparePrivacyKey(remote.payload, privacyPassphrase)
      privacyKey = privacy.key
      privacySalt = privacy.salt
    }

    // Keep writes to the shared settings datastore ordered. In particular,
    // the URL must be committed before the token enables the initial sync.
    await dispatch('updateSyncServerUrl', normalizedUrl, { root: true })
    await dispatch('updateSyncServerUsername', trimmedUsername, { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerPrivacyMode', privacySupported ? 'enhanced' : 'legacy', { root: true })
    await dispatch('updateSyncServerPrivacyKey', privacyKey, { root: true })
    await dispatch('updateSyncServerPrivacySalt', privacySalt, { root: true })
    await dispatch('updateSyncServerToken', token, { root: true })

    await dispatch('startSyncServerAutoSync')
    return dispatch('syncWithSyncServer')
  },

  async disconnectSyncServer({ commit, dispatch }) {
    await dispatch('stopSyncServerAutoSync')
    await dispatch('updateSyncServerUsername', '', { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerPrivacyMode', 'unknown', { root: true })
    await dispatch('updateSyncServerPrivacyKey', '', { root: true })
    await dispatch('updateSyncServerPrivacySalt', '', { root: true })
    await dispatch('updateSyncServerToken', '', { root: true })
    commit('setSyncServerError', '')
    commit('setSyncServerLastResult', null)
    commit('setSyncServerHistorySupported', null)
    commit('setSyncServerPlaybackSpeedsSupported', null)
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

  async initializeSyncServer({ commit, dispatch, rootState }) {
    if (!rootState.settings.syncServerToken) return

    try {
      const client = new SyncServerClient(
        rootState.settings.syncServerUrl,
        rootState.settings.syncServerToken
      )
      const privacySupported = await client.supportsEncryptedSync()
      const privacyMode = privacySupported ? 'enhanced' : 'legacy'
      await dispatch('updateSyncServerPrivacyMode', privacyMode, { root: true })
      if (privacySupported && !rootState.settings.syncServerPrivacyKey) {
        commit(
          'setSyncServerError',
          'Reconnect and enter your privacy passphrase to enable enhanced privacy'
        )
        return
      }
    } catch (error) {
      commit('setSyncServerError', error.message)
      return
    }

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
  setSyncServerPlaybackSpeedsSupported(state, supported) {
    state.syncServerPlaybackSpeedsSupported = supported
  },
}

export default { state, getters, actions, mutations }
