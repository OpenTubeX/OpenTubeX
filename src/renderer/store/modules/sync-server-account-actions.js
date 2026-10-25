import {
  SyncServerClient,
  SyncServerCancelledError,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  isExpiredSessionReauthentication,
  normalizeSyncServerUrl,
} from '../../helpers/sync-server'
import { preparePrivacyKey } from '../../helpers/sync-server-privacy'
import { encryptSyncServerDeviceInfo } from '../../helpers/sync-server-sessions'
import {
  assertEncryptionSupported,
  assertSyncEnabled,
  releaseSyncClient,
  requiresEncryptedSync,
  trackSyncClient,
} from './sync-server-run'

/** Sync-server store actions that sign in, pair, expire, disconnect, or delete the account. */
export const accountActions = {
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
}
