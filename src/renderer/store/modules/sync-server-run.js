import { runBackgroundJob } from '../../helpers/background-jobs.js'
import { SyncCollectionCache, createSyncActivity } from '../../helpers/sync-server-live'
import i18n from '../../i18n/index'
import { showToastOnAllTabs } from '../../helpers/utils'
import {
  SyncServerClient,
  SyncServerCancelledError,
  SyncServerTabRevocationPendingError,
  SyncServerDataLossError,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  isSessionExpiredError,
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
} from '../../helpers/sync-server-privacy'
import { mergePlaylistBookmarkConflict } from '../../helpers/playlist-bookmarks'
import { getPreviousSyncSessions } from '../../helpers/sync-sessions'
import {
  AUTO_SYNC_INTERVAL_MS,
  dispatchRemoteSyncAction,
} from '../../helpers/sync-server-scheduling'
import { isSettingSyncEnabled } from './settings'
import { syncSubscriptionSeenVideos, syncSubscriptionSeenPosts } from '../../helpers/subscription-seen-videos'
import { persistUploadedWatchStatsReset, syncWatchStats } from '../../helpers/sync-watch-stats'
import { syncLiveReminders } from '../../helpers/sync-live-reminders'
import { MAIN_PROFILE_ID } from '../../../constants'

// A full sync pass of the sync-server store module, and the client, lock, and
// snapshot helpers that its action modules share.
export const ENCRYPTED_SYNC_RETRIES = 3
const LEGACY_ENCRYPTED_COLLECTIONS = [
  'subscriptions',
  'playlists',
  'history',
  'profiles',
  'playlistBookmarks',
]

export const collectionCache = new SyncCollectionCache(value => runBackgroundJob('clone', { value }))
let syncCapabilities = null
const activeSyncClients = new Set()

export function activityAccountKey(settings) {
  // NeDB rejects dots in field names. A JSON escape preserves the account identity.
  return JSON.stringify([settings.syncServerUrl,
    settings.syncServerUsername, settings.syncServerDeviceId]).replaceAll('.', '\\u002e')
}

export function trackSyncClient(client) {
  activeSyncClients.add(client)
  return client
}

export function releaseSyncClient(client) {
  activeSyncClients.delete(client)
}

export function cancelActiveSyncClients() {
  for (const client of activeSyncClients) client.cancel()
}

export function assertSyncEnabled(rootState, client) {
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

let parsedSnapshot = { value: undefined, snapshot: {} }

/**
 * The snapshot holds a baseline for every synced history entry and is read
 * by each sync. Parse an unchanged value only once. Callers receive a copy of
 * its top level, as they replace or delete collections but never edit them.
 */
export function parseSnapshot(value) {
  if (value !== parsedSnapshot.value) {
    let snapshot
    try {
      snapshot = JSON.parse(value)
    } catch {}
    parsedSnapshot = { value, snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {} }
  }
  return { ...parsedSnapshot.snapshot }
}

export async function clearUnsupportedWatchStats({ commit, dispatch, rootState }, snapshotValue = rootState.settings.syncServerSnapshot) {
  commit('setSyncedWatchStats', [])
  const snapshot = parseSnapshot(snapshotValue)
  if (!('watchStats' in snapshot)) return
  delete snapshot.watchStats
  await dispatch('updateSyncServerSnapshot', JSON.stringify(snapshot), { root: true })
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

export function withSyncLock(callback) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('opentubex-sync-server', callback)
  }
  return callback()
}

export function requiresEncryptedSync(settings) {
  // A key may survive a privacy-mode downgrade made by an older app version.
  return settings.syncServerPrivacyMode === 'enhanced' || Boolean(settings.syncServerPrivacyKey)
}

export async function getSyncServerCapabilities(client, { refresh = false, requiredCapabilities = [] } = {}) {
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

export function clearSyncServerCapabilities() {
  syncCapabilities = null
}

export function assertEncryptionSupported(supported, required) {
  if (required && !supported) {
    throw new Error('This account requires encrypted sync, but the server no longer supports it')
  }
}

export async function runSync(context, { allowDataLoss = false, notifyDataLoss = true, automatic = false, remoteOnly = false } = {}) {
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
    async persistPlaylistSyncBaseline(id, { remoteId, metadata, applied = false, videos: syncedVideos, added = [], removed = [] }) {
      // Encrypted adapter mutations are only published in the final upload.
      if (encrypted) return
      const current = rootState.settings
      if (![current.syncServerUrl, current.syncServerToken, current.syncServerPrivacyMode,
        current.syncServerPrivacyKey, current.syncServerPrivacySalt].every((value, index) => value === historyAccount[index])) return
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
        if (updated !== snapshot) await dispatch('updateSyncServerSnapshot', updated, { root: true })
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
          // Takeout only supplies video IDs. Encrypted sync can carry unknown
          // uploaders; the legacy server requires real channel metadata.
          { allowDataLoss, allowMissingUploader: encrypted }
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
          // Imported playlist videos can enter history without uploader metadata.
          { allowDataLoss, allowMissingUploader: encrypted }
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
            if (collection === 'history') await persistUploadedHistoryRepairs(data, store)
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
              if (collection === 'history') await persistUploadedHistoryRepairs(data, store)
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
      // Saving the snapshot writes and broadcasts it to every window. Skip that
      // when this sync confirmed the saved baseline.
      await Promise.all([
        snapshot !== rootState.settings.syncServerSnapshot && dispatch('updateSyncServerSnapshot', snapshot, { root: true }),
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
