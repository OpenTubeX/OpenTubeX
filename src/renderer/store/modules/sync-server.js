import { SyncLiveConnectionState, validateDeviceRequest, watchSyncChanges } from '../../helpers/sync-server-live'
import i18n from '../../i18n/index'
import { showToastOnAllTabs } from '../../helpers/utils'
import { isAppHidden } from '../../helpers/appVisibility.js'
import { connectionEvents, getConnectionState } from '../../helpers/networkRecovery.js'
import {
  SyncServerClient,
  SyncServerCancelledError,
  SyncServerUnsupportedError,
  SYNC_SERVER_UPDATE_REQUIRED_MESSAGE,
  getSavedOtherDeviceSessions,
  isSessionExpiredError,
} from '../../helpers/sync-server'
import { decryptSyncDocument } from '../../helpers/sync-server-privacy'
import { loadSyncServerDevices } from '../../helpers/sync-server-sessions'
import {
  AUTO_SYNC_INTERVAL_MS,
  isRecentSync,
  isSyncReasonEnabled,
} from '../../helpers/sync-server-scheduling'
import { DBSettingHandlers } from '../../../datastores/handlers/index'
import { liveReminder } from '../../helpers/liveReminders'
import {
  activityAccountKey,
  assertEncryptionSupported,
  assertSyncEnabled,
  cancelActiveSyncClients,
  clearSyncServerCapabilities,
  clearUnsupportedWatchStats,
  collectionCache,
  getSyncServerCapabilities,
  parseSnapshot,
  releaseSyncClient,
  requiresEncryptedSync,
  runSync,
  trackSyncClient,
  withSyncLock,
} from './sync-server-run'
import { accountActions } from './sync-server-account-actions'
import { deviceActions } from './sync-server-device-actions'

const EVENT_SYNC_DEBOUNCE_MS = 1500
const EVENT_SYNC_DELAYS = {
  sessions: { delay: 10000, maxWait: 30000 },
  history: { delay: 30000, maxWait: 60000 },
  watchStats: { delay: 30000, maxWait: 60000 },
}

const liveConnection = new SyncLiveConnectionState(typeof navigator !== 'undefined' ? navigator.locks : null)
let liveClient = null
let liveLockController = null
let liveGeneration = 0
let eventsSince = ''
let eventsRefresh = null
let activeSyncPromise = null
let activeSyncRemoteOnly = false
let autoSyncTimer = null
let autoSyncController = new AbortController()
const eventSyncTimers = new Map()
// Event syncs that came due while a mobile app was hidden; replayed on resume.
const hiddenEventSyncReasons = new Set()
let lifecycleSyncStarted = false
let reminderSyncListenerStarted = false
let deviceRefreshId = 0
let syncServerEnabledChange = Promise.resolve()

function isSyncServerOffline() {
  return getConnectionState() === 'offline' ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
}

function clearSyncServerDevices(commit) {
  deviceRefreshId++
  commit('setSyncServerDevices', {})
}

function unclearedActivity(entries, settings) {
  const cutoff = settings.syncServerActivityClearedThrough?.[activityAccountKey(settings)]
  return typeof cutoff === 'string'
    ? entries.filter(entry => entry.id.split(':')[0] > cutoff)
    : entries
}

async function tryLoadSyncServerDevices(client, privacyKey) {
  try {
    return await loadSyncServerDevices(client, privacyKey)
  } catch (error) {
    if (error instanceof SyncServerCancelledError || isSessionExpiredError(error)) throw error
    console.warn('Failed to load encrypted sync devices:', error)
    return null
  }
}

const state = {
  syncServerLiveSupported: false,
  syncServerActivity: [],
  syncServerStatus: 'idle',
  syncServerProgress: null,
  syncServerError: '',
  syncServerLastResult: null,
  syncServerHistorySupported: null,
  syncServerWatchStatsSupported: null,
  syncServerLiveRemindersSupported: null,
  syncServerLiveRemindersPending: false,
  syncServerSessionExpired: false,
  syncServerOtherDeviceSessions: [],
  syncServerDevices: {},
}

const getters = {
  getSyncServerLiveSupported: state => state.syncServerLiveSupported,
  getSyncServerActivity: (state, getters, rootState) => unclearedActivity(state.syncServerActivity, rootState.settings),
  getSyncServerDevices: (state, getters, rootState) => Object.entries(state.syncServerDevices)
    .filter(([id]) => id !== rootState.settings.syncServerDeviceId)
    .map(([id, device]) => ({ id, ...device })),
  getSyncServerStatus: state => state.syncServerStatus,
  getSyncServerProgress: state => state.syncServerProgress,
  getSyncServerError: state => state.syncServerError === SYNC_SERVER_UPDATE_REQUIRED_MESSAGE
    ? i18n.global.t('Settings.Sync Settings.Server Update Required')
    : state.syncServerError,
  getSyncServerLastResult: state => state.syncServerLastResult,
  getSyncServerHistorySupported: state => state.syncServerHistorySupported,
  getSyncServerWatchStatsSupported: state => state.syncServerWatchStatsSupported,
  getSyncServerLiveRemindersSupported: state => state.syncServerLiveRemindersSupported,
  getSyncServerOtherDeviceSessions: state => state.syncServerOtherDeviceSessions.map(session => ({
    ...session,
    syncDeviceName: state.syncServerDevices[session.syncDeviceId]?.name ?? '',
  })),
}

const actions = {
  ...accountActions,
  ...deviceActions,

  stopSyncServerLive() {
    clearSyncServerCapabilities()
    liveGeneration++
    liveConnection.setConnected(false)
    liveClient?.cancel()
    liveLockController?.abort()
    liveLockController = null
    liveClient = null
  },

  async startSyncServerLive({ commit, dispatch, rootState }) {
    const settings = rootState.settings
    if (liveClient || !settings.syncServerEnabled || !settings.syncServerAutoSync ||
        !settings.syncServerToken || !settings.syncServerPrivacyKey || isSyncServerOffline() ||
        (process.env.IS_CAPACITOR && isAppHidden())) return
    const generation = ++liveGeneration
    const client = new SyncServerClient(settings.syncServerUrl, settings.syncServerToken)
    liveClient = client
    const lockController = new AbortController()
    liveLockController = lockController
    const listen = async () => {
      if (generation !== liveGeneration) return
      await watchSyncChanges(client, async () => {
        if (generation !== liveGeneration) return
        await dispatch('syncWithSyncServer', { automatic: true, remoteOnly: true })
        if (generation !== liveGeneration) return
        // Device messages must succeed before advancing the live cursor. This
        // wait belongs to the listener, not the completed library sync. A fresh
        // request also covers messages newer than an already downloading response.
        await dispatch('refreshSyncServerEvents', { fresh: true })
      }, async error => {
        if (error instanceof SyncServerUnsupportedError) {
          commit('setSyncServerError', error.message)
          commit('setSyncServerLiveSupported', false)
          return false
        }
        if (isSessionExpiredError(error)) {
          await dispatch('expireSyncServerSession')
          return false
        }
        return true
      }, {
        waitForPendingSync: async () => {
          const pending = activeSyncPromise
          if (!pending) return false
          await pending.catch(() => {})
          return true
        },
        onConnectionChange: connected => {
          if (generation === liveGeneration) liveConnection.setConnected(connected)
        },
        prepare: async () => {
          const supported = (await getSyncServerCapabilities(client, { refresh: true })).live_sync === 1
          if (generation !== liveGeneration) return false
          commit('setSyncServerLiveSupported', supported)
          return supported
        },
      })
    }
    try {
      // Other renderer tabs wait without occupying HTTP connections. If the
      // owner closes, the browser hands the lock to the next waiting tab.
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request('opentubex-sync-server-live', { signal: lockController.signal }, listen)
      } else await listen()
    } catch (error) {
      if (isSessionExpiredError(error)) await dispatch('expireSyncServerSession')
    } finally {
      if (generation === liveGeneration) {
        liveClient = null
        liveLockController = null
      }
    }
  },

  async applySyncServerToken({ commit, dispatch, rootState }) {
    await dispatch('stopSyncServerAutoSync')
    cancelActiveSyncClients()
    collectionCache.use('')
    eventsSince = ''
    commit('setSyncServerActivity', [])
    commit('setSyncServerLiveSupported', false)
    commit('setSyncServerWatchStatsSupported', null)
    commit('setSyncServerLiveRemindersSupported', null)
    commit('setSyncServerLiveRemindersPending', false)
    commit('setSyncedWatchStats', [])
    clearSyncServerDevices(commit)
    if (rootState.settings.syncServerToken) await dispatch('initializeSyncServer')
  },

  async clearSyncServerActivity({ commit, dispatch, rootState, state }) {
    const settings = rootState.settings
    const accountKey = activityAccountKey(settings)
    const savedCutoff = settings.syncServerActivityClearedThrough?.[accountKey] ?? ''
    const cutoff = state.syncServerActivity.reduce((latest, entry) => {
      const eventId = entry.id.split(':')[0]
      return eventId > latest ? eventId : latest
    }, eventsSince > savedCutoff ? eventsSince : savedCutoff)
    if (!cutoff) return
    await dispatch('updateSyncServerActivityClearedThrough', {
      ...settings.syncServerActivityClearedThrough,
      [accountKey]: cutoff,
    })
    if (activityAccountKey(rootState.settings) === accountKey) {
      commit('setSyncServerActivity', unclearedActivity(state.syncServerActivity, rootState.settings))
    }
  },

  async refreshSyncServerEvents({ commit, dispatch, rootState, state }, { background = false, fresh = false } = {}) {
    const settings = { ...rootState.settings }
    if (!settings.syncServerEnabled || !settings.syncServerToken || !settings.syncServerPrivacyKey) return
    const identity = JSON.stringify([settings.syncServerUrl, settings.syncServerToken,
      settings.syncServerPrivacyKey, settings.syncServerDeviceId])
    if (eventsRefresh?.identity === identity) {
      const refreshed = await eventsRefresh.promise
      if (fresh || (!background && refreshed === false)) {
        return actions.refreshSyncServerEvents({ commit, dispatch, rootState, state })
      }
      return
    }
    const client = trackSyncClient(new SyncServerClient(settings.syncServerUrl, settings.syncServerToken))
    const stillCurrent = () => rootState.settings.syncServerEnabled &&
      rootState.settings.syncServerUrl === settings.syncServerUrl &&
      rootState.settings.syncServerUsername === settings.syncServerUsername &&
      rootState.settings.syncServerPrivacyKey === settings.syncServerPrivacyKey &&
      rootState.settings.syncServerDeviceId === settings.syncServerDeviceId &&
      rootState.settings.syncServerToken === settings.syncServerToken && !client.cancelled
    const refresh = async () => {
      const events = await client.getSyncEvents(eventsSince)
      if (!stillCurrent()) return
      if (!Array.isArray(events)) throw new Error('Invalid sync events')
      const activity = [...state.syncServerActivity]
      let nextEventsSince = eventsSince
      for (const event of events) {
        if (!stillCurrent()) return
        if (typeof event.id !== 'string') continue
        // Discarded broadcast entries need not be fetched again. Device requests
        // stay outside this cursor and remain pending until acknowledged.
        if (event.recipient === '' && event.id > nextEventsSince) nextEventsSince = event.id
        if (event.expires_at <= Date.now()) continue
        let value
        try {
          value = await decryptSyncDocument(event.payload, settings.syncServerPrivacyKey)
        } catch {
          // An unreadable event must not block all following device requests.
          continue
        }
        if (!stillCurrent()) return
        if (event.recipient === '') {
          if (value?.version === 1 && value.type === 'activity' && Array.isArray(value.changes) &&
              typeof value.deviceName === 'string') {
            for (const [index, change] of value.changes.slice(0, 500).entries()) {
              if (!change || (typeof change.key !== 'string' && typeof change.collection !== 'string')) continue
              const id = `${event.id}:${index}`
              if (!activity.some(entry => entry.id === id)) {
                activity.push({
                  ...change, id, deviceName: value.deviceName, createdAt: event.created_at,
                })
              }
            }
          }
        } else if (event.recipient === settings.syncServerDeviceId &&
            (process.env.IS_ELECTRON || process.env.IS_CAPACITOR) &&
            !(process.env.IS_CAPACITOR && (isAppHidden() || rootState.settings.enableMobileTabs === false))) {
          const receiptKey = `sync-received:${JSON.stringify([settings.syncServerUrl, settings.syncServerUsername, settings.syncServerDeviceId])}`
          let receipts = []
          try { receipts = JSON.parse(localStorage.getItem(receiptKey) ?? '[]') } catch {}
          if (!Array.isArray(receipts)) receipts = []
          if (!receipts.includes(event.id) && validateDeviceRequest(value, settings.syncServerDeviceId)) {
            const route = `/watch/${value.videoId}?timestamp=${Math.floor(value.position)}`
            let opened
            if (process.env.IS_CAPACITOR) {
              const { getCapacitorTabService } = await import('../../tabs/CapacitorTabService')
              opened = await getCapacitorTabService().createTab(route, value.title, false)
            } else {
              opened = await window.ftElectron.tabs.create({ route, title: value.title, makeActive: false })
            }
            if (!opened) throw new Error('Unable to open the received video')
            localStorage.setItem(receiptKey, JSON.stringify([...receipts, event.id].slice(-200)))
            showToastOnAllTabs(i18n.global.t('Settings.Sync Settings.Video Received', { title: value.title }), 6000, ['fas', 'devices'])
          }
          await client.acknowledgeDeviceRequest(event.id)
        }
      }
      if (stillCurrent()) {
        commit('setSyncServerActivity', unclearedActivity(activity, rootState.settings)
          .filter(entry => entry.createdAt > Date.now() - 30 * 24 * 60 * 60 * 1000)
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, 200))
        eventsSince = nextEventsSince
      }
    }
    const promise = (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.locks) {
          // Other renderer tabs skip background refreshes rather than queueing
          // another full activity download. Explicit UI refreshes still wait.
          return await navigator.locks.request('opentubex-sync-server-events', { ifAvailable: background }, async lock => {
            if (!lock) return false
            await refresh()
            return true
          })
        }
        await refresh()
        return true
      } catch (error) {
        if (stillCurrent() && isSessionExpiredError(error)) await dispatch('expireSyncServerSession')
        throw error
      } finally {
        releaseSyncClient(client)
      }
    })()
    eventsRefresh = { identity, promise }
    try {
      await promise
    } finally {
      if (eventsRefresh?.promise === promise) eventsRefresh = null
    }
  },

  syncWithSyncServer(context, options = {}) {
    const autoSyncSignal = autoSyncController.signal
    if (!context.rootState.settings.syncServerEnabled) {
      return Promise.reject(new Error('Enable sync first'))
    }
    if (!context.rootState.settings.syncServerToken) {
      return Promise.reject(new Error('Connect to a sync server first'))
    }
    if (isSyncServerOffline() || (options.automatic && autoSyncSignal.aborted)) return Promise.resolve(null)
    // A remote-only check may skip all merges, so it cannot consume local work.
    if (activeSyncPromise && activeSyncRemoteOnly && !options.remoteOnly) {
      return activeSyncPromise.catch(() => {}).then(() => {
        if (options.automatic && autoSyncSignal.aborted) return null
        return actions.syncWithSyncServer(context, options)
      })
    }
    if (!activeSyncPromise) {
      activeSyncRemoteOnly = options.remoteOnly === true
      let syncStarted = false
      activeSyncPromise = withSyncLock(() => {
        if (!context.rootState.settings.syncServerEnabled || isSyncServerOffline() ||
            (options.automatic && autoSyncSignal.aborted)) return null
        if (options.skipIfRecent &&
            isRecentSync(context.rootState.settings.syncServerLastSyncAt)) {
          return null
        }
        syncStarted = !options.remoteOnly
        if (syncStarted) {
          // A full sync includes every collection, consuming all pending edits.
          for (const pending of eventSyncTimers.values()) clearTimeout(pending.timer)
          eventSyncTimers.clear()
        }
        return runSync(context, options)
      }).finally(() => {
        activeSyncPromise = null
        activeSyncRemoteOnly = false
        if (!autoSyncSignal.aborted) {
          context.dispatch(syncStarted
            ? 'restartSyncServerAutoSync'
            : 'startSyncServerAutoSync')
        }
      })
    }
    return activeSyncPromise
  },

  async initializeSyncServer({ commit, dispatch, rootState }, { skipIfRecent = true } = {}) {
    if (!reminderSyncListenerStarted && (process.env.IS_ELECTRON || process.env.IS_CAPACITOR)) {
      reminderSyncListenerStarted = true
      liveReminder.onUpdated(() => dispatch('scheduleSyncServer', 'liveReminders'))
    }
    if (!lifecycleSyncStarted && typeof window !== 'undefined') {
      lifecycleSyncStarted = true
      connectionEvents.addEventListener('change', async ({ detail }) => {
        if (detail === 'offline') {
          cancelActiveSyncClients()
          dispatch('stopSyncServerLive')
        } else if (detail === 'restored') {
          try {
            // A reconnect must start a fresh sync after cancellation finishes.
            await activeSyncPromise?.catch(() => {})
            dispatch('startSyncServerLive')
            if (rootState.settings.syncServerAutoSync &&
                isSyncReasonEnabled(rootState.settings, 'automatic')) {
              await dispatch('initializeSyncServer', { skipIfRecent: false })
            }
          } catch (error) {
            console.error('Sync server reconnect sync failed', error)
          }
        }
      })
      document.addEventListener('visibilitychange', () => {
        if (process.env.IS_CAPACITOR && isAppHidden()) dispatch('stopSyncServerLive')
        if (!isAppHidden()) {
          dispatch('startSyncServerLive')
          dispatch('scheduleSyncServer', 'automatic')
          dispatch('resumeHiddenEventSyncs')
        }
      })
    }

    if (!rootState.settings.syncServerEnabled || !rootState.settings.syncServerToken) return

    const snapshot = parseSnapshot(rootState.settings.syncServerSnapshot)
    commit('setSyncedWatchStats', Array.isArray(snapshot.watchStats) ? snapshot.watchStats : [])
    commit(
      'setSyncServerOtherDeviceSessions',
      getSavedOtherDeviceSessions(
        snapshot,
        rootState.settings
      )
    )

    if (isSyncServerOffline()) return

    try {
      const client = trackSyncClient(new SyncServerClient(
        rootState.settings.syncServerUrl,
        rootState.settings.syncServerToken
      ))
      let privacySupported
      try {
        const capabilities = await client.getCapabilities()
        privacySupported = capabilities.encrypted_sync === 1
        const liveSupported = privacySupported && capabilities.live_sync === 1
        assertSyncEnabled(rootState, client)
        commit('setSyncServerLiveSupported', liveSupported)
        const watchStatsSupported = privacySupported && capabilities.watch_stats === 1
        commit('setSyncServerWatchStatsSupported', watchStatsSupported)
        commit('setSyncServerLiveRemindersSupported', privacySupported && capabilities.live_reminders === 1)
        if (!watchStatsSupported && rootState.settings.syncServerSyncWatchStats) {
          const accountKeys = ['syncServerUrl', 'syncServerToken', 'syncServerPrivacyMode', 'syncServerPrivacyKey', 'syncServerPrivacySalt']
          const account = accountKeys.map(key => rootState.settings[key])
          await withSyncLock(async () => {
            const sameAccount = () => accountKeys.every((key, index) => rootState.settings[key] === account[index])
            if (!sameAccount()) throw new SyncServerCancelledError()
            // A different window may have synced while this initializer waited.
            // Read the shared datastore after acquiring the sync lock, rather
            // than trusting a renderer snapshot whose IPC update is still queued.
            const saved = await DBSettingHandlers.find()
            if (!sameAccount()) throw new SyncServerCancelledError()
            const snapshot = saved.find(setting => setting._id === 'syncServerSnapshot')?.value ?? '{}'
            await clearUnsupportedWatchStats({ commit, dispatch, rootState }, snapshot)
          })
        }
        if (liveSupported) await dispatch('refreshSyncServerDevices')
      } finally {
        releaseSyncClient(client)
      }
      assertEncryptionSupported(privacySupported, requiresEncryptedSync(rootState.settings))
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
    if (rootState.settings.syncServerAutoSync) {
      await dispatch('syncWithSyncServer', { skipIfRecent, automatic: true })
    }
  },

  startSyncServerAutoSync({ dispatch, rootState }) {
    dispatch('startSyncServerLive')
    if (autoSyncTimer ||
        !rootState.settings.syncServerEnabled ||
        !rootState.settings.syncServerAutoSync ||
        !rootState.settings.syncServerToken) {
      return
    }

    if (autoSyncController.signal.aborted) autoSyncController = new AbortController()
    if (!isSyncReasonEnabled(rootState.settings, 'automatic')) return
    const { signal } = autoSyncController
    autoSyncTimer = setTimeout(async () => {
      autoSyncTimer = null
      try {
        const connected = await liveConnection.isConnected()
        if (signal.aborted || !rootState.settings.syncServerEnabled || !rootState.settings.syncServerAutoSync ||
            !rootState.settings.syncServerToken || isSyncServerOffline()) return
        // A hidden mobile app has stopped its live connection on purpose; the
        // visibility handler syncs once it is shown again instead of polling
        // in the background.
        if (process.env.IS_CAPACITOR && isAppHidden()) return
        // Live notifications replace periodic downloads, but failed uploads
        // and reminders awaiting permission still need a retry.
        const retryPending = rootState.syncServer.syncServerStatus === 'error' ||
          (rootState.syncServer.syncServerLiveRemindersPending &&
            isSyncReasonEnabled(rootState.settings, 'liveReminders'))
        if (!connected || retryPending) {
          await dispatch('syncWithSyncServer', { skipIfRecent: !retryPending, automatic: true })
        }
      } catch (error) {
        console.error('Sync server automatic sync failed', error)
      } finally {
        if (!signal.aborted) dispatch('startSyncServerAutoSync')
      }
    }, AUTO_SYNC_INTERVAL_MS)
  },

  async refreshSyncServerDevices({ commit, dispatch, rootState }) {
    if (isSyncServerOffline()) return
    const settings = rootState.settings
    if (!settings.syncServerToken || !settings.syncServerPrivacyKey) {
      clearSyncServerDevices(commit)
      return
    }
    const refreshId = ++deviceRefreshId

    const client = trackSyncClient(new SyncServerClient(
      settings.syncServerUrl,
      settings.syncServerToken
    ))
    try {
      const devices = await tryLoadSyncServerDevices(
        client,
        settings.syncServerPrivacyKey
      )
      assertSyncEnabled(rootState, client)
      if (refreshId === deviceRefreshId && devices !== null) {
        commit('setSyncServerDevices', devices)
      }
    } catch (error) {
      if (refreshId !== deviceRefreshId) return
      if (error instanceof SyncServerCancelledError) return
      if (isSessionExpiredError(error)) {
        await dispatch('expireSyncServerSession')
        return
      }
      throw error
    } finally {
      releaseSyncClient(client)
    }
  },

  async replaceSyncServerToken({ commit, dispatch }, token) {
    await dispatch('stopSyncServerLive')
    collectionCache.use('')
    eventsSince = ''
    commit('setSyncServerActivity', [])
    commit('setSyncServerLiveSupported', false)
    commit('setSyncServerWatchStatsSupported', null)
    commit('setSyncServerLiveRemindersSupported', null)
    commit('setSyncServerLiveRemindersPending', false)
    commit('setSyncedWatchStats', [])
    clearSyncServerDevices(commit)
    await dispatch('updateSyncServerToken', token, { root: true })
  },

  restartSyncServerAutoSync({ dispatch }) {
    clearTimeout(autoSyncTimer)
    autoSyncTimer = null
    return dispatch('startSyncServerAutoSync')
  },

  stopSyncServerAutoSync({ dispatch }) {
    autoSyncController.abort()
    dispatch('stopSyncServerLive')
    clearTimeout(autoSyncTimer)
    for (const pending of eventSyncTimers.values()) clearTimeout(pending.timer)
    eventSyncTimers.clear()
    hiddenEventSyncReasons.clear()
    autoSyncTimer = null
  },

  scheduleSyncServer({ dispatch, rootState }, reason = 'data') {
    if (autoSyncController.signal.aborted || isSyncServerOffline() ||
        !rootState.settings.syncServerEnabled ||
        !rootState.settings.syncServerAutoSync ||
        !rootState.settings.syncServerToken ||
        !isSyncReasonEnabled(rootState.settings, reason)) {
      return
    }
    const previous = eventSyncTimers.get(reason)
    const firstChangeAt = previous?.firstChangeAt ?? Date.now()
    const { delay, maxWait } = EVENT_SYNC_DELAYS[reason] ?? { delay: EVENT_SYNC_DEBOUNCE_MS, maxWait: Infinity }
    clearTimeout(previous?.timer)
    const pending = { firstChangeAt, timer: null }
    eventSyncTimers.set(reason, pending)
    pending.timer = setTimeout(async () => {
      // Edits made during a sync retain their own deadline. Once due, wait for
      // that sync to finish rather than starting a second debounce period.
      for (let syncing = activeSyncPromise; syncing; syncing = activeSyncPromise) {
        await syncing.catch(() => {})
      }
      if (eventSyncTimers.get(reason) !== pending) return
      eventSyncTimers.delete(reason)
      if (isSyncServerOffline() ||
          !rootState.settings.syncServerEnabled ||
          !rootState.settings.syncServerAutoSync ||
          !rootState.settings.syncServerToken ||
          !isSyncReasonEnabled(rootState.settings, reason)) return
      if (process.env.IS_CAPACITOR && isAppHidden()) {
        hiddenEventSyncReasons.add(reason)
        return
      }
      dispatch('syncWithSyncServer', {
        skipIfRecent: reason === 'automatic',
        automatic: true,
      }).catch(error => {
        console.error('Sync server event sync failed', error)
      })
    }, Math.max(0, Math.min(delay, firstChangeAt + maxWait - Date.now())))
  },

  resumeHiddenEventSyncs({ dispatch }) {
    const reasons = [...hiddenEventSyncReasons]
    hiddenEventSyncReasons.clear()
    for (const reason of reasons) dispatch('scheduleSyncServer', reason)
  },

  async setSyncServerAutoSync({ dispatch }, enabled) {
    await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
    await dispatch('updateSyncServerAutoSync', enabled, { root: true })
    await dispatch(enabled ? 'startSyncServerAutoSync' : 'stopSyncServerAutoSync')
  },

  async applySyncServerEnabled({ commit, dispatch, rootState }, enabled) {
    if (!enabled) {
      cancelActiveSyncClients()
      await dispatch('stopSyncServerAutoSync')
      await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
      commit('setSyncServerProgress', null)
      commit('setSyncServerError', '')
      commit('setSyncServerStatus', 'idle')
      commit('setSyncServerOtherDeviceSessions', [])
      commit('setSyncedWatchStats', [])
      commit('setSyncServerWatchStatsSupported', null)
      commit('setSyncServerLiveRemindersSupported', null)
      clearSyncServerDevices(commit)
      return
    }
    if (rootState.settings.syncServerToken) {
      await dispatch('initializeSyncServer')
    }
  },

  async setSyncServerEnabled({ commit, dispatch }, enabled) {
    // Turning sync off and on quickly must save the last choice. The disable
    // cleanup saves its value later than a following enable would.
    const change = syncServerEnabledChange.then(async () => {
      if (!enabled) {
        commit('setSyncServerEnabled', false, { root: true })
        await dispatch('applySyncServerEnabled', false)
      }
      await dispatch('updateSyncServerEnabled', enabled, { root: true })
    })
    syncServerEnabledChange = change.catch(() => {})
    await change
    if (enabled) {
      await dispatch('applySyncServerEnabled', true)
    }
  },
}

const mutations = {
  setSyncServerLiveSupported(state, supported) {
    state.syncServerLiveSupported = supported
  },
  setSyncServerActivity(state, entries) {
    state.syncServerActivity = entries
  },
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
  setSyncServerWatchStatsSupported(state, supported) {
    state.syncServerWatchStatsSupported = supported
  },
  setSyncServerLiveRemindersSupported(state, supported) {
    state.syncServerLiveRemindersSupported = supported
  },
  setSyncServerLiveRemindersPending(state, pending) {
    state.syncServerLiveRemindersPending = pending
  },
  setSyncServerSessionExpired(state, expired) {
    state.syncServerSessionExpired = expired
  },
  setSyncServerOtherDeviceSessions(state, sessions) {
    state.syncServerOtherDeviceSessions = sessions
  },
  setSyncServerDevices(state, devices) {
    state.syncServerDevices = devices
  },
}

export default { state, getters, actions, mutations }
