import { areJsonValuesEqual } from './jsonValues.js'

export const SYNC_SESSIONS_VERSION = 1

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

export function getOtherDeviceSessions(value, deviceId) {
  const document = normalizeSyncSessionsDocument(value)
  return Object.entries(document.devices)
    .filter(([id]) => id !== deviceId)
    .flatMap(([id, device]) => device.sessions.map(session => ({
      ...clone(session),
      syncDeviceId: id,
      syncPlatform: device.platform,
    })))
}

export function removeSyncSession(value, deviceId, sessionId) {
  const document = normalizeSyncSessionsDocument(value)
  const device = document.devices[deviceId]
  if (!device) return document

  device.sessions = device.sessions.filter(session => session.sessionId !== sessionId)
  document.deletedSessions[deviceId] = Array.from(new Set([
    ...(document.deletedSessions[deviceId] ?? []),
    sessionId,
  ]))
  if (device.sessions.length === 0) delete document.devices[deviceId]
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

function claimLegacyDesktopSessions(document, deviceId, platform) {
  if (platform !== 'desktop') return document

  const claimed = clone(document)
  const legacy = claimed.devices['legacy-desktop']
  const current = claimed.devices[deviceId]
  if (legacy && (!current || current.sessions.length === 0)) {
    claimed.devices[deviceId] = legacy
    delete claimed.devices['legacy-desktop']
    if (claimed.deletedSessions['legacy-desktop']) {
      claimed.deletedSessions[deviceId] = Array.from(new Set([
        ...(claimed.deletedSessions[deviceId] ?? []),
        ...claimed.deletedSessions['legacy-desktop'],
      ]))
      delete claimed.deletedSessions['legacy-desktop']
    }
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
}) {
  const remote = claimLegacyDesktopSessions(
    normalizeSyncSessionsDocument(remoteValue),
    deviceId,
    platform
  )
  const previous = previousValue === null
    ? null
    : claimLegacyDesktopSessions(
        normalizeSyncSessionsDocument(previousValue),
        deviceId,
        platform
      )
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
    deletedSessions,
  }
  const otherDeviceSessions = getOtherDeviceSessions(document, deviceId)

  return {
    document,
    sessionsToApply: mode === 'shared' ? clone(shared) : clone(deviceSessions),
    otherDeviceSessions,
    mode,
  }
}
