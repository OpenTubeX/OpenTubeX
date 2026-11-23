import { runBackgroundJob } from '../../helpers/background-jobs.js'
import { SyncLiveConnectionState, SyncCollectionCache, createSyncActivity, validateDeviceRequest, watchSyncChanges } from '../../helpers/sync-server-live'
import i18n from '../../i18n/index'
import { openExternalLink, showToast, showToastOnAllTabs } from '../../helpers/utils'
import { isAppHidden } from '../../helpers/appVisibility.js'
import { holdAndroidBackgroundWork, isAndroidBackgroundRenderer, onAndroidWindowBlur, onPeriodicBackgroundTask } from '../../helpers/androidBackgroundSync.js'
import { checkConnection, connectionEvents, getConnectionState } from '../../helpers/networkRecovery.js'
import {
  SyncServerClient,
  SyncServerCancelledError,
  SyncServerTabRevocationPendingError,
  SyncServerUnsupportedError,
  SYNC_SERVER_UPDATE_REQUIRED_MESSAGE,
  SyncServerDataLossError,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  SYNC_SERVER_RESTORED_DEVICE_MESSAGE,
  forgetSyncDeviceId,
  getSavedOtherDeviceSessions,
  isExpiredSessionReauthentication,
  isAccountDeletedError,
  isSessionExpiredError,
  normalizeSyncServerUrl,
  syncHistory,
  syncPlaylistBookmarks,
  syncPlaylists,
  syncProfiles,
  syncSessions,
  syncSeparateProfiles,
  syncSettings,
  syncSubscriptions,
} from '../../helpers/sync-server'
import {
  EncryptedSyncAdapter,
  createEmptySyncDocument,
  decryptLegacySyncDocument,
  decryptSyncDocument,
  encryptSyncChange,
  encryptSyncDocument,
  loadLegacySyncDocument,
  migrateLegacyPlaybackSpeedsToSettings,
  preparePrivacyKey,
  readSyncCollection,
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
  isSyncReasonEnabled,
} from '../../helpers/sync-server-scheduling'
import { createSyncScheduler } from '../../helpers/sync-server-scheduler'
import { isSettingSyncEnabled, whenSyncServerSnapshotLoaded } from './settings'
import { syncSubscriptionSeenVideos, syncSubscriptionSeenPosts } from '../../helpers/subscription-seen-videos'
import { syncRssFeedSeenItems } from '../../helpers/rssFeedSeenItems'
import { containsWatchStatsDevice, mergeWatchStats, replaceWatchStatsDevice, persistUploadedWatchStatsReset, savedWatchStatsReset, syncWatchStats, watchStatsDeviceDays } from '../../helpers/sync-watch-stats'
import { areJsonValuesEqual } from '../../helpers/jsonValues'
import { DBSettingHandlers, DBWatchStatsHandlers, getDataScope } from '../../../datastores/handlers/index'
import { syncLiveReminders } from '../../helpers/sync-live-reminders'
import { liveReminder } from '../../helpers/liveReminders'
import { syncNotificationDismissals } from '../../helpers/sync-notification-dismissals'
import { getSettingsNotificationTarget, markOverNotificationsRead, notificationHistory, recordNotification } from '../../helpers/notificationHistory'
import { MAIN_PROFILE_ID } from '../../../constants'
import { isValidSeparateProfileId } from '../../../datastores/profileDatastoreNames.js'
import { historyChanges } from '../../helpers/sync-history-changes.js'
import {
  SYNC_DELETION_MARKS_COLLECTION,
  addSyncDeletionMarks,
  parseSyncDeletionListKey,
  readSyncDeletionMarks,
  syncDeletionKey,
  syncDeletionListKey,
  syncDeletions,
  translateSyncDeletionMarks,
  unsentSyncDeletionMarks,
  withRemoteSyncDeletions,
} from '../../helpers/sync-deletions.js'
import {
  SCOPED_SYNC_COLLECTIONS,
  supportsSeparateProfiles,
  dataScopeLoading,
  fromSharedSyncDeletionMarks,
  isScopedSyncDeletionKey,
  readScopedSnapshot,
  scopedSyncCollection,
  syncScopeKey,
  toSharedSyncDeletionMarks,
  writeScopedSnapshot,
} from '../../helpers/sync-data-scope.js'
import {
  SYNC_SERVER_OIDC_REDIRECT_URL,
  SyncServerOidcCallbacks,
  createSyncServerOidcState,
  getSyncServerOidcCallbackToken,
  syncServerOidcLoginUrl,
  syncServerOidcUsername,
} from '../../helpers/sync-server-oidc'

const ENCRYPTED_SYNC_RETRIES = 3
const LEGACY_ENCRYPTED_COLLECTIONS = [
  'subscriptions',
  'playlists',
  'history',
  'profiles',
  'playlistBookmarks',
]

const collectionCache = new SyncCollectionCache()
const oidcCallbacks = new SyncServerOidcCallbacks()
let oidcFlow = 0
const liveConnection = new SyncLiveConnectionState(typeof navigator !== 'undefined' ? navigator.locks : null)
let liveClient = null
let syncCapabilities = null
/** The remote history revision and data scope the saved baseline was merged with. */
let mergedHistory = null
let liveLockController = null
let liveGeneration = 0
let eventsSince = ''
let eventsRefresh = null
const activeSyncClients = new Set()
let lifecycleSyncStarted = false
/** The full sync that a reconnect started, while it runs. */
let reconnectSync = null
let reminderSyncListenerStarted = false
let notificationSyncListenerStarted = false
let deviceRefreshId = 0
let syncServerEnabledChange = Promise.resolve()

/** @type {ReturnType<typeof createSyncScheduler> | null} */
let scheduler = null

// The scheduler outlives the action that creates it. It only uses what every
// action context shares: the store's root state and dispatch.
function getScheduler(context) {
  scheduler ??= createSyncScheduler({
    getSettings: () => context.rootState.settings,
    getSyncState: () => context.rootState.syncServer,
    runSync: options => runSync(context, options),
    requestSync: options => context.dispatch('syncWithSyncServer', options),
    requestAutoSync: restart => context.dispatch(restart ? 'restartSyncServerAutoSync' : 'startSyncServerAutoSync'),
    withSyncLock,
    isOffline: isSyncServerOffline,
    isLiveConnected: () => liveConnection.isConnected(),
    startLive: () => context.dispatch('startSyncServerLive'),
    stopLive: () => context.dispatch('stopSyncServerLive'),
  })
  return scheduler
}

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

/**
 * Without the shared deletion marks, the sync asks the user to review the deletions
 * instead, so failing to transfer them must not stop it.
 * @template T
 * @param {() => Promise<T>} transfer
 * @returns {Promise<T | null>}
 */
async function tryDeletionMarks(transfer) {
  try {
    return await transfer()
  } catch (error) {
    if (error instanceof SyncServerCancelledError || isSessionExpiredError(error)) throw error
    console.warn('Failed to transfer the shared sync deletions:', error)
    return null
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
  /** Whether this device has deletions it failed to share with other devices */
  syncServerDeletionMarksPending: false,
  syncServerNotificationDismissalsSupported: null,
  syncServerSeparateProfilesSupported: null,
  syncServerSessionExpired: false,
  syncServerOtherDeviceSessions: [],
  syncServerDevices: {},
  /** Deletions the last sync stopped at, until the user reviews them */
  syncServerPendingDeletion: null,
  /** The OIDC flow waiting for the browser: 'login', 'delete', or null */
  syncServerOidcPending: null,
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
    : state.syncServerError === SYNC_SERVER_RESTORED_DEVICE_MESSAGE
      ? i18n.global.t('Settings.Sync Settings.Signed Out After Restore')
      : state.syncServerError,
  getSyncServerLastResult: state => state.syncServerLastResult,
  getSyncServerPendingDeletion: state => state.syncServerPendingDeletion,
  getSyncServerOidcPending: state => state.syncServerOidcPending,
  getSyncServerHistorySupported: state => state.syncServerHistorySupported,
  getSyncServerWatchStatsSupported: state => state.syncServerWatchStatsSupported,
  getSyncServerLiveRemindersSupported: state => state.syncServerLiveRemindersSupported,
  getSyncServerNotificationDismissalsSupported: state => state.syncServerNotificationDismissalsSupported,
  getSyncServerSeparateProfilesSupported: state => state.syncServerSeparateProfilesSupported,
  getSyncServerOtherDeviceSessions: state => state.syncServerOtherDeviceSessions.map(session => ({
    ...session,
    syncDeviceName: state.syncServerDevices[session.syncDeviceId]?.name ?? '',
  })),
}

let parsedSnapshot = { value: undefined, snapshot: {} }

/**
 * The snapshot holds a baseline for every synced history entry and is read
 * by each sync. Parse an unchanged value only once. Callers receive a copy of
 * its top level, as they replace or delete collections but never edit them.
 */
function parseSnapshot(value) {
  if (value !== parsedSnapshot.value) {
    let snapshot
    try {
      snapshot = JSON.parse(value)
    } catch {}
    parsedSnapshot = { value, snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {} }
  }
  return { ...parsedSnapshot.snapshot }
}

/** The baselines without the watch statistics of every data scope */
function withoutWatchStats(snapshot) {
  const result = { ...snapshot }
  delete result.watchStats
  if (result.scopes) {
    result.scopes = Object.fromEntries(Object.entries(result.scopes).map(([key, { watchStats: _watchStats, ...scope } = {}]) => [key, scope]))
  }
  return result
}

function hasWatchStats(snapshot) {
  return 'watchStats' in snapshot || Object.values(snapshot.scopes ?? {}).some(scope => scope && 'watchStats' in scope)
}

async function clearUnsupportedWatchStats({ commit, dispatch, rootState }, snapshotValue = rootState.settings.syncServerSnapshot) {
  commit('setSyncedWatchStats', [])
  const snapshot = parseSnapshot(snapshotValue)
  if (!hasWatchStats(snapshot)) return
  await dispatch('updateSyncServerSnapshot', JSON.stringify(withoutWatchStats(snapshot)), { root: true })
}

/**
 * The separate profile whose data the store shows, or undefined while a
 * switch to another profile loads its data
 * @returns {string | null | undefined}
 */
function shownDataScope(rootGetters) {
  const scope = getDataScope()
  return !dataScopeLoading() && (rootGetters.getActiveDataScope ?? null) === scope ? scope : undefined
}

/** The other devices' watch statistics of the data the store shows, as of the last sync */
function syncedWatchStatsOf(snapshot, rootGetters) {
  const watchStats = readScopedSnapshot(snapshot, syncScopeKey(rootGetters.getActiveDataScope ?? null)).watchStats
  return Array.isArray(watchStats) ? watchStats : []
}

/** Keeps the baselines of the separate profiles that still exist */
function withoutRemovedScopes(snapshot, profiles) {
  if (!snapshot.scopes) return snapshot
  const keys = new Set(profiles.filter(profile => profile.separate === true && isValidSeparateProfileId(profile._id))
    .map(profile => syncScopeKey(profile._id)))
  return { ...snapshot, scopes: Object.fromEntries(Object.entries(snapshot.scopes).filter(([key]) => keys.has(key))) }
}

async function persistUploadedHistoryRepairs(entries, store) {
  const durations = new Map(entries.map(entry => [entry.video.id, entry.video.duration]))
  const acknowledgedRepairs = []
  for (const record of store.state.history?.historyCacheSorted ?? []) {
    if (record.pendingDurationRepair === true && Number.isFinite(record.lengthSeconds) &&
        Math.round(record.lengthSeconds) === durations.get(record.videoId)) {
      acknowledgedRepairs.push({
        videoId: record.videoId,
        lengthSeconds: record.lengthSeconds,
        pendingDurationRepair: true,
      })
    }
  }
  if (acknowledgedRepairs.length) {
    store.assertActive?.()
    await store.dispatch('updateSubscriptionHistory', { acknowledgedRepairs })
  }
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
      requiredCapabilities.every(capability => capability === 'separate_profiles'
        ? supportsSeparateProfiles(syncCapabilities.value)
        : syncCapabilities.value[capability] === 1)) {
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

function assertPrivacyPassphrase(supported, privacyPassphrase, password) {
  if (!supported) return
  if (!privacyPassphrase) {
    throw new Error('A privacy passphrase is required by this server')
  }
  if (privacyPassphrase.length < 12) {
    throw new Error('The privacy passphrase must be at least 12 characters')
  }
  if (privacyPassphrase === password) {
    throw new Error('The privacy passphrase must be different from the account password')
  }
}

/**
 * Opens an OIDC flow in the browser and resolves with the URL the server
 * redirects back to.
 * @param {Function} commit
 * @param {'login' | 'delete'} kind
 * @param {string} url
 * @param {string | null} state the `state` the callback must carry, or null
 * @returns {Promise<string>}
 */
async function runOidcFlow(commit, kind, url, state) {
  oidcCallbacks.cancel(new SyncServerCancelledError())
  const flow = ++oidcFlow
  const callback = oidcCallbacks.wait(state)
  // Not awaited yet while the browser opens; cancelling it then must not
  // become an unhandled rejection.
  callback.catch(() => {})
  commit('setSyncServerOidcPending', kind)
  try {
    await openExternalLink(url)
    return await callback
  } catch (error) {
    // A newer flow that replaced this one now owns the pending callback.
    if (flow === oidcFlow) oidcCallbacks.cancel(error)
    throw error
  } finally {
    if (flow === oidcFlow) commit('setSyncServerOidcPending', null)
  }
}

/** The settings identifying a sync account and its privacy context. */
function getSyncAccount(settings) {
  return [settings.syncServerUrl, settings.syncServerToken, settings.syncServerPrivacyMode,
    settings.syncServerPrivacyKey, settings.syncServerPrivacySalt]
}

// Nested lists share their parent's sync setting.
const DELETION_MARK_STAGES = { playlistVideos: 'playlists', profileChannels: 'profiles' }

function isSameSyncAccount(settings, account) {
  return getSyncAccount(settings).every((value, index) => value === account[index])
}

const syncsNotifications = process.env.IS_ELECTRON || process.env.IS_CAPACITOR
// The renderer that syncs while the Android app is closed leaves out live
// reminders, because the notification plugin that schedules them belongs to
// the app's renderer.
const syncsLiveReminders = syncsNotifications && !isAndroidBackgroundRenderer

/** @param {boolean} allTabs false for a window that learns of a sync other windows announced */
function showDataLossToast(allTabs) {
  const message = i18n.global.t('Settings.Sync Settings.Destructive Sync Blocked')
  const icon = ['fas', 'triangle-exclamation']
  if (allTabs) {
    showToastOnAllTabs(message, 15000, icon, 'open-sync-settings')
    recordNotification({
      kind: 'sync-blocked',
      ...getSettingsNotificationTarget('sync'),
      title: i18n.global.t('Settings.Sync Settings.Sync Settings'),
      body: message
    })
  } else {
    showToast({ message, time: 15000, icon, buttonAction: 'open-sync-settings' })
  }
}

/** A sync that finished, or signing out, leaves no deletions to review. */
function markDataLossNotificationsRead() {
  markOverNotificationsRead(entry => entry.kind === 'sync-blocked')
}

async function runSync(context, { allowDataLoss = false, notifyDataLoss = true, automatic = false, remoteOnly = false } = {}) {
  const { commit, dispatch, rootGetters, rootState } = context
  const settings = rootState.settings
  const encrypted = requiresEncryptedSync(settings)
  // A sync merges the history, playlists, watch statistics, and subscriptions
  // of the data the store shows: a separate profile's, or else the shared ones.
  // A profile switch first loads the other profile's data.
  for (let loading = dataScopeLoading(); loading; loading = dataScopeLoading()) await loading.catch(() => {})
  await whenSyncServerSnapshotLoaded()
  const dataScope = rootGetters.getActiveDataScope ?? null
  const scopeKey = syncScopeKey(dataScope)
  // The server keeps a separate profile's collections under their own names.
  const remoteName = collection => scopedSyncCollection(collection, scopeKey)
  const networkClient = trackSyncClient(
    new SyncServerClient(settings.syncServerUrl, settings.syncServerToken)
  )
  let client = networkClient
  let encryptedCollections = null
  const cacheIdentity = JSON.stringify([settings.syncServerUrl, settings.syncServerToken, settings.syncServerPrivacyKey])
  collectionCache.use(cacheIdentity)
  let savedSnapshot = parseSnapshot(settings.syncServerSnapshot)
  const previous = readScopedSnapshot(savedSnapshot, scopeKey)
  const next = { ...previous }
  // After a conflicting upload, a collection merges again against the previous
  // baseline plus what this sync downloaded. The previous baseline alone would
  // undo removals of downloaded items, while the merged result would drop
  // local items that were never uploaded.
  /** @type {Record<string, () => unknown>} */
  const retryBaselines = {}
  const baseline = collection => retryBaselines[collection] ? retryBaselines[collection]() : previous[collection]
  // Playlist preferences use the server's playlist IDs, which only this sync's
  // playlist merge maps. A separate profile's playlists have none.
  const playlistSnapshot = () => settings.syncServerSyncPlaylists && dataScope === null ? next.playlists ?? null : null
  const historyAccount = getSyncAccount(settings)
  const isSameAccount = () => isSameSyncAccount(rootState.settings, historyAccount)
  // Deletions made or reviewed before this sync; ones made while it runs wait for the next.
  // A separate profile's lists take the deletions made in its data.
  const commonDeletions = Object.entries(syncDeletions.snapshot())
    .filter(([key]) => dataScope === null || !isScopedSyncDeletionKey(key))
  const scopeDeletions = dataScope === null
    ? []
    : Object.entries(syncDeletions.snapshot(dataScope)).filter(([key]) => isScopedSyncDeletionKey(key))
  const deletions = Object.fromEntries([...commonDeletions, ...scopeDeletions])
  // Merges also apply the deletions other devices confirmed.
  let mergeDeletions = deletions
  // Unsent deletion marks stay with their account, also when its token is renewed.
  const deletionMarksAccount = JSON.stringify([settings.syncServerUrl, settings.syncServerUsername, settings.syncServerPrivacyKey])
  // The confirmed deletions as other devices know the lists, by their server
  // IDs and with a separate profile's lists marked as its own
  const sharedDeletions = Object.fromEntries(toSharedSyncDeletionMarks(translateSyncDeletionMarks(
    Object.entries(deletions).map(([key, { confirmed = [] }]) => ({ key, ids: confirmed })),
    previous,
    true
  ), dataScope).map(({ key, ids }) => [key, { confirmed: ids }]))
  const result = {}
  const skippedCollections = new Set()
  // Collections this sync merged into the local data, and in enhanced privacy
  // mode the ones whose merge the server also holds
  const appliedCollections = new Set()
  const uploadedCollections = new Set()
  // The separate profiles this sync uploaded, and those whose data it deleted
  let uploadedSeparateProfiles = []
  const deletedProfileData = new Set()
  // The playlists the current playlist merge saved locally, for when a later one fails
  const savedPlaylistIds = new Set()
  let tabRevocationError = null
  // The server has no settings entry for speeds this sync migrated, and a saved
  // one would acknowledge the migration before its upload succeeded.
  let migratedPlaybackSpeedsEntry = false
  const store = {
    state: rootState,
    getters: rootGetters,
    commit,
    // Saves go to the data the store shows, so none may follow a profile switch.
    dispatch: (...args) => shownDataScope(rootGetters) === dataScope
      ? dispatchRemoteSyncAction(dispatch, ...args)
      : Promise.reject(new SyncServerCancelledError()),
    assertActive: assertSyncStillActive,
    async persistPlaylistSyncBaseline(id, { remoteId, metadata, applied = false, videos: syncedVideos, added = [], removed = [] }) {
      // Encrypted adapter mutations are only published in the final upload.
      if (encrypted) {
        if (applied) savedPlaylistIds.add(id)
        return
      }
      if (!isSameAccount()) return
      const current = rootState.settings
      const saved = parseSnapshot(current.syncServerSnapshot)
      // Until the local save succeeds, retain the shared header baseline so a
      // retry can still distinguish a remote rename from a new local edit.
      const sharedMetadata = applied ? metadata : saved.playlists?.[id]?.metadata ?? metadata
      const videos = new Set(applied ? syncedVideos : saved.playlists?.[id]?.videos ?? [])
      for (const videoId of added) videos.add(videoId)
      for (const videoId of removed) videos.delete(videoId)
      const baseline = { remoteId, metadata: sharedMetadata, videos: [...videos] }
      // Every completed playlist reports its baseline. Skip identical ones
      // instead of saving the whole sync snapshot again for each playlist.
      if (JSON.stringify(saved.playlists?.[id]) === JSON.stringify(baseline)) return
      await dispatch('updateSyncServerSnapshot', JSON.stringify({
        ...saved,
        playlists: { ...saved.playlists, [id]: baseline },
      }), { root: true })
    },
    async persistHistorySyncBaseline(changes) {
      // A disable can cancel requests after they succeeded. Record those
      // effects, but never carry them into a different account/privacy context.
      while (isSameAccount()) {
        const snapshot = rootState.settings.syncServerSnapshot
        const updated = await runBackgroundJob('updateHistorySnapshot', { snapshot, ...changes })
        if (!isSameAccount()) return
        if (snapshot !== rootState.settings.syncServerSnapshot) continue
        if (updated !== snapshot) await dispatch('updateSyncServerSnapshot', updated, { root: true })
        return
      }
    },
    async persistSettingsSyncBaseline(entries) {
      // The applied server entries are its state even when the upload fails.
      // Without them, the next sync would take them for local edits and
      // upload items and values other devices changed since.
      if (!isSameAccount()) return
      const saved = parseSnapshot(rootState.settings.syncServerSnapshot)
      const applied = { ...entries }
      if (migratedPlaybackSpeedsEntry) delete applied.channelPlaybackSpeeds
      const settings = { ...saved.settings, ...applied }
      if (JSON.stringify(settings) === JSON.stringify(saved.settings ?? {})) return
      await dispatch('updateSyncServerSnapshot', JSON.stringify({ ...saved, settings }), { root: true })
    },
  }
  // Separate profiles only sync with encryption.
  const syncsScope = dataScope === null || encrypted
  const stages = [
    ...(encrypted ? ['download'] : []),
    ...(settings.syncServerSyncSubscriptions && syncsScope ? ['subscriptions'] : []),
    ...(settings.syncServerSyncPlaylists && syncsScope ? ['playlists'] : []),
    ...(settings.syncServerSyncPlaylists && syncsScope ? ['playlistBookmarks'] : []),
    ...(settings.syncServerSyncHistory && syncsScope ? ['history'] : []),
    ...(encrypted && settings.syncServerSyncWatchStats ? ['watchStats'] : []),
    ...(syncsLiveReminders && encrypted &&
      settings.syncServerSyncLiveReminders
      ? ['liveReminders']
      : []),
    ...(syncsNotifications && encrypted && settings.syncServerSyncNotifications
      ? ['notificationDismissals']
      : []),
    ...(settings.syncServerSyncProfiles ? ['profiles'] : []),
    ...(encrypted && settings.syncServerSyncProfiles ? ['separateProfiles'] : []),
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
    // The next sync merges the data of the profile switched to.
    if (shownDataScope(rootGetters) !== dataScope) throw new SyncServerCancelledError()
  }

  async function runStage(stage, callback) {
    assertSyncStillActive()
    const progressStage = ['seenVideos', 'seenPosts', 'seenRssItems'].includes(stage)
      ? 'history'
      : stage === 'separateProfiles' ? 'profiles' : stage
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

  /** @type {Set<string> | null | undefined} undefined until the history stage takes them */
  let takenHistoryChanges
  function takeHistoryChanges() {
    const taken = historyChanges.take()
    takenHistoryChanges = takenHistoryChanges === undefined
      ? taken
      : takenHistoryChanges && taken && new Set([...takenHistoryChanges, ...taken])
    return takenHistoryChanges
  }

  /** The shared deletion marks, from the cache while their revision is unchanged. */
  async function downloadDeletionMarks(manifestRevision) {
    if (manifestRevision === 0) return { revision: 0, data: undefined }
    const known = collectionCache.latest(SYNC_DELETION_MARKS_COLLECTION)
    if (known?.revision === manifestRevision) return known
    const remote = await readSyncCollection(
      SYNC_DELETION_MARKS_COLLECTION,
      await networkClient.getEncryptedSyncCollection(SYNC_DELETION_MARKS_COLLECTION),
      null,
      settings.syncServerPrivacyKey
    )
    collectionCache.put(SYNC_DELETION_MARKS_COLLECTION, remote.revision, remote.data, cacheIdentity)
    return remote
  }

  /**
   * Shares this device's confirmed deletions before uploading them, so other
   * devices apply them without asking.
   * @param {{ revision: number, data: unknown }} marks
   * @param {import('../../helpers/sync-deletions.js').SyncDeletionMark[]} unsent
   * @param {(key: string) => boolean} includeKey
   * @returns {Promise<true>}
   */
  async function uploadDeletionMarks({ revision, data }, unsent, includeKey) {
    for (let attempt = 0; ; attempt++) {
      const known = [...readSyncDeletionMarks(data), ...unsent]
      const marks = addSyncDeletionMarks(known, sharedDeletions, { includeKey }) ?? (unsent.length > 0 ? known : null)
      if (!marks) return true
      assertSyncStillActive()
      startProgress('upload')
      try {
        const saved = await networkClient.putEncryptedSyncCollection(
          SYNC_DELETION_MARKS_COLLECTION,
          revision,
          await encryptSyncDocument(marks, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt)
        )
        collectionCache.put(SYNC_DELETION_MARKS_COLLECTION, saved.revision, marks, cacheIdentity)
        return true
      } catch (error) {
        if (error.status !== 409 || attempt === ENCRYPTED_SYNC_RETRIES - 1) throw error
        ;({ revision, data } = await readSyncCollection(
          SYNC_DELETION_MARKS_COLLECTION,
          await networkClient.getEncryptedSyncCollection(SYNC_DELETION_MARKS_COLLECTION),
          null,
          settings.syncServerPrivacyKey
        ))
      }
    }
  }

  // The next sync must not take what this one downloaded and applied for local
  // additions, which would upload items that other devices removed meanwhile.
  // A collection the server holds the merge of keeps it as its baseline. One
  // the upload missed keeps the conflict retry's: the previous baseline plus
  // the download, which still tells this device's unsent edits apart.
  async function persistFailedSyncBaselines() {
    if (!isSameAccount()) return
    const saved = parseSnapshot(rootState.settings.syncServerSnapshot)
    // A separate profile's baselines go to its own part of the snapshot.
    const updated = readScopedSnapshot(saved, scopeKey)
    for (const collection of appliedCollections) {
      if (skippedCollections.has(collection)) continue
      // syncSettings saves the entries it applied on its own
      let value = !encryptedCollections || uploadedCollections.has(collection)
        ? next[collection]
        : collection === 'settings' ? undefined : retryBaselines[collection]?.()
      // The baseline keeps removed profiles whose data the server may still
      // have, so the next sync finds them again and deletes it. Deleting
      // again is harmless.
      if (collection === 'separateProfiles' && value !== undefined && uploadedCollections.has(collection)) {
        value = { ...value, ...Object.fromEntries(removedProfileIds().map(id => [id, previous.separateProfiles?.[id] ?? null])) }
      }
      if (value !== undefined) updated[collection] = value
    }
    const snapshot = JSON.stringify(writeScopedSnapshot(saved, updated, scopeKey))
    if (snapshot !== rootState.settings.syncServerSnapshot) {
      await dispatch('updateSyncServerSnapshot', snapshot, { root: true })
    }
  }

  /**
   * A playlist merge that failed keeps the baseline it started from, except
   * for the playlists it saved, which take the download they merged.
   * @param {Record<string, unknown>} startBaseline
   */
  function keepSavedPlaylistsBaseline(startBaseline) {
    const mergeBaseline = retryBaselines.playlists
    const savedIds = Array.from(savedPlaylistIds)
    retryBaselines.playlists = () => {
      const downloaded = mergeBaseline?.() ?? {}
      const baseline = { ...startBaseline }
      for (const id of savedIds) {
        if (downloaded[id]) baseline[id] = downloaded[id]
      }
      return baseline
    }
  }

  /** Separate profiles the server may still keep data for, while no profile lists them */
  function removedProfileIds() {
    const ids = [
      ...Object.keys(previous.separateProfiles ?? {}),
      ...(encryptedCollections?.original.separateProfiles ?? []).map(entry => entry?.id),
    ]
    const remaining = new Set(Object.keys(next.separateProfiles ?? {}))
    for (const profile of rootState.profiles.profileList) remaining.add(profile._id)
    // The uploaded list also keeps the profiles this version can't read.
    for (const entry of Array.isArray(uploadedSeparateProfiles) ? uploadedSeparateProfiles : []) remaining.add(entry?.id)
    return [...new Set(ids)].filter(id => isValidSeparateProfileId(id) && !remaining.has(id) && !deletedProfileData.has(id))
  }

  // Whether the server keeps the data of separate profiles, see the capability check
  let separateProfilesSupported = false
  // The channel settings of the separate profile this sync merges sync in
  // their own entry, which goes once the profile is deleted. Without server
  // support, they stay on this device like the profile's other data.
  function settingsScope() {
    return {
      dataScope: separateProfilesSupported ? dataScope : null,
      removedProfileIds: removedProfileIds().filter(id => id !== dataScope),
    }
  }

  async function deleteRemovedProfileData() {
    for (const id of removedProfileIds()) {
      for (const collection of SCOPED_SYNC_COLLECTIONS) {
        assertSyncStillActive()
        await networkClient.deleteEncryptedSyncCollection(scopedSyncCollection(collection, syncScopeKey(id)))
      }
      deletedProfileData.add(id)
    }
  }

  async function applyCollection(collection, targetClient) {
    const onRetryBaseline = getBaseline => { retryBaselines[collection] = getBaseline }
    switch (collection) {
      case 'seenVideos':
        result.seenVideos = await syncSubscriptionSeenVideos(targetClient, store, assertSyncStillActive)
        break
      case 'seenPosts':
        result.seenPosts = await syncSubscriptionSeenPosts(targetClient, store, assertSyncStillActive)
        break
      case 'seenRssItems':
        result.seenRssItems = await syncRssFeedSeenItems(targetClient, store)
        break
      case 'subscriptions':
        next.subscriptions = await syncSubscriptions(
          targetClient,
          store,
          baseline(collection),
          { allowDataLoss, deletions: mergeDeletions, onRetryBaseline, profileId: dataScope }
        )
        result.subscriptions = next.subscriptions.length
        break
      case 'playlists':
        savedPlaylistIds.clear()
        next.playlists = await syncPlaylists(
          targetClient,
          store,
          baseline(collection),
          // Takeout only supplies video IDs. Encrypted sync can carry unknown
          // uploaders; the legacy server requires real channel metadata.
          { allowDataLoss, deletions: mergeDeletions, allowMissingUploader: encrypted, onRetryBaseline }
        )
        result.playlists = Object.keys(next.playlists).length
        break
      case 'playlistBookmarks':
        next.playlistBookmarks = await syncPlaylistBookmarks(
          targetClient,
          store,
          previous.playlistBookmarks,
          { allowDataLoss, deletions: mergeDeletions, onRetryBaseline }
        )
        result.playlistBookmarks = next.playlistBookmarks.length
        break
      case 'history': {
        const changedIds = takeHistoryChanges()
        // While the remote history is the one this window last merged, only
        // local changes since then need merging.
        const unchangedRemote = targetClient === client && mergedHistory?.identity === cacheIdentity &&
          mergedHistory.scope === scopeKey && mergedHistory.revision === encryptedCollections?.remote.history?.revision
        const history = await syncHistory(
          targetClient,
          store,
          baseline(collection),
          // Imported playlist videos can enter history without uploader metadata.
          { allowDataLoss, deletions: mergeDeletions, allowMissingUploader: encrypted, allowExternalMedia: encrypted },
          // Restoring entries can involve ones that did not change locally.
          { changedIds: unchangedRemote && !deletions.history ? changedIds : null, onRetryBaseline }
        )
        if (history !== null) {
          commit('setSyncServerHistorySupported', true)
          next.history = history
          result.history = Object.keys(history).length
        } else {
          // The server has no history, so this sync merged none.
          skippedCollections.add(collection)
          commit('setSyncServerHistorySupported', false)
        }
        break
      }
      case 'watchStats':
        next.watchStats = await syncWatchStats(targetClient, store, { dataScope })
        result.watchStats = next.watchStats.length
        break
      case 'liveReminders':
        {
          const reminders = await syncLiveReminders(targetClient, baseline(collection), undefined, { onRetryBaseline })
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
      case 'notificationDismissals':
        result.notificationDismissals = await syncNotificationDismissals(targetClient, notificationHistory)
        break
      case 'profiles':
        {
          const profiles = await syncProfiles(
            targetClient,
            store,
            baseline(collection),
            { allowDataLoss, deletions: mergeDeletions, onRetryBaseline }
          )
          if (profiles !== null) {
            next.profiles = profiles
            result.profiles = Object.keys(profiles).length
          } else {
            // The server has no profile groups, so this sync merged none.
            skippedCollections.add(collection)
          }
        }
        break
      case 'separateProfiles':
        next.separateProfiles = await syncSeparateProfiles(
          targetClient,
          store,
          baseline(collection),
          { allowDataLoss, deletions, onRetryBaseline }
        )
        break
      case 'settings':
        next.settings = await syncSettings(targetClient, store, previous.settings, playlistSnapshot(), { onRetryBaseline, ...settingsScope() })
        result.settings = Object.keys(next.settings).length
        break
      case 'sessionsV2': {
        let sessions
        try {
          sessions = await syncSessions(
            targetClient,
            store,
            retryBaselines.sessionsV2 ? retryBaselines.sessionsV2() : getPreviousSyncSessions(previous),
            { accountClient: networkClient, onRetryBaseline }
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
    assertSyncStillActive()
    // Remote checks share recent discovery. Full syncs refresh it for subsequent
    // live checks too, so new support cannot be reverted by an old live client.
    // Recheck missing support before consuming a live notification, otherwise an
    // enabled collection added by a server upgrade could miss its only event.
    const capabilities = await getSyncServerCapabilities(networkClient, {
      refresh: !remoteOnly,
      requiredCapabilities: [
        ...(stages.includes('watchStats') ? ['watch_stats'] : []),
        ...(stages.includes('liveReminders') ? ['live_reminders'] : []),
        ...(stages.includes('notificationDismissals') ? ['notification_dismissals'] : []),
        ...(encrypted && settings.syncServerSyncHistory ? ['seen_videos', 'seen_posts', 'seen_rss_items'] : []),
        ...(stages.includes('separateProfiles') ||
          (dataScope !== null && stages.some(stage => SCOPED_SYNC_COLLECTIONS.has(stage)))
          ? ['separate_profiles']
          : []),
      ],
    })
    const watchStatsSupported = encrypted && capabilities.watch_stats === 1
    commit('setSyncServerWatchStatsSupported', watchStatsSupported)
    if (!watchStatsSupported) {
      const index = stages.indexOf('watchStats')
      if (index !== -1) stages.splice(index, 1)
      if (settings.syncServerSyncWatchStats) {
        delete next.watchStats
        savedSnapshot = withoutWatchStats(savedSnapshot)
        await clearUnsupportedWatchStats(context)
      }
    }
    // Without support, a separate profile's data stays on this device.
    separateProfilesSupported = encrypted && supportsSeparateProfiles(capabilities)
    commit('setSyncServerSeparateProfilesSupported', separateProfilesSupported)
    if (!separateProfilesSupported) {
      for (const stage of ['separateProfiles', ...(dataScope === null ? [] : SCOPED_SYNC_COLLECTIONS)]) {
        const index = stages.indexOf(stage)
        if (index !== -1) stages.splice(index, 1)
      }
    }
    const liveRemindersSupported = encrypted && capabilities.live_reminders === 1
    commit('setSyncServerLiveRemindersSupported', liveRemindersSupported)
    if (!liveRemindersSupported) {
      commit('setSyncServerLiveRemindersPending', false)
      const index = stages.indexOf('liveReminders')
      if (index !== -1) stages.splice(index, 1)
    }
    const notificationDismissalsSupported = encrypted && capabilities.notification_dismissals === 1
    commit('setSyncServerNotificationDismissalsSupported', notificationDismissalsSupported)
    if (!notificationDismissalsSupported) {
      const index = stages.indexOf('notificationDismissals')
      if (index !== -1) stages.splice(index, 1)
    }
    assertEncryptionSupported(capabilities.encrypted_sync === 1, encrypted)
    const liveSupported = encrypted && capabilities.live_sync === 1
    commit('setSyncServerLiveSupported', liveSupported)
    if (encrypted) {
      // Seen marks sync with the history, which a separate profile keeps on
      // this device while the server lacks its collections.
      const syncsHistory = stages.includes('history')
      if (syncsHistory && capabilities.seen_videos === 1) {
        stages.splice(stages.indexOf('history') + 1, 0, 'seenVideos')
      }
      if (syncsHistory && capabilities.seen_posts === 1) {
        stages.splice(stages.indexOf('history') + 1, 0, 'seenPosts')
      }
      // RSS feeds are the same in every profile, and so are their seen marks.
      if (settings.syncServerSyncHistory && capabilities.seen_rss_items === 1) {
        stages.splice(stages.indexOf(syncsHistory ? 'history' : 'download') + 1, 0, 'seenRssItems')
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
        migratedPlaybackSpeeds,
        deletionMarks,
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
        // Legacy data is the shared data, which migrates while a shared profile is active.
        const uploadCollections = manifest.legacy_data || legacyEncrypted?.payload
          ? Array.from(new Set([...enabledCollections, ...LEGACY_ENCRYPTED_COLLECTIONS
              .filter(collection => remoteName(collection) === collection)]))
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
            !(capabilities.sync_deletions === 1 && unsentSyncDeletionMarks.read(deletionMarksAccount).length > 0) &&
            downloadCollections.every(collection => collectionCache.isSynced(
              remoteName(collection), manifest.collections.find(entry => entry.collection === remoteName(collection))?.revision ?? 0
            ))) return { unchanged: true }
        const document = createEmptySyncDocument()
        // Legacy speeds are read for migration into settings, never uploaded.
        document.playbackSpeeds = legacy.playbackSpeeds ?? []
        const original = {}
        const entries = await Promise.all(downloadCollections.map(async collection => {
          const name = remoteName(collection)
          const manifestRevision = manifest.collections.find(entry => entry.collection === name)?.revision ?? 0
          const known = !manifest.legacy_data && !legacyEncrypted?.payload
            ? collectionCache.latest(name)
            : null
          let remote = known?.revision === manifestRevision ? known : null
          if (!remote) {
            startProgress('download')
            // An older cached revision lets the server send only later changes.
            remote = await readSyncCollection(
              collection,
              await networkClient.getEncryptedSyncCollection(
                name, capabilities.collection_changes === 1 ? known?.revision ?? 0 : undefined
              ),
              known,
              settings.syncServerPrivacyKey
            )
          }
          // The document, its baseline and the cache share this value. The sync
          // adapter replaces collections instead of editing them.
          const legacyData = name === collection ? legacy[collection] : undefined
          document[collection] = (remote === known ? remote.data : remote.data ?? legacyData) ?? document[collection]
          if (remote !== known) collectionCache.put(name, remote.revision, document[collection], cacheIdentity)
          original[collection] = document[collection]
          return [collection, { revision: remote.revision }]
        }))
        let migratedPlaybackSpeeds = false
        if (settings.syncServerSyncSettings &&
            isSettingSyncEnabled(settings, 'channelPlaybackSpeeds')) {
          document.settings = document.settings.slice()
          migratedPlaybackSpeeds = migrateLegacyPlaybackSpeedsToSettings(
            document,
            settings.channelPlaybackSpeeds
          )
        }
        return {
          document,
          original,
          remote: Object.fromEntries(entries),
          uploadCollections,
          migratedPlaybackSpeeds,
          deletionMarks: capabilities.sync_deletions === 1
            ? await tryDeletionMarks(() => downloadDeletionMarks(manifest.collections
                .find(entry => entry.collection === SYNC_DELETION_MARKS_COLLECTION)?.revision ?? 0))
            : null,
        }
      })
      if (unchanged) {
        finishProgress()
        refreshSyncServerAccount(context)
        return null
      }
      client = new EncryptedSyncAdapter(document)
      if (migratedPlaybackSpeeds) {
        client.touched.add('settings')
        migratedPlaybackSpeedsEntry = true
      }
      if (deletionMarks) {
        mergeDeletions = withRemoteSyncDeletions(
          deletions,
          translateSyncDeletionMarks(fromSharedSyncDeletionMarks(readSyncDeletionMarks(deletionMarks.data), dataScope), previous, false)
        )
      }
      encryptedCollections = {
        original,
        remote,
        enabled: enabledCollections,
        upload: uploadCollections,
        shareDeletions: capabilities.sync_deletions === 1,
        deletionMarks,
      }
    }

    const collections = encryptedCollections?.enabled ?? stages.filter(stage => ![
      'download',
      'upload',
      'finishing',
      'settings',
    ].includes(stage))
    for (const collection of collections) {
      try {
        await runStage(collection, () => applyCollection(collection, client))
      } catch (error) {
        if (encryptedCollections && collection === 'playlists' && savedPlaylistIds.size > 0) {
          keepSavedPlaylistsBaseline(previous.playlists ?? {})
          appliedCollections.add(collection)
        }
        throw error
      }
      appliedCollections.add(collection)
    }

    if (encryptedCollections) {
      await runStage('upload', async () => {
        if (encryptedCollections.shareDeletions) {
          const includeKey = key => {
            const collection = parseSyncDeletionListKey(key)?.[1].split(':', 1)[0] ?? ''
            return encryptedCollections.enabled.includes(DELETION_MARK_STAGES[collection] ?? collection)
          }
          const unsent = unsentSyncDeletionMarks.read(deletionMarksAccount)
          const { deletionMarks } = encryptedCollections
          const shared = deletionMarks && await tryDeletionMarks(() => uploadDeletionMarks(deletionMarks, unsent, includeKey))
          // The decisions go once this sync succeeds, so the next ones share the marks.
          if (shared) unsentSyncDeletionMarks.remove(deletionMarksAccount, unsent)
          else unsentSyncDeletionMarks.add(deletionMarksAccount, sharedDeletions, includeKey)
          // Live sync replaces periodic syncs, which then still retry these.
          commit('setSyncServerDeletionMarksPending', unsentSyncDeletionMarks.read(deletionMarksAccount).length > 0)
        }
        for (const collection of encryptedCollections.upload) {
          if (skippedCollections.has(collection)) continue
          assertSyncStillActive()
          let revision = encryptedCollections.remote[collection].revision
          let data = client.document[collection]
          const persistUploaded = async () => {
            if (collection === 'separateProfiles') uploadedSeparateProfiles = data
            if (collection === 'watchStats') await persistUploadedWatchStatsReset(data, store, dataScope)
            if (collection === 'history') await persistUploadedHistoryRepairs(data, store)
          }
          // Untouched collections are still the downloaded value, and history
          // merges only write changed entries. Sending a collection to a worker
          // for comparison would cost more than serializing it here.
          if (revision > 0 && (!client.touched.has(collection) || (collection !== 'history' &&
              JSON.stringify(data) === JSON.stringify(encryptedCollections.original[collection])))) {
            await persistUploaded()
            uploadedCollections.add(collection)
            continue
          }
          startProgress('upload')
          const name = remoteName(collection)
          let activityBefore = encryptedCollections.original[collection]
          let changes = client
          for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
            // Older versions would show the activity of separate profiles as
            // their own. A separate profile's names stay out of shared activity.
            const activity = name !== collection || collection === 'separateProfiles'
              ? null
              : createSyncActivity(
                  collection, activityBefore, data, settings.syncServerDeviceId, settings.syncServerDeviceName,
                  [...(dataScope === null ? [...(encryptedCollections.original.subscriptions ?? []), ...(client.document.subscriptions ?? [])] : []),
                    ...(rootState.profiles.profileList.find(profile => profile._id === MAIN_PROFILE_ID)?.subscriptions ?? [])],
                  dataScope === null
                    ? [...(encryptedCollections.original.playlists ?? []), ...(client.document.playlists ?? [])].map(entry => entry?.playlist)
                    : []
                )
            const activityPayload = activity
              ? await encryptSyncDocument(
                  activity, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt
                )
              : undefined
            try {
              assertSyncStillActive()
              const change = capabilities.collection_changes === 1 && revision > 0
                ? changes.getChange(collection)
                : null
              let saved = null
              if (change) {
                try {
                  // Upload only the edits. Other devices apply them to their copy.
                  saved = await networkClient.appendEncryptedSyncChange(
                    name,
                    revision,
                    await encryptSyncChange(change, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt),
                    activityPayload
                  )
                } catch (error) {
                  // The server asks for a full upload to replace a long change log,
                  // while a device that cannot read changes is signed in (412), or
                  // when a large batch exceeds the change size limit (413).
                  if (error.status !== 412 && error.status !== 413) throw error
                }
              }
              saved ??= await networkClient.putEncryptedSyncCollection(
                name,
                revision,
                await encryptSyncDocument(data, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt),
                activityPayload
              )
              collectionCache.put(name, saved.revision, data, cacheIdentity)
              assertSyncStillActive()
              await persistUploaded()
              uploadedCollections.add(collection)
              break
            } catch (error) {
              if (error.status !== 409 || attempt === ENCRYPTED_SYNC_RETRIES - 1) throw error
              const remote = await readSyncCollection(
                collection,
                await networkClient.getEncryptedSyncCollection(
                  name, capabilities.collection_changes === 1 ? revision : undefined
                ),
                { revision, data: activityBefore },
                settings.syncServerPrivacyKey
              )
              const retryDocument = createEmptySyncDocument()
              const remoteData = remote.data ?? null
              // The download the rejected upload was merged from.
              const base = activityBefore
              activityBefore = remoteData
              if (collection === 'playlistBookmarks') {
                revision = remote.revision
                data = mergePlaylistBookmarkConflict({
                  original: base,
                  local: data,
                  remote: remoteData,
                })
                retryDocument.playlistBookmarks = data
                const retryClient = new EncryptedSyncAdapter(retryDocument)
                const appliedBaseline = retryBaselines.playlistBookmarks
                next.playlistBookmarks = await syncPlaylistBookmarks(
                  retryClient, store, next.playlistBookmarks, { allowDataLoss, deletions: mergeDeletions }
                )
                // The conflict merge also holds unsent local bookmarks, so only
                // the downloaded ones this retry applied join the baseline.
                const downloadedIds = (Array.isArray(remoteData) ? remoteData : [])
                  .map(bookmark => bookmark?.playlist?.id)
                  .filter(id => typeof id === 'string')
                retryBaselines.playlistBookmarks = () => Array.from(new Set([
                  ...(appliedBaseline?.() ?? previous.playlistBookmarks ?? []),
                  ...downloadedIds,
                ]))
                result.playlistBookmarks = next.playlistBookmarks.length
                data = retryClient.document.playlistBookmarks
                changes = retryClient
                continue
              }
              retryDocument[collection] = remoteData
              if (collection !== 'subscriptions') {
                retryDocument.subscriptions = client.document.subscriptions
              }
              const retryClient = new EncryptedSyncAdapter(retryDocument)
              // The retry registers the download as its baseline before applying it
              const appliedBaseline = retryBaselines[collection]
              try {
                if (collection === 'settings') {
                  next.settings = await syncSettings(retryClient, store, next.settings, playlistSnapshot(), {
                    listSnapshot: baseline('settings') ?? {},
                    onRetryBaseline: getBaseline => { retryBaselines.settings = getBaseline },
                    ...settingsScope(),
                  })
                  result.settings = Object.keys(next.settings).length
                } else {
                  await applyCollection(collection, retryClient)
                }
              } catch (error) {
                // Downloaded items it could not save must not look removed here next time
                if (collection === 'playlists') {
                  keepSavedPlaylistsBaseline(appliedBaseline?.() ?? previous.playlists ?? {})
                } else {
                  retryBaselines[collection] = appliedBaseline
                }
                throw error
              }
              if (skippedCollections.has(collection)) break
              revision = remote.revision
              data = retryClient.document[collection]
              changes = retryClient
            }
          }
        }
        // Once no profile lists them, the data of deleted separate profiles goes too.
        if (encryptedCollections.upload.includes('separateProfiles') && !skippedCollections.has('separateProfiles')) {
          await deleteRemovedProfileData()
        }
      })
    }

    await runStage('finishing', async () => {
      const lastSyncAt = Date.now()
      // Copying the baselines to a worker costs more than serializing them.
      const snapshot = JSON.stringify(withoutRemovedScopes(
        writeScopedSnapshot(savedSnapshot, next, scopeKey), rootState.profiles.profileList
      ))
      assertSyncStillActive()
      // Saving the snapshot writes and broadcasts it to every window. Skip that
      // when this sync confirmed the saved baseline.
      await Promise.all([
        snapshot !== rootState.settings.syncServerSnapshot && dispatch('updateSyncServerSnapshot', snapshot, { root: true }),
        dispatch('updateSyncServerLastSyncAt', lastSyncAt, { root: true }),
      ])
    })
    if (encryptedCollections) {
      collectionCache.markSynced(Object.keys(encryptedCollections.remote)
        .filter(collection => !skippedCollections.has(collection)).map(remoteName))
      // The saved baseline now matches this revision of the remote history.
      mergedHistory = takenHistoryChanges === undefined
        ? null
        : { identity: cacheIdentity, scope: scopeKey, revision: collectionCache.latest(remoteName('history'))?.revision }
    }
    if (settings.syncServerResumeAutoSync) {
      await dispatch('setSyncServerAutoSync', true)
    }
    // Lists this sync didn't merge keep their decisions for a sync that does.
    const merged = ([key]) => {
      const stage = DELETION_MARK_STAGES[key.split(':', 1)[0]] ?? key.split(':', 1)[0]
      return appliedCollections.has(stage) && !skippedCollections.has(stage)
    }
    syncDeletions.release(Object.fromEntries(commonDeletions.filter(merged)))
    if (dataScope !== null) syncDeletions.release(Object.fromEntries(scopeDeletions.filter(merged)), dataScope)
    commit('setSyncServerPendingDeletion', null)
    markDataLossNotificationsRead()
    if (progressStarted) commit('setSyncServerLastResult', result)
    if (tabRevocationError) throw tabRevocationError
    finishProgress()
    if (liveSupported) refreshSyncServerAccount(context)
    return result
  } catch (error) {
    if (!(error instanceof SyncServerCancelledError)) {
      try {
        await persistFailedSyncBaselines()
      } catch (persistError) {
        console.error('Failed to save the baselines of a failed sync:', persistError)
      }
    }
    // A failed sync may have uploaded history without saving its baseline.
    mergedHistory = null
    if (takenHistoryChanges !== undefined) historyChanges.restore(takenHistoryChanges)
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
      if (notifyDataLoss) showDataLossToast(true)
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
    // Sync settings reviews these deletions when it opens. The review accepts
    // a choice only after the sync stopped.
    // A separate profile's lists record their deletions in its data.
    if (error instanceof SyncServerDataLossError) {
      commit('setSyncServerPendingDeletion', { ...error.details, ...(dataScope === null ? {} : { dataScope }) })
    }
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
        waitForPendingSync: async () => await scheduler?.waitForActiveSync() ?? false,
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
    commit('setSyncServerDeletionMarksPending', false)
    commit('setSyncServerNotificationDismissalsSupported', null)
    commit('setSyncServerSeparateProfilesSupported', null)
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
          // The server assigns event ids, so recognize replays by the encrypted request
          // itself (its millisecond expiry is unique per send) until it expires.
          receipts = Array.isArray(receipts) ? receipts.filter(receipt => Array.isArray(receipt) && receipt[1] > Date.now()) : []
          const requestId = `${value?.expiresAt}:${value?.videoId}`
          if (validateDeviceRequest(value, settings.syncServerDeviceId) && !receipts.some(([id]) => id === requestId)) {
            const route = `/watch/${value.videoId}?timestamp=${Math.floor(value.position)}`
            // Save the receipt first, so a receipt that cannot be saved never lets the
            // next refresh open the video again. A failed open forgets it for a retry.
            localStorage.setItem(receiptKey, JSON.stringify([...receipts, [requestId, value.expiresAt]]))
            let opened
            try {
              if (process.env.IS_CAPACITOR) {
                const { getCapacitorTabService } = await import('../../tabs/CapacitorTabService')
                opened = await getCapacitorTabService().createTab(route, value.title, false)
              } else {
                opened = await window.ftElectron.tabs.create({ route, title: value.title, makeActive: false })
              }
            } finally {
              if (!opened) localStorage.setItem(receiptKey, JSON.stringify(receipts))
            }
            if (!opened) throw new Error('Unable to open the received video')
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
    await whenSyncServerSnapshotLoaded()

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
          const remote = await readSyncCollection(
            'sessionsV2', await client.getEncryptedSyncCollection('sessionsV2', 0), null, settings.syncServerPrivacyKey
          )
          let remoteValue = remote.data ?? null

          if (remoteValue === null) {
            const legacy = await readSyncCollection(
              'sessions', await client.getEncryptedSyncCollection('sessions', 0), null, settings.syncServerPrivacyKey
            )
            remoteValue = legacy.data ?? null
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

  replaceSyncWatchStatsDevice({ commit, dispatch, rootGetters, rootState }, { source, overlap, localDays, currentDays, replacedDevices, localReset, previewScope }) {
    const settings = { ...rootState.settings }
    if (!settings.syncServerEnabled || !settings.syncServerToken ||
        settings.syncServerPrivacyMode !== 'enhanced' || !settings.syncServerPrivacyKey ||
        !settings.syncServerSyncWatchStats) {
      throw new Error('Connect to the sync server first')
    }
    // The statistics of the data the store shows, with their own reset. A
    // preview of another profile's statistics would replace this one's.
    const dataScope = shownDataScope(rootGetters)
    if (dataScope === undefined || (previewScope !== undefined && previewScope !== dataScope)) throw new SyncServerCancelledError()
    const scopeKey = syncScopeKey(dataScope)
    const collection = scopedSyncCollection('watchStats', scopeKey)
    const savedReset = savedWatchStatsReset(settings, dataScope)
    const assertCurrentAccount = client => {
      assertSyncEnabled(rootState, client)
      if (activityAccountKey(rootState.settings) !== activityAccountKey(settings) ||
          rootState.settings.syncServerToken !== settings.syncServerToken ||
          !rootState.settings.syncServerSyncWatchStats ||
          shownDataScope(rootGetters) !== dataScope) throw new SyncServerCancelledError()
    }
    return withSyncLock(async () => {
      await whenSyncServerSnapshotLoaded()
      const client = trackSyncClient(new SyncServerClient(settings.syncServerUrl, settings.syncServerToken))
      try {
        for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
          assertCurrentAccount(client)
          const remote = await readSyncCollection(
            'watchStats', await client.getEncryptedSyncCollection(collection, 0), null, settings.syncServerPrivacyKey
          )
          const devices = remote.data ?? []
          const records = await DBWatchStatsHandlers.find()
          const days = Object.fromEntries(records.map(record => [record.date, record.seconds]))
          const current = devices.find(device => containsWatchStatsDevice(device, settings.syncServerDeviceId))
          const previous = devices.find(device => device.deviceId === source.deviceId)
          assertCurrentAccount(client)
          if (!areJsonValuesEqual(previous, source) || !areJsonValuesEqual(days, localDays) ||
              !areJsonValuesEqual(current?.replacedDevices ?? [], replacedDevices) ||
              !areJsonValuesEqual(savedWatchStatsReset(rootState.settings, dataScope), localReset) ||
              !areJsonValuesEqual(current ? watchStatsDeviceDays(current, settings.syncServerDeviceId, days, localReset) : days, currentDays)) {
            commit('setSyncedWatchStats', devices)
            throw new Error(i18n.global.t('Stats.Replacement changed'))
          }
          const merged = mergeWatchStats(devices, records, settings.syncServerDeviceId,
            settings.syncServerDeviceName, current?.platform, savedReset)
          const next = replaceWatchStatsDevice(merged, settings.syncServerDeviceId, source.deviceId, overlap, Date.now())
          const payload = await encryptSyncDocument(next, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt)
          assertCurrentAccount(client)
          let saved
          try {
            saved = await client.putEncryptedSyncCollection(collection, remote.revision, payload)
          } catch (error) {
            if (error.status === 409 && attempt < ENCRYPTED_SYNC_RETRIES - 1) continue
            throw error
          }
          assertCurrentAccount(client)
          collectionCache.put(collection, saved.revision, next)
          assertCurrentAccount(client)
          const snapshot = parseSnapshot(rootState.settings.syncServerSnapshot)
          await dispatch('updateSyncServerSnapshot', JSON.stringify(writeScopedSnapshot(
            snapshot, { ...readScopedSnapshot(snapshot, scopeKey), watchStats: next }, scopeKey
          )), { root: true })
          // The profile switched to meanwhile shows its own statistics.
          if (shownDataScope(rootGetters) === dataScope) commit('setSyncedWatchStats', next)
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
    { mode, serverUrl, username, password, token: oidcToken, privacyPassphrase, deviceId, deviceName, deviceSystemInfo }
  ) {
    if (mode !== 'login' && mode !== 'register' && mode !== 'oidc') {
      throw new Error('Invalid authentication mode')
    }
    if (!rootState.settings.syncServerEnabled) {
      throw new Error('Enable sync first')
    }

    const oidc = mode === 'oidc'
    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const trimmedUsername = oidc ? syncServerOidcUsername(oidcToken) : username.trim()
    const previousToken = rootState.settings.syncServerToken
    const resumesExpiredSession = isExpiredSessionReauthentication({
      expired: state.syncServerSessionExpired,
      savedServerUrl: rootState.settings.syncServerUrl,
      savedUsername: rootState.settings.syncServerUsername,
      serverUrl: normalizedUrl,
      username: trimmedUsername,
    })
    if (!trimmedUsername || (!oidc && !password) || !deviceId || !deviceName || !deviceSystemInfo) {
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
      assertPrivacyPassphrase(privacySupported, privacyPassphrase, password)
      let token
      if (oidc) {
        token = oidcToken
        client.token = token
        // Anyone can send the app a callback link. A session the server opened
        // for this device's ID proves that this device started the sign-in.
        // The login button only appears on servers that list sessions.
        const { sessions } = await client.getAccountSessions()
        if (sessions?.find(session => session.current)?.device_id !== deviceId) {
          throw new Error('This sign-in was not started on this device')
        }
      } else {
        token = await client.authenticate(mode, trimmedUsername, password, deviceId)
      }
      let privacyKey = ''
      let privacySalt = ''

      if (privacySupported) {
        const manifest = await client.getEncryptedSyncManifest()
        const firstCollection = manifest.collections[0]?.collection
        const remote = firstCollection
          // Older servers ignore `since`. Newer ones refuse reads without it
          // while the collection has appended changes.
          ? await client.getEncryptedSyncCollection(firstCollection, 0)
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

  async loginSyncServerWithOidc(
    { commit, dispatch, rootState },
    { serverUrl, privacyPassphrase, deviceId, deviceName, deviceSystemInfo }
  ) {
    if (!rootState.settings.syncServerEnabled) {
      throw new Error('Enable sync first')
    }
    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const client = trackSyncClient(new SyncServerClient(normalizedUrl))
    let checksState
    try {
      // Check the passphrase before the user signs in at the provider.
      assertPrivacyPassphrase(await client.supportsEncryptedSync(), privacyPassphrase, '')
      checksState = await client.returnsOidcState()
    } finally {
      releaseSyncClient(client)
    }

    const state = createSyncServerOidcState()
    const callbackUrl = await runOidcFlow(
      commit,
      'login',
      syncServerOidcLoginUrl(normalizedUrl, deviceId, state),
      checksState ? state : null
    )
    const token = getSyncServerOidcCallbackToken(callbackUrl)
    if (!token) throw new Error('The sync server did not complete the sign-in')
    return dispatch('authenticateSyncServer', {
      mode: 'oidc',
      serverUrl: normalizedUrl,
      token,
      privacyPassphrase,
      deviceId,
      deviceName,
      deviceSystemInfo,
    })
  },

  /** @returns {boolean} whether an OIDC flow was waiting for the callback */
  receiveSyncServerOidcCallback(_context, url) {
    return oidcCallbacks.receive(url)
  },

  cancelSyncServerOidc() {
    oidcCallbacks.cancel(new SyncServerCancelledError())
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

  /**
   * App data restored from a backup or another device keeps that
   * installation's sync sign-in, keys, and device ID, so the two would sync
   * as one device. This one signs in again as a new device instead.
   */
  async forgetRestoredSyncServerDevice({ commit, dispatch, rootState }) {
    const { syncServerToken, syncServerDeviceId } = rootState.settings
    forgetSyncDeviceId()
    if (!syncServerToken && !syncServerDeviceId) return
    await dispatch('disconnectSyncServer')
    if (rootState.settings.syncServerToken) {
      // Saving failed. Keep the token out of this session; the next launch tries again.
      commit('setSyncServerToken', '')
      throw new Error('Could not sign restored app data out of sync')
    }
    await dispatch('updateSyncServerDeviceId', '', { root: true })
    await dispatch('updateSyncServerDeviceName', '', { root: true })
    if (syncServerToken) commit('setSyncServerError', SYNC_SERVER_RESTORED_DEVICE_MESSAGE)
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
    commit('setSyncServerPendingDeletion', null)
    markDataLossNotificationsRead()
    syncDeletions.clear()
    unsentSyncDeletionMarks.clear()
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

  async deleteSyncServerOidcAccount({ commit, dispatch, rootState }) {
    if (!rootState.settings.syncServerToken) {
      throw new Error('Connect to a sync server first')
    }

    const { syncServerUrl: url, syncServerToken: token, syncServerUsername: username } = rootState.settings
    let client = trackSyncClient(new SyncServerClient(url, token))
    const state = createSyncServerOidcState()
    let authorizationUrl
    let checksState
    try {
      checksState = await client.returnsOidcState()
      authorizationUrl = await client.startOidcAccountDeletion(SYNC_SERVER_OIDC_REDIRECT_URL, state)
    } finally {
      releaseSyncClient(client)
    }
    await runOidcFlow(commit, 'delete', authorizationUrl, checksState ? state : null)

    // The callback carries no proof, but the server reports the deleted
    // account. A 401 only means the session ended, for example because another
    // device signed this one out. A sync may have noticed the deletion first
    // and expired the session, which keeps the account's saved state.
    client = trackSyncClient(new SyncServerClient(url, token))
    try {
      try {
        await (await client.supportsAccountSessions()
          ? client.getAccountSessions()
          : client.getSubscriptions())
      } catch (error) {
        if (!isAccountDeletedError(error)) throw error
        assertSyncEnabled(rootState, client)
        const { syncServerUrl, syncServerUsername } = rootState.settings
        if (syncServerUrl === url && syncServerUsername === username) await dispatch('disconnectSyncServer')
        return
      }
      throw new Error('The sync account was not deleted')
    } finally {
      releaseSyncClient(client)
    }
  },

  syncWithSyncServer(context, options = {}) {
    return getScheduler(context).sync(options)
  },

  /**
   * Applies the user's choice for the deletions the last sync stopped at, then
   * syncs again. Deletions in other lists still need their own review.
   * @param {'delete' | 'keep'} choice
   */
  async resolveSyncServerDeletion({ commit, dispatch, state }, choice) {
    const pending = state.syncServerPendingDeletion
    if (!pending) return null
    const deletionKey = syncDeletionKey(pending.collection, pending.scope)
    const key = syncDeletionListKey(deletionKey, isScopedSyncDeletionKey(deletionKey) ? pending.dataScope ?? null : null)
    const ids = pending.items.map(item => item.id)
    if (choice === 'keep') syncDeletions.keep(key, ids)
    else syncDeletions.confirm(key, ids)
    commit('setSyncServerPendingDeletion', null)
    return await dispatch('syncWithSyncServer', { notifyDataLoss: false })
  },

  dismissSyncServerDeletion({ commit }) {
    commit('setSyncServerPendingDeletion', null)
  },

  /** Shows the synced data of the profile switched to and syncs it */
  async applySyncServerDataScope({ commit, dispatch, rootGetters, rootState }) {
    const settings = rootState.settings
    if (!settings.syncServerEnabled || !settings.syncServerToken) return
    await whenSyncServerSnapshotLoaded()
    commit('setSyncedWatchStats', syncedWatchStatsOf(parseSnapshot(settings.syncServerSnapshot), rootGetters))
    return dispatch('scheduleSyncServer', 'data')
  },

  async initializeSyncServer({ commit, dispatch, rootGetters, rootState, state }, { skipIfRecent = true } = {}) {
    if (!reminderSyncListenerStarted && (process.env.IS_ELECTRON || process.env.IS_CAPACITOR)) {
      reminderSyncListenerStarted = true
      liveReminder.onUpdated(() => dispatch('scheduleSyncServer', 'liveReminders'))
    }
    if (!notificationSyncListenerStarted && (process.env.IS_ELECTRON || process.env.IS_CAPACITOR)) {
      notificationSyncListenerStarted = true
      notificationHistory.onDismissed(() => dispatch('scheduleSyncServer', 'notificationDismissals'))
    }
    if (!lifecycleSyncStarted && typeof window !== 'undefined') {
      lifecycleSyncStarted = true
      connectionEvents.addEventListener('change', ({ detail }) => {
        if (detail === 'offline') {
          cancelActiveSyncClients()
          dispatch('stopSyncServerLive')
        } else if (detail === 'restored') {
          const settings = rootState.settings
          // Android freezes a hidden app, which could leave the offline edits unsent.
          const releaseHold = settings.syncServerEnabled && settings.syncServerToken && settings.syncServerAutoSync &&
            isSyncReasonEnabled(settings, 'automatic')
            ? holdAndroidBackgroundWork()
            : () => {}
          const sync = (async () => {
            try {
              // A reconnect must start a fresh sync after cancellation finishes.
              await scheduler?.waitForActiveSync()
              dispatch('startSyncServerLive')
              if (rootState.settings.syncServerAutoSync &&
                  isSyncReasonEnabled(rootState.settings, 'automatic')) {
                await dispatch('initializeSyncServer', { skipIfRecent: false })
              }
            } catch (error) {
              console.error('Sync server reconnect sync failed', error)
            } finally {
              releaseHold()
              if (reconnectSync === sync) reconnectSync = null
            }
          })()
          reconnectSync = sync
        }
      })
      // Live notifications stop while the app is hidden; check periodically instead.
      onPeriodicBackgroundTask(async () => {
        const settings = rootState.settings
        if (!settings.syncServerEnabled || !settings.syncServerAutoSync || !settings.syncServerToken ||
            !isSyncReasonEnabled(settings, 'automatic')) return
        // Android blocks a hidden app's network, so a connection that returned
        // while hidden still counts as lost until the app is shown. This job runs
        // with network access. A regained connection publishes 'restored', whose
        // full sync uploads the edits made offline; the job waits for it.
        if (isSyncServerOffline() && (!await checkConnection() || isSyncServerOffline())) return
        if (reconnectSync) return reconnectSync
        // A recent success does not cover a sync that failed since, which may
        // have left offline edits unsent.
        return dispatch('syncWithSyncServer', { skipIfRecent: state.syncServerStatus !== 'error', automatic: true, remoteOnly: true })
      })
      // Swiping the app away stops syncing until it opens again, so pending
      // edits sync as soon as the user may be leaving it.
      onAndroidWindowBlur(() => dispatch('flushPendingSyncServerEdits'))
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

    await whenSyncServerSnapshotLoaded()
    const snapshot = parseSnapshot(rootState.settings.syncServerSnapshot)
    commit('setSyncedWatchStats', syncedWatchStatsOf(snapshot, rootGetters))
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
        commit('setSyncServerNotificationDismissalsSupported', privacySupported && capabilities.notification_dismissals === 1)
        commit('setSyncServerSeparateProfilesSupported', privacySupported && supportsSeparateProfiles(capabilities))
        if (!watchStatsSupported && rootState.settings.syncServerSyncWatchStats) {
          const account = getSyncAccount(rootState.settings)
          await withSyncLock(async () => {
            const sameAccount = () => isSameSyncAccount(rootState.settings, account)
            if (!sameAccount()) throw new SyncServerCancelledError()
            // A different window may have synced while this initializer waited.
            // Read the shared datastore after acquiring the sync lock, rather
            // than trusting a renderer snapshot whose IPC update is still queued.
            const snapshot = await DBSettingHandlers.findValue('syncServerSnapshot') ?? '{}'
            if (!sameAccount()) throw new SyncServerCancelledError()
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
      // Remote-only syncs skip unchanged collections unless the last sync failed,
      // so this keeps the next background sync from skipping offline edits.
      commit('setSyncServerStatus', 'error')
      return
    }

    await dispatch('startSyncServerAutoSync')
    if (rootState.settings.syncServerAutoSync) {
      await dispatch('syncWithSyncServer', { skipIfRecent, automatic: true })
    } else if (rootState.settings.syncServerResumeAutoSync) {
      // The review of the deletions that paused automatic sync lives only in
      // the window whose sync stopped. Check again, so it returns after a
      // restart or a sync in the background, and automatic sync resumes once
      // nothing would be deleted anymore.
      try {
        await dispatch('syncWithSyncServer', { notifyDataLoss: false })
      } catch (error) {
        if (!(error instanceof SyncServerDataLossError)) throw error
        // Other windows already know, so a new window does not notify them again.
        showDataLossToast(false)
      }
    }
  },

  startSyncServerAutoSync(context) {
    getScheduler(context).start()
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
    commit('setSyncServerDeletionMarksPending', false)
    commit('setSyncServerNotificationDismissalsSupported', null)
    commit('setSyncServerSeparateProfilesSupported', null)
    commit('setSyncedWatchStats', [])
    clearSyncServerDevices(commit)
    await dispatch('updateSyncServerToken', token, { root: true })
  },

  restartSyncServerAutoSync(context) {
    getScheduler(context).restart()
  },

  stopSyncServerAutoSync(context) {
    getScheduler(context).stop()
  },

  scheduleSyncServer(context, reason) {
    getScheduler(context).schedule(reason)
  },

  flushPendingSyncServerEdits(context) {
    getScheduler(context).flush()
  },

  resumeHiddenEventSyncs(context) {
    getScheduler(context).resumeHidden()
  },

  async setSyncServerAutoSync({ dispatch }, enabled) {
    await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
    await dispatch('updateSyncServerAutoSync', enabled, { root: true })
    await dispatch(enabled ? 'startSyncServerAutoSync' : 'stopSyncServerAutoSync')
  },

  async applySyncServerEnabled({ commit, dispatch, rootState }, enabled) {
    if (!enabled) {
      cancelActiveSyncClients()
      oidcCallbacks.cancel(new SyncServerCancelledError())
      await dispatch('stopSyncServerAutoSync')
      await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
      commit('setSyncServerProgress', null)
      commit('setSyncServerError', '')
      commit('setSyncServerStatus', 'idle')
      commit('setSyncServerOtherDeviceSessions', [])
      commit('setSyncedWatchStats', [])
      commit('setSyncServerWatchStatsSupported', null)
      commit('setSyncServerLiveRemindersSupported', null)
      commit('setSyncServerNotificationDismissalsSupported', null)
      commit('setSyncServerSeparateProfilesSupported', null)
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
  setSyncServerDeletionMarksPending(state, pending) {
    state.syncServerDeletionMarksPending = pending
  },
  setSyncServerOidcPending(state, kind) {
    state.syncServerOidcPending = kind
  },
  setSyncServerNotificationDismissalsSupported(state, supported) {
    state.syncServerNotificationDismissalsSupported = supported
  },
  setSyncServerSeparateProfilesSupported(state, supported) {
    state.syncServerSeparateProfilesSupported = supported
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
  setSyncServerPendingDeletion(state, details) {
    state.syncServerPendingDeletion = details
  },
}

export default { state, getters, actions, mutations }
