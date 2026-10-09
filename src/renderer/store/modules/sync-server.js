import { runBackgroundJob } from '../../helpers/background-jobs.js'
import { SyncLiveConnectionState, SyncCollectionCache, createSyncActivity, validateDeviceRequest, watchSyncChanges } from '../../helpers/sync-server-live'
import i18n from '../../i18n/index'
import { showToastOnAllTabs } from '../../helpers/utils'
import { isAppHidden } from '../../helpers/appVisibility.js'
import { connectionEvents, getConnectionState } from '../../helpers/networkRecovery.js'
import {
  SyncServerClient,
  SyncServerCancelledError,
  SyncServerTabRevocationPendingError,
  SyncServerUnsupportedError,
  SYNC_SERVER_UPDATE_REQUIRED_MESSAGE,
  SyncServerDataLossError,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  getSavedOtherDeviceSessions,
  isExpiredSessionReauthentication,
  isSessionExpiredError,
  normalizeSyncServerUrl,
  syncHistory,
  syncPlaylistBookmarks,
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
  migrateLegacyPlaybackSpeedsToSettings,
  preparePrivacyKey,
} from '../../helpers/sync-server-privacy'
import {
  encryptSyncServerDeviceInfo,
  loadSyncServerDevices,
} from '../../helpers/sync-server-sessions'
import { mergePlaylistBookmarkConflict } from '../../helpers/playlist-bookmarks'
import { getPreviousSyncSessions, getSyncTabRoute, removeSyncDeviceSessions, removeSyncSession } from '../../helpers/sync-sessions'
import {
  AUTO_SYNC_INTERVAL_MS,
  dispatchRemoteSyncAction,
  isRecentSync,
  isSyncReasonEnabled,
} from '../../helpers/sync-server-scheduling'
import { isSettingSyncEnabled } from './settings'
import { syncSubscriptionSeenVideos, syncSubscriptionSeenPosts } from '../../helpers/subscription-seen-videos'
import { containsWatchStatsDevice, mergeWatchStats, replaceWatchStatsDevice, persistUploadedWatchStatsReset, syncWatchStats, watchStatsDeviceDays } from '../../helpers/sync-watch-stats'
import { areJsonValuesEqual } from '../../helpers/jsonValues'
import { DBWatchStatsHandlers } from '../../../datastores/handlers/index'
import { syncLiveReminders } from '../../helpers/sync-live-reminders'
import { liveReminder } from '../../helpers/liveReminders'
import { MAIN_PROFILE_ID } from '../../../constants'

const EVENT_SYNC_DEBOUNCE_MS = 1500
const EVENT_SYNC_DELAYS = {
  sessions: { delay: 10000, maxWait: 30000 },
  history: { delay: 30000, maxWait: 60000 },
  watchStats: { delay: 30000, maxWait: 60000 },
}
const ENCRYPTED_SYNC_RETRIES = 3
const LEGACY_ENCRYPTED_COLLECTIONS = [
  'subscriptions',
  'playlists',
  'history',
  'profiles',
  'playlistBookmarks',
]

const collectionCache = new SyncCollectionCache(value => runBackgroundJob('clone', { value }))
const liveConnection = new SyncLiveConnectionState(typeof navigator !== 'undefined' ? navigator.locks : null)
let liveClient = null
let syncCapabilities = null
let liveLockController = null
let liveGeneration = 0
let eventsSince = ''
let eventsRefresh = null
let activeSyncPromise = null
let activeSyncRemoteOnly = false
const activeSyncClients = new Set()
let autoSyncTimer = null
let autoSyncController = new AbortController()
const eventSyncTimers = new Map()
let lifecycleSyncStarted = false
let reminderSyncListenerStarted = false
let deviceRefreshId = 0

function isSyncServerOffline() {
  return getConnectionState() === 'offline' ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
}

function clearSyncServerDevices(commit) {
  deviceRefreshId++
  commit('setSyncServerDevices', {})
}

function activityAccountKey(settings) {
  // NeDB rejects dots in field names. A JSON escape preserves the account identity.
  return JSON.stringify([settings.syncServerUrl,
    settings.syncServerUsername, settings.syncServerDeviceId]).replaceAll('.', '\\u002e')
}

function unclearedActivity(entries, settings) {
  const cutoff = settings.syncServerActivityClearedThrough?.[activityAccountKey(settings)]
  return typeof cutoff === 'string'
    ? entries.filter(entry => entry.id.split(':')[0] > cutoff)
    : entries
}

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

function refreshSyncServerAccount({ dispatch }) {
  // Account activity and device metadata do not determine whether library data
  // was saved. Keep them fresh without holding the sync lock or progress open.
  for (const action of ['refreshSyncServerEvents', 'refreshSyncServerDevices']) {
    dispatch(action, action === 'refreshSyncServerEvents' ? { background: true } : undefined).catch(error => {
      if (!(error instanceof SyncServerCancelledError)) {
        console.warn('Failed to refresh sync account information:', error)
      }
    })
  }
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

function parseSnapshot(value) {
  try {
    const snapshot = JSON.parse(value)
    return snapshot && typeof snapshot === 'object' ? snapshot : {}
  } catch {
    return {}
  }
}

async function clearUnsupportedWatchStats({ commit, dispatch, rootState }) {
  commit('setSyncedWatchStats', [])
  const snapshot = parseSnapshot(rootState.settings.syncServerSnapshot)
  if (!('watchStats' in snapshot)) return
  delete snapshot.watchStats
  await dispatch('updateSyncServerSnapshot', JSON.stringify(snapshot), { root: true })
}

function withSyncLock(callback) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('opentubex-sync-server', callback)
  }
  return callback()
}

function requiresEncryptedSync(settings) {
  // A key may survive a privacy-mode downgrade made by an older app version.
  return settings.syncServerPrivacyMode === 'enhanced' || Boolean(settings.syncServerPrivacyKey)
}

async function getSyncServerCapabilities(client, { refresh = false, requiredCapabilities = [] } = {}) {
  const identity = JSON.stringify([client.serverUrl, client.token])
  const age = syncCapabilities ? Date.now() - syncCapabilities.checkedAt : Infinity
  if (!refresh && syncCapabilities?.identity === identity && syncCapabilities.value &&
      age >= 0 && age < AUTO_SYNC_INTERVAL_MS &&
      requiredCapabilities.every(capability => syncCapabilities.value[capability] === 1)) {
    return syncCapabilities.value
  }
  // Failed discovery must not leave previously advertised support reusable.
  const discovery = { identity, value: null, checkedAt: 0 }
  syncCapabilities = discovery
  const value = await client.getCapabilities()
  // An older in-flight discovery must not replace a newer result or revive a
  // cache cleared when the live connection was stopped.
  if (syncCapabilities === discovery) {
    discovery.value = value
    discovery.checkedAt = Date.now()
  }
  return syncCapabilities?.identity === identity && syncCapabilities.value
    ? syncCapabilities.value
    : value
}

function assertEncryptionSupported(supported, required) {
  if (required && !supported) {
    throw new Error('This account requires encrypted sync, but the server no longer supports it')
  }
}

async function runSync(context, { allowDataLoss = false, notifyDataLoss = true, automatic = false, remoteOnly = false } = {}) {
  const { commit, dispatch, rootGetters, rootState } = context
  const settings = rootState.settings
  const encrypted = requiresEncryptedSync(settings)
  const networkClient = trackSyncClient(
    new SyncServerClient(settings.syncServerUrl, settings.syncServerToken)
  )
  let client = networkClient
  let encryptedCollections = null
  collectionCache.use(JSON.stringify([settings.syncServerUrl, settings.syncServerToken, settings.syncServerPrivacyKey]))
  const previous = parseSnapshot(settings.syncServerSnapshot)
  const next = { ...previous }
  const historyAccount = [settings.syncServerUrl, settings.syncServerToken,
    settings.syncServerPrivacyMode, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt]
  const result = {}
  const skippedCollections = new Set()
  let tabRevocationError = null
  const store = {
    state: rootState,
    getters: rootGetters,
    commit,
    dispatch: (...args) => dispatchRemoteSyncAction(dispatch, ...args),
    assertActive: assertSyncStillActive,
    async persistHistorySyncBaseline(changes) {
      const sameAccount = () => {
        const current = rootState.settings
        return [current.syncServerUrl, current.syncServerToken, current.syncServerPrivacyMode,
          current.syncServerPrivacyKey, current.syncServerPrivacySalt].every((value, index) => value === historyAccount[index])
      }
      // A disable can cancel requests after they succeeded. Record those
      // effects, but never carry them into a different account/privacy context.
      while (sameAccount()) {
        const snapshot = rootState.settings.syncServerSnapshot
        const updated = await runBackgroundJob('updateHistorySnapshot', { snapshot, ...changes })
        if (!sameAccount()) return
        if (snapshot !== rootState.settings.syncServerSnapshot) continue
        await dispatch('updateSyncServerSnapshot', updated, { root: true })
        return
      }
    },
  }
  const stages = [
    ...(encrypted ? ['download'] : []),
    ...(settings.syncServerSyncSubscriptions ? ['subscriptions'] : []),
    ...(settings.syncServerSyncPlaylists ? ['playlists'] : []),
    ...(settings.syncServerSyncPlaylists ? ['playlistBookmarks'] : []),
    ...(settings.syncServerSyncHistory ? ['history'] : []),
    ...(encrypted && settings.syncServerSyncWatchStats ? ['watchStats'] : []),
    ...((process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && encrypted &&
      settings.syncServerSyncLiveReminders
      ? ['liveReminders']
      : []),
    ...(settings.syncServerSyncProfiles ? ['profiles'] : []),
    ...((process.env.IS_ELECTRON || process.env.IS_CAPACITOR) &&
      encrypted &&
      settings.syncServerSyncSessions
      ? ['sessionsV2']
      : []),
    ...(encrypted && settings.syncServerSyncSettings
      ? ['settings']
      : []),
    ...(encrypted ? ['upload'] : []),
    'finishing',
  ]
  let completedStages = 0
  let progressStarted = false

  function startProgress(stage) {
    if (progressStarted) return
    progressStarted = true
    commit('setSyncServerStatus', 'syncing')
    commit('setSyncServerProgress', { stage, percentage: Math.round((completedStages / stages.length) * 100) })
    commit('setSyncServerError', '')
  }

  function finishProgress() {
    if (!progressStarted && context.state.syncServerStatus !== 'error') return
    commit('setSyncServerError', '')
    commit('setSyncServerProgress', null)
    commit('setSyncServerStatus', 'success')
  }

  function assertSyncStillActive() {
    assertSyncEnabled(rootState, networkClient)
  }

  async function runStage(stage, callback) {
    assertSyncStillActive()
    const progressStage = ['seenVideos', 'seenPosts'].includes(stage) ? 'history' : stage
    if (progressStarted) {
      commit('setSyncServerProgress', {
        stage: progressStage,
        percentage: Math.round((completedStages / stages.length) * 100),
      })
    }
    const value = await callback()
    assertSyncStillActive()
    completedStages++
    if (progressStarted) {
      commit('setSyncServerProgress', {
        stage: progressStage,
        percentage: Math.round((completedStages / stages.length) * 100),
      })
    }
    return value
  }

  if (!automatic || !encrypted) startProgress(stages[0])

  async function applyCollection(collection, targetClient) {
    switch (collection) {
      case 'seenVideos':
        result.seenVideos = await syncSubscriptionSeenVideos(targetClient, store)
        break
      case 'seenPosts':
        result.seenPosts = await syncSubscriptionSeenPosts(targetClient, store)
        break
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
      case 'playlistBookmarks':
        next.playlistBookmarks = await syncPlaylistBookmarks(
          targetClient,
          store,
          previous.playlistBookmarks,
          { allowDataLoss }
        )
        result.playlistBookmarks = next.playlistBookmarks.length
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
          result.history = Object.keys(history).length
        } else {
          commit('setSyncServerHistorySupported', false)
        }
        break
      }
      case 'watchStats':
        next.watchStats = await syncWatchStats(targetClient, store)
        result.watchStats = next.watchStats.length
        break
      case 'liveReminders':
        {
          const reminders = await syncLiveReminders(targetClient, previous.liveReminders)
          if (reminders === null) {
            skippedCollections.add('liveReminders')
            if ('liveReminders' in previous) next.liveReminders = previous.liveReminders
            else delete next.liveReminders
            delete result.liveReminders
            commit('setSyncServerLiveRemindersPending', true)
          } else {
            next.liveReminders = reminders
            result.liveReminders = reminders.length
            commit('setSyncServerLiveRemindersPending', false)
          }
        }
        break
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
      case 'sessionsV2': {
        let sessions
        try {
          sessions = await syncSessions(
            targetClient,
            store,
            getPreviousSyncSessions(previous),
            { accountClient: networkClient }
          )
        } catch (error) {
          if (!(error instanceof SyncServerTabRevocationPendingError)) throw error
          // Finish the other collections before reporting paused tab sync.
          skippedCollections.add(collection)
          tabRevocationError = error
          if ('sessionsV2' in previous) next.sessionsV2 = previous.sessionsV2
          else delete next.sessionsV2
          delete result.sessions
          break
        }
        if (sessions !== null) {
          next.sessionsV2 = sessions.document
          result.sessions = sessions.sessionsToApply.reduce(
            (count, session) => count + session.tabs.length,
            0
          )
          commit('setSyncServerOtherDeviceSessions', sessions.otherDeviceSessions)
        }
        break
      }
    }
  }

  try {
    // Remote checks share recent discovery. Full syncs refresh it for subsequent
    // live checks too, so new support cannot be reverted by an old live client.
    // Recheck missing support before consuming a live notification, otherwise an
    // enabled collection added by a server upgrade could miss its only event.
    const capabilities = await getSyncServerCapabilities(networkClient, {
      refresh: !remoteOnly,
      requiredCapabilities: [
        ...(stages.includes('watchStats') ? ['watch_stats'] : []),
        ...(stages.includes('liveReminders') ? ['live_reminders'] : []),
        ...(encrypted && settings.syncServerSyncHistory ? ['seen_videos', 'seen_posts'] : []),
      ],
    })
    const watchStatsSupported = encrypted && capabilities.watch_stats === 1
    commit('setSyncServerWatchStatsSupported', watchStatsSupported)
    if (!watchStatsSupported) {
      const index = stages.indexOf('watchStats')
      if (index !== -1) stages.splice(index, 1)
      if (settings.syncServerSyncWatchStats) {
        delete next.watchStats
        await clearUnsupportedWatchStats(context)
      }
    }
    const liveRemindersSupported = encrypted && capabilities.live_reminders === 1
    commit('setSyncServerLiveRemindersSupported', liveRemindersSupported)
    if (!liveRemindersSupported) {
      commit('setSyncServerLiveRemindersPending', false)
      const index = stages.indexOf('liveReminders')
      if (index !== -1) stages.splice(index, 1)
    }
    assertEncryptionSupported(capabilities.encrypted_sync === 1, encrypted)
    const liveSupported = encrypted && capabilities.live_sync === 1
    commit('setSyncServerLiveSupported', liveSupported)
    if (encrypted) {
      if (settings.syncServerSyncHistory && capabilities.seen_videos === 1) {
        stages.splice(stages.indexOf('history') + 1, 0, 'seenVideos')
      }
      if (settings.syncServerSyncHistory && capabilities.seen_posts === 1) {
        stages.splice(stages.indexOf('history') + 1, 0, 'seenPosts')
      }
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
        unchanged,
      } = await runStage('download', async () => {
        // The snapshot is saved only after successful collection uploads.
        // Never infer completed migration from unrelated encrypted settings.
        const playbackSpeedsInSettings = settings.syncServerSyncSettings &&
          isSettingSyncEnabled(settings, 'channelPlaybackSpeeds') &&
          Boolean(previous.settings?.channelPlaybackSpeeds)
        const manifest = await networkClient.getEncryptedSyncManifest({ playbackSpeedsInSettings })
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
        const hasLegacyPlaybackSpeeds = manifest.collections.some(
          entry => entry.collection === 'playbackSpeeds'
        )
        const compatibilityCollections = [
          ...(hasLegacyPlaybackSpeeds ? ['playbackSpeeds'] : []),
          ...(enabledCollections.includes('sessionsV2') ? ['sessions'] : []),
        ]
        const downloadCollections = Array.from(new Set([
          ...uploadCollections,
          ...compatibilityCollections,
        ]))
        // A cursor also changes for our own uploads and device messages. Avoid
        // merging every collection again when its revision is already cached.
        if (remoteOnly && context.state.syncServerStatus !== 'error' && !manifest.legacy_data && !legacyEncrypted?.payload &&
            downloadCollections.every(collection => collectionCache.isSynced(
              collection, manifest.collections.find(entry => entry.collection === collection)?.revision ?? 0
            ))) return { unchanged: true }
        const document = createEmptySyncDocument()
        // Legacy speeds are read for migration into settings, never uploaded.
        document.playbackSpeeds = legacy.playbackSpeeds ?? []
        const original = {}
        const entries = await Promise.all(downloadCollections.map(async collection => {
          const manifestRevision = manifest.collections.find(entry => entry.collection === collection)?.revision ?? 0
          const cached = !manifest.legacy_data && !legacyEncrypted?.payload
            ? await collectionCache.get(collection, manifestRevision)
            : null
          if (!cached) startProgress('download')
          const response = cached ?? await networkClient.getEncryptedSyncCollection(collection)
          const data = cached
            ? cached.data
            : response.payload
              ? await decryptSyncDocument(response.payload, settings.syncServerPrivacyKey)
              : legacy[collection]
          document[collection] = data ?? document[collection]
          await collectionCache.put(collection, response.revision, document[collection])
          original[collection] = await runBackgroundJob('clone', { value: document[collection] })
          return [collection, response]
        }))
        if (settings.syncServerSyncSettings &&
            isSettingSyncEnabled(settings, 'channelPlaybackSpeeds')) {
          migrateLegacyPlaybackSpeedsToSettings(
            document,
            settings.channelPlaybackSpeeds
          )
        }
        return { document, original, remote: Object.fromEntries(entries), uploadCollections }
      })
      if (unchanged) {
        finishProgress()
        refreshSyncServerAccount(context)
        return null
      }
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
          if (skippedCollections.has(collection)) continue
          assertSyncStillActive()
          let revision = encryptedCollections.remote[collection].revision
          let data = client.document[collection]
          if (revision > 0 &&
              await runBackgroundJob('equal', { first: data, second: encryptedCollections.original[collection] })) {
            if (collection === 'watchStats') await persistUploadedWatchStatsReset(data, store)
            continue
          }
          startProgress('upload')
          let activityBefore = encryptedCollections.original[collection]
          for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
            const activity = createSyncActivity(
              collection, activityBefore, data, settings.syncServerDeviceId, settings.syncServerDeviceName,
              [...(encryptedCollections.original.subscriptions ?? []), ...(client.document.subscriptions ?? []),
                ...(rootState.profiles.profileList.find(profile => profile._id === MAIN_PROFILE_ID)?.subscriptions ?? [])]
            )
            const activityPayload = activity
              ? await encryptSyncDocument(
                  activity, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt
                )
              : undefined
            const payload = await encryptSyncDocument(
              data,
              settings.syncServerPrivacyKey,
              settings.syncServerPrivacySalt
            )
            try {
              assertSyncStillActive()
              const saved = await networkClient.putEncryptedSyncCollection(collection, revision, payload, activityPayload)
              await collectionCache.put(collection, saved.revision, data)
              assertSyncStillActive()
              if (collection === 'watchStats') await persistUploadedWatchStatsReset(data, store)
              break
            } catch (error) {
              if (error.status !== 409 || attempt === ENCRYPTED_SYNC_RETRIES - 1) throw error
              const remote = await networkClient.getEncryptedSyncCollection(collection)
              const retryDocument = createEmptySyncDocument()
              const remoteData = await decryptSyncDocument(
                remote.payload,
                settings.syncServerPrivacyKey
              )
              activityBefore = remoteData
              if (collection === 'playlistBookmarks') {
                revision = remote.revision
                data = mergePlaylistBookmarkConflict({
                  original: encryptedCollections.original.playlistBookmarks,
                  local: data,
                  remote: remoteData,
                })
                retryDocument.playlistBookmarks = data
                const retryClient = new EncryptedSyncAdapter(retryDocument)
                next.playlistBookmarks = await syncPlaylistBookmarks(
                  retryClient, store, next.playlistBookmarks, { allowDataLoss }
                )
                result.playlistBookmarks = next.playlistBookmarks.length
                data = retryClient.document.playlistBookmarks
                continue
              }
              retryDocument[collection] = remoteData
              if (collection !== 'subscriptions') {
                retryDocument.subscriptions = client.document.subscriptions
              }
              const retryClient = new EncryptedSyncAdapter(retryDocument)
              if (collection === 'settings') {
                next.settings = await syncSettings(retryClient, store, next.settings)
                result.settings = Object.keys(next.settings).length
              } else {
                await applyCollection(collection, retryClient)
              }
              if (skippedCollections.has(collection)) break
              revision = remote.revision
              data = retryClient.document[collection]
            }
          }
        }
      })
    }

    await runStage('finishing', async () => {
      const lastSyncAt = Date.now()
      const snapshot = await runBackgroundJob('stringify', { value: next })
      assertSyncStillActive()
      await Promise.all([
        dispatch('updateSyncServerSnapshot', snapshot, { root: true }),
        dispatch('updateSyncServerLastSyncAt', lastSyncAt, { root: true }),
      ])
    })
    if (encryptedCollections) {
      collectionCache.markSynced(Object.keys(encryptedCollections.remote)
        .filter(collection => !skippedCollections.has(collection)))
    }
    if (settings.syncServerResumeAutoSync) {
      await dispatch('setSyncServerAutoSync', true)
    }
    if (progressStarted) commit('setSyncServerLastResult', result)
    if (tabRevocationError) throw tabRevocationError
    finishProgress()
    if (liveSupported) refreshSyncServerAccount(context)
    return result
  } catch (error) {
    if (error instanceof SyncServerCancelledError) {
      commit('setSyncServerProgress', null)
      commit('setSyncServerError', '')
      commit('setSyncServerStatus', 'idle')
      return null
    }
    if (error instanceof SyncServerDataLossError) {
      if (settings.syncServerAutoSync) {
        await dispatch('updateSyncServerResumeAutoSync', true, { root: true })
      }
      // Pause without treating it as the user's choice to disable automatic sync.
      await dispatch('updateSyncServerAutoSync', false, { root: true })
      await dispatch('stopSyncServerAutoSync')
      if (notifyDataLoss) {
        showToastOnAllTabs(
          i18n.global.t('Settings.Sync Settings.Destructive Sync Blocked'),
          15000,
          ['fas', 'triangle-exclamation'],
          'open-sync-settings'
        )
      }
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
  stopSyncServerLive() {
    syncCapabilities = null
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
            const route = `/watch/${value.videoId}?t=${Math.floor(value.position)}`
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

  async sendSyncServerVideo({ rootState }, { recipient, videoId, title = '', position = 0 }) {
    const settings = { ...rootState.settings }
    const request = {
      version: 1,
      type: 'openVideo',
      recipient,
      videoId,
      title: title.slice(0, 500),
      position,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    }
    if (!settings.syncServerEnabled || !settings.syncServerToken || !settings.syncServerPrivacyKey ||
        !validateDeviceRequest(request, recipient)) throw new Error('Invalid device request')
    const client = trackSyncClient(new SyncServerClient(settings.syncServerUrl, settings.syncServerToken))
    try {
      const payload = await encryptSyncDocument(request, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt)
      assertSyncEnabled(rootState, client)
      await client.sendDeviceRequest(recipient, payload)
    } finally {
      releaseSyncClient(client)
    }
  },

  async openSyncServerSession(_context, session) {
    if (!Array.isArray(session?.tabs) || session.tabs.length === 0) return false

    if (process.env.IS_CAPACITOR) {
      const { getCapacitorTabService } = await import('../../tabs/CapacitorTabService')
      return getCapacitorTabService().openSyncedSession(session)
    }
    if (!process.env.IS_ELECTRON) return false

    for (const [index, tab] of session.tabs.entries()) {
      await window.ftElectron.tabs.create({
        route: getSyncTabRoute(tab.url),
        title: tab.title ?? '',
        makeActive: index === session.tabs.length - 1,
      })
    }
    return true
  },

  deleteSyncServerSession({ dispatch }, session) {
    if (typeof session?.sessionId !== 'string') throw new Error('Invalid synced tab set')
    return dispatch('deleteSyncServerSessions', session)
  },

  deleteSyncServerDeviceSessions({ dispatch }, { syncDeviceId, accountSessionId }) {
    return dispatch('deleteSyncServerSessions', { syncDeviceId, accountSessionId })
  },

  async deleteSyncServerSessions({ commit, dispatch, rootState }, { syncDeviceId, sessionId, accountSessionId } = {}) {
    const settings = rootState.settings
    if (typeof syncDeviceId !== 'string' || (sessionId !== undefined && typeof sessionId !== 'string') ||
        (sessionId === undefined && typeof accountSessionId !== 'string')) {
      throw new Error('Invalid synced tab set')
    }
    if (!settings.syncServerToken || !settings.syncServerPrivacyKey) {
      throw new Error('Connect to the sync server first')
    }

    const deleteSession = async () => {
      const client = trackSyncClient(new SyncServerClient(
        settings.syncServerUrl,
        settings.syncServerToken
      ))
      commit('setSyncServerStatus', 'syncing')
      commit('setSyncServerError', '')

      try {
        for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
          assertSyncEnabled(rootState, client)
          const remote = await client.getEncryptedSyncCollection('sessionsV2')
          let remoteValue = remote.payload
            ? await decryptSyncDocument(remote.payload, settings.syncServerPrivacyKey)
            : null

          if (remoteValue === null) {
            const legacy = await client.getEncryptedSyncCollection('sessions')
            remoteValue = legacy.payload
              ? await decryptSyncDocument(legacy.payload, settings.syncServerPrivacyKey)
              : null
          }

          assertSyncEnabled(rootState, client)
          const nextSessions = sessionId === undefined
            ? removeSyncDeviceSessions(remoteValue, syncDeviceId, accountSessionId)
            : removeSyncSession(remoteValue, syncDeviceId, sessionId)
          const payload = await encryptSyncDocument(
            nextSessions,
            settings.syncServerPrivacyKey,
            settings.syncServerPrivacySalt
          )

          // A reconnect can introduce another login while loading or retrying
          // the encrypted collection. Preserve its tabs before every upload.
          if (sessionId === undefined) {
            const response = await client.getAccountSessions()
            if (!Array.isArray(response?.sessions)) {
              throw new Error(i18n.global.t('Settings.Sync Settings.Account Management Failed'))
            }
            assertSyncEnabled(rootState, client)
            if (response.sessions.some(session => (
              session.id !== accountSessionId && session.device_id === syncDeviceId
            ))) {
              commit('setSyncServerStatus', 'idle')
              return 'preserved'
            }
          }

          try {
            await client.putEncryptedSyncCollection('sessionsV2', remote.revision, payload)
          } catch (error) {
            if (error.status === 409 && attempt < ENCRYPTED_SYNC_RETRIES - 1) continue
            throw error
          }

          assertSyncEnabled(rootState, client)
          const snapshot = parseSnapshot(rootState.settings.syncServerSnapshot)
          snapshot.sessionsV2 = nextSessions
          await dispatch('updateSyncServerSnapshot', JSON.stringify(snapshot), { root: true })
          commit('setSyncServerOtherDeviceSessions', getSavedOtherDeviceSessions(snapshot, settings))
          commit('setSyncServerStatus', 'success')
          return true
        }
      } catch (error) {
        if (error instanceof SyncServerCancelledError) {
          commit('setSyncServerStatus', 'idle')
          return false
        }
        if (isSessionExpiredError(error)) {
          await dispatch('expireSyncServerSession')
          throw new Error(SYNC_SERVER_SESSION_EXPIRED_MESSAGE, { cause: error })
        }
        commit('setSyncServerError', error.message)
        commit('setSyncServerStatus', 'error')
        throw error
      } finally {
        releaseSyncClient(client)
      }
    }

    return withSyncLock(deleteSession)
  },

  replaceSyncWatchStatsDevice({ commit, dispatch, rootState }, { source, overlap, localDays, currentDays, replacedDevices, localReset }) {
    const settings = { ...rootState.settings }
    if (!settings.syncServerEnabled || !settings.syncServerToken ||
        settings.syncServerPrivacyMode !== 'enhanced' || !settings.syncServerPrivacyKey ||
        !settings.syncServerSyncWatchStats) {
      throw new Error('Connect to the sync server first')
    }
    const assertCurrentAccount = client => {
      assertSyncEnabled(rootState, client)
      if (activityAccountKey(rootState.settings) !== activityAccountKey(settings) ||
          rootState.settings.syncServerToken !== settings.syncServerToken ||
          !rootState.settings.syncServerSyncWatchStats) throw new SyncServerCancelledError()
    }
    return withSyncLock(async () => {
      const client = trackSyncClient(new SyncServerClient(settings.syncServerUrl, settings.syncServerToken))
      try {
        for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
          assertCurrentAccount(client)
          const remote = await client.getEncryptedSyncCollection('watchStats')
          const devices = remote.payload
            ? await decryptSyncDocument(remote.payload, settings.syncServerPrivacyKey)
            : []
          const records = await DBWatchStatsHandlers.find()
          const days = Object.fromEntries(records.map(record => [record.date, record.seconds]))
          const current = devices.find(device => containsWatchStatsDevice(device, settings.syncServerDeviceId))
          const previous = devices.find(device => device.deviceId === source.deviceId)
          assertCurrentAccount(client)
          if (!areJsonValuesEqual(previous, source) || !areJsonValuesEqual(days, localDays) ||
              !areJsonValuesEqual(current?.replacedDevices ?? [], replacedDevices) ||
              !areJsonValuesEqual(rootState.settings.syncServerWatchStatsReset, localReset) ||
              !areJsonValuesEqual(current ? watchStatsDeviceDays(current, settings.syncServerDeviceId, days, localReset) : days, currentDays)) {
            commit('setSyncedWatchStats', devices)
            throw new Error(i18n.global.t('Stats.Replacement changed'))
          }
          const merged = mergeWatchStats(devices, records, settings.syncServerDeviceId,
            settings.syncServerDeviceName, current?.platform, settings.syncServerWatchStatsReset)
          const next = replaceWatchStatsDevice(merged, settings.syncServerDeviceId, source.deviceId, overlap, Date.now())
          const payload = await encryptSyncDocument(next, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt)
          assertCurrentAccount(client)
          let saved
          try {
            saved = await client.putEncryptedSyncCollection('watchStats', remote.revision, payload)
          } catch (error) {
            if (error.status === 409 && attempt < ENCRYPTED_SYNC_RETRIES - 1) continue
            throw error
          }
          assertCurrentAccount(client)
          await collectionCache.put('watchStats', saved.revision, next)
          assertCurrentAccount(client)
          const snapshot = parseSnapshot(rootState.settings.syncServerSnapshot)
          snapshot.watchStats = next
          await dispatch('updateSyncServerSnapshot', JSON.stringify(snapshot), { root: true })
          commit('setSyncedWatchStats', next)
          return true
        }
      } finally {
        releaseSyncClient(client)
      }
    })
  },

  async completeSyncServerPairing(
    { commit, dispatch, rootState },
    { serverUrl, username, token, privacyKey, privacySalt, deviceId, deviceName, deviceSystemInfo }
  ) {
    if (!rootState.settings.syncServerEnabled) {
      throw new Error('Enable sync first')
    }
    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !token || !privacyKey || !privacySalt || !deviceId || !deviceName) {
      throw new Error('Incomplete pairing result')
    }

    await dispatch('updateSyncServerUrl', normalizedUrl, { root: true })
    await dispatch('updateSyncServerUsername', trimmedUsername, { root: true })
    await dispatch('updateSyncServerDeviceId', deviceId, { root: true })
    await dispatch('updateSyncServerDeviceName', deviceName, { root: true })
    await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerPrivacyMode', 'enhanced', { root: true })
    await dispatch('updateSyncServerPrivacyKey', privacyKey, { root: true })
    await dispatch('updateSyncServerPrivacySalt', privacySalt, { root: true })
    await dispatch('replaceSyncServerToken', token)
    commit('setSyncServerSessionExpired', false)

    if (deviceSystemInfo) {
      const client = trackSyncClient(new SyncServerClient(normalizedUrl, token))
      try {
        if (await client.supportsAccountSessions()) {
          const encryptedDeviceInfo = await encryptSyncServerDeviceInfo(
            { name: deviceName, ...deviceSystemInfo },
            privacyKey,
            deviceId
          )
          await client.updateAccountSession('current', encryptedDeviceInfo)
        }
      } catch {
        // The one-time pairing transfer has already been consumed. Keep the
        // saved account session; account management repairs its metadata later.
      } finally {
        releaseSyncClient(client)
      }
    }

    return dispatch('startSyncServerAutoSync')
  },

  async authenticateSyncServer(
    { commit, dispatch, rootState, state },
    { mode, serverUrl, username, password, privacyPassphrase, deviceId, deviceName, deviceSystemInfo }
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
    if (!trimmedUsername || !password || !deviceId || !deviceName || !deviceSystemInfo) {
      throw new Error('Username, password, and device information are required')
    }

    const client = trackSyncClient(new SyncServerClient(normalizedUrl))
    try {
      const updateWhileEnabled = async (action, value) => {
        assertSyncEnabled(rootState, client)
        await dispatch(action, value, { root: true })
        assertSyncEnabled(rootState, client)
      }

      const privacySupported = await client.supportsEncryptedSync()
      const sameAccount = normalizedUrl === rootState.settings.syncServerUrl &&
        trimmedUsername === rootState.settings.syncServerUsername
      assertEncryptionSupported(privacySupported, Boolean(privacyPassphrase) ||
        (sameAccount && requiresEncryptedSync(rootState.settings)))
      if (privacySupported && !privacyPassphrase) {
        throw new Error('A privacy passphrase is required by this server')
      }
      if (privacySupported && privacyPassphrase.length < 12) {
        throw new Error('The privacy passphrase must be at least 12 characters')
      }
      if (privacySupported && privacyPassphrase === password) {
        throw new Error('The privacy passphrase must be different from the account password')
      }
      const token = await client.authenticate(mode, trimmedUsername, password, deviceId)
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

      if (privacySupported && await client.supportsAccountSessions()) {
        const encryptedDeviceInfo = await encryptSyncServerDeviceInfo(
          { name: deviceName, ...deviceSystemInfo },
          privacyKey,
          deviceId
        )
        await client.updateAccountSession('current', encryptedDeviceInfo)
      }

      assertSyncEnabled(rootState, client)

      // Keep writes to the shared settings datastore ordered. In particular,
      // the URL must be committed before the token enables the initial sync.
      if (!sameAccount) {
        await updateWhileEnabled('updateSyncServerResumeAutoSync', false)
      }
      await updateWhileEnabled('updateSyncServerUrl', normalizedUrl)
      await updateWhileEnabled('updateSyncServerUsername', trimmedUsername)
      await updateWhileEnabled('updateSyncServerDeviceId', deviceId)
      await updateWhileEnabled('updateSyncServerDeviceName', deviceName)
      if (!resumesExpiredSession) {
        await updateWhileEnabled('updateSyncServerSnapshot', '{}')
      }
      if (!resumesExpiredSession) await updateWhileEnabled('updateSyncServerLastSyncAt', 0)
      await updateWhileEnabled(
        'updateSyncServerPrivacyMode',
        privacySupported ? 'enhanced' : 'legacy'
      )
      await updateWhileEnabled('updateSyncServerPrivacyKey', privacyKey)
      await updateWhileEnabled('updateSyncServerPrivacySalt', privacySalt)
      await updateWhileEnabled('replaceSyncServerToken', token)
      commit('setSyncServerSessionExpired', false)

      await dispatch('startSyncServerAutoSync')
      return dispatch('syncWithSyncServer')
    } catch (error) {
      if (error instanceof SyncServerCancelledError &&
          rootState.settings.syncServerToken !== previousToken) {
        await dispatch('replaceSyncServerToken', previousToken)
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
    await dispatch('replaceSyncServerToken', '')
    commit('setSyncServerProgress', null)
    commit('setSyncServerError', SYNC_SERVER_SESSION_EXPIRED_MESSAGE)
    commit('setSyncServerSessionExpired', true)
    commit('setSyncServerStatus', 'error')
  },

  async disconnectSyncServer({ commit, dispatch }) {
    await dispatch('stopSyncServerAutoSync')
    await dispatch('updateSyncServerUsername', '', { root: true })
    await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerPrivacyMode', 'unknown', { root: true })
    await dispatch('updateSyncServerPrivacyKey', '', { root: true })
    await dispatch('updateSyncServerPrivacySalt', '', { root: true })
    await dispatch('replaceSyncServerToken', '')
    commit('setSyncServerError', '')
    commit('setSyncServerLastResult', null)
    commit('setSyncServerHistorySupported', null)
    commit('setSyncServerProgress', null)
    commit('setSyncServerStatus', 'idle')
    commit('setSyncServerSessionExpired', false)
    commit('setSyncServerOtherDeviceSessions', [])
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
          await clearUnsupportedWatchStats({ commit, dispatch, rootState })
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
      dispatch('syncWithSyncServer', {
        skipIfRecent: reason === 'automatic',
        automatic: true,
      }).catch(error => {
        console.error('Sync server event sync failed', error)
      })
    }, Math.max(0, Math.min(delay, firstChangeAt + maxWait - Date.now())))
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
    if (!enabled) {
      commit('setSyncServerEnabled', false, { root: true })
      await dispatch('applySyncServerEnabled', false)
    }
    await dispatch('updateSyncServerEnabled', enabled, { root: true })
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
