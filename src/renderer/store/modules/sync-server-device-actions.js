import { validateDeviceRequest } from '../../helpers/sync-server-live'
import i18n from '../../i18n/index'
import {
  SyncServerClient,
  SyncServerCancelledError,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  getSavedOtherDeviceSessions,
  isSessionExpiredError,
} from '../../helpers/sync-server'
import {
  decryptSyncDocument,
  encryptSyncDocument,
} from '../../helpers/sync-server-privacy'
import { getSyncTabRoute, removeSyncDeviceSessions, removeSyncSession } from '../../helpers/sync-sessions'
import { containsWatchStatsDevice, mergeWatchStats, replaceWatchStatsDevice, watchStatsDeviceDays } from '../../helpers/sync-watch-stats'
import { areJsonValuesEqual } from '../../helpers/jsonValues'
import { DBWatchStatsHandlers } from '../../../datastores/handlers/index'
import {
  ENCRYPTED_SYNC_RETRIES,
  activityAccountKey,
  assertSyncEnabled,
  collectionCache,
  parseSnapshot,
  releaseSyncClient,
  trackSyncClient,
  withSyncLock,
} from './sync-server-run'

/** Sync-server store actions that send videos to, open, or clean up data of the account's other devices. */
export const deviceActions = {
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
}
