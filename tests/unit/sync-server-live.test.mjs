import assert from 'node:assert/strict'
import test from 'node:test'
import { SyncCollectionCache, createSyncActivity, validateDeviceRequest, watchSyncChanges } from '../../src/renderer/helpers/sync-server-live.js'

test('cached collections keep their latest revision and are isolated between accounts and keys', () => {
  const cache = new SyncCollectionCache()
  cache.use('account-a:key-a')
  const settings = [{ key: 'baseTheme', value: 'dark' }]
  cache.put('settings', 3, settings)
  assert.deepEqual(cache.latest('settings'), { revision: 3, data: settings })
  cache.use('account-a:key-b')
  assert.equal(cache.latest('settings'), null)
})

test('a sync that finishes after an account change does not fill the new account cache', () => {
  const cache = new SyncCollectionCache()
  cache.use('first-account')
  cache.use('second-account')
  cache.put('history', 1, [{ id: 'private' }], 'first-account')
  assert.equal(cache.latest('history'), null)
})

test('marking a sync finished after the cache was cleared skips the discarded collections', async () => {
  const cache = new SyncCollectionCache()
  cache.use('first-account')
  cache.put('history', 1, [])
  cache.use('')
  cache.markSynced(['history'])
  assert.equal(cache.isSynced('history', 1), false)
})

test('activity describes only changed settings with stable keys and omits initial baselines and noisy collections', () => {
  const before = [{ key: 'baseTheme', value: 'dark', updatedAt: 1 }]
  assert.equal(createSyncActivity('settings', [], before, 'device', 'Laptop'), null)
  assert.equal(createSyncActivity('settings', before, [{ ...before[0], updatedAt: 2 }], 'device', 'Laptop'), null)
  assert.deepEqual(createSyncActivity('settings', before, [{ key: 'baseTheme', value: 'light' }], 'device', 'Laptop'), {
    version: 1, type: 'activity', deviceId: 'device', deviceName: 'Laptop', changes: [{ key: 'baseTheme', value: 'light' }],
  })
  assert.equal(createSyncActivity('settings', before, [{ key: 'baseTheme', value: 'x'.repeat(10000) }], 'device', 'Laptop').changes[0].value, null)
  for (const key of ['channelPlaybackSpeeds', 'channelVolumes', 'channelSubtitlesStates', 'channelVideoQualities', 'playlistReverseStates', 'sponsorBlockDraftSegmentsByVideoId']) {
    assert.equal(createSyncActivity('settings', [{ key, value: '{}' }], [{ key, value: '{"video":2}' }], 'device', 'Laptop'), null)
  }
  for (const collection of ['history', 'seenVideos', 'seenPosts', 'seenRssItems', 'externalMediaPositions', 'sessions', 'sessionsV2']) {
    assert.equal(createSyncActivity(collection, [], ['changed'], 'device', 'Laptop'), null)
  }
})

test('device requests reject another recipient, arbitrary routes, expired messages and invalid positions', () => {
  const now = 100000
  const request = { version: 1, type: 'openVideo', recipient: 'phone', videoId: 'dQw4w9WgXcQ', title: 'Video', position: 30, expiresAt: now + 5000 }
  assert.equal(validateDeviceRequest(request, 'phone', now), true)
  assert.equal(validateDeviceRequest({ ...request, expiresAt: now + 86400000 + 60000 }, 'phone', now), true)
  for (const invalid of [{ recipient: 'other' }, { videoId: '../settings' }, { expiresAt: now }, { expiresAt: now + 90000000 }, { position: -1 }, { position: NaN }, { type: 'execute' }]) {
    assert.equal(validateDeviceRequest({ ...request, ...invalid }, 'phone', now), false)
  }
})

test('live sync retries an unprocessed cursor after failure, ignores unchanged cursors, and stops on cancellation', async () => {
  const cursors = []
  let changes = 0
  const client = {
    cancelled: false,
    async waitForSyncChanges(cursor) {
      cursors.push(cursor)
      if (cursors.length === 4) { this.cancelled = true; return { cursor: 'newer' } }
      return { cursor: 'latest' }
    },
  }
  const errors = []
  await watchSyncChanges(client, async () => {
    if (++changes === 1) throw new Error('Network lost during download')
  }, error => errors.push(error.message), { sleep: async () => {} })
  assert.deepEqual(cursors, ['', '', 'latest', 'latest'])
  assert.equal(changes, 2)
  assert.deepEqual(errors, ['Network lost during download'])
})

test('live sync stops retrying expired authentication and exponentially backs off network errors', async () => {
  const delays = []
  let attempts = 0
  await watchSyncChanges({ cancelled: false, waitForSyncChanges: async () => { throw new Error(++attempts < 5 ? 'offline' : 'expired') } },
    () => assert.fail(), error => error.message !== 'expired', { sleep: async delay => delays.push(delay) })
  assert.deepEqual(delays, [1000, 2000, 4000, 8000])
})

test('live sync coalesces notifications received during an upload without losing a concurrent peer change', async () => {
  const cursors = []
  const processed = []
  let serverCursor = 'first-upload'
  let pending = true
  const client = {
    cancelled: false,
    async waitForSyncChanges(cursor) {
      cursors.push(cursor)
      if (cursors.length >= 5) this.cancelled = true
      if (cursor === 'last-upload') serverCursor = 'peer-change'
      if (cursor === 'peer-change') this.cancelled = true
      return { cursor: serverCursor }
    },
  }
  await watchSyncChanges(client, async () => processed.push(serverCursor), error => { throw error }, {
    waitForPendingSync: async () => {
      if (!pending) return false
      pending = false
      serverCursor = 'last-upload'
      return true
    },
  })
  assert.deepEqual(processed, ['last-upload', 'peer-change'])
  assert.deepEqual(cursors, ['', '', 'last-upload', 'peer-change'])
})

test('live sync retries the old cursor if the coalesced notification fails', async () => {
  const cursors = []
  let changes = 0
  const client = {
    cancelled: false,
    async waitForSyncChanges(cursor) {
      cursors.push(cursor)
      if (cursors.length === 2) throw new Error('Refresh failed')
      if (cursor === 'latest') this.cancelled = true
      return { cursor: 'latest' }
    },
  }
  await watchSyncChanges(client, async () => { changes++ }, () => true, {
    waitForPendingSync: async () => cursors.length === 1,
    sleep: async () => {},
  })
  assert.deepEqual(cursors, ['', '', '', 'latest'])
  assert.equal(changes, 1)
})

test('live sync retries discovery before polling and stops when unsupported or cancelled', async () => {
  const delays = []
  let attempts = 0
  let polls = 0
  const client = { cancelled: false, waitForSyncChanges: async () => { polls++; client.cancelled = true; return { cursor: 'ready' } } }
  await watchSyncChanges(client, () => assert.fail(), () => true, {
    prepare: async () => { if (++attempts < 3) throw new Error('temporary discovery failure'); return true },
    sleep: async ms => delays.push(ms),
  })
  assert.equal(attempts, 3)
  assert.equal(polls, 1)
  assert.deepEqual(delays, [1000, 2000])
  for (const supported of [false, true]) {
    const stopped = { cancelled: false, waitForSyncChanges: () => assert.fail('must not poll') }
    await watchSyncChanges(stopped, () => assert.fail(), () => true, {
      prepare: async () => { stopped.cancelled = supported; return supported },
    })
  }
})

test('live connection health follows successful polls, errors, recovery, and cancellation', async () => {
  const connected = []
  let polls = 0
  const client = {
    cancelled: false,
    async waitForSyncChanges() {
      if (++polls === 2) throw new Error('Disconnected')
      if (polls === 4) this.cancelled = true
      return { cursor: 'latest' }
    },
  }
  await watchSyncChanges(client, async () => {}, async () => true, {
    sleep: async () => {},
    onConnectionChange: value => connected.push(value),
  })
  assert.deepEqual(connected, [true, false, true, false])
})

test('live connection health is shared across owners and released on disconnect', async () => {
  const { locks } = await import('node:worker_threads')
  const { SyncLiveConnectionState } = await import('../../src/renderer/helpers/sync-server-live.js')
  const owner = new SyncLiveConnectionState(locks)
  const otherTab = new SyncLiveConnectionState(locks)
  try {
    assert.equal(await otherTab.isConnected(), false)
    owner.setConnected(true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await otherTab.isConnected(), true)
    owner.setConnected(false)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await otherTab.isConnected(), false)
    owner.setConnected(true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await otherTab.isConnected(), true)
  } finally {
    owner.setConnected(false)
    await new Promise(resolve => setImmediate(resolve))
  }
})

test('subscription activity names additions and removals but ignores metadata refreshes', () => {
  const oldChannels = [{ id: 'a', name: 'Alpha', thumbnail: 'old' }, { id: 'b', name: 'Beta' }]
  const newChannels = [{ id: 'a', name: 'Alpha', thumbnail: 'new' }, { id: 'c', name: 'Gamma' }]
  assert.deepEqual(createSyncActivity('subscriptions', oldChannels, newChannels, 'device', 'Laptop').changes, [
    { collection: 'subscriptions', action: 'removed', item: 'Beta' },
    { collection: 'subscriptions', action: 'added', item: 'Gamma' },
  ])
  assert.equal(createSyncActivity('subscriptions', oldChannels, [{ ...oldChannels[0], thumbnail: 'new' }, oldChannels[1]], 'device', 'Laptop'), null)
})

test('playlist activity describes playlists, video membership and metadata changes', () => {
  const before = [
    { playlist: { id: 'one', title: 'Old name', description: '' }, videos: [{ id: 'video-a', title: 'Video A' }] },
    { playlist: { id: 'gone', title: 'Gone' }, videos: [] },
  ]
  const after = [
    { playlist: { id: 'one', title: 'New name', description: 'Updated' }, videos: [{ id: 'video-b', title: 'Video B' }] },
    { playlist: { id: 'new', title: 'New playlist' }, videos: [] },
  ]
  assert.deepEqual(createSyncActivity('playlists', before, after, 'device', 'Laptop').changes, [
    { collection: 'playlists', action: 'removed', item: 'Gone' },
    { collection: 'playlists', action: 'added', item: 'New playlist' },
    { collection: 'playlists', action: 'renamed', item: 'Old name', value: 'New name' },
    { collection: 'playlists', action: 'removed', item: 'Video A', parent: 'New name' },
    { collection: 'playlists', action: 'added', item: 'Video B', parent: 'New name' },
    { collection: 'playlists', action: 'updated', item: 'New name' },
  ])
})

test('activity bounds large imports and omits long item names', () => {
  const channels = Array.from({ length: 200 }, (_, index) => ({ id: String(index), name: `Channel ${index}` }))
  const activity = createSyncActivity('subscriptions', [], channels, 'device', 'Laptop')
  assert.equal(activity.changes.length, 64)
  assert.deepEqual(activity.changes.at(-1), { collection: 'subscriptions' })
  const long = createSyncActivity('subscriptions', [], [
    { id: 'long', name: 'a'.repeat(129) },
    { id: 'also-long', name: 'b'.repeat(129) },
  ], 'device', 'Laptop')
  assert.deepEqual(long.changes, [{ collection: 'subscriptions' }])
})
