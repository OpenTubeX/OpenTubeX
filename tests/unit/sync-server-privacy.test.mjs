import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmptySyncDocument,
  decryptLegacySyncDocument,
  decryptSyncDocument,
  EncryptedSyncAdapter,
  encryptSyncChange,
  encryptSyncDocument,
  migrateLegacyPlaybackSpeedsToSettings,
  preparePrivacyKey,
  readSyncCollection,
} from '../../src/renderer/helpers/sync-server-privacy.js'
import { applyRemoteHistoryChanges } from '../../src/renderer/helpers/sync-history-merge.js'

import { encryptLegacyDocument } from '../helpers/encrypt-legacy-sync-document.mjs'

test('decrypts the original single-document encrypted sync format', async () => {
  const passphrase = 'legacy-privacy-passphrase'
  const privacy = await preparePrivacyKey(null, passphrase)
  const document = {
    version: 1,
    subscriptions: [{ id: 'UC-test' }],
    playlists: [],
    history: [],
    playbackSpeeds: [],
    subscriptionGroups: [],
    playlistBookmarks: [],
  }
  const payload = await encryptLegacyDocument(document, privacy)

  assert.deepEqual(
    await decryptLegacySyncDocument(payload, privacy.key),
    document
  )
  await assert.doesNotReject(() => preparePrivacyKey(payload, passphrase))
  await assert.rejects(
    () => decryptSyncDocument(payload, privacy.key),
    /corrupted sync data/
  )
})

test('moves legacy playback speeds into settings while preserving local values', () => {
  const document = {
    settings: [],
    playbackSpeeds: [
      { channel_id: 'remote', playback_speed: 1.25 },
      { channel_id: 'shared', playback_speed: 1.5 },
    ],
  }

  assert.equal(migrateLegacyPlaybackSpeedsToSettings(
    document,
    JSON.stringify({ local: 0.75, shared: 2 }),
    123
  ), true)
  assert.deepEqual(document.settings, [{
    key: 'channelPlaybackSpeeds',
    value: JSON.stringify({ remote: 1.25, shared: 2, local: 0.75 }),
    updatedAt: 123,
  }])
})

test('keeps the current settings collection instead of legacy playback speeds', () => {
  const current = {
    key: 'channelPlaybackSpeeds',
    value: JSON.stringify({ current: 1.75 }),
    updatedAt: 456,
  }
  const document = {
    settings: [current],
    playbackSpeeds: [{ channel_id: 'legacy', playback_speed: 1.25 }],
  }

  assert.equal(migrateLegacyPlaybackSpeedsToSettings(document, '{}', 789), false)
  assert.deepEqual(document.settings, [current])
})

test('stores playlist bookmarks in the encrypted sync document', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const bookmark = {
    playlist: { id: 'saved-playlist', title: 'Saved playlist' },
    uploader: { id: 'saved-channel', name: 'Saved channel' },
  }

  await adapter.createPlaylistBookmark(bookmark)
  assert.deepEqual(await adapter.getPlaylistBookmarks(), [bookmark])

  await adapter.deletePlaylistBookmark('saved-playlist')
  assert.deepEqual(await adapter.getPlaylistBookmarks(), [])
})

test('keeps versioned sessions isolated from older clients', async () => {
  const legacySessions = [{ sessionId: 'legacy-desktop', tabs: [] }]
  const versionedSessions = {
    version: 1,
    mode: 'separate',
    devices: {},
    shared: [],
  }
  const document = createEmptySyncDocument()
  document.sessions = legacySessions
  const adapter = new EncryptedSyncAdapter(document)

  assert.deepEqual(await adapter.getSessions(), legacySessions)
  await adapter.putSessions(versionedSessions)
  assert.deepEqual(document.sessions, legacySessions)
  assert.deepEqual(await adapter.getSessions(), versionedSessions)

  document.sessions = [{ sessionId: 'changed-by-older-client', tabs: [] }]
  assert.deepEqual(await adapter.getSessions(), versionedSessions)
})

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

test('sync adapter edits replace shared collections and record what they touched', async () => {
  const video = { id: 'video', title: 'Video', uploader: { id: 'UC-channel', name: 'Channel' } }
  const shared = deepFreeze({
    subscriptions: [{ id: 'UC-channel', name: 'Channel' }],
    playlists: [{ playlist: { id: 'playlist', title: 'Playlist' }, videos: [video] }],
    playlistBookmarks: [{ playlist: { id: 'bookmark', title: 'Bookmark' } }],
    history: [{ video, metadata: { added_date: 1, watched_state: 'watching', position_millis: 1 } }],
    profiles: [{ group: { id: 'profile', title: 'Profile' }, channels: [] }],
    settings: [{ key: 'baseTheme', value: 'dark' }],
  })
  const calls = {
    subscribe: ['subscriptions', { id: 'UC-other' }],
    subscribeBulk: ['subscriptions', [{ id: 'UC-other' }]],
    unsubscribe: ['subscriptions', 'UC-channel'],
    createPlaylistBookmark: ['playlistBookmarks', { playlist: { id: 'other' } }],
    deletePlaylistBookmark: ['playlistBookmarks', 'bookmark'],
    createPlaylist: ['playlists', { id: 'other', title: 'Other' }],
    updatePlaylist: ['playlists', 'playlist', { title: 'Renamed' }],
    deletePlaylist: ['playlists', 'playlist'],
    addPlaylistVideos: ['playlists', 'playlist', [{ ...video, title: 'Renamed' }, { ...video, id: 'other' }]],
    removePlaylistVideo: ['playlists', 'playlist', 'video'],
    putWatchStats: ['watchStats', []],
    putLiveReminders: ['liveReminders', []],
    putSeenVideos: ['seenVideos', []],
    putSeenPosts: ['seenPosts', []],
    putSessions: ['sessionsV2', { version: 2 }],
    putWatchHistory: ['history', { ...shared.history[0], metadata: { ...shared.history[0].metadata, added_date: 2 } }],
    putWatchHistoryBulk: ['history', [{ video: { ...video, id: 'other' }, metadata: shared.history[0].metadata }]],
    applyWatchHistoryChanges: ['history', [], ['video']],
    deleteWatchHistory: ['history', 'video'],
    createSubscriptionGroup: ['profiles', { id: 'other', title: 'Other' }],
    updateSubscriptionGroup: ['profiles', 'profile', { title: 'Renamed' }],
    deleteSubscriptionGroup: ['profiles', 'profile'],
    addSubscriptionGroupChannel: ['profiles', 'profile', 'UC-channel'],
    removeSubscriptionGroupChannel: ['profiles', 'profile', 'UC-channel'],
    putSettings: ['settings', [{ key: 'baseTheme', value: 'light' }]],
  }
  const editors = Object.getOwnPropertyNames(EncryptedSyncAdapter.prototype)
    .filter(name => name !== 'constructor' && !/^(get|supports)/.test(name))
  // A new editor must be listed so this test checks that it copies on write.
  assert.deepEqual(editors.sort(), Object.keys(calls).sort())

  for (const [method, [collection, ...args]] of Object.entries(calls)) {
    const adapter = new EncryptedSyncAdapter({ ...shared })
    // Frozen values reject in-place edits, which would also change the cache.
    await adapter[method](...args)
    assert.deepEqual([...adapter.touched], [collection], method)
    assert.notEqual(adapter.document[collection], shared[collection], method)
    for (const other of Object.keys(shared).filter(key => key !== collection)) {
      assert.equal(adapter.document[other], shared[other], `${method} left ${other} alone`)
    }
  }
})

const historyEntry = (id, addedDate = 1) => ({
  video: { id, title: id, uploader: { id: 'UC-channel', name: 'Channel' } },
  metadata: { added_date: addedDate, watched_state: 'watching', position_millis: 1 },
})

test('a combined history change turns the loaded collection into the edited one', async () => {
  const loaded = deepFreeze(['a', 'b', 'c', 'd'].map(id => historyEntry(id)))
  const adapter = new EncryptedSyncAdapter({ history: loaded })
  assert.equal(adapter.getChange('history'), null)
  await adapter.applyWatchHistoryChanges([historyEntry('a', 2), historyEntry('e')], ['b'])
  await adapter.putWatchHistory(historyEntry('b', 3))
  await adapter.deleteWatchHistory('e')
  await adapter.putWatchHistoryBulk([historyEntry('a', 4), historyEntry('f')])
  const change = adapter.getChange('history')
  assert.deepEqual(applyRemoteHistoryChanges({ history: loaded, ...change }), adapter.document.history)
  assert.deepEqual(adapter.document.history.map(entry => entry.video.id), ['c', 'd', 'b', 'a', 'f'])
  assert.equal(adapter.getChange('settings'), null)
})

test('reads full and incremental collection responses with their changes', async () => {
  const privacy = await preparePrivacyKey(null, 'change-log-passphrase')
  const base = [historyEntry('a'), historyEntry('b')]
  const payload = await encryptSyncDocument(base, privacy.key, privacy.salt)
  const changes = [
    { revision: 3, payload: await encryptSyncChange({ upserts: [historyEntry('a', 2)], deletions: [] }, privacy.key, privacy.salt) },
    { revision: 4, payload: await encryptSyncChange({ upserts: [], deletions: ['b'] }, privacy.key, privacy.salt) },
  ]
  // Small changes are not padded to the size of a collection.
  assert.ok(changes[0].payload.length < payload.length / 4)

  // Servers without change logs return only the payload.
  assert.deepEqual(await readSyncCollection('history', { revision: 2, payload }, null, privacy.key), { revision: 2, data: base })
  assert.deepEqual(await readSyncCollection('history', { revision: 0, payload: null }, null, privacy.key), { revision: 0, data: undefined })

  const full = await readSyncCollection('history', { revision: 4, payload, base_revision: 2, changes }, null, privacy.key)
  assert.deepEqual(full, { revision: 4, data: [historyEntry('a', 2)] })
  const incremental = await readSyncCollection(
    'history', { revision: 4, payload: null, base_revision: 2, changes: changes.slice(1) },
    { revision: 3, data: [historyEntry('b'), historyEntry('a', 2)] }, privacy.key
  )
  assert.deepEqual(incremental, full)
  const unchanged = { revision: 4, data: full.data }
  assert.equal((await readSyncCollection('history', { revision: 4, payload: null, base_revision: 2, changes: [] }, unchanged, privacy.key)).data, full.data)

  for (const response of [
    { revision: 4, payload, base_revision: 2, changes: changes.slice(1) },
    { revision: 5, payload, base_revision: 2, changes },
    { revision: 4, payload: null, base_revision: 2, changes: changes.slice(1) },
  ]) {
    await assert.rejects(readSyncCollection('history', response, null, privacy.key), /Invalid encrypted sync response/)
  }
  // A collection whose change format this version does not know cannot be applied.
  await assert.rejects(
    readSyncCollection('settings', { revision: 3, payload, base_revision: 2, changes: changes.slice(0, 1) }, null, privacy.key),
    /newer OpenTubeX version/
  )
})
