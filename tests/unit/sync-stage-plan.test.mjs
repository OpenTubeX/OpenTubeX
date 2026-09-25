import assert from 'node:assert/strict'
import test from 'node:test'

import { getInitialSyncStages } from '../../src/renderer/helpers/sync-server-plan.js'

const allEnabled = {
  syncServerSyncSubscriptions: true,
  syncServerSyncPlaylists: true,
  syncServerSyncHistory: true,
  syncServerSyncWatchStats: true,
  syncServerSyncProfiles: true,
  syncServerSyncSessions: true,
  syncServerSyncSettings: true,
}

test('plans every enabled encrypted sync stage in protocol order', () => {
  assert.deepEqual(getInitialSyncStages(allEnabled, {
    encrypted: true, supportsSessions: true
  }), [
    'download', 'subscriptions', 'playlists', 'playlistBookmarks',
    'history', 'watchStats', 'profiles', 'sessionsV2', 'settings',
    'upload', 'finishing'
  ])
})

test('omits encrypted-only and unsupported session stages without changing basic sync', () => {
  assert.deepEqual(getInitialSyncStages(allEnabled, {
    encrypted: false, supportsSessions: true
  }), [
    'subscriptions', 'playlists', 'playlistBookmarks',
    'history', 'profiles', 'finishing'
  ])
  assert.equal(getInitialSyncStages(allEnabled, {
    encrypted: true, supportsSessions: false
  }).includes('sessionsV2'), false)
})

test('always retains the final stage when collections are disabled', () => {
  assert.deepEqual(getInitialSyncStages({}, {
    encrypted: false, supportsSessions: false
  }), ['finishing'])
})
