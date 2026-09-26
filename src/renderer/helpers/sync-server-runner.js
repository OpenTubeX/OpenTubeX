import { createSyncActivity } from './sync-server-live'
import {
  SyncServerClient,
  SyncServerCancelledError,
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
} from './sync-server'
import {
  EncryptedSyncAdapter,
  createEmptySyncDocument,
  decryptLegacySyncDocument,
  decryptSyncDocument,
  encryptSyncDocument,
  loadLegacySyncDocument,
  migrateLegacyPlaybackSpeedsToSettings,
} from './sync-server-privacy'
import { mergePlaylistBookmarkConflict } from './playlist-bookmarks'
import { getPreviousSyncSessions } from './sync-sessions'
import { dispatchRemoteSyncAction } from './sync-server-scheduling'
import { isSettingSyncEnabled } from '../store/modules/settings'
import { syncSubscriptionSeenVideos, syncSubscriptionSeenPosts } from './subscription-seen-videos'
import { syncWatchStats } from './sync-watch-stats'
import { getInitialSyncStages, planEncryptedSyncCollections } from './sync-server-plan.js'
import { MAIN_PROFILE_ID } from '../../constants'

/**
 * Keep the store's client lifecycle and mutations outside the protocol runner.
 * Each dependency belongs to the Vuex adapter rather than the remote protocol.
 *
 * @param {object} dependencies
 * @param {import('./sync-server-live').SyncCollectionCache} dependencies.collectionCache
 * @param {(client: import('./sync-server').SyncServerClient) => import('./sync-server').SyncServerClient} dependencies.trackSyncClient
 * @param {(client: import('./sync-server').SyncServerClient) => void} dependencies.releaseSyncClient
 * @param {(value: string) => object} dependencies.parseSnapshot
 * @param {(context: object) => Promise<void>} dependencies.clearUnsupportedWatchStats
 * @param {(rootState: object, client: import('./sync-server').SyncServerClient) => void} dependencies.assertSyncEnabled
 * @param {(settings: object) => boolean} dependencies.requiresEncryptedSync
 * @param {(supported: boolean, required: boolean) => void} dependencies.assertEncryptionSupported
 * @param {(message: string, duration: number, icon: string[], action: string) => void} dependencies.showToastOnAllTabs
 * @param {object} dependencies.i18n
 * @param {number} dependencies.encryptedSyncRetries
 * @returns {(context: object, options?: object) => Promise<object | null>}
 */
export function createSyncRunner({
  collectionCache,
  trackSyncClient,
  releaseSyncClient,
  parseSnapshot,
  clearUnsupportedWatchStats,
  assertSyncEnabled,
  requiresEncryptedSync,
  assertEncryptionSupported,
  showToastOnAllTabs,
  i18n,
  encryptedSyncRetries,
}) {
  return async function runSync(context, { allowDataLoss = false, notifyDataLoss = true, automatic = false, remoteOnly = false } = {}) {
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
    const result = {}
    const store = {
      state: rootState,
      getters: rootGetters,
      commit,
      dispatch: (...args) => dispatchRemoteSyncAction(dispatch, ...args),
    }
    const stages = getInitialSyncStages(settings, {
      encrypted,
      supportsSessions: Boolean(process.env.IS_ELECTRON || process.env.IS_CAPACITOR)
    })
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
          const sessions = await syncSessions(
            targetClient,
            store,
            getPreviousSyncSessions(previous)
          )
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
      const capabilities = await networkClient.getCapabilities()
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
      assertEncryptionSupported(capabilities.encrypted_sync === 1, encrypted)
      const liveSupported = encrypted && capabilities.live_sync === 1
      commit('setSyncServerLiveSupported', liveSupported)
      if (encrypted) {
        if (settings.syncServerSyncHistory && await networkClient.supportsSeenVideosSync()) {
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
          const { upload: uploadCollections, download: downloadCollections } = planEncryptedSyncCollections({
            enabled: enabledCollections,
            manifest,
            hasLegacyEncryptedPayload: Boolean(legacyEncrypted?.payload),
          })
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
              ? collectionCache.get(collection, manifestRevision)
              : null
            if (!cached) startProgress('download')
            const response = cached ?? await networkClient.getEncryptedSyncCollection(collection)
            const data = cached
              ? cached.data
              : response.payload
                ? await decryptSyncDocument(response.payload, settings.syncServerPrivacyKey)
                : legacy[collection]
            document[collection] = data ?? document[collection]
            collectionCache.put(collection, response.revision, document[collection])
            original[collection] = structuredClone(document[collection])
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
          await dispatch('refreshSyncServerEvents')
          await dispatch('refreshSyncServerDevices')
          finishProgress()
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
            assertSyncStillActive()
            let revision = encryptedCollections.remote[collection].revision
            let data = client.document[collection]
            if (revision > 0 &&
                JSON.stringify(data) === JSON.stringify(encryptedCollections.original[collection])) {
              continue
            }
            startProgress('upload')
            let activityBefore = encryptedCollections.original[collection]
            for (let attempt = 0; attempt < encryptedSyncRetries; attempt++) {
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
                const saved = await networkClient.putEncryptedSyncCollection(collection, revision, payload, activityPayload)
                collectionCache.put(collection, saved.revision, data)
                break
              } catch (error) {
                if (error.status !== 409 || attempt === encryptedSyncRetries - 1) throw error
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
      if (encryptedCollections) collectionCache.markSynced(Object.keys(encryptedCollections.remote))
      if (liveSupported) {
        await dispatch('refreshSyncServerEvents')
        await dispatch('refreshSyncServerDevices')
      }
      if (settings.syncServerResumeAutoSync) {
        await dispatch('setSyncServerAutoSync', true)
      }
      if (progressStarted) commit('setSyncServerLastResult', result)
      finishProgress()
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
}
