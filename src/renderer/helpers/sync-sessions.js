import { areJsonValuesEqual } from './jsonValues.js'

export const SYNC_SESSIONS_VERSION = 1

// Account device IDs are base64url, so this reserved key cannot name a device.
// Keeping these markers in the existing map lets older clients preserve them.
const REVOCATION_KEY_PREFIX = 'revoked:'
const REVOCATION_LOGIN_KEY_PREFIX = 'revoked-login:'

function revocationKey(deviceId) {
  return `${REVOCATION_KEY_PREFIX}${deviceId}`
}

export function getSyncTabRoute(value) {
  if (typeof value !== 'string' || value.length === 0) return '/'

  try {
    const url = new URL(value, 'https://opentubex.invalid')
    // Electron stores the route in the app shell's hash; Capacitor uses paths.
    if ((url.pathname === '/' || url.pathname === '/index.html') && url.hash.startsWith('#/')) {
      return url.hash.slice(1)
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

function clone(value) {
  return structuredClone(value)
}

function latestSessionUpdate(sessions) {
  return sessions.reduce((latest, session) => (
    Number.isFinite(session?.updatedAt) ? Math.max(latest, session.updatedAt) : latest
  ), 0)
}

function normalizeSessions(value) {
  return Array.isArray(value) ? clone(value) : []
}

function normalizeDeletedSessions(value) {
  const deletedSessions = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return deletedSessions

  for (const [deviceId, sessionIds] of Object.entries(value)) {
    if (!Array.isArray(sessionIds)) continue
    const normalized = Array.from(new Set(
      sessionIds.filter(sessionId => typeof sessionId === 'string' && sessionId.length > 0)
    ))
    if (normalized.length > 0) deletedSessions[deviceId] = normalized
  }
  for (const [key, sessionIds] of Object.entries(deletedSessions)) {
    if (!key.startsWith(REVOCATION_KEY_PREFIX)) continue
    const deviceId = key.slice(REVOCATION_KEY_PREFIX.length)
    deletedSessions[key] = deletedSessions[`${REVOCATION_LOGIN_KEY_PREFIX}${deviceId}`]
      ? sessionIds.filter(id => deletedSessions[deviceId]?.includes(id))
      : []
    if (deletedSessions[key].length === 0) delete deletedSessions[key]
  }
  return deletedSessions
}

function withoutDeletedSessions(sessions, deletedSessionIds = []) {
  const deleted = new Set(deletedSessionIds)
  return sessions.filter(session => !deleted.has(session?.sessionId))
}

export function normalizeSyncSessionsDocument(value) {
  if (Array.isArray(value)) {
    return {
      version: SYNC_SESSIONS_VERSION,
      mode: 'separate',
      devices: value.length > 0
        ? { 'legacy-desktop': { platform: 'desktop', sessions: clone(value) } }
        : {},
      shared: [],
      deletedSessions: {},
    }
  }

  const deletedSessions = normalizeDeletedSessions(value?.deletedSessions)
  const devices = {}
  if (value?.devices && typeof value.devices === 'object' && !Array.isArray(value.devices)) {
    for (const [deviceId, device] of Object.entries(value.devices)) {
      if (!device || (device.platform !== 'desktop' && device.platform !== 'mobile')) continue
      devices[deviceId] = {
        platform: device.platform,
        sessions: withoutDeletedSessions(
          normalizeSessions(device.sessions),
          deletedSessions[deviceId]
        ),
      }
    }
  }

  return {
    version: SYNC_SESSIONS_VERSION,
    mode: value?.mode === 'shared' ? 'shared' : 'separate',
    devices,
    shared: normalizeSessions(value?.shared),
    deletedSessions,
  }
}

export function getOtherDeviceSessions(value, deviceId, legacyDeviceIds = []) {
  const document = normalizeSyncSessionsDocument(value)
  const currentDeviceIds = new Set([deviceId, ...legacyDeviceIds])
  return Object.entries(document.devices)
    .filter(([id]) => !currentDeviceIds.has(id))
    .flatMap(([id, device]) => device.sessions.map(session => ({
      ...clone(session),
      syncDeviceId: id,
      syncPlatform: device.platform,
    })))
}

export function getRevokedSyncSessionLogins(value, deviceId) {
  return normalizeSyncSessionsDocument(value).deletedSessions[`${REVOCATION_LOGIN_KEY_PREFIX}${deviceId}`] ?? []
}

export function removeSyncSession(value, deviceId, sessionId, { revokedAccountSessionId } = {}) {
  const document = normalizeSyncSessionsDocument(value)
  const device = document.devices[deviceId]
  const key = revocationKey(deviceId)
  const loginKey = `${REVOCATION_LOGIN_KEY_PREFIX}${deviceId}`
  const revoked = typeof revokedAccountSessionId === 'string' && revokedAccountSessionId.length > 0
  const alreadyDeleted = document.deletedSessions[deviceId]?.includes(sessionId)
  if (revoked && (!alreadyDeleted || document.deletedSessions[key]?.includes(sessionId))) {
    document.deletedSessions[key] = Array.from(new Set([...(document.deletedSessions[key] ?? []), sessionId]))
    document.deletedSessions[loginKey] = Array.from(new Set([
      ...(document.deletedSessions[loginKey] ?? []), revokedAccountSessionId,
    ]))
  } else if (!revoked && document.deletedSessions[key]) {
    document.deletedSessions[key] = document.deletedSessions[key].filter(id => id !== sessionId)
    if (document.deletedSessions[key].length === 0) {
      delete document.deletedSessions[key]
    }
  }
  document.deletedSessions[deviceId] = Array.from(new Set([
    ...(document.deletedSessions[deviceId] ?? []),
    sessionId,
  ]))
  if (!device) return document

  device.sessions = device.sessions.filter(session => session.sessionId !== sessionId)
  if (device.sessions.length === 0) delete document.devices[deviceId]
  return document
}

export function removeSyncDeviceSessions(value, deviceId, accountSessionId) {
  let document = normalizeSyncSessionsDocument(value)
  const sessionIds = new Set([
    ...(document.devices[deviceId]?.sessions ?? []).map(session => session.sessionId),
    ...(document.deletedSessions[revocationKey(deviceId)] ?? []),
  ])
  for (const sessionId of sessionIds) {
    document = removeSyncSession(document, deviceId, sessionId, { revokedAccountSessionId: accountSessionId })
  }
  // A login with no saved sets can still open a new window before its DELETE.
  const loginKey = `${REVOCATION_LOGIN_KEY_PREFIX}${deviceId}`
  document.deletedSessions[loginKey] = Array.from(new Set([
    ...(document.deletedSessions[loginKey] ?? []), accountSessionId,
  ]))
  return document
}

export function getPreviousSyncSessions(snapshot) {
  return snapshot?.sessionsV2 ?? snapshot?.sessions ?? null
}

export function shouldShowOtherDeviceSessions({
  syncEnabled,
  syncConnected,
  enhancedSyncEnabled,
  sharedTabsEnabled,
  sessions,
}) {
  return syncEnabled &&
    syncConnected &&
    enhancedSyncEnabled &&
    !sharedTabsEnabled &&
    sessions.length > 0
}

export function formatDeviceSessionLabel(session, t) {
  const count = session.tabs.length
  const fallbackName = session.syncPlatform === 'mobile'
    ? t('Settings.Sync Settings.Mobile Device')
    : t('Settings.Sync Settings.Desktop Device')
  const name = typeof session.syncDeviceName === 'string' && session.syncDeviceName.trim()
    ? session.syncDeviceName
    : fallbackName
  return `${name} · ${t('Tab Organizer.Tab Count', { count }, count)}`
}

function claimDeletedSessions(document, sourceId, deviceId) {
  const deleted = document.deletedSessions
  const sourceKey = revocationKey(sourceId)
  const targetKey = revocationKey(deviceId)
  const explicitDeletions = new Set([sourceId, deviceId].flatMap(id => (
    (deleted[id] ?? []).filter(sessionId => !deleted[revocationKey(id)]?.includes(sessionId))
  )))
  if (deleted[sourceId]) {
    deleted[deviceId] = Array.from(new Set([...(deleted[deviceId] ?? []), ...deleted[sourceId]]))
  }
  const revoked = Array.from(new Set([
    ...(deleted[targetKey] ?? []), ...(deleted[sourceKey] ?? []),
  ])).filter(id => !explicitDeletions.has(id))
  const sourceLoginKey = `${REVOCATION_LOGIN_KEY_PREFIX}${sourceId}`
  const targetLoginKey = `${REVOCATION_LOGIN_KEY_PREFIX}${deviceId}`
  const pendingLogins = Array.from(new Set([
    ...(deleted[targetLoginKey] ?? []), ...(deleted[sourceLoginKey] ?? []),
  ]))
  if (pendingLogins.length > 0) deleted[targetLoginKey] = pendingLogins
  if (revoked.length > 0) {
    deleted[targetKey] = revoked
  } else {
    delete deleted[targetKey]
  }
  delete deleted[sourceLoginKey]
  delete deleted[sourceId]
  delete deleted[sourceKey]
}

function claimLegacyDeviceSessions(document, deviceId, legacyDeviceIds) {
  const claimed = clone(document)
  for (const legacyDeviceId of legacyDeviceIds) {
    if (legacyDeviceId === deviceId || !claimed.devices[legacyDeviceId]) continue

    const legacyDevice = claimed.devices[legacyDeviceId]
    const currentDevice = claimed.devices[deviceId]
    if (currentDevice) {
      const currentSessionIds = new Set(
        currentDevice.sessions.map(session => session?.sessionId)
      )
      for (const session of legacyDevice.sessions) {
        if (currentSessionIds.has(session?.sessionId)) continue
        currentDevice.sessions.push(session)
        currentSessionIds.add(session?.sessionId)
      }
    } else {
      claimed.devices[deviceId] = legacyDevice
    }
    delete claimed.devices[legacyDeviceId]
    claimDeletedSessions(claimed, legacyDeviceId, deviceId)
  }
  return claimed
}

function claimLegacyDesktopSessions(document, deviceId, platform) {
  if (platform !== 'desktop') return document

  const claimed = clone(document)
  const legacy = claimed.devices['legacy-desktop']
  const current = claimed.devices[deviceId]
  if (legacy && (!current || current.sessions.length === 0)) {
    claimed.devices[deviceId] = legacy
    delete claimed.devices['legacy-desktop']
    claimDeletedSessions(claimed, 'legacy-desktop', deviceId)
  }
  return claimed
}

function mergeSessions(local, remote, previous) {
  if (previous === null) return remote.length > 0 ? remote : local

  const localChanged = !areJsonValuesEqual(local, previous)
  const remoteChanged = !areJsonValuesEqual(remote, previous)
  if (remoteChanged && !localChanged) return remote
  if (remoteChanged && localChanged && latestSessionUpdate(remote) > latestSessionUpdate(local)) {
    return remote
  }
  return local
}

export function mergeSyncSessions({
  localSessions,
  remoteValue,
  previousValue = null,
  deviceId,
  platform,
  preferredMode,
  legacyDeviceIds = [],
  reclaimDeviceSessions = false,
  activeRevokedLogins = [],
}) {
  const remote = claimLegacyDeviceSessions(
    claimLegacyDesktopSessions(
      normalizeSyncSessionsDocument(remoteValue),
      deviceId,
      platform
    ),
    deviceId,
    legacyDeviceIds
  )
  const previous = previousValue === null
    ? null
    : claimLegacyDeviceSessions(
        claimLegacyDesktopSessions(
          normalizeSyncSessionsDocument(previousValue),
          deviceId,
          platform
        ),
        deviceId,
        legacyDeviceIds
      )
  const key = revocationKey(deviceId)
  const reclaimedSessionIds = new Set(reclaimDeviceSessions ? remote.deletedSessions[key] : [])
  if (reclaimedSessionIds.size > 0) {
    remote.deletedSessions[deviceId] = remote.deletedSessions[deviceId].filter(id => !reclaimedSessionIds.has(id))
    if (remote.deletedSessions[deviceId].length === 0) delete remote.deletedSessions[deviceId]
    delete remote.deletedSessions[key]
    // Revocation removed the remote sessions, not this device's local tabs.
    // A fresh login must publish those tabs instead of inferring a deletion.
    if (previous) delete previous.devices[deviceId]
  }
  if (reclaimDeviceSessions) {
    const loginKey = `${REVOCATION_LOGIN_KEY_PREFIX}${deviceId}`
    if (activeRevokedLogins.length > 0) remote.deletedSessions[loginKey] = clone(activeRevokedLogins)
    else delete remote.deletedSessions[loginKey]
  }
  const localMode = preferredMode === 'shared' ? 'shared' : 'separate'
  const localModeChanged = previous !== null && previous.mode !== localMode
  const remoteModeChanged = previous !== null && remote.mode !== previous.mode
  const mode = previous === null
    ? localMode === 'shared' ? 'shared' : remote.mode
    : localModeChanged
      ? localMode
      : remoteModeChanged
        ? remote.mode
        : localMode

  const local = normalizeSessions(localSessions)
  const localDeviceSessions = withoutDeletedSessions(
    local,
    remote.deletedSessions[deviceId]
  )
  const previousDeviceSessions = previous?.devices[deviceId]?.sessions ?? null
  const remoteDeviceSessions = remote.devices[deviceId]?.sessions ?? []
  const deviceSessions = mergeSessions(
    localDeviceSessions,
    remoteDeviceSessions,
    previousDeviceSessions
  )
  // A concurrent login may already have published another window. Keep that
  // window and append the local sets whose revocation we are reclaiming.
  const mergedSessionIds = new Set(deviceSessions.map(session => session?.sessionId))
  for (const session of localDeviceSessions) {
    if (reclaimedSessionIds.has(session?.sessionId) && !mergedSessionIds.has(session?.sessionId)) {
      deviceSessions.push(clone(session))
      mergedSessionIds.add(session.sessionId)
    }
  }
  const devices = {
    ...remote.devices,
    [deviceId]: { platform, sessions: clone(deviceSessions) },
  }
  const deletedSessions = clone(remote.deletedSessions)
  if (deletedSessions[deviceId]) {
    const localSessionIds = new Set(local.map(session => session?.sessionId))
    deletedSessions[deviceId] = deletedSessions[deviceId].filter(
      sessionId => localSessionIds.has(sessionId)
    )
    if (deletedSessions[deviceId].length === 0) delete deletedSessions[deviceId]
  }

  let shared = remote.shared
  if (mode === 'shared') {
    shared = localModeChanged && previous?.mode !== 'shared'
      ? local
      : mergeSessions(local, remote.shared, previous?.shared ?? null)
  }

  const document = {
    version: SYNC_SESSIONS_VERSION,
    mode,
    devices,
    shared: clone(shared),
    deletedSessions: normalizeDeletedSessions(deletedSessions),
  }
  const otherDeviceSessions = getOtherDeviceSessions(document, deviceId)

  return {
    document,
    sessionsToApply: mode === 'shared' ? clone(shared) : clone(deviceSessions),
    otherDeviceSessions,
    mode,
  }
}
