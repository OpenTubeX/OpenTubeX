import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createStore } from 'vuex'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTO_SYNC_INTERVAL_MS,
  dispatchRemoteSyncAction,
  isRemoteSyncDispatch,
  SYNC_ACTION_REASONS,
  SYNC_MUTATION_REASONS,
  isRecentSync,
  isSyncReasonEnabled,
} from '../../src/renderer/helpers/sync-server-scheduling.js'

function settings (overrides = {}) {
  return {
    syncServerPrivacyMode: 'enhanced',
    syncServerSyncSubscriptions: false,
    syncServerSyncPlaylists: false,
    syncServerSyncHistory: false,
    syncServerSyncProfiles: false,
    syncServerSyncSessions: false,
    syncServerSyncSettings: false,
    ...overrides,
  }
}

test('maps local actions to their affected sync collection', () => {
  assert.equal(SYNC_ACTION_REASONS.get('updateWatchProgress'), 'history')
  assert.equal(SYNC_ACTION_REASONS.get('mergeSubscriptionSeenVideos'), 'history')
  assert.equal(SYNC_MUTATION_REASONS.get('setSubscriptionSeenVideos'), 'history')
  assert.equal(SYNC_ACTION_REASONS.get('addVideo'), 'playlists')
  assert.equal(SYNC_ACTION_REASONS.has('updateChannelPlaybackSpeeds'), false)
  assert.equal(SYNC_ACTION_REASONS.get('updateCustomThemes'), 'settings')
  assert.equal(SYNC_ACTION_REASONS.get('updateChannelSettings'), 'settings')
  assert.equal(SYNC_MUTATION_REASONS.get('updateChannelSettings'), 'settings')
  assert.equal(SYNC_ACTION_REASONS.get('createProfile'), 'profiles')
  assert.equal(SYNC_ACTION_REASONS.get('addChannelToProfiles'), 'profilesOrSubscriptions')
  assert.equal(SYNC_MUTATION_REASONS.get('setTabsState'), 'sessions')
  assert.equal(SYNC_MUTATION_REASONS.get('setTabNavigation'), 'sessions')
})

test('only schedules changes for enabled collections', () => {
  assert.equal(isSyncReasonEnabled(settings(), 'history'), false)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncHistory: true }), 'history'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncProfiles: true }), 'profilesOrSubscriptions'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSubscriptions: true }), 'profilesOrSubscriptions'), true)
  assert.equal(isSyncReasonEnabled(settings(), 'automatic'), false)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncPlaylists: true }), 'automatic'), true)
})

test('requires enhanced privacy and the collection toggle for private collections', () => {
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSettings: true }), 'settings'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSessions: true }), 'sessions'), true)
  assert.equal(isSyncReasonEnabled(settings({
    syncServerPrivacyMode: 'legacy',
    syncServerSyncSettings: true,
    syncServerSyncSessions: true,
  }), 'automatic'), false)
})

test('treats syncs as recent only inside the automatic sync interval', () => {
  const now = 1000000
  assert.equal(isRecentSync(0, now), false)
  assert.equal(isRecentSync(now + 1, now), false)
  assert.equal(isRecentSync(now - AUTO_SYNC_INTERVAL_MS + 1, now), true)
  assert.equal(isRecentSync(now - AUTO_SYNC_INTERVAL_MS, now), false)
})

async function loadLocalChangePlugin() {
  const source = await readFile(new URL('../../src/renderer/store/index.js', import.meta.url), 'utf8')
  return vm.runInNewContext(
    source.slice(source.indexOf('function syncOnLocalChanges('), source.indexOf('function reloadRecommendationEvidenceAfterHistoryRemoval(')) + '\nsyncOnLocalChanges',
    { SYNC_ACTION_REASONS, SYNC_MUTATION_REASONS, isRemoteSyncDispatch,
      isSettingSyncable: key => key === 'autoplayVideos', isSettingSyncEnabled: () => true }
  )
}

test('remote actions do not schedule uploads while concurrent user actions still do', async () => {
  let releaseRemote
  const pendingRemote = new Promise(resolve => { releaseRemote = resolve })
  const scheduled = []
  const store = createStore({
    state: { settings: { autoplayVideos: true }, progress: 0 },
    plugins: [await loadLocalChangePlugin()],
    mutations: {
      setAutoplayVideos: (state, value) => { state.settings.autoplayVideos = value },
      updateRecordWatchProgressInHistoryCache: (state, value) => { state.progress = value },
    },
    actions: {
      async updateAutoplayVideos({ commit }, value) {
        await pendingRemote
        commit('setAutoplayVideos', value)
      },
      updateWatchProgress: ({ commit }, value) => commit('updateRecordWatchProgressInHistoryCache', value),
      scheduleSyncServer: (_, reason) => { scheduled.push(reason) },
    },
  })
  const remote = dispatchRemoteSyncAction(store.dispatch, 'updateAutoplayVideos', false)
  assert.equal(isRemoteSyncDispatch(), false)
  try {
    await store.dispatch('updateWatchProgress', 42)
    assert.deepEqual(scheduled, ['history'])
  } finally {
    releaseRemote()
    await remote
  }
  assert.deepEqual(scheduled, ['history'])
  await store.dispatch('updateAutoplayVideos', true)
  assert.deepEqual(scheduled, ['history', 'settings'])
})

test('nested remote dispatches and thrown dispatches restore their origin scope', () => {
  dispatchRemoteSyncAction(() => {
    assert.equal(isRemoteSyncDispatch(), true)
    assert.throws(() => dispatchRemoteSyncAction(() => {
      assert.equal(isRemoteSyncDispatch(), true)
      throw new Error('Dispatch failed')
    }), /Dispatch failed/)
    assert.equal(isRemoteSyncDispatch(), true)
  })
  assert.equal(isRemoteSyncDispatch(), false)
})
