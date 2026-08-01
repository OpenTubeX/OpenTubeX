import {
  SyncServerClient,
  SyncServerCancelledError,
  SyncServerDataLossError,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  isExpiredSessionReauthentication,
  isSessionExpiredError,
  normalizeSyncServerUrl,
  syncChannelPlaybackSpeeds,
  syncHistory,
  syncPlaylists,
  syncProfiles,
  syncSessions,
  syncSettings,
  syncSubscriptions,
} from '../../helpers/sync-server'
import {
  EncryptedSyncAdapter,
  createEmptySyncDocument,
  decryptLegacySyncDocument,
  decryptSyncDocument,
  encryptSyncDocument,
  loadLegacySyncDocument,
  preparePrivacyKey,
} from '../../helpers/sync-server-privacy'
import {
  AUTO_SYNC_INTERVAL_MS,
  isRecentSync,
  isSyncReasonEnabled,
} from '../../helpers/sync-server-scheduling'

const EVENT_SYNC_DEBOUNCE_MS = 1500
const ENCRYPTED_SYNC_RETRIES = 3
const LEGACY_ENCRYPTED_COLLECTIONS = [
  'subscriptions',
  'playlists',
  'history',
  'playbackSpeeds',
  'profiles',
  'playlistBookmarks',
]

let activeSyncPromise = null
const activeSyncClients = new Set()
let autoSyncTimer = null
let eventSyncTimer = null
let lifecycleSyncStarted = false

function trackSyncClient(client) {
  activeSyncClients.add(client)
  return client
}

function releaseSyncClient(client) {
  activeSyncClients.delete(client)
}

function cancelActiveSyncClients() {
  for (const client of activeSyncClients) client.cancel()
}

function assertSyncEnabled(rootState, client) {
  if (!rootState.settings.syncServerEnabled || client.cancelled) {
    throw new SyncServerCancelledError()
  }
}

const state = {
  syncServerStatus: 'idle',
  syncServerProgress: null,
  syncServerError: '',
  syncServerLastResult: null,
  syncServerHistorySupported: null,
  syncServerPlaybackSpeedsSupported: null,
  syncServerSessionExpired: false,
}

const getters = {
  getSyncServerStatus: state => state.syncServerStatus,
  getSyncServerProgress: state => state.syncServerProgress,
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

async function runSync(context, { allowDataLoss = false } = {}) {
  const { commit, dispatch, rootState } = context
  const settings = rootState.settings
  const networkClient = trackSyncClient(
    new SyncServerClient(settings.syncServerUrl, settings.syncServerToken)
  )
  let client = networkClient
  let encryptedCollections = null
  const previous = parseSnapshot(settings.syncServerSnapshot)
  const next = { ...previous }
  const result = {}
  const store = { state: rootState, dispatch }
  const stages = [
    ...(settings.syncServerPrivacyMode === 'enhanced' ? ['download'] : []),
    ...(settings.syncServerSyncSubscriptions ? ['subscriptions'] : []),
    ...(settings.syncServerSyncPlaylists ? ['playlists'] : []),
    ...(settings.syncServerSyncHistory ? ['history'] : []),
    ...(settings.syncServerSyncPlaybackSpeeds ? ['playbackSpeeds'] : []),
    ...(settings.syncServerSyncProfiles ? ['profiles'] : []),
    ...(process.env.IS_ELECTRON &&
      settings.syncServerPrivacyMode === 'enhanced' &&
      settings.syncServerSyncSessions
      ? ['sessions']
      : []),
    ...(settings.syncServerPrivacyMode === 'enhanced' && settings.syncServerSyncSettings
      ? ['settings']
      : []),
    ...(settings.syncServerPrivacyMode === 'enhanced' ? ['upload'] : []),
    'finishing',
  ]
  let completedStages = 0

  function assertSyncStillActive() {
    assertSyncEnabled(rootState, networkClient)
  }

  async function runStage(stage, callback) {
    assertSyncStillActive()
    commit('setSyncServerProgress', {
      stage,
      percentage: Math.round((completedStages / stages.length) * 100),
    })
    const value = await callback()
    assertSyncStillActive()
    completedStages++
    commit('setSyncServerProgress', {
      stage,
      percentage: Math.round((completedStages / stages.length) * 100),
    })
    return value
  }

  commit('setSyncServerStatus', 'syncing')
  commit('setSyncServerProgress', { stage: stages[0], percentage: 0 })
  commit('setSyncServerError', '')

  async function applyCollection(collection, targetClient) {
    switch (collection) {
      case 'subscriptions':
        next.subscriptions = await syncSubscriptions(
          targetClient,
          store,
          previous.subscriptions,
          { allowDataLoss }
        )
        result.subscriptions = next.subscriptions.length
        break
      case 'playlists':
        next.playlists = await syncPlaylists(
          targetClient,
          store,
          previous.playlists,
          { allowDataLoss }
        )
        result.playlists = Object.keys(next.playlists).length
        break
      case 'history': {
        const history = await syncHistory(
          targetClient,
          store,
          previous.history,
          { allowDataLoss }
        )
        if (history !== null) {
          commit('setSyncServerHistorySupported', true)
          next.history = history
          result.history = history.length
        } else {
          commit('setSyncServerHistorySupported', false)
        }
        break
      }
      case 'playbackSpeeds': {
        const speeds = await syncChannelPlaybackSpeeds(
          targetClient,
          store,
          previous.playbackSpeeds,
          { allowDataLoss }
        )
        if (speeds !== null) {
          commit('setSyncServerPlaybackSpeedsSupported', true)
          next.playbackSpeeds = speeds
          result.playbackSpeeds = Object.keys(speeds).length
        } else {
          commit('setSyncServerPlaybackSpeedsSupported', false)
        }
        break
      }
      case 'profiles':
        {
          const profiles = await syncProfiles(
            targetClient,
            store,
            previous.profiles,
            { allowDataLoss }
          )
          if (profiles !== null) {
            next.profiles = profiles
            result.profiles = Object.keys(profiles).length
          }
        }
        break
      case 'settings':
        next.settings = await syncSettings(targetClient, store, previous.settings)
        result.settings = Object.keys(next.settings).length
        break
      case 'sessions': {
        const sessions = await syncSessions(
          targetClient,
          Object.prototype.hasOwnProperty.call(previous, 'sessions') ? previous.sessions : null
        )
        if (sessions !== null) {
          next.sessions = sessions
          result.sessions = sessions.reduce((count, session) => count + session.tabs.length, 0)
        }
        break
      }
    }
  }

  try {
    if (settings.syncServerPrivacyMode === 'enhanced') {
      if (!settings.syncServerPrivacyKey) {
        throw new Error('Reconnect and enter your privacy passphrase to enable enhanced privacy')
      }
      const enabledCollections = stages.filter(stage => ![
        'download',
        'upload',
        'finishing',
      ].includes(stage))
      const {
        document,
        original,
        remote,
        uploadCollections,
      } = await runStage('download', async () => {
        const manifest = await networkClient.getEncryptedSyncManifest()
        const legacyEncrypted = manifest.legacy_encrypted_data
          ? await networkClient.getLegacyEncryptedSync()
          : null
        const legacy = legacyEncrypted?.payload
          ? await decryptLegacySyncDocument(
              legacyEncrypted.payload,
              settings.syncServerPrivacyKey
            )
          : manifest.legacy_data
            ? await loadLegacySyncDocument(networkClient)
            : createEmptySyncDocument()
        const uploadCollections = manifest.legacy_data || legacyEncrypted?.payload
          ? Array.from(new Set([...enabledCollections, ...LEGACY_ENCRYPTED_COLLECTIONS]))
          : enabledCollections
        const document = createEmptySyncDocument()
        const original = {}
        const entries = await Promise.all(uploadCollections.map(async collection => {
          const response = await networkClient.getEncryptedSyncCollection(collection)
          const data = response.payload
            ? await decryptSyncDocument(response.payload, settings.syncServerPrivacyKey)
            : legacy[collection]
          document[collection] = data ?? document[collection]
          original[collection] = structuredClone(document[collection])
          return [collection, response]
        }))
        return { document, original, remote: Object.fromEntries(entries), uploadCollections }
      })
      client = new EncryptedSyncAdapter(document)
      encryptedCollections = {
        original,
        remote,
        enabled: enabledCollections,
        upload: uploadCollections,
      }
    }

    const collections = encryptedCollections?.enabled ?? stages.filter(stage => ![
      'download',
      'upload',
      'finishing',
      'settings',
    ].includes(stage))
    for (const collection of collections) {
      await runStage(collection, () => applyCollection(collection, client))
    }

    if (encryptedCollections) {
      await runStage('upload', async () => {
        for (const collection of encryptedCollections.upload) {
          assertSyncStillActive()
          let revision = encryptedCollections.remote[collection].revision
          let data = client.document[collection]
          if (revision > 0 &&
              JSON.stringify(data) === JSON.stringify(encryptedCollections.original[collection])) {
            continue
          }
          for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
            const payload = await encryptSyncDocument(
              data,
              settings.syncServerPrivacyKey,
              settings.syncServerPrivacySalt
            )
            try {
              await networkClient.putEncryptedSyncCollection(collection, revision, payload)
              break
            } catch (error) {
              if (error.status !== 409 || attempt === ENCRYPTED_SYNC_RETRIES - 1) throw error
              const remote = await networkClient.getEncryptedSyncCollection(collection)
              const retryDocument = createEmptySyncDocument()
              const remoteData = await decryptSyncDocument(
                remote.payload,
                settings.syncServerPrivacyKey
              )
              if (collection === 'playlistBookmarks') {
                const bookmarks = new Map(remoteData.map(entry => [entry.playlist.id, entry]))
                for (const entry of data) bookmarks.set(entry.playlist.id, entry)
                revision = remote.revision
                data = Array.from(bookmarks.values())
                continue
              }
              retryDocument[collection] = remoteData
              retryDocument.subscriptions = client.document.subscriptions
              const retryClient = new EncryptedSyncAdapter(retryDocument)
              if (collection === 'settings') {
                next.settings = await syncSettings(retryClient, store, next.settings)
                result.settings = Object.keys(next.settings).length
              } else {
                await applyCollection(collection, retryClient)
              }
              revision = remote.revision
              data = retryClient.document[collection]
            }
          }
        }
      })
    }

    await runStage('finishing', async () => {
      const lastSyncAt = Date.now()
      await Promise.all([
        dispatch('updateSyncServerSnapshot', JSON.stringify(next), { root: true }),
        dispatch('updateSyncServerLastSyncAt', lastSyncAt, { root: true }),
      ])
    })
    commit('setSyncServerLastResult', result)
    commit('setSyncServerProgress', null)
    commit('setSyncServerStatus', 'success')
    return result
  } catch (error) {
    if (error instanceof SyncServerCancelledError) {
      commit('setSyncServerProgress', null)
      commit('setSyncServerError', '')
      commit('setSyncServerStatus', 'idle')
      return null
    }
    if (error instanceof SyncServerDataLossError) {
      await dispatch('setSyncServerAutoSync', false)
    }
    commit('setSyncServerProgress', null)
    if (isSessionExpiredError(error)) {
      // Retrying cannot help once the token is rejected, and every scheduled
      // sync would keep failing with the same opaque message. Drop the token so
      // automatic sync stops and the UI asks for a sign-in.
      await dispatch('expireSyncServerSession')
      throw new Error(SYNC_SERVER_SESSION_EXPIRED_MESSAGE, { cause: error })
    }
    commit('setSyncServerError', error.message)
    commit('setSyncServerStatus', 'error')
    throw error
  } finally {
    releaseSyncClient(networkClient)
  }
}

const actions = {
  async authenticateSyncServer(
    { commit, dispatch, rootState, state },
    { mode, serverUrl, username, password, privacyPassphrase }
  ) {
    if (mode !== 'login' && mode !== 'register') {
      throw new Error('Invalid authentication mode')
    }
    if (!rootState.settings.syncServerEnabled) {
      throw new Error('Enable sync first')
    }

    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const trimmedUsername = username.trim()
    const previousToken = rootState.settings.syncServerToken
    const resumesExpiredSession = isExpiredSessionReauthentication({
      expired: state.syncServerSessionExpired,
      savedServerUrl: rootState.settings.syncServerUrl,
      savedUsername: rootState.settings.syncServerUsername,
      serverUrl: normalizedUrl,
      username: trimmedUsername,
    })
    if (!trimmedUsername || !password) {
      throw new Error('Username and password are required')
    }

    const client = trackSyncClient(new SyncServerClient(normalizedUrl))
    try {
      const updateWhileEnabled = async (action, value) => {
        assertSyncEnabled(rootState, client)
        await dispatch(action, value, { root: true })
        assertSyncEnabled(rootState, client)
      }

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
        const manifest = await client.getEncryptedSyncManifest()
        const firstCollection = manifest.collections[0]?.collection
        const remote = firstCollection
          ? await client.getEncryptedSyncCollection(firstCollection)
          : manifest.legacy_encrypted_data
            ? await client.getLegacyEncryptedSync()
            : null
        const privacy = await preparePrivacyKey(remote?.payload, privacyPassphrase)
        privacyKey = privacy.key
        privacySalt = privacy.salt
      }

      assertSyncEnabled(rootState, client)

      // Keep writes to the shared settings datastore ordered. In particular,
      // the URL must be committed before the token enables the initial sync.
      await updateWhileEnabled('updateSyncServerUrl', normalizedUrl)
      await updateWhileEnabled('updateSyncServerUsername', trimmedUsername)
      if (!resumesExpiredSession) {
        await updateWhileEnabled('updateSyncServerSnapshot', '{}')
        await updateWhileEnabled('updateSyncServerLastSyncAt', 0)
      }
      await updateWhileEnabled(
        'updateSyncServerPrivacyMode',
        privacySupported ? 'enhanced' : 'legacy'
      )
      await updateWhileEnabled('updateSyncServerPrivacyKey', privacyKey)
      await updateWhileEnabled('updateSyncServerPrivacySalt', privacySalt)
      await updateWhileEnabled('updateSyncServerToken', token)
      commit('setSyncServerSessionExpired', false)

      await dispatch('startSyncServerAutoSync')
      return dispatch('syncWithSyncServer')
    } catch (error) {
      if (error instanceof SyncServerCancelledError &&
          rootState.settings.syncServerToken !== previousToken) {
        await dispatch('updateSyncServerToken', previousToken, { root: true })
      }
      throw error
    } finally {
      releaseSyncClient(client)
    }
  },

  /**
   * Handle the server rejecting the stored token.
   *
   * Only the token is cleared. The server URL, username, snapshot and privacy
   * key are kept so that signing in again resumes where sync left off instead of
   * re-downloading everything.
   */
  async expireSyncServerSession({ commit, dispatch }) {
    await dispatch('stopSyncServerAutoSync')
    await dispatch('updateSyncServerToken', '', { root: true })
    commit('setSyncServerProgress', null)
    commit('setSyncServerError', SYNC_SERVER_SESSION_EXPIRED_MESSAGE)
    commit('setSyncServerSessionExpired', true)
    commit('setSyncServerStatus', 'error')
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
    commit('setSyncServerProgress', null)
    commit('setSyncServerStatus', 'idle')
    commit('setSyncServerSessionExpired', false)
  },

  async deleteSyncServerAccount({ commit, dispatch, rootState }, password) {
    if (!rootState.settings.syncServerToken) {
      throw new Error('Connect to a sync server first')
    }
    if (!password) {
      throw new Error('Password is required')
    }

    commit('setSyncServerStatus', 'syncing')
    commit('setSyncServerProgress', null)
    commit('setSyncServerError', '')
    await dispatch('stopSyncServerAutoSync')

    try {
      const client = trackSyncClient(new SyncServerClient(
        rootState.settings.syncServerUrl,
        rootState.settings.syncServerToken
      ))
      try {
        await client.deleteAccount(password)
        assertSyncEnabled(rootState, client)
        await dispatch('disconnectSyncServer')
      } finally {
        releaseSyncClient(client)
      }
    } catch (error) {
      if (error instanceof SyncServerCancelledError) {
        commit('setSyncServerError', '')
        commit('setSyncServerStatus', 'idle')
        return null
      }
      commit('setSyncServerError', error.message)
      commit('setSyncServerStatus', 'error')
      await dispatch('startSyncServerAutoSync')
      throw error
    }
  },

  syncWithSyncServer(context, options = {}) {
    if (!context.rootState.settings.syncServerEnabled) {
      return Promise.reject(new Error('Enable sync first'))
    }
    if (!context.rootState.settings.syncServerToken) {
      return Promise.reject(new Error('Connect to a sync server first'))
    }
    if (!activeSyncPromise) {
      let syncStarted = false
      clearTimeout(eventSyncTimer)
      eventSyncTimer = null
      activeSyncPromise = withSyncLock(() => {
        if (!context.rootState.settings.syncServerEnabled) return null
        if (options.skipIfRecent &&
            isRecentSync(context.rootState.settings.syncServerLastSyncAt)) {
          return null
        }
        syncStarted = true
        return runSync(context, options)
      }).finally(() => {
        activeSyncPromise = null
        context.dispatch(syncStarted
          ? 'restartSyncServerAutoSync'
          : 'startSyncServerAutoSync')
      })
    }
    return activeSyncPromise
  },

  async initializeSyncServer({ commit, dispatch, rootState }) {
    if (!rootState.settings.syncServerEnabled || !rootState.settings.syncServerToken) return

    try {
      const client = trackSyncClient(new SyncServerClient(
        rootState.settings.syncServerUrl,
        rootState.settings.syncServerToken
      ))
      let privacySupported
      try {
        privacySupported = await client.supportsEncryptedSync()
        assertSyncEnabled(rootState, client)
      } finally {
        releaseSyncClient(client)
      }
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
      if (error instanceof SyncServerCancelledError) return
      commit('setSyncServerError', error.message)
      return
    }

    await dispatch('startSyncServerAutoSync')
    if (!lifecycleSyncStarted && typeof window !== 'undefined') {
      lifecycleSyncStarted = true
      window.addEventListener('online', () => dispatch('scheduleSyncServer', 'automatic'))
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          dispatch('scheduleSyncServer', 'automatic')
        }
      })
    }
    if (rootState.settings.syncServerAutoSync) {
      await dispatch('syncWithSyncServer', { skipIfRecent: true })
    }
  },

  startSyncServerAutoSync({ dispatch, rootState }) {
    if (autoSyncTimer ||
        !rootState.settings.syncServerEnabled ||
        !rootState.settings.syncServerAutoSync ||
        !rootState.settings.syncServerToken ||
        !isSyncReasonEnabled(rootState.settings, 'automatic')) {
      return
    }

    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = null
      dispatch('syncWithSyncServer', { skipIfRecent: true }).catch(error => {
        console.error('Sync server automatic sync failed', error)
      })
    }, AUTO_SYNC_INTERVAL_MS)
  },

  restartSyncServerAutoSync({ dispatch }) {
    clearTimeout(autoSyncTimer)
    autoSyncTimer = null
    return dispatch('startSyncServerAutoSync')
  },

  stopSyncServerAutoSync() {
    clearTimeout(autoSyncTimer)
    clearTimeout(eventSyncTimer)
    autoSyncTimer = null
    eventSyncTimer = null
  },

  scheduleSyncServer({ dispatch, rootState }, reason = 'data') {
    if (!rootState.settings.syncServerEnabled ||
        !rootState.settings.syncServerAutoSync ||
        !rootState.settings.syncServerToken ||
        !isSyncReasonEnabled(rootState.settings, reason) ||
        rootState.syncServer.syncServerStatus === 'syncing') {
      return
    }
    clearTimeout(eventSyncTimer)
    eventSyncTimer = setTimeout(() => {
      eventSyncTimer = null
      dispatch('syncWithSyncServer', {
        skipIfRecent: reason === 'automatic',
      }).catch(error => {
        console.error('Sync server event sync failed', error)
      })
    }, EVENT_SYNC_DEBOUNCE_MS)
  },

  async setSyncServerAutoSync({ dispatch }, enabled) {
    await dispatch('updateSyncServerAutoSync', enabled, { root: true })
    await dispatch(enabled ? 'startSyncServerAutoSync' : 'stopSyncServerAutoSync')
  },

  async applySyncServerEnabled({ commit, dispatch, rootState }, enabled) {
    if (!enabled) {
      cancelActiveSyncClients()
      await dispatch('stopSyncServerAutoSync')
      commit('setSyncServerProgress', null)
      commit('setSyncServerError', '')
      commit('setSyncServerStatus', 'idle')
      return
    }
    if (rootState.settings.syncServerToken) {
      await dispatch('initializeSyncServer')
    }
  },

  async setSyncServerEnabled({ dispatch }, enabled) {
    await dispatch('updateSyncServerEnabled', enabled, { root: true })
    await dispatch('applySyncServerEnabled', enabled)
  },
}

const mutations = {
  setSyncServerStatus(state, status) {
    state.syncServerStatus = status
  },
  setSyncServerProgress(state, progress) {
    state.syncServerProgress = progress
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
  setSyncServerSessionExpired(state, expired) {
    state.syncServerSessionExpired = expired
  },
}

export default { state, getters, actions, mutations }
