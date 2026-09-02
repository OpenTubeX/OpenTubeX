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

export function normalizeSyncSessionsDocument(value) {
  if (Array.isArray(value)) {
    return {
      version: SYNC_SESSIONS_VERSION,
      mode: 'separate',
      devices: value.length > 0
        ? { 'legacy-desktop': { platform: 'desktop', sessions: clone(value) } }
        : {},
      shared: [],
    }
  }

  const devices = {}
  if (value?.devices && typeof value.devices === 'object' && !Array.isArray(value.devices)) {
    for (const [deviceId, device] of Object.entries(value.devices)) {
      if (!device || (device.platform !== 'desktop' && device.platform !== 'mobile')) continue
      devices[deviceId] = {
        platform: device.platform,
        sessions: normalizeSessions(device.sessions),
      }
    }
  }

  return {
    version: SYNC_SESSIONS_VERSION,
    mode: value?.mode === 'shared' ? 'shared' : 'separate',
    devices,
    shared: normalizeSessions(value?.shared),
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
  const previousDeviceSessions = previous?.devices[deviceId]?.sessions ?? null
  const remoteDeviceSessions = remote.devices[deviceId]?.sessions ?? []
  const deviceSessions = mergeSessions(local, remoteDeviceSessions, previousDeviceSessions)
  const devices = {
    ...remote.devices,
    [deviceId]: { platform, sessions: clone(deviceSessions) },
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
  }
  const otherDeviceSessions = getOtherDeviceSessions(document, deviceId)

  return {
    document,
    sessionsToApply: mode === 'shared' ? clone(shared) : clone(deviceSessions),
    otherDeviceSessions,
    mode,
  }
}
