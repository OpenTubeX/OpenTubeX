import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getOtherDeviceSessions,
  getPreviousSyncSessions,
  mergeSyncSessions,
  normalizeSyncSessionsDocument,
  shouldShowOtherDeviceSessions,
} from '../../src/renderer/helpers/sync-sessions.js'

const session = (id, updatedAt, url = `https://opentubex.local/${id}`) => ({
  sessionId: id,
  updatedAt,
  activeTabId: `${id}-tab`,
  tabs: [{ id: `${id}-tab`, url }],
})

test('treats legacy session arrays as a separate desktop device', () => {
  const document = normalizeSyncSessionsDocument([session('desktop', 1)])
  assert.equal(document.mode, 'separate')
  assert.deepEqual(document.devices['legacy-desktop'].sessions, [session('desktop', 1)])
})

test('keeps mobile and desktop sessions separate by default', () => {
  const result = mergeSyncSessions({
    localSessions: [session('mobile', 2)],
    remoteValue: [session('desktop', 1)],
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.sessionsToApply, [session('mobile', 2)])
  assert.equal(result.otherDeviceSessions[0].sessionId, 'desktop')
  assert.equal(result.otherDeviceSessions[0].syncPlatform, 'desktop')
})

test('claims an upgraded desktop legacy session instead of showing it as another device', () => {
  const desktop = session('desktop', 3)
  const result = mergeSyncSessions({
    localSessions: [session('local', 2)],
    remoteValue: [desktop],
    deviceId: 'upgraded-desktop',
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.sessionsToApply, [desktop])
  assert.deepEqual(result.document.devices['upgraded-desktop'].sessions, [desktop])
  assert.equal(result.document.devices['legacy-desktop'], undefined)
  assert.deepEqual(result.otherDeviceSessions, [])
})

test('an explicit shared mode mirrors the newest shared session set', () => {
  const previous = {
    version: 1,
    mode: 'shared',
    devices: { phone: { platform: 'mobile', sessions: [session('mobile', 2)] } },
    shared: [session('desktop', 3)],
  }
  const remote = structuredClone(previous)
  remote.shared = [session('desktop-new', 5)]

  const result = mergeSyncSessions({
    localSessions: [session('mobile', 2)],
    remoteValue: remote,
    previousValue: previous,
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'shared',
  })

  assert.deepEqual(result.sessionsToApply, [session('desktop-new', 5)])
})

test('switching to shared mode publishes the local tabs intentionally', () => {
  const previous = {
    version: 1,
    mode: 'separate',
    devices: { phone: { platform: 'mobile', sessions: [session('mobile-old', 1)] } },
    shared: [session('desktop', 5)],
  }

  const result = mergeSyncSessions({
    localSessions: [session('mobile-new', 6)],
    remoteValue: previous,
    previousValue: previous,
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'shared',
  })

  assert.equal(result.mode, 'shared')
  assert.deepEqual(result.sessionsToApply, [session('mobile-new', 6)])
})

test('shows other-device tabs only while separate session sync is connected', () => {
  const sessions = [session('desktop', 1)]

  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: false,
    syncConnected: false,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions,
  }), false)
  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: true,
    syncConnected: false,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions,
  }), false)
  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: true,
    syncConnected: true,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions,
  }), true)
})

test('keeps saved other-device tabs available for manual sync', () => {
  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: true,
    automaticSyncEnabled: false,
    syncConnected: true,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions: [session('desktop', 1)],
  }), true)
})

test('restores migrated desktop tabs from the saved sync snapshot', () => {
  const desktop = session('desktop', 1)
  const savedSnapshot = normalizeSyncSessionsDocument([desktop])

  assert.deepEqual(getOtherDeviceSessions(savedSnapshot, 'phone'), [{
    ...desktop,
    syncDeviceId: 'legacy-desktop',
    syncPlatform: 'desktop',
  }])
})

test('uses legacy sessions as the baseline when the versioned snapshot is null', () => {
  const previousSessions = [session('previous', 1)]
  const localSessions = [session('local', 3)]
  const remoteValue = {
    version: 1,
    mode: 'separate',
    devices: {
      desktop: { platform: 'desktop', sessions: [session('remote', 2)] },
    },
    shared: [],
  }
  const previousValue = getPreviousSyncSessions({
    sessions: previousSessions,
    sessionsV2: null,
  })

  const result = mergeSyncSessions({
    localSessions,
    remoteValue,
    previousValue,
    deviceId: 'desktop',
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.sessionsToApply, localSessions)
})
