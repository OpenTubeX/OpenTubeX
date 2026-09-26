import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { SyncLiveConnectionState } from '../../src/renderer/helpers/sync-server-live.js'
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
    syncServerSyncLiveReminders: false,
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
  assert.equal(SYNC_ACTION_REASONS.get('mergeSubscriptionSeenPosts'), 'history')
  assert.equal(SYNC_MUTATION_REASONS.get('setSubscriptionSeenPosts'), 'history')
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
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncLiveReminders: true }), 'liveReminders'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncLiveReminders: true }), 'automatic'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSettings: true }), 'settings'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSessions: true }), 'sessions'), true)
  assert.equal(isSyncReasonEnabled(settings({
    syncServerPrivacyMode: 'legacy',
    syncServerSyncSettings: true,
    syncServerSyncSessions: true,
    syncServerSyncLiveReminders: true,
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

async function schedulingFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
  const source = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
  const declarations = source.slice(source.indexOf('const EVENT_SYNC_'), source.indexOf('function isSyncServerOffline'))
  const action = name => source.slice(source.indexOf(`  ${name}(`), source.indexOf('\n  },', source.indexOf(`  ${name}(`)) + 5)
  const calls = []
  let releaseSync
  let blockSync = false
  let pendingLock = Promise.resolve()
  let releaseLock
  const sandbox = {
    Date, setTimeout, clearTimeout, AbortController, console, isRecentSync, isSyncReasonEnabled, SyncLiveConnectionState, AUTO_SYNC_INTERVAL_MS,
    SyncCollectionCache: class {}, isSyncServerOffline: () => false,
    withSyncLock: callback => pendingLock.then(callback),
    runSync: async () => {
      calls.push(Date.now())
      if (blockSync) await new Promise(resolve => { releaseSync = resolve })
    },
  }
  const { actions, liveConnection } = vm.runInNewContext(declarations + `
    const actions = {
      ${action('syncWithSyncServer')}
      ${action('startSyncServerAutoSync')}
      ${action('stopSyncServerAutoSync')}
      ${action('scheduleSyncServer')}
    }; ({ actions, liveConnection })`, sandbox)
  const context = {
    rootState: {
      settings: settings({ syncServerEnabled: true, syncServerAutoSync: true,
        syncServerToken: 'token', syncServerSyncHistory: true,
        syncServerSyncSessions: true, syncServerSyncSettings: true }),
      syncServer: { syncServerStatus: 'idle' },
    },
    dispatch: (name, payload) => Promise.resolve(actions[name]?.(context, payload)),
  }
  return {
    calls, context,
    liveConnection,
    start: () => actions.startSyncServerAutoSync(context),
    schedule: reason => actions.scheduleSyncServer(context, reason),
    sync: options => actions.syncWithSyncServer(context, options),
    stop: () => actions.stopSyncServerAutoSync(context),
    block: () => { blockSync = true },
    holdLock: () => { pendingLock = new Promise(resolve => { releaseLock = resolve }) },
    releaseLock: () => releaseLock(),
    release: () => { blockSync = false; releaseSync() },
    tick: async ms => {
      t.mock.timers.tick(ms)
      // Drain the lock, sync, and dispatch promise chains without real delays.
      for (let i = 0; i < 20; i++) await Promise.resolve()
    },
  }
}

for (const [reason, delay, maxWait] of [['sessions', 10000, 30000], ['history', 30000, 60000]]) {
  test(`${reason} sync waits for inactivity`, async t => {
    const f = await schedulingFixture(t)
    f.schedule(reason)
    await f.tick(delay - 1)
    assert.equal(f.calls.length, 0)
    f.schedule(reason)
    await f.tick(delay - 1)
    assert.equal(f.calls.length, 0)
    await f.tick(1)
    assert.equal(f.calls.length, 1)
  })
  test(`${reason} sync has a maximum wait during continuous edits`, async t => {
    const f = await schedulingFixture(t)
    for (let elapsed = 0; elapsed < maxWait; elapsed += 1000) {
      f.schedule(reason)
      await f.tick(1000)
      assert.equal(f.calls.length, elapsed + 1000 === maxWait ? 1 : 0)
    }
  })
}

test('history edits do not postpone the tabs deadline', async t => {
  const f = await schedulingFixture(t)
  f.schedule('sessions')
  for (let i = 0; i < 10; i++) {
    f.schedule('history')
    await f.tick(1000)
  }
  assert.equal(f.calls.length, 1)
  await f.tick(60000)
  assert.equal(f.calls.length, 1, 'one full sync consumes both pending collections')
})

test('manual sync is immediate and cancels pending event syncs', async t => {
  const f = await schedulingFixture(t)
  f.schedule('history')
  f.schedule('sessions')
  await f.sync()
  assert.equal(f.calls.length, 1)
  await f.tick(60000)
  assert.equal(f.calls.length, 1)
})

test('stopping automatic sync cancels pending changes', async t => {
  const f = await schedulingFixture(t)
  f.schedule('history')
  f.schedule('sessions')
  f.stop()
  await f.tick(60000)
  assert.equal(f.calls.length, 0)
})

test('other changes retain their short delay and automatic checks cannot suppress local edits', async t => {
  const f = await schedulingFixture(t)
  f.context.rootState.settings.syncServerLastSyncAt = Date.now()
  f.schedule('settings')
  f.schedule('automatic')
  await f.tick(1500)
  assert.equal(f.calls.length, 1)
})

for (const remoteOnly of [false, true]) {
  test(`edits during a ${remoteOnly ? 'remote' : 'full'} sync keep their debounce`, async t => {
    const f = await schedulingFixture(t)
    f.block()
    const syncing = f.sync({ remoteOnly })
    await f.tick(0)
    f.schedule('history')
    f.release()
    await syncing
    await f.tick(29999)
    assert.equal(f.calls.length, 1)
    await f.tick(1)
    assert.equal(f.calls.length, 2)
  })
}

test('an expired deadline waits for the active sync, then runs without another debounce', async t => {
  const f = await schedulingFixture(t)
  f.block()
  const syncing = f.sync()
  await f.tick(0)
  f.schedule('sessions')
  await f.tick(30000)
  assert.equal(f.calls.length, 1)
  f.release()
  await syncing
  await f.tick(0)
  assert.equal(f.calls.length, 2)
})

test('disabling a collection before its deadline prevents its scheduled sync', async t => {
  const f = await schedulingFixture(t)
  f.schedule('history')
  f.context.rootState.settings.syncServerSyncHistory = false
  await f.tick(30000)
  assert.equal(f.calls.length, 0)
})

test('a recent automatic check preserves the pending history deadline', async t => {
  const f = await schedulingFixture(t)
  f.context.rootState.settings.syncServerLastSyncAt = Date.now()
  f.schedule('history')
  f.schedule('automatic')
  await f.tick(1500)
  assert.equal(f.calls.length, 0)
  await f.tick(28500)
  assert.equal(f.calls.length, 1)
})

test('stopping sync cancels an expired timer waiting for an active sync', async t => {
  const f = await schedulingFixture(t)
  f.block()
  const syncing = f.sync()
  await f.tick(0)
  f.schedule('sessions')
  await f.tick(10000)
  f.stop()
  f.release()
  await syncing
  await f.tick(0)
  assert.equal(f.calls.length, 1)
})

for (const connected of [true, false]) {
  test(`periodic fallback ${connected ? 'skips a healthy live connection' : 'syncs without a live connection'}`, async t => {
    const f = await schedulingFixture(t)
    f.liveConnection.setConnected(connected)
    f.start()
    await f.tick(AUTO_SYNC_INTERVAL_MS)
    assert.equal(f.calls.length, connected ? 0 : 1)
    await f.tick(AUTO_SYNC_INTERVAL_MS)
    assert.equal(f.calls.length, connected ? 0 : 2)
  })
}

test('periodic fallback resumes after a live disconnect', async t => {
  const f = await schedulingFixture(t)
  f.liveConnection.setConnected(true)
  f.start()
  await f.tick(AUTO_SYNC_INTERVAL_MS)
  assert.equal(f.calls.length, 0)
  f.liveConnection.setConnected(false)
  await f.tick(AUTO_SYNC_INTERVAL_MS)
  assert.equal(f.calls.length, 1)
})

test('periodic fallback retries failed uploads despite a healthy live connection and recent sync', async t => {
  const f = await schedulingFixture(t)
  f.liveConnection.setConnected(true)
  f.context.rootState.syncServer.syncServerStatus = 'error'
  f.start()
  await f.tick(AUTO_SYNC_INTERVAL_MS - 1000)
  // Another renderer can update this shared timestamp while our upload failed.
  f.context.rootState.settings.syncServerLastSyncAt = Date.now()
  await f.tick(1000)
  assert.equal(f.calls.length, 1)
})

test('a due edit waits for session deletion to release the sync lock', async t => {
  const f = await schedulingFixture(t)
  f.schedule('sessions')
  f.holdLock()
  f.context.rootState.syncServer.syncServerStatus = 'syncing'
  await f.tick(10000)
  assert.equal(f.calls.length, 0)
  f.context.rootState.syncServer.syncServerStatus = 'success'
  f.releaseLock()
  await f.tick(0)
  assert.equal(f.calls.length, 1)
})

test('a due edit remains cancellable when another remote check starts during its wait', async t => {
  const f = await schedulingFixture(t)
  f.block()
  const first = f.sync({ remoteOnly: true })
  await f.tick(0)
  const second = first.then(() => f.sync({ remoteOnly: true }))
  f.schedule('sessions')
  await f.tick(10000)
  f.release()
  f.block()
  await first
  await f.tick(0)
  assert.equal(f.calls.length, 2)
  f.stop()
  f.release()
  await second
  await f.tick(0)
  assert.equal(f.calls.length, 2, 'stopping sync must cancel the waiting local upload')
})

test('edits made during session deletion wait for its sync lock', async t => {
  const f = await schedulingFixture(t)
  f.holdLock()
  f.context.rootState.syncServer.syncServerStatus = 'syncing'
  f.schedule('history')
  await f.tick(30000)
  assert.equal(f.calls.length, 0)
  f.context.rootState.syncServer.syncServerStatus = 'success'
  f.releaseLock()
  await f.tick(0)
  assert.equal(f.calls.length, 1)
})

test('stopping during a fallback health check cancels its upload and rescheduling', async t => {
  const f = await schedulingFixture(t)
  let finishHealthCheck
  f.liveConnection.isConnected = () => new Promise(resolve => { finishHealthCheck = resolve })
  f.start()
  await f.tick(AUTO_SYNC_INTERVAL_MS)
  f.stop()
  finishHealthCheck(false)
  await f.tick(0)
  assert.equal(f.calls.length, 0)
  f.liveConnection.isConnected = async () => false
  await f.tick(AUTO_SYNC_INTERVAL_MS)
  assert.equal(f.calls.length, 0)
  f.start()
  await f.tick(AUTO_SYNC_INTERVAL_MS)
  assert.equal(f.calls.length, 1, 'an explicit restart still works')
})

test('stopping during an active sync prevents completion or later edits from restarting it', async t => {
  const f = await schedulingFixture(t)
  f.block()
  const syncing = f.sync()
  await f.tick(0)
  f.stop()
  f.release()
  await syncing
  f.schedule('history')
  await f.tick(AUTO_SYNC_INTERVAL_MS)
  assert.equal(f.calls.length, 1)
})

test('stopping sync cancels an automatic upload already queued behind the lock', async t => {
  const f = await schedulingFixture(t)
  f.holdLock()
  f.schedule('sessions')
  await f.tick(10000)
  f.stop()
  f.releaseLock()
  await f.tick(0)
  assert.equal(f.calls.length, 0)
})

test('automatic sync can restart before any collection is enabled', async t => {
  const f = await schedulingFixture(t)
  f.stop()
  const settings = f.context.rootState.settings
  settings.syncServerSyncSessions = false
  settings.syncServerSyncHistory = false
  settings.syncServerSyncSettings = false
  f.start()
  settings.syncServerSyncHistory = true
  f.schedule('history')
  await f.tick(30000)
  assert.equal(f.calls.length, 1)
})
