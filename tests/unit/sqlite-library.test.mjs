import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rm, writeFile, appendFile } from 'node:fs/promises'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'
import model from '@seald-io/nedb/lib/model.js'
import Datastore from '@seald-io/nedb'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { StartupLibrary } from '../../src/datastores/sqlite/startup.js'
import { createDeferredCursor } from '../../src/datastores/sqlite/cursor.js'
import { openLibrary } from '../../src/datastores/sqlite/migration.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { metadataPage } from '../../src/datastores/sqlite/metadata.js'
import { LibraryExports } from '../../src/datastores/sqlite/export.js'
import { filterVideosWithQuery } from '../../src/renderer/helpers/historySearch.js'
import { canMarkHistoryEntryAsWatched, migrateLegacyHistoryRecord } from '../../src/history.js'
import { historyRepairRecord, markAllHistory, applySubscriptionUnseenHistory, recommendationInputs, importSubscriptionProfiles, removePlaylistMember, removePlaylistMembers, addSelectedPlaylistVideos, playlistVideoIds, playlistImportCandidates } from '../../src/datastores/sqlite/operations.js'

test('legacy subscription imports accept nullable custom profile names without discarding subscriptions', async t => {
  const engine = memory(t)
  await engine.collections.profiles.insertAsync({ _id: 'allChannels', name: null, subscriptions: [], unknown: new Date(0) })
  const incoming = { _id: 'custom', name: null, subscriptions: [{ id: 'channel', name: 'Retained' }], unknown: new Date(1) }
  assert.equal(await importSubscriptionProfiles(engine, { profiles: [incoming] }), true)
  assert.deepEqual(await engine.collections.profiles.findOneAsync({ _id: 'custom' }), incoming)
  assert.deepEqual((await engine.collections.profiles.findOneAsync({ _id: 'allChannels' })).subscriptions, incoming.subscriptions)
})

for (const unicode of [false, true]) {
  for (const verified of [false, true]) {
    test(`single deletes preserve NeDB natural ID order, unicode: ${unicode}, verifier: ${verified}`, async t => {
      const engine = memory(t), legacy = new Datastore({ inMemoryOnly: true })
      const records = [{ _id: unicode ? '\u{10000}' : 'a', videoId: 'first', timeWatched: 1 }, { _id: unicode ? '\uE000' : 'z', videoId: 'second', timeWatched: 100 }]
      await engine.collections.history.insertAsync(records)
      await legacy.insertAsync(records)
      const query = verified ? { $where() { return this.timeWatched > 0 } } : { timeWatched: { $gt: 0 } }
      assert.equal(await engine.collections.history.removeAsync(query), await legacy.removeAsync(query))
      assert.deepEqual(await engine.collections.history.findAsync({}), await legacy.findAsync({}))
    })
  }
}

for (const duplicate of [false, true]) {
  test(`single membership removal clears only lost history context, surviving duplicate: ${duplicate}`, async t => {
    const engine = memory(t)
    const removed = { videoId: 'video', playlistItemId: 'old', unknown: new Date(1) }
    const retained = { videoId: 'video', playlistItemId: 'retained', unknown: new Date(2) }
    await engine.collections.playlists.insertAsync({ _id: 'p', videos: [removed, ...(duplicate ? [retained] : [])] })
    const history = { _id: 'history', videoId: 'video', lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', unknown: new Date(3), watchProgress: 20 }
    await engine.collections.history.insertAsync(history)
    const memberId = engine.playlistPage({ id: 'p' }).records[0]._libraryMemberId
    assert.equal(await engine.transaction(() => removePlaylistMember(engine, { id: 'p', memberId })), true)
    const { lastViewedPlaylistId, lastViewedPlaylistType, ...cleared } = history
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'history' }), duplicate ? history : cleared)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, duplicate ? [retained] : [])
  })
}

for (const sort of ['custom', 'video_title_ascending', 'author_descending', 'date_added_descending', 'published_ascending']) {
  test(`history writes do not invalidate ${sort} playlist cursors`, async t => {
    const engine = memory(t)
    const playlist = { _id: 'p', videos: [0, 1, 2].map(index => ({ videoId: `v${index}`, title: `Title ${index}`, author: `Author ${index}`, timeAdded: index, published: index, unknown: new Date(index) })) }
    await engine.collections.playlists.insertAsync(playlist)
    const first = engine.playlistPage({ id: 'p', sort, limit: 1 })
    const expected = engine.playlistPage({ id: 'p', sort, limit: 1, cursor: first.cursor })
    await engine.collections.history.insertAsync({ _id: 'history', videoId: 'v0', timeWatched: 100, watchProgress: 20 })
    assert.deepEqual(engine.playlistPage({ id: 'p', sort, limit: 1, cursor: first.cursor }), expected)
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
    const duration = engine.playlistPage({ id: 'p', sort: 'video_duration_ascending', limit: 1 })
    await engine.collections.history.updateAsync({ _id: 'history' }, { $set: { lengthSeconds: 60 } })
    assert.equal(engine.playlistPage({ id: 'p', sort: 'video_duration_ascending', limit: 1, cursor: duration.cursor }).stale, true)
  })
}

test('playlist summaries preserve opaque membership shapes while keeping real member arrays bounded', async t => {
  const engine = memory(t)
  const records = [undefined, null, false, 42, 'retained', { unknown: true }, [], [{ videoId: 'valid' }]].map((videos, index) => ({
    _id: `shape-${index}`, playlistName: 'Retained', ...(videos === undefined ? {} : { videos }), unknown: new Date(index),
  }))
  await engine.collections.playlists.insertAsync(records)
  const summaries = engine.playlistSummaries()
  for (const record of records) {
    const summary = summaries.find(value => value._id === record._id)
    assert.deepEqual(summary.videos, Array.isArray(record.videos) ? [] : record.videos)
    assert.equal(summary.videoCount, Array.isArray(record.videos) ? record.videos.length : 0)
    assert.deepEqual(await engine.playlistSnapshot({ id: record._id }), record)
  }
})

test('a busy transaction start releases its async owner before later queued reads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-busy-owner-'))
  const database = new DatabaseSync(join(directory, 'library.sqlite'))
  database.exec(SCHEMA_SQL)
  const engine = new LibraryEngine(database), blocker = new DatabaseSync(join(directory, 'library.sqlite'))
  t.after(async () => { blocker.close(); database.close(); await rm(directory, { recursive: true, force: true }) })
  await engine.collections.settings.insertAsync({ _id: 'record', value: 0 })
  const exec = database.exec
  let failedOwner
  t.mock.method(database, 'exec', function(sql) {
    if (sql === 'BEGIN IMMEDIATE' && !failedOwner) failedOwner = engine.transactionContext.getStore()
    return exec.call(this, sql)
  })
  blocker.exec('BEGIN IMMEDIATE')
  await assert.rejects(engine.transaction(() => assert.fail('a busy BEGIN must not run the operation')), /locked|busy/i)
  blocker.exec('ROLLBACK')
  assert.equal(failedOwner.active, false)
  assert.equal(engine.transactionDepth, 0)
  const entered = Promise.withResolvers(), resume = Promise.withResolvers()
  const owner = engine.transaction(async () => {
    await engine.collections.settings.updateAsync({ _id: 'record' }, { $set: { value: 1 } })
    entered.resolve()
    await resume.promise
  })
  await entered.promise
  let completed = false
  const read = engine.transactionContext.run(failedOwner, () => engine.collections.settings.findOneAsync({ _id: 'record' })).then(record => { completed = true; return record })
  await setImmediate()
  const early = completed
  resume.resolve()
  await owner
  assert.deepEqual(await read, { _id: 'record', value: 1 })
  assert.equal(early, false, 'the failed owner must not observe another suspended transaction')
})

for (const videoId of ['\ud800', '\udc00', 'embedded-\ud800-id']) {
  test(`history operations retain exact malformed UTF-16 video identity: ${JSON.stringify(videoId)}`, async t => {
    const engine = memory(t)
    const counterpart = videoId.toWellFormed()
    const original = { _id: 'target', videoId, isWatched: true, timeWatched: 1, watchProgress: 12,
      lengthSeconds: 20, lastViewedPlaylistItemId: 'member', unknown: { date: new Date(0) } }
    const other = { ...original, _id: 'other', videoId: counterpart }
    // Cross the bounded SELECT boundary as well as the first page.
    const targets = Array.from({ length: 251 }, (_, index) => ({ ...original, _id: `target-${String(index).padStart(3, '0')}` }))
    await engine.collections.history.insertAsync([original, other, ...targets])
    await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId, seenAt: 2, unseenAt: 2 }]) })
    await t.test('repair lookup', () => {
      assert.deepEqual(historyRepairRecord(engine, { id: original._id, videoId }), original)
      assert.equal(historyRepairRecord(engine, { id: other._id, videoId }), null)
    })
    await t.test('unseen marks across pages', async () => {
      assert.equal(await applySubscriptionUnseenHistory(engine), 252)
      for (const record of [original, ...targets]) assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), { ...record, isWatched: false })
      assert.deepEqual(await engine.collections.history.findOneAsync({ _id: other._id }), other)
    })
    await engine.collections.history.updateAsync({ _id: { $ne: other._id } }, { $set: { isWatched: false } }, { multi: true })
    await t.test('mark-all propagation', async () => {
      let seen
      const result = await markAllHistory(engine, {}, { settings: { mergeSeenVideos: async ({ videos }) => { seen = videos; return videos } } })
      assert.equal(result.count, 252)
      assert.deepEqual(seen, [{ videoId, seenAt: 2, unseenAt: 2 }])
      for (const record of [original, other, ...targets]) assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), record)
    })
  })
}

function memory(t) {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(SCHEMA_SQL)
  t.after(() => database.close())
  return new LibraryEngine(database)
}

test('migration never activates while a reader blocks its final WAL checkpoint', async t => {
  const path = await directory(t)
  const original = model.serialize({ _id: 'history', videoId: 'video', timeWatched: 1, unknown: new Date(1) }) + '\n'
  await writeFile(join(path, 'history.db'), original)
  let reader
  try {
    await assert.rejects(openLibrary(path, {
      onCheckpoint: checkpoint => {
        if (checkpoint.collection !== 'history' || reader) return
        reader = new DatabaseSync(join(path, 'library.sqlite.migrating'), { readOnly: true })
        reader.exec('BEGIN')
        reader.prepare('SELECT count(*) FROM records').get()
      }
    }), /checkpoint.*incomplete/i)
    await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
    await assert.rejects(readFile(join(path, 'library.sqlite.initialized')), { code: 'ENOENT' })
    assert.equal(await readFile(join(path, 'history.db'), 'utf8'), original)
    reader.close()
    reader = null
    const engine = await openLibrary(path)
    try {
      assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'history' }), model.deserialize(original.trim()))
      assert.equal(engine.database.prepare('PRAGMA synchronous').get().synchronous, 2)
    } finally { engine.database.close() }
  } finally { reader?.close() }
})

test('invalid UTF-8 migration errors identify the source and line while retaining every original byte', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-invalid-utf8-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const original = Buffer.concat([Buffer.from(model.serialize({ _id: 'first', videoId: 'first', unknown: new Date(1) }) + '\n'), Buffer.from([0xFF, 0x0A])])
  await writeFile(join(directory, 'history.db'), original)
  await assert.rejects(openLibrary(directory, { batchSize: 1 }), error => /history\.db at line 2/.test(error.message) && /original file has not been changed/.test(error.message) && error.cause?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
  assert.deepEqual(await readFile(join(directory, 'history.db')), original)
  await assert.rejects(readFile(join(directory, 'library.sqlite')), { code: 'ENOENT' })
})

for (const tombstone of [false, true]) {
  test(`migration fails closed for unpaired surrogate ${tombstone ? 'tombstone' : 'record'} IDs without altering originals`, async t => {
    const path = await mkdtemp(join(tmpdir(), 'opentubex-unpaired-id-'))
    let unexpectedEngine
    t.after(async () => { unexpectedEngine?.database.close(); await rm(path, { recursive: true, force: true }) })
    const records = tombstone
      ? [{ _id: '\uFFFD', videoId: 'keep', unknown: { keep: true } }, { _id: '\ud800', $$deleted: true }]
      : [{ _id: '\ud800', videoId: 'first' }, { _id: '\ud801', videoId: 'second' }]
    const original = records.map(record => model.serialize(record)).join('\n') + '\n'
    await writeFile(join(path, 'history.db'), original)
    await assert.rejects(async () => { unexpectedEngine = await openLibrary(path) }, /unpaired UTF-16 surrogate/)
    assert.equal(await readFile(join(path, 'history.db'), 'utf8'), original)
    await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
  })
}

test('unpaired string predicates use NeDB verification instead of targeting replacement-character records', async t => {
  const engine = memory(t)
  const records = [{ _id: '\uFFFD', videoId: '\uFFFD', title: '\uFFFD' }, { _id: 'plain', videoId: 'plain', title: '\ud801' }, { _id: '𐀀', videoId: 'paired', title: '\ud800' }, { _id: 'surrogate-video', videoId: '\ud800', title: 'Retained' }]
  const legacy = new Datastore({ inMemoryOnly: true })
  await engine.collections.history.insertAsync(records)
  await legacy.insertAsync(records)
  for (const field of ['_id', 'title', 'videoId']) {
    for (const condition of ['\uFFFD', '\ud800', { $ne: '\ud800' }, { $in: ['plain', '\ud800'] }, { $nin: ['\ud800'] }]) {
      const query = { [field]: condition }
      assert.deepEqual(await engine.collections.history.findAsync(query).sort({ _id: 1 }), await legacy.findAsync(query).sort({ _id: 1 }))
      assert.equal(await engine.collections.history.countAsync(query), await legacy.countAsync(query))
    }
  }
  await assert.rejects(engine.collections.history.insertAsync([{ _id: 'new', videoId: 'new' }, { _id: '\ud800', videoId: 'unsafe' }]), /unpaired UTF-16 surrogate/)
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
})

for (const timeWatched of [new Date(2), '2026-01-01', undefined, null, false, [1], { value: 1 }, 1]) {
  test(`normalized latest-history readers retain NeDB ordering for ${model.serialize({ timeWatched })}`, async t => {
    for (const action of ['state', 'statistics', 'duration', 'cleanup']) {
      await t.test(action, async t => {
        const engine = memory(t)
        const legacy = new Datastore({ inMemoryOnly: true })
        const videoId = 'abcdefghijk'
        const records = [
          { _id: '\uE000', videoId, ...(timeWatched === undefined ? {} : { timeWatched }), cachedAt: model.compareThings(timeWatched, 1) > 0 ? 0 : 9999, isWatched: false, watchProgress: 10, lengthSeconds: 120, unknown: new Date(3) },
          { _id: '😀', videoId, timeWatched: 1, isWatched: true, watchProgress: 100, lengthSeconds: 300, unknown: new Date(4) },
        ]
        const playlist = { _id: 'p', videos: [{ videoId, unknown: new Date(5) }, { videoId: 'other', lengthSeconds: 180 }], unknown: new Date(6), lastUpdatedAt: 1 }
        await engine.collections.history.insertAsync(records)
        await legacy.insertAsync(records)
        await engine.collections.playlists.insertAsync(playlist)
        const newest = (await legacy.findAsync({ videoId }).sort({ timeWatched: -1, _id: -1 }))[0]
        if (action === 'state') assert.deepEqual((await engine.videoState({ ids: [videoId] })).history, [migrateLegacyHistoryRecord(newest)])
        if (action === 'statistics') assert.deepEqual(engine.playlistStatistics({ id: 'p' }), { total: 2, uniqueCount: 2, duration: newest.lengthSeconds + 180, missingDuration: 0, watchedCount: Number(newest.isWatched) })
        if (action === 'duration') assert.deepEqual(engine.playlistPage({ id: 'p', sort: 'video_duration_ascending' }).records.map(record => record.videoId), newest.lengthSeconds < 180 ? [videoId, 'other'] : ['other', videoId])
        if (action === 'cleanup') {
          assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), Number(newest.isWatched))
          assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, newest.isWatched ? playlist.videos.slice(1) : playlist.videos)
        } else assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
        assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
      })
    }
  })
}

test('repeated playlist statistics reuse only the current durable revision and return independent values', async t => {
  const engine = memory(t)
  const videos = [{ videoId: 'video', unknown: new Date(1) }, { videoId: 'video', lengthSeconds: 20 }]
  await engine.collections.playlists.insertAsync({ _id: 'playlist', playlistName: 'Original', videos, unknown: new Date(2) })
  await engine.collections.history.insertAsync({ _id: 'watched', videoId: 'video', timeWatched: 1, isWatched: true, lengthSeconds: 100, unknown: new Date(3) })
  const original = await engine.playlistSnapshot({ id: 'playlist' })
  let lookups = 0
  const latest = engine.latestHistoryRows.bind(engine)
  t.mock.method(engine, 'latestHistoryRows', ids => { lookups++; return latest(ids) })
  const expected = { total: 2, uniqueCount: 1, duration: 120, missingDuration: 0, watchedCount: 2 }
  const first = engine.playlistStatistics({ id: 'playlist' })
  assert.deepEqual(first, expected)
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist', includeExpiry: true }), { ...expected, refreshAt: null })
  const firstLookups = lookups
  assert.ok(firstLookups > 0)
  first.duration = -1
  first.watchedCount = -1
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), expected)
  assert.equal(lookups, firstLookups, 'unchanged statistics must not reload history')
  await engine.collections.playlists.updateAsync({ _id: 'playlist' }, { $set: { playlistName: 'Renamed' } })
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), expected)
  assert.ok(lookups > firstLookups)
  await engine.collections.history.updateAsync({ _id: 'watched' }, { $set: { lengthSeconds: 60, isWatched: false, watchProgress: 0 } })
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), { ...expected, duration: 80, watchedCount: 0 })
  await engine.collections.playlists.updateAsync({ _id: 'playlist' }, { $push: { videos: { videoId: 'other', lengthSeconds: 30 } } })
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), { total: 3, uniqueCount: 2, duration: 110, missingDuration: 0, watchedCount: 0 })
  assert.deepEqual(await engine.playlistSnapshot({ id: 'playlist' }), { ...original, playlistName: 'Renamed', videos: [...videos, { videoId: 'other', lengthSeconds: 30 }] })
})

test('playlist statistics discard an aborted view before the same revisions are committed', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos: [{ videoId: 'video' }], unknown: new Date(1) })
  await engine.collections.history.insertAsync({ _id: 'history', videoId: 'video', timeWatched: 1, lengthSeconds: 100, isWatched: false, unknown: new Date(2) })
  const read = () => engine.playlistStatistics({ id: 'playlist' })
  const original = { total: 1, uniqueCount: 1, duration: 100, missingDuration: 0, watchedCount: 0 }
  assert.deepEqual(read(), original)
  await assert.rejects(engine.transaction(async () => {
    await engine.collections.history.updateAsync({ _id: 'history' }, { $set: { lengthSeconds: 150, isWatched: true } })
    await engine.collections.playlists.updateAsync({ _id: 'playlist' }, { $push: { videos: { videoId: 'other', lengthSeconds: 50 } } })
    assert.deepEqual(read(), { total: 2, uniqueCount: 2, duration: 200, missingDuration: 0, watchedCount: 1 })
    throw new Error('abort cached statistics')
  }), /abort cached statistics/)
  assert.deepEqual(read(), original)
  await engine.transaction(async () => {
    await engine.collections.history.updateAsync({ _id: 'history' }, { $set: { lengthSeconds: 180, isWatched: false } })
    await engine.collections.playlists.updateAsync({ _id: 'playlist' }, { $push: { videos: { videoId: 'other', lengthSeconds: 60 } } })
  })
  assert.deepEqual(read(), { total: 2, uniqueCount: 2, duration: 240, missingDuration: 0, watchedCount: 0 })
  assert.deepEqual(await engine.playlistSnapshot({ id: 'playlist' }), { _id: 'playlist', videos: [{ videoId: 'video' }, { videoId: 'other', lengthSeconds: 60 }], unknown: new Date(1) })
})

test('cached playlist watched counts expire when a retained premiere becomes watchable', async t => {
  const engine = memory(t)
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  const videos = [{ videoId: 'premiere' }, { videoId: 'premiere' }, { videoId: 'later' }]
  const history = [
    { _id: 'premiere', videoId: 'premiere', timeWatched: 1, isWatched: true, isUpcoming: true, premiereTimestamp: 2, lengthSeconds: 100, unknown: new Date(1) },
    { _id: 'later', videoId: 'later', timeWatched: 2, watchProgress: 100, isUpcoming: true, premiereTimestamp: '3', lengthSeconds: 100, unknown: new Date(2) },
  ]
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos })
  await engine.collections.history.insertAsync(history)
  const revision = engine.revision('history')
  const expected = { total: 3, uniqueCount: 2, duration: 300, missingDuration: 0, watchedCount: 0 }
  let lookups = 0
  const latest = engine.latestHistoryRows.bind(engine)
  t.mock.method(engine, 'latestHistoryRows', ids => { lookups++; return latest(ids) })
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), expected)
  const firstLookups = lookups
  now = 1999
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), expected)
  assert.equal(lookups, firstLookups, 'the cache remains useful before the next premiere')
  now = 2000
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), { ...expected, watchedCount: 2 })
  now = 3000
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), { ...expected, watchedCount: 3 })
  now = 1000
  assert.deepEqual(engine.playlistStatistics({ id: 'playlist' }), expected, 'a backwards clock change also invalidates the cache')
  assert.equal(engine.revision('history'), revision)
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), history.toSorted((a, b) => model.compareThings(a._id, b._id)))
  assert.deepEqual((await engine.playlistSnapshot({ id: 'playlist' })).videos, videos)
})

test('legacy subscription import accepts the primary null name and preserves current profile metadata', async t => {
  const engine = memory(t)
  const original = { _id: 'allChannels', name: 'Current name', subscriptions: [{ id: 'current', showMembersOnly: true }], unknown: new Date(1) }
  await engine.collections.profiles.insertAsync(original)
  const custom = { _id: 'custom', name: 'Custom', subscriptions: [{ id: 'custom-channel' }], unknown: { keep: true } }
  await importSubscriptionProfiles(engine, { profiles: [{ _id: 'allChannels', name: null, subscriptions: [{ id: 'imported' }] }, custom] })
  assert.deepEqual(await engine.collections.profiles.findAsync({}).sort({ _id: 1 }), [
    { ...original, subscriptions: [...original.subscriptions, { id: 'imported' }, ...custom.subscriptions] }, custom,
  ])
  await assert.rejects(importSubscriptionProfiles(engine, { profiles: [{ _id: 'invalid-custom', name: 42, subscriptions: [] }] }), /Invalid subscription profiles/)
  assert.equal(await engine.collections.profiles.countAsync({}), 2)
})

test('legacy subscription profile import preserves current settings, metadata and name/ID collision rules', async t => {
  const engine = memory(t)
  const main = { _id: 'allChannels', name: 'Current primary', subscriptions: [{ id: 'current', showMembersOnly: true }], unknown: new Date(1) }
  const custom = { _id: 'custom', name: 'Existing name', subscriptions: [{ id: 'kept', showMembersOnly: true }], unknown: new Date(2) }
  await engine.collections.profiles.insertAsync([main, custom])
  const profiles = [
    { _id: 'incoming-name', name: custom.name, subscriptions: [{ id: 'kept', showMembersOnly: false }, { id: 'new' }], icon: { type: 'image', value: 'existing-name' } },
    { _id: custom._id, name: 'Different name', subscriptions: [{ id: 'new-group' }] },
    { _id: main._id, name: 'Ignored primary name', subscriptions: [{ id: 'current', showMembersOnly: false }], icon: { type: 'image', value: 'primary' } },
  ]
  assert.equal(await importSubscriptionProfiles(engine, { profiles }), true)
  assert.deepEqual(await engine.collections.profiles.findOneAsync({ _id: custom._id }), { ...custom, subscriptions: [...custom.subscriptions, { id: 'new' }], icon: profiles[0].icon })
  assert.deepEqual(await engine.collections.profiles.findOneAsync({ _id: main._id }), { ...main, subscriptions: [...main.subscriptions, { id: 'kept', showMembersOnly: false }, { id: 'new' }, { id: 'new-group' }], icon: profiles[2].icon })
  const created = await engine.collections.profiles.findOneAsync({ name: 'Different name' })
  assert.notEqual(created._id, custom._id)
  assert.deepEqual(created, { ...profiles[1], _id: created._id })
  assert.equal(await engine.collections.profiles.countAsync({}), 3)
})

test('a failed legacy subscription profile import rolls back new profiles and primary changes together', async t => {
  const engine = memory(t)
  const original = { _id: 'allChannels', name: 'Primary', subscriptions: [{ id: 'current', unknown: new Date(1) }], unknown: new Date(2) }
  await engine.collections.profiles.insertAsync(original)
  const update = engine.collections.profiles.updateAsync.bind(engine.collections.profiles)
  t.mock.method(engine.collections.profiles, 'updateAsync', async (...args) => {
    await update(...args)
    throw new Error('failure after the primary merge')
  })
  await assert.rejects(importSubscriptionProfiles(engine, { profiles: [{ _id: 'new', name: 'New profile', subscriptions: [{ id: 'imported' }] }] }), /failure after the primary merge/)
  assert.deepEqual(await engine.collections.profiles.findAsync({}), [original])
})

test('Continue Watching applies original timestamp and UTF-16 order before every page', async t => {
  const engine = memory(t)
  const legacy = new Datastore({ inMemoryOnly: true })
  const times = [new Date(2), '2026-01-01', undefined, null, false, [1], { value: 1 }, 1]
  const records = times.map((timeWatched, index) => ({ _id: String(index), videoId: `v${String(index).padStart(10, '0')}`, ...(timeWatched === undefined ? {} : { timeWatched }), cachedAt: 999 - index, isWatched: false, watchProgress: 10, lengthSeconds: 120, type: 'video', authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: `Original ${index}`, unknown: new Date(index) }))
  records.push(...['\uE000', '😀'].map(_id => ({ ...records.at(-1), _id, videoId: _id })))
  await engine.collections.history.insertAsync(records)
  await legacy.insertAsync(records)
  const expected = (await legacy.findAsync({}).sort({ timeWatched: -1 })).map(migrateLegacyHistoryRecord)
  const collected = []
  while (collected.length < expected.length) {
    const page = engine.continuedHistoryPage({ offset: collected.length, limit: 3 })
    assert.equal(page.total, expected.length)
    collected.push(...page.records)
  }
  assert.deepEqual(collected, expected)
  assert.deepEqual(recommendationInputs(engine).history.map(record => record.title), (await legacy.findAsync({}).sort({ timeWatched: -1 })).map(record => record.title))
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
})

test('legacy Continue Watching excludes unwatchable candidates before filling page slots', async t => {
  const engine = memory(t)
  const legacy = new Datastore({ inMemoryOnly: true })
  const records = [
    { _id: 'live', timeWatched: { value: 1 }, isLive: true },
    { _id: 'missing-premiere', timeWatched: [1], isUpcoming: true },
    { _id: 'invalid-premiere', timeWatched: new Date(3), isUpcoming: true, premiereTimestamp: 'invalid' },
    { _id: 'future-premiere', timeWatched: 'future', isUpcoming: true, premiereTimestamp: Date.now() / 1000 + 3600 },
    { _id: 'eligible-date', timeWatched: new Date(2) },
    { _id: 'eligible-numeric', timeWatched: 1 },
  ].map(record => ({ videoId: record._id, watchProgress: 10, lengthSeconds: 120, isWatched: false, unknown: new Date(7), ...record }))
  await engine.collections.history.insertAsync(records)
  await legacy.insertAsync(records)
  const expected = (await legacy.findAsync({}).sort({ timeWatched: -1 })).filter(record => canMarkHistoryEntryAsWatched(record)).map(migrateLegacyHistoryRecord)
  assert.equal(expected.length, 2)
  const collected = []
  for (let offset = 0; offset < expected.length; offset++) {
    const page = engine.continuedHistoryPage({ offset, limit: 1 })
    assert.equal(page.total, expected.length)
    collected.push(...page.records)
  }
  assert.deepEqual(collected, expected)
  assert.deepEqual(engine.continuedHistoryPage({ offset: expected.length, limit: 1 }).records, [])
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
})

for (const [name, field] of [['playlists', 'videos'], ['subscriptionCache', 'communityPosts']]) {
  for (const condition of [{ $ne: 'post' }, { $nin: ['post'] }, { $nin: ['post', 'video'] }, { $ne: 'post', $exists: false }, { $ne: 'post', $exists: true }, { $not: { videoId: 'post' } }]) {
    test(`${name} negative video-ID queries keep post-only members: ${JSON.stringify(condition)}`, async t => {
      const collection = memory(t).collections[name]
      const legacy = new Datastore({ inMemoryOnly: true })
      const members = [{ postId: 'post' }, { postId: 'post', videoId: null }, { postId: 'post', videoId: 'post' }, { videoId: 'video' }]
      const records = members.map((member, index) => ({ _id: String(index), [field]: [{ ...member, unknown: new Date(index) }], unknown: { keep: true } }))
      records.push({ _id: 'mixed', [field]: [records[0][field][0], records[2][field][0]], unknown: new Date(7) })
      await collection.insertAsync(records)
      await legacy.insertAsync(records)
      const predicate = condition.$not ? condition : { videoId: condition }
      const query = { [field]: { $elemMatch: predicate } }
      assert.deepEqual(await collection.findAsync(query).sort({ _id: 1 }), await legacy.findAsync(query).sort({ _id: 1 }))
      assert.equal(await collection.countAsync(query), await legacy.countAsync(query))
      assert.deepEqual(await collection.findAsync(query).sort({ _id: 1 }).skip(1).limit(1), await legacy.findAsync(query).sort({ _id: 1 }).skip(1).limit(1))
      const update = { $set: { checked: true } }
      assert.equal((await collection.updateAsync(query, update, { multi: true })).numAffected, (await legacy.updateAsync(query, update, { multi: true })).numAffected)
      assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
      const pull = { $pull: { [field]: predicate } }
      assert.equal((await collection.updateAsync({}, pull, { multi: true })).numAffected, (await legacy.updateAsync({}, pull, { multi: true })).numAffected)
      assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
    })
  }
}

test('numeric history pages retain Unicode timestamp ties across cursors in both directions', async t => {
  const engine = memory(t)
  const legacy = new Datastore({ inMemoryOnly: true })
  const records = ['\uE000', '😀', '😁', 'a'].map(_id => ({ _id, videoId: _id, timeWatched: 123, unknown: new Date(2) }))
  await engine.collections.history.insertAsync(records)
  await legacy.insertAsync(records)
  for (const oldest of [false, true]) {
    const direction = oldest ? 1 : -1
    const expected = (await legacy.findAsync({}).sort({ timeWatched: direction, _id: direction })).map(migrateLegacyHistoryRecord)
    const collected = []
    let cursor = null
    do {
      const page = engine.historyPage({ oldest, limit: 1, cursor })
      collected.push(...page.records)
      cursor = page.cursor
    } while (cursor)
    assert.deepEqual(collected, expected)
  }
})

test('numeric history paging and latest lookup remain bounded on twenty thousand records', async t => {
  const engine = memory(t)
  const records = Array.from({ length: 20_000 }, (_, index) => ({ _id: String(index).padStart(5, '0'), videoId: index % 2 ? 'odd' : 'even', timeWatched: index, isWatched: false, watchProgress: 10, lengthSeconds: 120, unknown: new Date(index) }))
  await engine.collections.history.insertAsync(records)
  let compared = 0
  engine.database.function('nedb_id_sort', { deterministic: true }, id => { compared++; return Buffer.from(id, 'utf16le').swap16() })
  const deserialize = model.deserialize
  let hydrated = 0
  t.mock.method(model, 'deserialize', data => { if (data.includes('videoId')) hydrated++; return deserialize(data) })
  assert.deepEqual((await engine.videoState({ ids: ['odd', 'even'] })).history, [records.at(-1), records.at(-2)].map(migrateLegacyHistoryRecord))
  assert.equal(hydrated, 2)
  assert.ok(compared <= 4, 'timestamp indexes must restrict Unicode comparison to the newest ties')
  compared = 0; hydrated = 0
  assert.deepEqual(engine.continuedHistoryPage({ limit: 2 }).records, [records.at(-1), records.at(-2)].map(migrateLegacyHistoryRecord))
  assert.equal(hydrated, 2)
  assert.ok(compared <= 4, 'paging must stop after the requested timestamp groups')
})

for (const scope of [{ account: 'a' }, new Date(42), ['a', { nested: new Date(2) }], { nested: [{ unknown: new Date(3) }] }, {}, null, false, 12, 'a']) {
  test(`modifier upsert preserves literal equality ${model.serialize({ scope })}`, async t => {
    const engine = memory(t)
    const legacy = new Datastore({ inMemoryOnly: true })
    const query = { _id: 'literal', scope }
    for (const value of [1, 2]) {
      const update = { $set: { value } }
      const options = { upsert: true, returnUpdatedDocs: true }
      assert.deepEqual(await engine.collections.settings.updateAsync(query, update, options), await legacy.updateAsync(query, update, options))
      assert.deepEqual(await engine.collections.settings.findAsync({}), await legacy.findAsync({}))
    }
    assert.equal(await engine.collections.settings.countAsync({}), 1)
  })
}

for (const scope of [{ $gte: 1 }, /a/, { account: 'a', range: { $lt: 3 } }]) {
  test(`modifier upsert strips query operators like NeDB ${String(scope)}`, async t => {
    const engine = memory(t)
    const legacy = new Datastore({ inMemoryOnly: true })
    const query = { _id: 'operators', scope, 'nested.path': 1, $or: [{ optional: true }, { optional: false }] }
    const update = { $set: { value: 1 } }
    const options = { upsert: true, returnUpdatedDocs: true }
    assert.deepEqual(await engine.collections.settings.updateAsync(query, update, options), await legacy.updateAsync(query, update, options))
    assert.deepEqual(await engine.collections.settings.findAsync({}), await legacy.findAsync({}))
  })
}

test('modifier upsert preserves own prototype keys inside literal arrays', async t => {
  const engine = memory(t)
  const scope = [JSON.parse('{"__proto__":{"retained":true},"constructor":{"unknown":true},"date":0}')]
  const query = { _id: 'prototype', scope }
  const result = await engine.collections.settings.updateAsync(query, { $set: { value: 1 } }, { upsert: true, returnUpdatedDocs: true })
  assert.deepEqual(result.affectedDocuments, { ...query, value: 1 })
  assert.deepEqual(await engine.collections.settings.findOneAsync({ _id: query._id }), { ...query, value: 1 })
  assert.equal(Object.prototype.retained, undefined)
})

for (const videoId of [42, false]) {
  test(`legacy duplicate cleanup clears only the removed ${videoId} occurrence context`, async t => {
    const engine = memory(t)
    const videos = [{ videoId, playlistItemId: 'kept', unknown: new Date(1) }, { videoId, playlistItemId: 'removed', unknown: new Date(2) }]
    const records = ['kept', 'removed'].map(item => ({ _id: item, videoId, timeWatched: 1, lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: item, watchProgress: 123, unknown: new Date(3) }))
    await engine.collections.playlists.insertAsync({ _id: 'p', videos })
    await engine.collections.history.insertAsync(records)
    assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'duplicates' }), 1)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, [videos[0]])
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'kept' }), records[0])
    const { lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId, ...retained } = records[1]
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'removed' }), retained)
  })
}

test('normalized field replacements and unsets retain the same scalar values as NeDB', async t => {
  const engine = memory(t)
  const legacy = new Datastore({ inMemoryOnly: true })
  await engine.collections.playlists.insertAsync({ _id: 'p', videos: [{ videoId: 'video' }], unknown: new Date(1) })
  await legacy.insertAsync({ _id: 'p', videos: [{ videoId: 'video' }], unknown: new Date(1) })
  for (const value of [null, false, 42, 'retained', { unknown: new Date(2) }, [{ videoId: 'restored' }]]) {
    const update = { $set: { videos: value } }
    await engine.collections.playlists.updateAsync({ _id: 'p' }, update)
    await legacy.updateAsync({ _id: 'p' }, update)
    assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'p' }), await legacy.findOneAsync({ _id: 'p' }))
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), await legacy.findOneAsync({ _id: 'p' }))
    if (!Array.isArray(value)) assert.equal(engine.playlistPage({ id: 'p' }).records.length, 0)
  }
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $unset: { videos: true } })
  await legacy.updateAsync({ _id: 'p' }, { $unset: { videos: true } })
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'p' }), await legacy.findOneAsync({ _id: 'p' }))
  assert.equal(engine.prepare('SELECT count(*) AS count FROM record_arrays').get().count, 0)
})

test('duration pages display newest history fallbacks without changing saved members', async t => {
  const engine = memory(t)
  const videos = [
    { videoId: 'fallback', lengthSeconds: 0, unknown: new Date(1) },
    { videoId: 'explicit', lengthSeconds: 30, unknown: new Date(2) },
    { videoId: 'fallback', unknown: new Date(3) },
    { videoId: 'missing', lengthSeconds: 0 },
  ]
  const playlist = { _id: 'p', videos, unknown: new Date(4) }
  const history = [
    { _id: 'old', videoId: 'fallback', timeWatched: 1, lengthSeconds: 900, watchProgress: 10 },
    { _id: 'new', videoId: 'fallback', timeWatched: 2, lengthSeconds: 600, watchProgress: 300 },
    { _id: 'explicit', videoId: 'explicit', timeWatched: 3, lengthSeconds: 120 },
  ]
  await engine.collections.playlists.insertAsync(playlist)
  await engine.collections.history.insertAsync(history)
  for (const sort of ['video_duration_ascending', 'video_duration_descending']) {
    const records = []
    let cursor = null
    do {
      const page = engine.playlistPage({ id: 'p', sort, cursor, limit: 1 })
      records.push(...page.records)
      cursor = page.cursor
    } while (cursor)
    const expected = sort.endsWith('ascending') ? [videos[3], videos[1], { ...videos[0], lengthSeconds: 600 }, { ...videos[2], lengthSeconds: 600 }] : [{ ...videos[0], lengthSeconds: 600 }, { ...videos[2], lengthSeconds: 600 }, videos[1], videos[3]]
    assert.deepEqual(records.map(({ _libraryMemberId, ...video }) => video), expected)
    records[0].lengthSeconds = 9999
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
    assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), history.toSorted((a, b) => model.compareThings(a._id, b._id)))
  }
})

test('duration pages and playback windows safely retain legacy member identities', async t => {
  const engine = memory(t)
  const identities = [undefined, null, false, true, 42, { unknown: true }, new Date(1)]
  const videos = identities.map((videoId, index) => ({ ...(videoId === undefined ? {} : { videoId }), title: String(index), unknown: new Date(index) }))
  const records = [undefined, null, false, true, 42].map((videoId, index) => ({ _id: String(index), ...(videoId === undefined ? {} : { videoId }), timeWatched: index, lengthSeconds: 120 + index }))
  const playlist = { _id: 'p', videos, unknown: new Date(3) }
  await engine.collections.playlists.insertAsync(playlist)
  await engine.collections.history.insertAsync(records)
  for (const sort of ['video_duration_ascending', 'video_duration_descending']) {
    const page = await engine.playlistPage({ id: 'p', sort })
    const window = await engine.playlistWindow({ id: 'p', sort })
    assert.equal(page.records.length, videos.length)
    assert.deepEqual(window.records, page.records)
    assert.deepEqual(page.records.map(video => video.title), sort.endsWith('ascending') ? ['5', '6', '0', '1', '2', '3', '4'] : ['4', '3', '2', '1', '0', '5', '6'])
  }
  assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), records)
})

test('playlist statistics retain typed legacy identities without hydrating their full members', async t => {
  const engine = memory(t)
  const legacy = new Datastore({ inMemoryOnly: true })
  const legacyHistory = new Datastore({ inMemoryOnly: true })
  const identities = [42, 43, false, 0, null, undefined, '42', 'string', [1], [1], new Date(1), new Date(1)]
  const videos = identities.map((videoId, index) => ({ ...(videoId === undefined ? {} : { videoId }), unknown: { date: new Date(index) } }))
  videos.push({ ...videos[0], unknown: { keep: true } }, { ...videos[2], lengthSeconds: 15 })
  const playlist = { _id: 'legacy', videos, unknown: { preserved: true } }
  const history = identities.slice(0, 8).flatMap((videoId, index) => [
    { _id: `old-${index}`, videoId, timeWatched: 1, lengthSeconds: 999, isWatched: false },
    { _id: `new-${index}`, videoId, timeWatched: 2, lengthSeconds: 10 + index, isWatched: index % 2 === 0 },
  ])
  await legacy.insertAsync(playlist)
  const saved = await legacy.findOneAsync({ _id: 'legacy' })
  await engine.collections.playlists.insertAsync(saved)
  await engine.collections.history.insertAsync(history)
  await legacyHistory.insertAsync(history)
  const byId = new Map()
  for (const row of await legacyHistory.findAsync({}).sort({ timeWatched: -1, _id: -1 })) {
    if (!byId.has(row.videoId)) byId.set(row.videoId, row)
  }
  const durations = saved.videos.map(video => video.lengthSeconds || byId.get(video.videoId)?.lengthSeconds || 0)
  assert.deepEqual(engine.playlistStatistics({ id: 'legacy' }), {
    total: saved.videos.length,
    uniqueCount: new Set(saved.videos.map(video => video.videoId)).size,
    duration: durations.reduce((total, value) => total + value, 0),
    missingDuration: durations.filter(value => !value).length,
    watchedCount: saved.videos.filter(video => byId.get(video.videoId)?.isWatched === true).length,
  })
  assert.deepEqual(await engine.playlistSnapshot({ id: 'legacy' }), saved)
})

test('single history removals select the latest matching occurrence with stable ties', async t => {
  for (const query of [{ videoId: 'duplicate' }, { videoId: 'duplicate', title: /matching/ }]) {
    const engine = memory(t)
    const records = [
      { _id: 'older', videoId: 'duplicate', title: 'matching', timeWatched: 1, unknown: new Date(1) },
      { _id: 'same-a', videoId: 'duplicate', title: 'matching', timeWatched: 2, unknown: { keep: true } },
      { _id: 'same-b', videoId: 'duplicate', title: 'matching', timeWatched: 2, unknown: new Date(2) },
      { _id: 'unrelated', videoId: 'other', title: 'matching', timeWatched: 3, unknown: new Date(3) },
    ]
    await engine.collections.history.insertAsync(records)
    assert.equal(await engine.collections.history.removeAsync(query), 1)
    assert.equal(await engine.collections.history.findOneAsync({ _id: 'same-b' }), null)
    for (const record of [records[0], records[1], records[3]]) assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), record)
    assert.equal(await engine.collections.history.removeAsync(query, { multi: true }), 2)
    assert.deepEqual(await engine.collections.history.findAsync({}), [records[3]])
  }
})

for (const timeWatched of ['2026-01-01', new Date(2), undefined, null, false, [1], { value: 1 }, 10]) {
  for (const action of ['read', 'write', 'delete']) {
    test(`single history ${action} retains NeDB ordering for ${model.serialize({ timeWatched })}`, async t => {
      for (const filtered of [false, true]) {
        const engine = memory(t)
        const legacy = new Datastore({ inMemoryOnly: true })
        const records = [
          { _id: 'numeric', videoId: 'same', timeWatched: 1, title: 'matching', unknown: new Date(1) },
          ...['\uE000', '😀'].map(_id => ({ _id, videoId: 'same', ...(timeWatched === undefined ? {} : { timeWatched }), cachedAt: 999, title: 'matching', unknown: { keep: true } })),
          { _id: 'unrelated', videoId: 'other', timeWatched: 1000, unknown: new Date(3) },
        ]
        await legacy.insertAsync(records)
        await engine.collections.history.insertAsync(records)
        const query = { videoId: 'same', ...(filtered ? { title: /matching/ } : {}) }
        const expected = (await legacy.findAsync(query).sort({ timeWatched: -1, _id: -1 }).limit(1))[0]
        if (action === 'read') assert.deepEqual(await engine.collections.history.findOneAsync(query), expected)
        else if (action === 'write') {
          const update = { $set: { retained: 'updated' } }
          assert.equal((await engine.collections.history.updateAsync(query, update)).numAffected, 1)
          await legacy.updateAsync({ _id: expected._id }, update)
        } else {
          assert.equal(await engine.collections.history.removeAsync(query), 1)
          await legacy.removeAsync({ _id: expected._id })
        }
        assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
      }
    })
  }
}

test('playlist pages and windows rebuild views created in a rolled-back transaction', async t => {
  const engine = memory(t)
  const videos = [{ videoId: 'b', title: 'B' }, { videoId: 'a', title: 'A' }]
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos })
  const revision = engine.revision('playlists')
  for (const read of [
    () => engine.playlistPage({ id: 'playlist', query: 'a' }),
    () => engine.playlistWindow({ id: 'playlist' }),
  ]) {
    let expected
    await assert.rejects(engine.transaction(() => {
      expected = read()
      throw new Error('abort after building the view')
    }), /abort after building the view/)
    assert.deepEqual(read(), expected)
    assert.equal(engine.revision('playlists'), revision)
    assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'playlist' }), { _id: 'playlist', videos })
  }
})

test('dotted normalized array modifiers reject atomically without changing metadata or members', async t => {
  const engine = memory(t)
  for (const [name, fields] of [['playlists', ['videos']], ['subscriptionCache', ['videos', 'shorts', 'liveStreams', 'communityPosts']]]) {
    const collection = engine.collections[name]
    const record = { _id: 'record', future: { value: 'before' }, ...Object.fromEntries(fields.map(field => [field, [{ videoId: 'video', title: 'Original', unknown: { date: new Date(123) } }]])) }
    await collection.insertAsync(record)
    const revision = engine.revision(name)
    for (const field of fields) {
      for (const operator of ['$set', '$unset', '$push', '$pull', '$inc']) {
        const update = { [operator]: { [`${field}.0.title`]: 'Lost' } }
        update.$set = { 'future.value': 'changed', ...update.$set }
        await assert.rejects(collection.updateAsync({ _id: record._id }, update), /Unsupported normalized array modifier/)
        assert.deepEqual(await collection.findOneAsync({ _id: record._id }), record)
        assert.equal(engine.revision(name), revision)
      }
    }
    await collection.updateAsync({ _id: record._id }, { $set: { 'future.value': 'after' } })
    assert.deepEqual(await collection.findOneAsync({ _id: record._id }), { ...record, future: { value: 'after' } })
  }
})

test('metadata inclusion and exclusion projections preserve the released thumbnail contract', async t => {
  const engine = memory(t)
  const collection = engine.collections.videoMetadataCache
  const portable = new Datastore()
  const record = { _id: 'metadata', title: 'Title', description: 'Description', thumbnail: 'data:image/png;base64,stored', unknown: { date: new Date(123) } }
  await collection.insertAsync(record)
  await portable.insertAsync(record)
  for (const projection of [{}, { description: 0 }, { thumbnail: 0 }, { _id: 0 }, { _id: 1 }, { _id: 1, description: 0 }, { title: 1 }, { thumbnail: 1 }]) {
    const expected = await portable.findOneAsync({ _id: record._id }, projection)
    assert.deepEqual(await collection.findAsync({ _id: record._id }, projection), [expected], JSON.stringify(projection))
    assert.deepEqual(await collection.findOneAsync({ _id: record._id }, projection), expected, JSON.stringify(projection))
  }
  assert.deepEqual(await collection.findOneAsync({ _id: record._id }), record)
})

test('dotted inclusion and exclusion projections match released nested document shapes', async t => {
  const engine = memory(t)
  const collection = engine.collections.playlists
  const portable = new Datastore()
  const record = { _id: 'playlist', metadata: { title: 'Title', description: 'Description', date: new Date(123) }, videos: [{ videoId: 'video', title: 'Member' }], unknown: true }
  await collection.insertAsync(record)
  await portable.insertAsync(record)
  for (const projection of [{ 'metadata.title': 1 }, { 'metadata.title': 1, 'metadata.date': 1, _id: 0 }, { 'metadata.description': 0 }, { 'videos.videoId': 1 }, { 'videos.title': 0 }, { _id: 1 }]) {
    const expected = await portable.findOneAsync({ _id: record._id }, projection)
    assert.deepEqual(await collection.findAsync({ _id: record._id }, projection), [expected], JSON.stringify(projection))
    assert.deepEqual(await collection.findOneAsync({ _id: record._id }, projection), expected, JSON.stringify(projection))
  }
  for (const find of ['findAsync', 'findOneAsync']) {
    await assert.rejects(Promise.resolve().then(() => collection[find]({ _id: record._id }, { 'metadata.title': 1, unknown: 0 })), /Can't both keep and omit fields/)
  }
  assert.deepEqual(await collection.findOneAsync({ _id: record._id }), record)
})

test('projection cannot omit normalized fields needed to verify the query', async t => {
  const engine = memory(t)
  for (const [name, record, query] of [
    ['playlists', { _id: 'playlist', title: 'Found', videos: [{ videoId: 'video' }] }, { videos: { $elemMatch: { videoId: 'video' } } }],
    ['videoMetadataCache', { _id: 'metadata', title: 'Found', thumbnail: 'stored thumbnail' }, { thumbnail: 'stored thumbnail' }],
  ]) {
    const collection = engine.collections[name]
    const portable = new Datastore()
    await collection.insertAsync(record)
    await portable.insertAsync(record)
    const expected = await portable.findOneAsync(query, { title: 1 })
    assert.deepEqual(await collection.findAsync(query, { title: 1 }), [expected])
    assert.deepEqual(await collection.findOneAsync(query, { title: 1 }), expected)
  }
})

test('an independent write waits for a suspended transaction and survives its rollback', async t => {
  const engine = memory(t)
  const entered = Promise.withResolvers()
  const resume = Promise.withResolvers()
  const failure = new Error('import failed after awaiting its handler')
  const importTransaction = engine.transaction(async () => {
    await engine.collections.history.insertAsync({ _id: 'imported', videoId: 'imported' })
    entered.resolve()
    await resume.promise
    throw failure
  })
  const rejected = assert.rejects(importTransaction, failure)
  await entered.promise
  const independent = { _id: 'independent', videoId: 'saved', unknown: { date: new Date(123) } }
  let saved = false
  const write = engine.collections.history.insertAsync(independent).then(record => { saved = true; return record })
  await setImmediate()
  const savedBeforeRollback = saved
  resume.resolve()
  await rejected
  assert.deepEqual(await write, independent)
  assert.deepEqual(await engine.collections.history.findAsync({}), [independent])
  assert.equal(savedBeforeRollback, false, 'the independent write must not resolve inside another request\'s transaction')
  assert.equal(engine.revision('history'), 1)
  assert.equal(engine.transactionDepth, 0)
})

for (const commit of [false, true]) {
  test(`independent collection reads wait for a suspended transaction to ${commit ? 'commit' : 'roll back'}`, async t => {
    const engine = memory(t)
    const collection = engine.collections.history
    const original = { _id: 'kept', videoId: 'kept', title: 'Original', timeWatched: 1, unknown: new Date(123) }
    const incoming = { _id: 'new', videoId: 'new', title: 'Incoming', timeWatched: 2, unknown: { keep: true } }
    await collection.insertAsync(original)
    const entered = Promise.withResolvers()
    const resume = Promise.withResolvers()
    const owner = engine.transaction(async () => {
      await collection.updateAsync({ _id: original._id }, { $set: { title: 'Changed' } })
      await collection.insertAsync(incoming)
      // Descendants of the owner must still see its writes without deadlocking.
      assert.deepEqual(await collection.findAsync({}).sort({ timeWatched: 1 }), [{ ...original, title: 'Changed' }, incoming])
      assert.deepEqual(await collection.findOneAsync({ _id: original._id }), { ...original, title: 'Changed' })
      assert.equal(await collection.countAsync({}), 2)
      entered.resolve()
      await resume.promise
      if (!commit) throw new Error('abort owner')
    }).then(() => true, error => { assert.match(error.message, /abort owner/); return false })
    await entered.promise
    const reads = [
      collection.findAsync({}).sort({ timeWatched: 1 }),
      collection.findAsync({}, { title: 1, _id: 0 }).sort({ timeWatched: -1 }).skip(1).limit(1),
      collection.findOneAsync({ _id: original._id }),
      collection.countAsync({}),
      collection.countAsync({ title: /Changed|Incoming/ }),
    ]
    const completed = []
    const pending = reads.map((read, index) => Promise.resolve(read).then(value => { completed.push(index); return value }))
    await setImmediate()
    const early = [...completed]
    resume.resolve()
    assert.equal(await owner, commit)
    const expected = commit ? { ...original, title: 'Changed' } : original
    assert.deepEqual(await Promise.all(pending), [
      commit ? [expected, incoming] : [expected],
      commit ? [{ title: 'Changed' }] : [],
      expected,
      commit ? 2 : 1,
      commit ? 2 : 0,
    ])
    assert.deepEqual(early, [], 'no independent read may expose the suspended transaction')
  })
}

test('queued read failures leave later reads and writes usable without opening write transactions', async t => {
  const engine = memory(t)
  const collection = engine.collections.history
  const record = { _id: 'saved', videoId: 'saved', title: 'Saved' }
  await collection.insertAsync(record)
  const exec = engine.database.exec.bind(engine.database)
  const boundaries = []
  t.mock.method(engine.database, 'exec', sql => { boundaries.push(sql); return exec(sql) })
  await assert.rejects(Promise.resolve(collection.findAsync({}, { title: 1, videoId: 0 })), /Can't both keep and omit fields/)
  assert.deepEqual(await collection.findOneAsync({ _id: record._id }), record)
  assert.equal(await collection.countAsync({}), 1)
  assert.deepEqual(boundaries, [])
  await collection.updateAsync({ _id: record._id }, { $set: { title: 'Updated' } })
  assert.deepEqual(await collection.findAsync({}), [{ ...record, title: 'Updated' }])
  assert.deepEqual(boundaries, ['BEGIN IMMEDIATE', 'COMMIT'])
})

test('nested writes share their owner while independent successful transactions commit separately', async t => {
  const engine = memory(t)
  const entered = Promise.withResolvers()
  const resume = Promise.withResolvers()
  const exec = engine.database.exec.bind(engine.database)
  const boundaries = []
  t.mock.method(engine.database, 'exec', sql => { boundaries.push(sql); return exec(sql) })
  const first = engine.transaction(async () => {
    await engine.collections.history.insertAsync({ _id: 'first', videoId: 'first' })
    entered.resolve()
    await resume.promise
    await engine.transaction(() => engine.collections.history.insertAsync({ _id: 'nested', videoId: 'nested' }))
  })
  await entered.promise
  const second = engine.collections.history.insertAsync({ _id: 'second', videoId: 'second' })
  resume.resolve()
  await Promise.all([first, second])
  assert.deepEqual(boundaries, ['BEGIN IMMEDIATE', 'COMMIT', 'BEGIN IMMEDIATE', 'COMMIT'])
  assert.deepEqual(await engine.collections.history.findAsync({}), [
    { _id: 'first', videoId: 'first' }, { _id: 'nested', videoId: 'nested' }, { _id: 'second', videoId: 'second' },
  ])
})

test('large member writes preserve dates, unknown fields, duplicate identities and complete rollback', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 1200 }, (_, index) => ({
    videoId: 'duplicate', playlistItemId: 'duplicate-item', title: `雪😀\\\"${index}`,
    date: new Date(index - 600), unknown: JSON.parse('{"__proto__":{"keep":true},"constructor":"retained","prototype":null}'),
  }))
  const original = { _id: 'large', protected: true, future: { keep: true }, videos }
  assert.deepEqual(await engine.collections.playlists.insertAsync(original), original)
  const identities = () => engine.prepare("SELECT membership_id FROM members WHERE collection = 'playlists' AND record_id = 'large' ORDER BY position").all().map(row => row.membership_id)
  const ids = identities()
  assert.equal(new Set(ids).size, videos.length)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'large' }), original)
  await engine.collections.playlists.updateAsync({ _id: 'large' }, { $set: { videos } })
  assert.deepEqual(identities(), ids)
  const appended = videos.slice(0, 300)
  const decoded = t.mock.method(model, 'deserialize')
  await engine.collections.playlists.updateAsync({ _id: 'large' }, { $push: { videos: { $each: appended } } })
  assert.equal(decoded.mock.calls.some(call => call.result?.videoId === 'duplicate'), false, 'appending must not deserialize existing members')
  decoded.mock.restore()
  const saved = { ...original, videos: [...videos, ...appended] }
  assert.deepEqual(await engine.playlistSnapshot({ id: 'large' }), saved)
  const savedIds = identities()
  assert.deepEqual(savedIds.slice(0, ids.length), ids)
  assert.equal(new Set(savedIds).size, saved.videos.length)
  const revision = engine.revision('playlists')
  const bytes = engine.prepare("SELECT bytes FROM collection_counts WHERE collection = 'playlists'").get().bytes
  engine.database.exec("CREATE TEMP TRIGGER fail_member_insert BEFORE INSERT ON main.members WHEN NEW.record_id = 'large' AND NEW.position = 1751 BEGIN SELECT RAISE(ABORT, 'simulated disk full'); END")
  await assert.rejects(engine.collections.playlists.updateAsync({ _id: 'large' }, { $push: { videos: { $each: videos.slice(0, 600) } } }), /simulated disk full/)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'large' }), saved)
  assert.deepEqual(identities(), savedIds)
  assert.equal(engine.revision('playlists'), revision)
  assert.equal(engine.prepare("SELECT bytes FROM collection_counts WHERE collection = 'playlists'").get().bytes, bytes)
  assert.equal(engine.prepare("SELECT length FROM record_arrays WHERE collection = 'playlists' AND record_id = 'large' AND field = 'videos'").get().length, saved.videos.length)
  assert.deepEqual(engine.prepare('PRAGMA foreign_key_check').all(), [])
})

test('playlist cleanup retains playback context for surviving memberships and legacy duplicates', async t => {
  const engine = memory(t)
  const entries = [
    ['retained', 'first', 'second'], ['removed', 'first', 'second'],
    ['repeated', 'same', 'same'], ['legacy', undefined, undefined], ['elsewhere', 'first', 'second'],
  ]
  await engine.collections.playlists.insertAsync({ _id: 'p', videos: entries.flatMap(([videoId, first, second]) => [
    { videoId, playlistItemId: first }, { videoId, playlistItemId: second },
  ]) })
  const histories = entries.map(([videoId, first, second]) => ({
    _id: videoId, videoId, isWatched: true, unknown: { keep: videoId },
    lastViewedPlaylistId: videoId === 'elsewhere' ? 'other' : 'p', lastViewedPlaylistType: 'user',
    ...(videoId === 'legacy' ? {} : { lastViewedPlaylistItemId: videoId === 'removed' ? second : first }),
  }))
  await engine.collections.history.insertAsync(histories)
  assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'duplicates' }), 5)
  for (const history of histories) {
    const actual = await engine.collections.history.findOneAsync({ _id: history._id })
    const expected = { ...history }
    if (history.videoId === 'removed') {
      delete expected.lastViewedPlaylistId
      delete expected.lastViewedPlaylistType
      delete expected.lastViewedPlaylistItemId
    }
    assert.deepEqual(actual, expected)
  }
  assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), 5)
  for (const history of histories) {
    const actual = await engine.collections.history.findOneAsync({ _id: history._id })
    assert.deepEqual(actual.unknown, history.unknown)
    assert.equal(actual.lastViewedPlaylistId, history.videoId === 'elsewhere' ? 'other' : undefined)
  }
})

test('playlist cleanup clears every duplicate history context across batches and rolls back failures', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', videos: [{ videoId: 'same', playlistItemId: 'keep' }] })
  const histories = Array.from({ length: 601 }, (_, index) => ({
    _id: `history-${String(index).padStart(4, '0')}`, videoId: 'same', timeWatched: index,
    lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: index % 3 === 0 ? 'keep' : 'removed',
    unknown: { index, date: new Date(index) },
  }))
  await engine.collections.history.insertAsync(histories)
  const revision = engine.revision('history')
  engine.database.exec("CREATE TEMP TRIGGER fail_context_cleanup BEFORE UPDATE ON main.records WHEN NEW.collection = 'history' AND NEW.id = 'history-0500' BEGIN SELECT RAISE(ABORT, 'context cleanup failure'); END")
  await assert.rejects(engine.transaction(() => engine.clearRemovedPlaylistContext('p', ['same', 'same'])), /context cleanup failure/)
  assert.deepEqual(await engine.collections.history.findAsync({}), histories)
  assert.equal(engine.revision('history'), revision)
  engine.database.exec('DROP TRIGGER fail_context_cleanup')
  await engine.transaction(() => engine.clearRemovedPlaylistContext('p', ['same', 'same']))
  assert.deepEqual(await engine.collections.history.findAsync({}), histories.map((history, index) => {
    if (index % 3 === 0) return history
    const { lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId, ...retained } = history
    return retained
  }))
  assert.equal(engine.revision('history'), revision + 1)
  await engine.transaction(() => engine.clearRemovedPlaylistContext('p', ['same']))
  assert.equal(engine.revision('history'), revision + 1)
})

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'opentubex-sqlite-test-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

async function compactionFixture(t) {
  const path = await directory(t)
  const records = [
    { _id: 'retained', videoId: 'keep', isWatched: true, watchProgress: 42, unknown: { date: new Date(0) } },
    ...Array.from({ length: 32 }, (_, index) => ({ _id: `large-${index}`, videoId: 'removed', unknown: '雪'.repeat(10000) })),
  ]
  const originals = {
    'history.db': records.map(model.serialize).join('\n') + '\n',
    'playlists.db': model.serialize({ _id: 'retained', protected: true, unknown: { date: new Date(123) }, videos: [
      { videoId: 'same', playlistItemId: 'duplicate', added: new Date(0), unknown: 'first' },
      { videoId: 'same', playlistItemId: 'duplicate', unknown: 'second' },
    ] }) + '\n',
    'video-metadata-cache.db': ['first', 'second'].map((_id, index) => model.serialize({ _id, videoId: 'same', cachedAt: 1, title: 'Metadata', thumbnail: `data:image/png;base64,${'a'.repeat(5000 + index)}`, unknown: new Date(index) })).join('\n') + '\n',
  }
  for (const [filename, contents] of Object.entries(originals)) await writeFile(join(path, filename), contents)
  const engine = await openLibrary(path)
  t.after(() => engine.database.close())
  const snapshot = () => Object.fromEntries(engine.database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, engine.database.prepare(`SELECT * FROM ${name}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
  return { path, engine, records, originals, snapshot }
}

test('storage compaction reclaims free pages and the WAL without changing documents, identities, counters or originals', async t => {
  const { path, engine, originals, snapshot } = await compactionFixture(t)
  const libraryPath = join(path, 'library.sqlite')
  const beforeSize = (await fs.stat(libraryPath)).size
  await engine.collections.history.removeAsync({ videoId: 'removed' }, { multi: true })
  assert.ok(engine.prepare('PRAGMA freelist_count').get().freelist_count > 0)
  const saved = snapshot()
  const first = engine.playlistPage({ id: 'retained', limit: 1 })
  assert.equal(engine.compact(), true)
  assert.ok((await fs.stat(libraryPath)).size < beforeSize / 2)
  assert.equal((await fs.stat(libraryPath + '-wal')).size, 0)
  assert.equal(engine.prepare('PRAGMA freelist_count').get().freelist_count, 0)
  assert.deepEqual(snapshot(), saved)
  assert.equal(engine.playlistPage({ id: 'retained', cursor: first.cursor, limit: 1 }).records[0].unknown, 'second')
  assert.deepEqual(engine.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'])
  assert.deepEqual(engine.prepare('PRAGMA foreign_key_check').all(), [])
  let vacuums = 0
  const exec = engine.database.exec.bind(engine.database)
  const mock = t.mock.method(engine.database, 'exec', sql => { if (sql === 'VACUUM') vacuums++; return exec(sql) })
  try {
    assert.equal(engine.compact(), true)
    assert.equal(vacuums, 0, 'a fully compacted library needs only WAL truncation')
  } finally { mock.mock.restore() }
  const reopened = await openLibrary(path)
  try {
    const actual = reopened.database.prepare('SELECT membership_id, data FROM members ORDER BY position').all()
    assert.deepEqual(actual, engine.database.prepare('SELECT membership_id, data FROM members ORDER BY position').all())
    for (const collection of ['history', 'playlists', 'videoMetadataCache']) assert.deepEqual(await reopened.collections[collection].findAsync({}), await engine.collections[collection].findAsync({}))
  } finally { reopened.database.close() }
  for (const [filename, contents] of Object.entries(originals)) assert.equal(await readFile(join(path, filename), 'utf8'), contents)
})

test('blocked storage compaction leaves an active export snapshot usable and succeeds after it finishes', async t => {
  const { path, engine, records, snapshot } = await compactionFixture(t)
  engine.database.exec('PRAGMA busy_timeout = 0')
  const exports = new LibraryExports(engine)
  const job = exports.start({ format: 'ndjson', collection: 'history' })
  t.after(() => { if (exports.jobs.has(job.id)) exports.cancel(job) })
  await engine.collections.history.removeAsync({ videoId: 'removed' }, { multi: true })
  const saved = snapshot()
  assert.throws(() => engine.compact(), /library is in use/)
  assert.deepEqual(snapshot(), saved)
  const chunks = []
  let next
  do { next = exports.next(job); chunks.push(Buffer.from(next.data)) } while (!next.done)
  const exported = Buffer.concat(chunks).toString().trim().split('\n').map(line => model.deserialize(line)).sort((a, b) => a._id.localeCompare(b._id))
  assert.deepEqual(exported, structuredClone(records).sort((a, b) => a._id.localeCompare(b._id)))
  assert.equal(engine.compact(), true)
  assert.deepEqual(snapshot(), saved)
  assert.equal((await fs.stat(join(path, 'library.sqlite-wal'))).size, 0)
})

test('storage compaction rejects active transactions and propagates VACUUM failures while retaining a writable library', async t => {
  const { engine, snapshot } = await compactionFixture(t)
  await engine.collections.history.removeAsync({ videoId: 'removed' }, { multi: true })
  const saved = snapshot()
  await assert.rejects(engine.transaction(() => engine.compact()), /inside a transaction/)
  assert.deepEqual(snapshot(), saved)
  const exec = engine.database.exec.bind(engine.database)
  const mock = t.mock.method(engine.database, 'exec', sql => {
    if (sql === 'VACUUM') throw new Error('simulated disk full during compaction')
    return exec(sql)
  })
  try { assert.throws(() => engine.compact(), /simulated disk full/) } finally { mock.mock.restore() }
  assert.deepEqual(snapshot(), saved)
  assert.equal(engine.transactionDepth, 0)
  await engine.collections.history.insertAsync({ _id: 'later', videoId: 'later', unknown: 'new write' })
  assert.equal(engine.compact(), true)
  assert.equal((await engine.collections.history.findOneAsync({ _id: 'later' })).unknown, 'new write')
  assert.deepEqual(engine.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'])
})

test('migration creates private staging and sidecar files even with a permissive umask', { skip: process.platform === 'win32' }, async t => {
  const path = await directory(t)
  const staging = join(path, 'library.sqlite.migrating')
  const originalOpen = fs.open
  const originalChmod = fs.chmod
  let checkedCreation = false
  const checkCreation = async filename => {
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600, 'staging must already be private before permission tightening')
    checkedCreation = true
  }
  const chmodMock = t.mock.method(fs, 'chmod', async (filename, ...args) => {
    if (filename === staging) await checkCreation(filename)
    return originalChmod(filename, ...args)
  })
  const openMock = t.mock.method(fs, 'open', async (filename, flags, ...args) => {
    const handle = await originalOpen(filename, flags, ...args)
    if (filename === staging && flags === 'a') {
      const chmod = handle.chmod.bind(handle)
      handle.chmod = async mode => { await checkCreation(filename); return chmod(mode) }
    }
    return handle
  })
  syncBuiltinESMExports()
  t.after(() => { chmodMock.mock.restore(); openMock.mock.restore(); syncBuiltinESMExports() })
  const record = { _id: 'private', videoId: 'private', unknown: new Date(123) }
  const original = model.serialize(record) + '\n'
  await writeFile(join(path, 'history.db'), original)
  const previousUmask = process.umask(0)
  let engine
  let checkedSidecars = false
  try {
    engine = await openLibrary(path, { onCheckpoint: async ({ collection, lines }) => {
      if (collection !== 'history' || !lines) return
      for (const suffix of ['', '-wal', '-shm']) assert.equal((await fs.stat(staging + suffix)).mode & 0o777, 0o600)
      checkedSidecars = true
    } })
    assert.equal(checkedCreation, true)
    assert.equal(checkedSidecars, true)
    assert.deepEqual(await engine.collections.history.findAsync({}), [record])
    assert.equal((await fs.stat(join(path, 'library.sqlite'))).mode & 0o777, 0o600)
    assert.equal(await readFile(join(path, 'history.db'), 'utf8'), original)
  } finally {
    engine?.database.close()
    process.umask(previousUmask)
  }
})

test('migration flushes the completed staging file with a Windows-compatible writable handle', async t => {
  const path = await directory(t)
  const originalOpen = fs.open
  let flushed = false
  const mock = t.mock.method(fs, 'open', async (filename, flags, ...args) => {
    const handle = await originalOpen(filename, flags, ...args)
    if (filename.endsWith('library.sqlite.migrating')) {
      const sync = handle.sync.bind(handle)
      handle.sync = async () => {
        if (flags === 'r') throw Object.assign(new Error('FlushFileBuffers requires write access'), { code: 'EBADF' })
        await sync()
        flushed = true
      }
    }
    return handle
  })
  syncBuiltinESMExports()
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  const original = model.serialize({ _id: 'saved', videoId: 'saved', unknown: 'preserved' }) + '\n'
  await writeFile(join(path, 'history.db'), original)
  const engine = await openLibrary(path)
  t.after(() => engine.database.close())
  assert.equal(flushed, true)
  assert.deepEqual(await engine.collections.history.findAsync({}), [{ _id: 'saved', videoId: 'saved', unknown: 'preserved' }])
  assert.equal(await readFile(join(path, 'history.db'), 'utf8'), original)
})

test('multi-megabyte UTF-8 migration lines copy bytes linearly and resume at exact CRLF offsets', async t => {
  const path = await directory(t)
  const playlist = { _id: 'large', playlistName: '雪😀', unknown: 'é💾abc'.repeat(400000),
    videos: [{ videoId: 'same', playlistItemId: 'duplicate' }, { videoId: 'same', playlistItemId: 'duplicate', added: new Date(0) }] }
  const tail = { _id: 'tail', videos: [], unknown: 'retained without a final newline' }
  const original = Buffer.from(model.serialize(playlist) + '\r\n' + model.serialize(tail))
  await writeFile(join(path, 'playlists.db'), original)
  const concat = Buffer.concat
  let copied = 0
  t.mock.method(Buffer, 'concat', (buffers, length) => {
    copied += length ?? buffers.reduce((total, buffer) => total + buffer.length, 0)
    return concat(buffers, length)
  })
  await assert.rejects(openLibrary(path, { batchSize: 1, onCheckpoint: ({ collection, lines }) => {
    if (collection === 'playlists' && lines === 1) throw new Error('Interrupted after the large line')
  } }), /Interrupted after the large line/)
  assert.ok(copied <= original.length * 4, `${copied} bytes copied for a ${original.length}-byte source`)
  const engine = await openLibrary(path)
  t.after(() => engine.database.close())
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: playlist._id }), playlist)
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: tail._id }), tail)
  assert.deepEqual(await readFile(join(path, 'playlists.db')), original)
})

test('migration resumes when CRLF spans a stream boundary and retains empty lines and an unterminated tail', async t => {
  const path = await directory(t)
  const first = { _id: 'first', unknown: '' }
  first.unknown = 'a'.repeat(65535 - Buffer.byteLength(model.serialize(first)))
  const firstLine = model.serialize(first) + '\r\n'
  assert.equal(Buffer.byteLength(firstLine), 65537, 'CR ends the first 64 KiB chunk and LF starts the next')
  const tail = { _id: 'tail', unknown: '雪😀' }
  const original = Buffer.from(firstLine + '\r\n\n' + model.serialize(tail))
  await writeFile(join(path, 'history.db'), original)
  await assert.rejects(openLibrary(path, { batchSize: 1, onCheckpoint: ({ collection, lines }) => {
    if (collection === 'history' && lines === 1) throw new Error('Interrupted at the split CRLF')
  } }), /Interrupted at the split CRLF/)
  const staging = new DatabaseSync(join(path, 'library.sqlite.migrating'))
  try {
    assert.equal(staging.prepare("SELECT offset FROM migration_sources WHERE collection = 'history'").get().offset, 65537)
  } finally { staging.close() }
  const engine = await openLibrary(path)
  t.after(() => engine.database.close())
  assert.deepEqual(await engine.collections.history.findAsync({}), [first, tail])
  assert.deepEqual(await readFile(join(path, 'history.db')), original)
})

test('invalid UTF-8 across a stream boundary fails closed with and without a final newline', async t => {
  for (const ending of ['\n', '']) {
    const path = await directory(t)
    const prefix = Buffer.from('{"_id":"bad","unknown":"')
    const original = Buffer.concat([prefix, Buffer.alloc(65535 - prefix.length, 97), Buffer.from([0xc3, 0x28]), Buffer.from('"}' + ending)])
    await writeFile(join(path, 'history.db'), original)
    await assert.rejects(openLibrary(path), /encoded data was not valid/)
    await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
    assert.deepEqual(await readFile(join(path, 'history.db')), original)
  }
})

test('startup reads execute lazy query cursors inside the snapshot context', async t => {
  const startup = new StartupLibrary()
  const settings = [{ _id: 'theme', value: 'dark' }]
  startup.publish({ settings, tabSession: [] })
  t.after(() => startup.fail(new Error('finished')))
  const snapshot = startup.snapshot
  const records = await startup.read(() => createDeferredCursor(() => {
    assert.equal(startup.context.getStore(), snapshot)
    return startup.context.getStore().collections.settings.findAsync({})
  }))
  assert.deepEqual(records, settings)
  await assert.rejects(startup.read(() => startup.context.getStore().collections.settings.updateAsync({ _id: 'theme' }, { $set: { value: 'light' } })), /read.?only/i)
  assert.deepEqual(await startup.read(() => snapshot.collections.settings.findAsync({})), settings)
})

test('startup reads retain their snapshot through activation, reject writes and then use the live library', async t => {
  const startup = new StartupLibrary()
  const settings = [{ _id: 'theme', value: 'dark', future: { date: new Date(123) } }]
  startup.publish({ settings, tabSession: [] })
  const snapshot = startup.snapshot
  const entered = Promise.withResolvers()
  const resume = Promise.withResolvers()
  const reader = startup.read(async () => {
    entered.resolve()
    assert.throws(() => startup.assertWritable(), /read-only/)
    await resume.promise
    return startup.context.getStore().collections.settings.findAsync({})
  })
  await entered.promise
  const live = memory(t)
  await live.collections.settings.insertAsync({ _id: 'theme', value: 'light' })
  startup.activate(live)
  assert.equal(snapshot.database.isOpen, true)
  resume.resolve()
  assert.deepEqual(await reader, settings)
  assert.equal(snapshot.database.isOpen, false)
  assert.deepEqual(await startup.read(() => startup.context.getStore().collections.settings.findAsync({})), [{ _id: 'theme', value: 'light' }])
  assert.equal(startup.context.getStore(), undefined)
  startup.assertWritable()
})

test('startup reads reject failures before and after publication and discard their private copy', async () => {
  for (const publish of [false, true]) {
    const startup = new StartupLibrary()
    if (publish) startup.publish({ settings: [], tabSession: [] })
    const snapshot = startup.snapshot
    const failure = new Error('migration rejected')
    startup.fail(failure)
    await assert.rejects(startup.read(() => assert.fail('a failed migration must not return configuration')), error => error === failure)
    if (snapshot) assert.equal(snapshot.database.isOpen, false)
  }
})

test('migration supplies exact startup snapshots before bulk replay and keeps originals untouched', async t => {
  const path = await directory(t)
  const settings = [{ _id: 'baseTheme', value: 'dark', unknown: new Date(123) }]
  const tabSession = [{ _id: 'window', value: { tabs: [], future: [null, false, '$$foo'] } }]
  const cache = [{ _id: 'channel', videos: [{ videoId: 'video', unknown: new Date(456) }] }]
  const originals = { 'settings.db': settings, 'tab-session.db': tabSession, 'subscription-cache.db': cache }
  for (const [name, records] of Object.entries(originals)) await writeFile(join(path, name), records.map(model.serialize).join('\n'))
  let snapshot
  const engine = await openLibrary(path, {
    onStartupReady(value) {
      assert.equal(snapshot, undefined)
      snapshot = value
      assert.deepEqual(snapshot, { settings, tabSession })
      // A main-process reader must not mutate the migration's working records.
      value.settings[0].value = 'changed in the preview'
    },
    onCheckpoint({ collection }) {
      if (collection === 'subscriptionCache') assert.ok(snapshot, 'startup configuration must be available before bulk replay finishes')
    },
  })
  t.after(() => engine.database.close())
  assert.deepEqual(await engine.collections.settings.findAsync({}), settings)
  assert.deepEqual(await engine.collections.tabSession.findAsync({}), tabSession)
  assert.deepEqual(await engine.collections.subscriptionCache.findAsync({}), cache)
  for (const [name, records] of Object.entries(originals)) assert.equal(await readFile(join(path, name), 'utf8'), records.map(model.serialize).join('\n'))
})

test('migration does not publish startup snapshots for invalid configuration or sessions', async t => {
  for (const filename of ['settings.db', 'tab-session.db']) {
    const path = await directory(t)
    const original = '{invalid JSON}\n'
    await writeFile(join(path, filename), original)
    let published = false
    await assert.rejects(openLibrary(path, { onStartupReady() { published = true } }), /Cannot migrate/)
    assert.equal(published, false)
    assert.equal(await readFile(join(path, filename), 'utf8'), original)
    await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
  }
})

test('migration retains escaped date markers, prototype keys and plain JSON values through restart', async t => {
  const path = await directory(t)
  const lines = [
    String.raw`{"_id":"escaped","videos":[{"videoId":"same","unknown":{"\u0024\u0024date":0}},{"videoId":"same","unknown":{"\u0024\u0024date":123}}],"__proto__":{"retained":true},"unknown":"backslash \\ and emoji \ud83d\ude00"}`,
    '{"_id":"plain","videos":[null,false,0,"text",{"videoId":"plain"}],"unknown":{"constructor":"keep","prototype":"keep"}}',
  ]
  const original = lines.join('\n') + '\n'
  const expected = lines.map(model.deserialize)
  await writeFile(join(path, 'playlists.db'), original)
  for (let attempt = 0; attempt < 2; attempt++) {
    const engine = await openLibrary(path)
    try {
      assert.deepEqual(await engine.collections.playlists.findAsync({}), expected)
      assert.equal(await readFile(join(path, 'playlists.db'), 'utf8'), original)
    } finally { engine.database.close() }
  }
})

test('migration preserves append-log semantics, dates, unknown fields, duplicates, order and blobs without modifying sources', async t => {
  const path = await directory(t)
  const playlist = {
    _id: 'playlist', playlistName: 'Renamed', protected: true, future: { a: [null, false, 0, ''] },
    videos: [
      { videoId: 'same', playlistItemId: 'duplicate', timeAdded: new Date(0), title: 'first' },
      { videoId: 'same', playlistItemId: 'duplicate', timeAdded: new Date(123), title: 'second' },
      { videoId: 'other', title: 'third' },
    ],
  }
  const files = {
    'playlists.db': [model.serialize({ ...playlist, playlistName: 'old' }), model.serialize(playlist)],
    'history.db': [
      model.serialize({ _id: 'history1', videoId: 'same', timeWatched: 1, watchProgress: 12 }),
      model.serialize({ _id: 'history2', videoId: 'same', timeWatched: 2, watchProgress: 34 }),
      model.serialize({ _id: 'removed', videoId: 'removed' }),
      model.serialize({ _id: 'removed', $$deleted: true }),
      JSON.stringify({ $$indexCreated: { fieldName: 'videoId', unique: false } }),
    ],
    'subscription-cache.db': [model.serialize({ _id: 'channel', videos: [{ videoId: 'seen', isNewInSubscriptionFeed: false }], videosTimestamp: new Date(0), shorts: [] })],
    'video-metadata-cache.db': [model.serialize({ _id: 'revision', videoId: 'same', thumbnail: 'data:image/png;base64,' + 'A'.repeat(10000), title: 'Title', description: 'Description', cachedAt: 42 })],
  }
  for (const [name, lines] of Object.entries(files)) await writeFile(join(path, name), lines.join('\r\n'))
  const before = await Promise.all(Object.keys(files).map(name => readFile(join(path, name))))
  const engine = await openLibrary(path, { batchSize: 1 })
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'playlist' }), playlist)
  assert.deepEqual((await engine.collections.history.findAsync({}).sort({ timeWatched: 1 })).map(row => row._id), ['history1', 'history2'])
  assert.equal((await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' })).videosTimestamp.getTime(), 0)
  assert.equal((await engine.collections.videoMetadataCache.findOneAsync({ _id: 'revision' })).thumbnail.length, 10022)
  assert.equal(engine.database.prepare("SELECT length(data) AS size FROM records WHERE collection = 'videoMetadataCache'").get().size < 500, true)
  const metadataBytes = () => ['records', 'members', 'record_blobs'].reduce((total, table) => total + engine.prepare(`SELECT coalesce(sum(length(CAST(data AS BLOB))), 0) AS bytes FROM ${table} WHERE collection = 'videoMetadataCache'`).get().bytes, 0)
  const recordedBytes = () => engine.prepare("SELECT bytes FROM collection_counts WHERE collection = 'videoMetadataCache'").get().bytes
  assert.equal(recordedBytes(), metadataBytes())
  await engine.collections.videoMetadataCache.updateAsync({ _id: 'revision' }, { $set: { thumbnail: '雪😀' } })
  assert.equal(recordedBytes(), metadataBytes())
  await engine.collections.videoMetadataCache.removeAsync({}, { multi: true })
  assert.equal(recordedBytes(), 0)
  engine.database.close()
  for (const [index, name] of Object.keys(files).entries()) assert.deepEqual(await readFile(join(path, name)), before[index])
  const reopened = await openLibrary(path)
  assert.deepEqual(await reopened.collections.playlists.findOneAsync({ _id: 'playlist' }), playlist)
  reopened.database.close()
})

test('interrupted chunk migration resumes and replayed deletions do not resurrect records', async t => {
  const path = await directory(t)
  const contents = [
    { _id: 'a', videoId: 'a', title: '雪😀' },
    { _id: 'b', videoId: 'b' },
    { _id: 'a', $$deleted: true },
    { _id: 'b', videoId: 'b', title: 'new' },
  ].map(model.serialize).join('\n') + '\n'
  await writeFile(join(path, 'history.db'), contents)
  await assert.rejects(openLibrary(path, { batchSize: 1, onCheckpoint: ({ collection, lines }) => {
    if (collection === 'history' && lines === 2) throw new Error('simulated interruption')
  } }), /simulated interruption/)
  await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
  const engine = await openLibrary(path)
  assert.deepEqual(await engine.collections.history.findAsync({}), [{ _id: 'b', videoId: 'b', title: 'new' }])
  engine.database.close()
  assert.equal(await readFile(join(path, 'history.db'), 'utf8'), contents)
})

for (const interruption of ['replay', 'verification']) {
  test(`migration resumes after ${interruption} and rebuilds exact member accounting before live writes`, async t => {
    const path = await directory(t)
    const original = { _id: 'p', playlistName: '雪😀', unknown: new Date(1), videos: [
      { videoId: 'same', title: 'First', unknown: new Date(2) }, null, false,
      { videoId: 'same', playlistItemId: 'duplicate', unknown: ['preserved', null] },
    ] }
    const replaced = { ...original, videos: [{ videoId: 'new', title: 'é replacement' }, { videoId: 'new' }] }
    const contents = [original, { _id: 'deleted', videos: original.videos }, replaced, { _id: 'deleted', $$deleted: true }].map(model.serialize).join('\n') + '\n'
    await writeFile(join(path, 'playlists.db'), contents)
    let restore
    if (interruption === 'verification') {
      const materialize = LibraryEngine.prototype.materialize
      const mock = t.mock.method(LibraryEngine.prototype, 'materialize', function (collection, ...args) {
        if (collection === 'playlists') throw new Error('interrupted verification')
        return materialize.call(this, collection, ...args)
      })
      restore = () => mock.mock.restore()
    }
    try {
      await assert.rejects(openLibrary(path, { batchSize: 1, onCheckpoint: ({ collection, lines }) => {
        if (interruption === 'replay' && collection === 'playlists' && lines === 2) throw new Error('interrupted replay')
      } }), /interrupted/)
    } finally { restore?.() }
    await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
    const engine = await openLibrary(path, { batchSize: 1 })
    t.after(() => engine.database.close())
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), replaced)
    assert.equal(await engine.playlistSnapshot({ id: 'deleted' }), null)
    const verifyAccounting = () => {
      const summary = engine.prepare("SELECT count, bytes FROM collection_counts WHERE collection = 'playlists'").get()
      const records = engine.prepare("SELECT count(*) AS count, coalesce(sum(length(CAST(data AS BLOB))), 0) AS bytes FROM records WHERE collection = 'playlists'").get()
      const members = engine.prepare("SELECT coalesce(sum(length(CAST(data AS BLOB))), 0) AS bytes FROM members WHERE collection = 'playlists'").get()
      assert.equal(summary.count, records.count)
      assert.equal(summary.bytes, records.bytes + members.bytes)
      const array = engine.prepare("SELECT length, next_position FROM record_arrays WHERE collection = 'playlists' AND record_id = 'p' AND field = 'videos'").get()
      const rows = engine.prepare("SELECT count(*) AS length, coalesce(max(position) + 1, 0) AS next_position FROM members WHERE collection = 'playlists' AND record_id = 'p' AND field = 'videos'").get()
      assert.deepEqual({ ...array }, { ...rows })
      assert.deepEqual(engine.prepare('PRAGMA foreign_key_check').all(), [])
    }
    verifyAccounting()
    await engine.collections.playlists.updateAsync({ _id: 'p' }, { $push: { videos: { videoId: 'appended', unknown: new Date(3) } } })
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, [...replaced.videos, { videoId: 'appended', unknown: new Date(3) }])
    verifyAccounting()
    await engine.collections.playlists.updateAsync({ _id: 'p' }, { $pull: { videos: { videoId: 'new' } } })
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, [{ videoId: 'appended', unknown: new Date(3) }])
    verifyAccounting()
    assert.equal(await readFile(join(path, 'playlists.db'), 'utf8'), contents)
  })
}

test('resumed legacy metadata migration retains NeDB equal-time ID order through replacement records', async t => {
  const path = await directory(t)
  const revisions = ['z-first', 'y-second', 'x-third'].map((_id, index) => ({
    _id, videoId: 'abcdefghijk', title: ['First', 'Second', 'Third'][index], cachedAt: 1000,
    thumbnailUrl: 'https://example.com/image.png', hasThumbnailChange: index < 2,
    thumbnail: index < 2 ? `data:image/png;base64,${index ? 'BBBB' : 'AAAA'}` : null,
  }))
  revisions[0].unknown = { date: new Date(1234) }
  const contents = [ { ...revisions[0], unknown: null }, revisions[1], revisions[2], revisions[0] ].map(model.serialize).join('\r\n')
  const source = join(path, 'video-metadata-cache.db')
  await writeFile(source, contents)
  await assert.rejects(openLibrary(path, { batchSize: 1, onCheckpoint: ({ collection, lines }) => {
    if (collection === 'videoMetadataCache' && lines === 2) throw new Error('simulated interruption')
  } }), /simulated interruption/)
  const engine = await openLibrary(path, { batchSize: 1 })
  try {
    assert.deepEqual(engine.prepare('SELECT record_id FROM metadata_order ORDER BY sequence').all().map(row => row.record_id), revisions.map(record => record._id))
    const legacy = new Datastore({ inMemoryOnly: true })
    await legacy.insertAsync(revisions)
    const ordered = await legacy.findAsync({ videoId: 'abcdefghijk' }).sort({ cachedAt: 1 })
    assert.deepEqual((await metadataPage(engine, { videoId: 'abcdefghijk', field: 'title' })).records.map(row => row.value), ordered.slice(0, -1).toReversed().map(row => row.title))
    for (const record of revisions) assert.deepEqual(await engine.collections.videoMetadataCache.findOneAsync({ _id: record._id }), record)
    assert.deepEqual(engine.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(await readFile(source, 'utf8'), contents)
  } finally { engine.database.close() }
})

test('migration uses a bounded number of prepared statements for replay and independent verification', async t => {
  const path = await directory(t)
  const contents = Array.from({ length: 1000 }, (_, index) => model.serialize({ _id: `history-${index}`, videoId: `video-${index}`, title: `Episode ${index}`, timeWatched: index, unknown: { index } })).join('\n') + '\n'
  await writeFile(join(path, 'history.db'), contents)
  const original = DatabaseSync.prototype.prepare
  const prepare = t.mock.method(DatabaseSync.prototype, 'prepare', function (...args) { return Reflect.apply(original, this, args) })
  const engine = await openLibrary(path)
  try {
    assert.ok(prepare.mock.calls.length < 100, `Prepared ${prepare.mock.calls.length} statements for 1000 records`)
    assert.equal(await engine.collections.history.countAsync({}), 1000)
    assert.deepEqual((await engine.collections.history.findOneAsync({ _id: 'history-999' })).unknown, { index: 999 })
    assert.equal(await readFile(join(path, 'history.db'), 'utf8'), contents)
  } finally { engine.database.close() }
})

test('malformed legacy input fails closed and can be retried after repairing the source', async t => {
  const path = await directory(t)
  await writeFile(join(path, 'history.db'), '{"_id":"safe","videoId":"safe"}\n{"_id":\n')
  await assert.rejects(openLibrary(path), /history.db at line 2/)
  await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
  assert.equal(await readFile(join(path, 'history.db'), 'utf8'), '{"_id":"safe","videoId":"safe"}\n{"_id":\n')
  await writeFile(join(path, 'history.db'), '{"_id":"safe","videoId":"safe"}\n')
  const engine = await openLibrary(path)
  assert.equal(await engine.collections.history.countAsync({}), 1)
  engine.database.close()
})

test('a missing active database never silently restores stale legacy snapshots', async t => {
  const path = await directory(t)
  const engine = await openLibrary(path)
  await engine.collections.history.insertAsync({ _id: 'new', videoId: 'new' })
  engine.database.close()
  await rm(join(path, 'library.sqlite'))
  await assert.rejects(openLibrary(path), { code: 'LIBRARY_MISSING' })
})

test('identity mismatch fails closed with a recovery code and saved translation preferences', async t => {
  const path = await directory(t)
  const engine = await openLibrary(path)
  await engine.collections.settings.insertAsync({ _id: 'currentLocale', value: 'de-DE' })
  await engine.collections.settings.insertAsync({ _id: 'useAITranslationCompletions', value: false })
  await engine.collections.history.insertAsync({ _id: 'new', videoId: 'new' })
  engine.database.close()
  await writeFile(join(path, 'library.sqlite.initialized'), 'different-profile')
  await assert.rejects(openLibrary(path), { code: 'LIBRARY_IDENTITY_MISMATCH', locale: 'de-DE', useAITranslationCompletions: false })
  assert.equal(await readFile(join(path, 'library.sqlite.initialized'), 'utf8'), 'different-profile')

  const deserialize = model.deserialize
  t.mock.method(model, 'deserialize', data => {
    const record = deserialize(data)
    if (record._id === 'currentLocale') throw new Error('Unreadable locale record')
    return record
  })
  await assert.rejects(openLibrary(path), { code: 'LIBRARY_IDENTITY_MISMATCH', useAITranslationCompletions: false })
})

test('interrupted identity-marker writes leave the validated active library recoverable', async t => {
  const path = await directory(t)
  const original = '{"_id":"saved","videoId":"saved","unknown":{"keep":true}}\n'
  await writeFile(join(path, 'history.db'), original)
  const probe = await open(join(path, 'filehandle-probe'), 'w')
  const prototype = Object.getPrototypeOf(probe)
  await probe.close()
  const write = t.mock.method(prototype, 'writeFile', () => { throw new Error('simulated marker interruption') })
  await assert.rejects(openLibrary(path), /simulated marker interruption/)
  write.mock.restore()
  await assert.rejects(readFile(join(path, 'library.sqlite.initialized')), { code: 'ENOENT' })
  const engine = await openLibrary(path)
  try {
    assert.deepEqual(await engine.collections.history.findAsync({}), [{ _id: 'saved', videoId: 'saved', unknown: { keep: true } }])
    assert.equal(await readFile(join(path, 'history.db'), 'utf8'), original)
    await engine.collections.history.insertAsync({ _id: 'new', videoId: 'new' })
  } finally { engine.database.close() }
  await rm(join(path, 'library.sqlite.initialized'))
  const retryWrite = t.mock.method(prototype, 'writeFile', () => { throw new Error('simulated marker interruption') })
  await assert.rejects(openLibrary(path), /simulated marker interruption/)
  retryWrite.mock.restore()
  await assert.rejects(readFile(join(path, 'library.sqlite.initialized')), { code: 'ENOENT' })
  const reopened = await openLibrary(path)
  try { assert.equal(await reopened.collections.history.countAsync({}), 2) } finally { reopened.database.close() }
})

test('source modification during migration prevents activation', async t => {
  const path = await directory(t)
  await writeFile(join(path, 'history.db'), '{"_id":"safe","videoId":"safe"}\n')
  await assert.rejects(openLibrary(path, { batchSize: 1, onCheckpoint: async ({ collection }) => {
    if (collection === 'history') await appendFile(join(path, 'history.db'), '\n')
  } }), /changed during migration/)
  await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
})

test('playlist metadata edits do not read, replace or rewrite membership rows', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 20000 }, (_, index) => ({ videoId: `video-${index}`, playlistItemId: `item-${index}` }))
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos, playlistName: 'Original' })
  const before = engine.database.prepare('SELECT total_changes() AS changes').get().changes
  const materialize = engine.materialize.bind(engine)
  engine.materialize = (collection, row, options) => {
    assert.equal(options?.arrays, false, 'metadata mutation must never hydrate members')
    return materialize(collection, row, options)
  }
  await engine.collections.playlists.updateAsync({ _id: 'playlist' }, { $set: { playlistName: 'Renamed' } })
  const after = engine.database.prepare('SELECT total_changes() AS changes').get().changes
  assert.equal(after - before, 3, 'one metadata row, its byte counter and one revision row')
  engine.materialize = materialize
  assert.deepEqual((await engine.collections.playlists.findOneAsync({ _id: 'playlist' })).videos, videos)
  assert.equal(engine.playlistSummaries()[0].videoCount, 20000)
})

test('transaction failures roll back bulk mutations, metadata, members and revisions', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos: [{ videoId: 'original' }] })
  const revision = engine.revision('playlists')
  await assert.rejects(engine.transaction(async () => {
    await engine.collections.playlists.updateAsync({ _id: 'playlist' }, { $push: { videos: { videoId: 'new' } } })
    await engine.collections.playlists.insertAsync({ _id: 'playlist', videos: [] })
  }), /UNIQUE constraint/)
  assert.deepEqual((await engine.collections.playlists.findOneAsync({ _id: 'playlist' })).videos, [{ videoId: 'original' }])
  assert.equal(engine.revision('playlists'), revision)
})

test('large duplicate cleanup retains the first stable member, metadata and protection', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'duplicate', protected: true, unknown: { retained: true }, videos: Array.from({ length: 20000 }, (_, index) => ({ videoId: 'same', playlistItemId: 'collision', title: String(index) })) })
  const first = engine.playlistPage({ id: 'duplicate' }).records[0]
  assert.equal(await engine.cleanupPlaylist({ id: 'duplicate', mode: 'duplicates' }), 19999)
  const kept = engine.playlistPage({ id: 'duplicate' }).records
  assert.equal(kept.length, 1)
  assert.deepEqual(kept[0], first)
  assert.equal(engine.playlistSummaries()[0].protected, true)
  assert.deepEqual(engine.playlistSummaries()[0].unknown, { retained: true })
})

for (const playlistItemId of [undefined, null]) {
  test(`SQLite duplicate cleanup retains ambiguous history context with a surviving legacy item ID of ${playlistItemId}`, async t => {
    const engine = memory(t)
    await engine.collections.playlists.insertAsync({ _id: 'legacy-context', videos: [
      { videoId: 'same', playlistItemId, unknown: new Date(2) },
      { videoId: 'same', playlistItemId: 'removed', unknown: new Date(3) },
    ] })
    const record = { _id: 'context', videoId: 'same', timeWatched: 1, lastViewedPlaylistId: 'legacy-context', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'removed', watchProgress: 123, unknown: new Date(1) }
    await engine.collections.history.insertAsync(record)
    assert.equal(await engine.cleanupPlaylist({ id: 'legacy-context', mode: 'duplicates' }), 1)
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), record)
  })
}

test('bounded history cursors preserve tied timestamps and reject stale pages', async t => {
  const engine = memory(t)
  const records = Array.from({ length: 1000 }, (_, index) => ({ _id: `id-${String(index).padStart(4, '0')}`, videoId: `video-${index}`, timeWatched: Math.floor(index / 10) }))
  await engine.collections.history.insertAsync(records)
  const result = []
  let page = engine.historyPage({ limit: 73 })
  while (true) {
    assert.equal(page.records.length <= 73, true)
    result.push(...page.records)
    if (!page.cursor) break
    page = engine.historyPage({ limit: 73, cursor: page.cursor })
  }
  assert.deepEqual(result.map(record => record._id), records.toReversed().map(record => record._id))
  page = engine.historyPage({ limit: 20 })
  await engine.collections.history.insertAsync({ _id: 'latest', videoId: 'latest', timeWatched: 1000 })
  assert.equal(engine.historyPage({ cursor: page.cursor }).stale, true)
})

test('history search preserves fuzzy, accent, case and short-query semantics across pages', async t => {
  const engine = memory(t)
  const records = [
    { _id: 'one', videoId: 'one', title: 'Troubleshooting café', author: 'Élodie', timeWatched: 3 },
    { _id: 'two', videoId: 'two', title: 'Türkçe İSTANBUL', author: 'Example', timeWatched: 2 },
    { _id: 'three', videoId: 'three', title: 'Snow 雪', author: 'Short', timeWatched: 1 },
  ]
  await engine.collections.history.insertAsync(records)
  assert.equal(engine.historyPage({ query: 'troubleshootnig cafe' }).records[0]._id, 'one')
  assert.equal(engine.historyPage({ query: 'Élodie', caseSensitive: true }).records[0]._id, 'one')
  assert.equal(engine.historyPage({ query: 'élodie', caseSensitive: true }).records.length, 0)
  assert.equal(engine.historyPage({ query: 'istanbul', locale: 'tr-TR' }).records[0]._id, 'two')
  assert.equal(engine.historyPage({ query: '雪' }).records[0]._id, 'three')
})

for (const [operator, previous, next] of [['$min', 'zzzz', 'alpha'], ['$max', 'aaaa', '雪山']]) {
  test(`history search follows actual title and author changes through ${operator}`, async t => {
    const engine = memory(t)
    const portable = new Datastore({ inMemoryOnly: true })
    const record = { _id: 'changed', title: previous, author: previous, timeWatched: 1, unknown: new Date(123) }
    await engine.collections.history.insertAsync(record)
    await portable.insertAsync(record)
    const update = { [operator]: { title: next, author: next } }
    await engine.collections.history.updateAsync({ _id: record._id }, update)
    await portable.updateAsync({ _id: record._id }, update)
    const expected = await portable.findOneAsync({ _id: record._id })
    assert.deepEqual(engine.historyPage({ query: next }).records, [migrateLegacyHistoryRecord(expected)])
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), expected)
    assert.equal(engine.prepare('SELECT 1 FROM search_characters WHERE record_id = ? AND character = ?').get(record._id, previous[0]), undefined)
  })
}

test('history progress and unchanged metadata edits do not rebuild the search index', async t => {
  const engine = memory(t)
  await engine.collections.history.insertAsync({ _id: 'progress', title: 'before', author: 'author', watchProgress: 0 })
  const indexSearch = engine.indexSearch.bind(engine)
  let indexed = 0
  t.mock.method(engine, 'indexSearch', record => { indexed++; return indexSearch(record) })
  await engine.collections.history.updateAsync({ _id: 'progress' }, { $inc: { watchProgress: 1 } })
  await engine.collections.history.updateAsync({ _id: 'progress' }, { $set: { title: 'before', author: 'author' } })
  assert.equal(indexed, 0)
  await engine.collections.history.updateAsync({ _id: 'progress' }, { $max: { title: 'zzz' } })
  assert.equal(indexed, 1)
  assert.equal(engine.historyPage({ query: 'zzz' }).records[0].watchProgress, 1)
})

test('recommendation learning budgets count distinct eligible videos without changing duplicate storage', async t => {
  const engine = memory(t)
  const duplicates = Array.from({ length: 1100 }, (_, index) => ({ _id: `duplicate-${index}`, videoId: 'duplicate', title: String(index), author: 'Visible', timeWatched: 5000 + index, unknown: new Date(index) }))
  const history = Array.from({ length: 1100 }, (_, index) => ({ _id: `distinct-${index}`, videoId: `distinct-${index}`, timeWatched: index, author: 'Visible' }))
  await engine.collections.history.insertAsync([...duplicates, ...history, { _id: 'hidden', videoId: 'duplicate', author: 'Hidden', timeWatched: 10000 }])
  const videos = [...duplicates.slice(0, 600), ...history.slice(0, 550)]
  await engine.collections.playlists.insertAsync([{ _id: 'favorites', videos }, { _id: 'saved', videos }])
  const inputs = recommendationInputs(engine, { preferences: { hiddenChannelNames: ['Hidden'] } })
  assert.equal(inputs.history.length, 1000)
  assert.equal(inputs.history[0].title, '1099', 'the newest eligible occurrence must supply the history metadata')
  assert.equal(inputs.history.at(-1).videoId, 'distinct-101')
  for (const source of ['favorites', 'saved']) {
    assert.equal(inputs[source].length, 500)
    assert.equal(inputs[source][0].title, '0', 'the first eligible playlist member must be retained')
    assert.equal(inputs[source].at(-1).videoId, 'distinct-498')
  }
  for (const source of Object.values(inputs)) assert.equal(new Set(source.map(video => video.videoId)).size, source.length)
  assert.equal(engine.collections.history.count(), 2201)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'favorites' })).videos, videos)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'saved' })).videos, videos)
})

test('indexed history search retains fuzzy edits at every position and repeated anchors across pages', async t => {
  const engine = memory(t)
  const queries = ['cafe', 'needle', 'abcdefg', 'aaabcde', 'aaaaaaa', 'αβγδεζη', '雪山動画履歴集', '😀🦊📺ab', '😀😀', '\uD83D', '\uDE00', 'İstanbul', 'ΟΣΟΣΟΣΑ']
  const records = []
  for (const query of queries) {
    const characters = [...query]
    const variants = new Set([query, characters.join(' '), 'unrelated'])
    // The released matcher compares UTF-16 units: these distinct characters
    // contain a matching subsequence of surrogate halves across code points.
    if (query === '😀😀') variants.add('😁𠈀😁𠈀')
    for (let first = 0; first < characters.length; first++) {
      variants.add(characters.filter((_, index) => index !== first).join(''))
      variants.add(characters.map((character, index) => index === first ? 'x' : character).join(''))
      variants.add([...characters.slice(0, first), 'x', ...characters.slice(first)].join(''))
      if (first + 1 < characters.length) {
        const transposed = [...characters]
        ;[transposed[first], transposed[first + 1]] = [transposed[first + 1], transposed[first]]
        variants.add(transposed.join(''))
      }
      if (query.length < 7) continue
      for (let second = first + 1; second < characters.length; second++) {
        for (const edits of [['', ''], ['', 'x'], ['x', ''], ['x', 'x']]) {
          variants.add(characters.map((character, index) => index === first ? edits[0] : index === second ? edits[1] : character).join(''))
        }
      }
    }
    for (const variant of variants) {
      const index = records.length
      records.push({
        _id: String(index).padStart(5, '0'), videoId: `video-${index}`, timeWatched: Math.floor(index / 3), isWatched: false,
        title: index % 2 ? variant : 'unrelated', author: index % 2 ? 'unrelated' : variant, unknown: { preserved: index },
      })
    }
  }
  await engine.collections.history.insertAsync(records)
  for (const query of queries) {
    for (const locale of ['en-US', 'tr-TR']) {
      for (const caseSensitive of [false, true]) {
        for (const oldest of [false, true]) {
          const expected = filterVideosWithQuery(oldest ? records : records.toReversed(), query, caseSensitive, locale)
          assert.ok(expected.length > 0)
          const actual = []
          let cursor = null
          do {
            const page = engine.historyPage({ query, locale, caseSensitive, oldest, cursor, limit: 17 })
            actual.push(...page.records)
            cursor = page.cursor
          } while (cursor)
          assert.deepEqual(actual, expected, `${query} / ${locale} / caseSensitive=${caseSensitive} / oldest=${oldest}`)
        }
      }
    }
  }
})

test('filtered history pages fill across rejected candidates and tied timestamps in both directions', async t => {
  const engine = memory(t)
  const records = Array.from({ length: 320 }, (_, index) => ({
    _id: `id-${String(index).padStart(4, '0')}`, videoId: `video-${index}`, timeWatched: Math.floor(index / 7),
    title: index % 11 === 0 ? 'Target needle' : 'Target unrelated',
  }))
  await engine.collections.history.insertAsync(records)
  for (const oldest of [false, true]) {
    const options = { query: 'target needle', oldest, limit: 7 }
    const expected = filterVideosWithQuery(oldest ? records : records.toReversed(), options.query)
    const actual = []
    let page = engine.historyPage(options)
    for (;;) {
      assert.equal(page.records.length, Math.min(7, expected.length - actual.length))
      actual.push(...page.records)
      if (!page.cursor) break
      page = engine.historyPage({ ...options, cursor: page.cursor })
    }
    assert.deepEqual(actual.map(record => record._id), expected.map(record => record._id))
  }
})

test('a validated staging database recovers a crash immediately before activation', async t => {
  const path = await directory(t)
  await writeFile(join(path, 'playlists.db'), model.serialize({ _id: 'protected', playlistName: 'Keep me', protected: true, videos: [{ videoId: 'same' }, { videoId: 'same' }] }))
  await assert.rejects(openLibrary(path, { onCheckpoint: checkpoint => { if (checkpoint.collection === 'validated') throw new Error('power failure') } }), /power failure/)
  const engine = await openLibrary(path)
  assert.equal(engine.playlistSummaries()[0].videoCount, 2)
  assert.equal(engine.playlistSummaries()[0].protected, true)
  engine.database.close()
})

test('replacement and partial reordering preserve stable memberships, hidden members and duplicate identities', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 300 }, (_, index) => ({ videoId: index % 2 ? 'duplicate' : `video-${index}`, playlistItemId: index % 2 ? 'duplicate-item' : `item-${index}`, title: `Title ${index}` }))
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos })
  const first = engine.playlistPage({ id: 'playlist', limit: 100 })
  const ids = first.records.map(record => record._libraryMemberId)
  await engine.reorderPlaylistMembers({ id: 'playlist', memberIds: ids.toReversed(), revision: first.revision })
  const saved = await engine.playlistSnapshot({ id: 'playlist' })
  assert.deepEqual(saved.videos, videos.slice(0, 100).toReversed().concat(videos.slice(100)))
  assert.deepEqual(engine.playlistPage({ id: 'playlist' }).records.map(record => record._libraryMemberId), ids.toReversed())
  const originalIds = engine.playlistPage({ id: 'playlist' }).records.map(record => record._libraryMemberId)
  await engine.collections.playlists.updateAsync({ _id: 'playlist' }, { $set: { videos: saved.videos } })
  assert.deepEqual(engine.playlistPage({ id: 'playlist' }).records.map(record => record._libraryMemberId), originalIds)
  await assert.rejects(engine.reorderPlaylistMembers({ id: 'playlist', memberIds: ids, revision: first.revision }), /changed/)
  assert.equal((await engine.playlistSnapshot({ id: 'playlist' })).videos.length, 300)
})

test('player windows navigate across unloaded pages and keep a stable full-library shuffle', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos: Array.from({ length: 20000 }, (_, index) => ({ videoId: `video-${index}`, playlistItemId: `item-${index}`, title: String(index) })) })
  const page = engine.playlistWindow({ id: 'playlist', anchor: { itemId: 'item-10000', videoId: 'video-10000' } })
  assert.equal(page.records.length, 100)
  assert.equal(page.index, 10000)
  assert.equal(page.offset, 9980)
  assert.equal(page.next.videoId, 'video-10001')
  assert.equal(page.previous.videoId, 'video-9999')
  const options = { id: 'playlist', shuffleSeed: 'stable-seed', shuffleAnchor: { itemId: 'item-10000', videoId: 'video-10000' } }
  const shuffled = engine.playlistWindow({ ...options, anchor: options.shuffleAnchor })
  assert.equal(shuffled.index, 0)
  assert.equal(shuffled.records[0].videoId, 'video-10000')
  assert.equal(new Set(shuffled.records.map(record => record._libraryMemberId)).size, 100)
  const next = engine.playlistWindow({ ...options, anchor: { memberId: shuffled.next._libraryMemberId } })
  assert.equal(next.index, 1)
  assert.equal(next.previous.videoId, 'video-10000')
})

for (const shuffleAnchor of [undefined, null]) {
  test(`an unanchored shuffle does not promote members without video IDs (${shuffleAnchor})`, async t => {
    const engine = memory(t)
    const videos = Array.from({ length: 8 }, (_, index) => ({ videoId: `video-${index}`, playlistItemId: `item-${index}`, title: String(index), unknown: new Date(index) }))
    const legacy = structuredClone(videos)
    delete legacy[3].videoId
    await engine.collections.playlists.insertAsync([{ _id: 'control', videos }, { _id: 'legacy', videos: legacy }])
    const options = { shuffleSeed: 'unanchored-legacy', shuffleAnchor, limit: 8 }
    const expected = engine.playlistWindow({ id: 'control', ...options }).records.map(record => record.playlistItemId)
    const actual = engine.playlistWindow({ id: 'legacy', ...options })
    assert.deepEqual(actual.records.map(record => record.playlistItemId), expected)
    assert.deepEqual(engine.playlistWindow({ id: 'legacy', ...options }), actual)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'legacy' })).videos, legacy)
  })
}

for (const shuffleSeed of ['', 'stable-empty-item']) {
  test(`empty legacy playlist item IDs anchor the correct duplicate with shuffle=${Boolean(shuffleSeed)}`, async t => {
    const engine = memory(t)
    const videos = [
      { videoId: 'same', playlistItemId: 'other', title: 'First occurrence', unknown: new Date(1) },
      { videoId: 'before', playlistItemId: 'before' },
      { videoId: 'same', playlistItemId: '', title: 'Empty-ID occurrence', unknown: new Date(2) },
      { videoId: 'after', playlistItemId: 'after' },
    ]
    await engine.collections.playlists.insertAsync({ _id: 'playlist', videos })
    const anchor = { videoId: 'same', itemId: '' }
    const options = { id: 'playlist', anchor, shuffleSeed, shuffleAnchor: anchor }
    const window = engine.playlistWindow(options)
    assert.equal(window.index, shuffleSeed ? 0 : 2)
    const { _libraryMemberId, ...current } = window.records[window.index - window.offset]
    assert.deepEqual(current, videos[2])
    assert.equal(typeof _libraryMemberId, 'string')
    if (!shuffleSeed) {
      assert.equal(window.previous.videoId, 'before')
      assert.equal(window.next.videoId, 'after')
    }
    const repeated = engine.playlistWindow(options)
    assert.deepEqual(repeated, window)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'playlist' })).videos, videos)
  })
}

test('summary uses indexed eligibility and retains old Takeout, fractional-progress and premiere rules', async t => {
  const engine = memory(t)
  await engine.collections.history.insertAsync([
    { _id: 'takeout', videoId: 'takeout', timeWatched: 3, published: 3, lengthSeconds: null, watchProgress: 1, description: '', isLive: true, type: 'video' },
    { _id: 'fraction', videoId: 'fraction', timeWatched: 2, published: 2, lengthSeconds: 1000, watchProgress: 0.5, description: '', isLive: false, type: 'video' },
    { _id: 'premiere', videoId: 'premiere', timeWatched: 1, watchProgress: 10, lengthSeconds: 100, isUpcoming: true, premiereTimestamp: Date.now() / 1000 + 3600 },
  ])
  const summary = engine.historySummary()
  assert.equal(summary.total, 3)
  assert.deepEqual(summary.continued.map(record => [record.videoId, record.watchProgress]), [['fraction', 500]])
  assert.equal(engine.historyPage().records[0].isWatched, true)
  assert.equal(engine.historyPage().records[0].isLive, false)
  const plan = engine.database.prepare("EXPLAIN QUERY PLAN SELECT data FROM records WHERE collection = 'history' AND continue_candidate = 1 AND watchable_after <= ? ORDER BY sort_time DESC, id DESC LIMIT 50").all(Date.now())
  assert.ok(plan.some(row => row.detail.includes('records_continue')))
})

test('SQLite predicates match NeDB including negation, unknown operators, dates, nulls and nested arrays', async t => {
  const engine = memory(t)
  const records = [
    { _id: 'a', videoId: 'a', value: null, flag: false, age: 0, nested: { list: [{ value: 3 }] }, subscriptions: [{ id: 'one' }], date: new Date(0) },
    { _id: 'b', videoId: 'b', value: 'x', flag: true, age: 9, nested: { list: [] }, subscriptions: [{ id: 'two' }], date: new Date(50) },
    { _id: 'c', videoId: 'c', value: ['x', null], age: '9', subscriptions: [] },
    { _id: 'd', videoId: 'd' },
  ]
  await engine.collections.profiles.insertAsync(records)
  const queries = [
    { value: null }, { value: 'x' }, { value: { $ne: null } }, { value: { $nin: ['x'] } },
    { age: { $lt: 1 } }, { flag: { $exists: false } }, { date: new Date(0) },
    { 'nested.list.value': 3 }, { subscriptions: { $elemMatch: { id: 'one' } } },
    { $and: [{ value: /x/ }, { $not: { value: 'x' } }] },
    { $or: [{ value: /x/ }, { $not: { age: { $gt: 1 } } }] },
    { $not: { value: { $size: 2 } } },
  ]
  for (const query of queries) {
    const expected = records.filter(record => model.match(record, query)).map(record => record._id)
    assert.deepEqual((await engine.collections.profiles.findAsync(query)).map(record => record._id), expected, JSON.stringify(query))
    assert.equal(await engine.collections.profiles.countAsync(query), expected.length, JSON.stringify(query))
  }
})

test('fallback counts avoid unrelated members and blobs while preserving full predicate semantics', async t => {
  const engine = memory(t)
  const base = Array.from({ length: 8 }, (_, index) => ({
    _id: String(index), label: index % 2 ? 'other' : 'match', date: new Date(index), nested: { value: index }
  }))
  const playlists = base.map(record => ({ ...record,
    videos: Array.from({ length: 100 }, (_, index) => ({ videoId: `video-${index}`, title: index % 2 ? 'other' : 'match' }))
  }))
  const metadata = base.map(record => ({ ...record, thumbnail: `${record.label}-${'x'.repeat(65536)}` }))
  await engine.collections.playlists.insertAsync(playlists)
  await engine.collections.videoMetadataCache.insertAsync(metadata)
  const reads = []
  const prepare = engine.prepare.bind(engine)
  t.mock.method(engine, 'prepare', sql => {
    if (/FROM (members|record_arrays|record_blobs)\b/.test(sql)) reads.push(sql)
    return prepare(sql)
  })
  const scalarQueries = [
    { label: 'match' }, { label: /match/ }, { date: { $gte: new Date(3) } },
    { $or: [{ label: /match/ }, { 'nested.value': { $gte: 3 } }] },
    { $and: [{ date: { $gte: new Date(1) } }, { $not: { label: 'other' } }] },
    { _id: { $in: ['0', '2'] } }, { missing: { $exists: false } }
  ]
  for (const [name, records] of [['playlists', playlists], ['videoMetadataCache', metadata]]) {
    for (const query of scalarQueries) {
      assert.equal(await engine.collections[name].countAsync(query), records.filter(record => model.match(record, query)).length)
    }
  }
  assert.deepEqual(reads, [], 'scalar counts must not hydrate unrelated normalized members or thumbnail blobs')
  for (const query of [
    { videos: { $size: 100 } }, { 'videos.title': /match/ },
    { $not: { videos: { $elemMatch: { videoId: 'missing' } } } },
    { $or: [{ label: 'missing' }, { videos: { $elemMatch: { title: /match/ } } }] },
    { $where: function () { return this.videos.length === 100 && this.date instanceof Date } }
  ]) {
    assert.equal(await engine.collections.playlists.countAsync(query), playlists.filter(record => model.match(record, query)).length)
  }
  for (const query of [
    { thumbnail: /^match/ }, { $not: { thumbnail: /^other/ } },
    { $or: [{ label: 'missing' }, { thumbnail: /match/ }] },
    { $where: function () { return this.thumbnail.startsWith('match') && this.date instanceof Date } }
  ]) {
    assert.equal(await engine.collections.videoMetadataCache.countAsync(query), metadata.filter(record => model.match(record, query)).length)
  }
})

test('timeWatched predicates preserve stored values independently of cachedAt and missing timestamp fallbacks', async t => {
  const engine = memory(t)
  const records = [
    { _id: 'a', timeWatched: 0, cachedAt: 100 },
    { _id: 'b', timeWatched: 9, cachedAt: 1 },
    { _id: 'c', timeWatched: '9', cachedAt: 90 },
    { _id: 'd', cachedAt: 9 },
    { _id: 'e', timeWatched: [9], cachedAt: 10 },
    { _id: 'f', timeWatched: new Date(9), cachedAt: 11 },
    { _id: 'g', timeWatched: null, cachedAt: 12 },
  ]
  const queries = [
    { timeWatched: 0 }, { timeWatched: 9 }, { timeWatched: '9' }, { timeWatched: new Date(9) }, { timeWatched: null },
    { timeWatched: { $exists: false } }, { timeWatched: { $lt: 10 } }, { timeWatched: { $gte: '8' } },
    { timeWatched: { $in: [0, 9, '9'] } }, { timeWatched: { $nin: [9] } }, { $not: { timeWatched: 9 } },
  ]
  for (const name of ['history', 'profiles', 'videoMetadataCache']) {
    const collection = engine.collections[name]
    await collection.insertAsync(records)
    for (const query of queries) {
      const expected = records.filter(record => model.match(record, query)).map(record => record._id)
      assert.deepEqual((await collection.findAsync(query)).map(record => record._id), expected, `${name}: ${JSON.stringify(query)}`)
      assert.equal(await collection.countAsync(query), expected.length)
      assert.deepEqual(await collection.findOneAsync(query), records.find(record => model.match(record, query)) ?? null)
    }
  }
})

test('record ID predicates preserve NeDB types for reads, updates and removals', async t => {
  const records = ['0', '0.0', '1', '1.0', '1.5', '42', '42.0', '43', 'null', 'true'].map(_id => ({ _id, unknown: { date: new Date(123) } }))
  const queries = [
    { _id: 42 }, { _id: 1.5 }, { _id: true }, { _id: false }, { _id: null }, { _id: new Date(42) },
    { _id: { $ne: 42 } }, { _id: { $nin: [42] } }, { _id: { $in: [42, '43'] } },
    { _id: { $nin: [42, '43'] } }, { _id: { $lt: 42 } }, { _id: { $gte: 42 } },
    { _id: { $gt: false } }, { _id: { $gte: '1', $ne: 42 } },
    { $not: { _id: 42 } }, { $not: { _id: { $nin: [42, '43'] } } },
    { $or: [{ _id: 42 }, { _id: '43' }] },
    { _id: '42' }, { _id: { $in: ['42', '43'] } }, { _id: { $ne: '42' } },
    { _id: { $exists: true } }, { _id: { $exists: false } },
    { _id: {} }, { _id: [] }, { _id: Object.create(null) },
    { $not: { _id: {} } }, { $not: { _id: [] } },
    { $or: [{ _id: {} }, { _id: '43' }] },
    { $and: [{ _id: [] }, { unknown: { $exists: true } }] },
  ]
  for (const query of queries) {
    await t.test(JSON.stringify(query), async t => {
      const collection = memory(t).collections.profiles
      const portable = new Datastore()
      await collection.insertAsync(records)
      await portable.insertAsync(records)
      assert.deepEqual(await collection.findAsync(query).sort({ _id: 1 }), await portable.findAsync(query).sort({ _id: 1 }))
      assert.deepEqual(await collection.findOneAsync(query), await portable.findOneAsync(query))
      assert.equal(await collection.countAsync(query), await portable.countAsync(query))
      assert.deepEqual(await collection.findAsync(query).sort({ _id: 1 }).skip(1).limit(1), await portable.findAsync(query).sort({ _id: 1 }).skip(1).limit(1))
      const update = { $set: { changed: true } }
      assert.equal((await collection.updateAsync(query, update, { multi: true })).numAffected, (await portable.updateAsync(query, update, { multi: true })).numAffected)
      assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
      assert.equal(await collection.removeAsync(query, { multi: true }), await portable.removeAsync(query, { multi: true }))
      assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
    })
  }
})

test('exists predicates preserve NeDB truthiness for reads and mutations', async t => {
  const records = [
    { _id: 'a', videoId: 'video', title: '', videos: [{ videoId: 'video' }], unknown: new Date(123) },
    { _id: 'b', videoId: null, title: null, videos: [{ videoId: null }] },
    { _id: 'c', videos: [{}] },
  ]
  for (const field of ['_id', 'videoId', 'title', 'videos']) {
    for (const argument of ['', true, false, 0, null, undefined, [], {}]) {
      await t.test(`${field}: ${String(argument)} (${typeof argument})`, async t => {
        const collection = memory(t).collections.playlists
        const portable = new Datastore()
        await collection.insertAsync(records)
        await portable.insertAsync(records)
        const condition = { $exists: argument }
        const query = field === 'videos' ? { videos: { $elemMatch: { videoId: condition } } } : { [field]: condition }
        for (const predicate of [query, { $not: query }, { $or: [query, { _id: 'c' }] }]) {
          assert.deepEqual(await collection.findAsync(predicate).sort({ _id: 1 }), await portable.findAsync(predicate).sort({ _id: 1 }))
          assert.equal(await collection.countAsync(predicate), await portable.countAsync(predicate))
          assert.deepEqual(await collection.findAsync(predicate).sort({ _id: 1 }).skip(1).limit(1), await portable.findAsync(predicate).sort({ _id: 1 }).skip(1).limit(1))
        }
        assert.equal((await collection.updateAsync(query, { $set: { changed: true } }, { multi: true })).numAffected, (await portable.updateAsync(query, { $set: { changed: true } }, { multi: true })).numAffected)
        assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
        assert.equal(await collection.removeAsync(query, { multi: true }), await portable.removeAsync(query, { multi: true }))
        assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
      })
    }
  }
})

test('string range predicates preserve NeDB Unicode ordering for reads and mutations', async t => {
  const values = ['A', 'a', 'é', '\uE000', '😀', '😁']
  for (const field of ['_id', 'videoId', 'title', 'videos']) {
    for (const operator of ['$lt', '$lte', '$gt', '$gte']) {
      await t.test(`${field} ${operator}`, async t => {
        const collection = memory(t).collections.playlists
        const portable = new Datastore()
        const records = values.map((value, index) => ({ _id: field === '_id' ? value : String(index), videoId: value, title: value, videos: [{ videoId: value }], retained: new Date(123) }))
        const condition = { [operator]: '\uE000' }
        const query = field === 'videos' ? { videos: { $elemMatch: { videoId: condition } } } : { [field]: condition }
        await collection.insertAsync(records)
        await portable.insertAsync(records)
        const ids = entries => entries.map(entry => entry._id).sort()
        assert.deepEqual(ids(await collection.findAsync(query)), ids(await portable.findAsync(query)))
        assert.equal(await collection.countAsync(query), await portable.countAsync(query))
        const update = { $set: { changed: true } }
        assert.equal((await collection.updateAsync(query, update, { multi: true })).numAffected, (await portable.updateAsync(query, update, { multi: true })).numAffected)
        for (const record of records) assert.deepEqual(await collection.findOneAsync({ _id: record._id }), await portable.findOneAsync({ _id: record._id }))
        assert.equal(await collection.removeAsync(query, { multi: true }), await portable.removeAsync(query, { multi: true }))
        assert.deepEqual(ids(await collection.findAsync({})), ids(await portable.findAsync({})))
      })
    }
  }
})

test('sorted cursors apply NeDB type and Unicode ordering before windowing and projection', async t => {
  const collection = memory(t).collections.playlists
  const portable = new Datastore()
  const values = [undefined, null, 2, 10, '\uE000', '😀', false, true, new Date(2), new Date(10), [2], [10], { value: 2 }, { value: 10 }]
  const records = values.map((value, index) => ({ _id: String(index).padStart(2, '0'), ...(value === undefined ? {} : { value }), nested: value === undefined ? {} : { value }, videos: [value === undefined ? {} : { order: value }], retained: 'unchanged' }))
  await collection.insertAsync(records)
  await portable.insertAsync(records)
  for (const field of ['value', 'nested.value', 'videos']) {
    for (const direction of [-1, 1]) {
      const sort = { [field]: direction }
      assert.deepEqual(await collection.findAsync({}).sort(sort), await portable.findAsync({}).sort(sort), `${field} ${direction}`)
      assert.deepEqual(await collection.findAsync({}, { _id: 1, retained: 1 }).sort(sort).skip(3).limit(5), await portable.findAsync({}, { _id: 1, retained: 1 }).sort(sort).skip(3).limit(5), `${field} ${direction}: projected window`)
    }
  }
  const unicodeIds = ['\uE000', '😀'].map(_id => ({ _id, value: 0, videos: [] }))
  await collection.insertAsync(unicodeIds)
  await portable.insertAsync(unicodeIds)
  assert.deepEqual(await collection.findAsync({ _id: { $in: unicodeIds.map(record => record._id) } }).sort({ _id: 1 }).limit(1), await portable.findAsync({ _id: { $in: unicodeIds.map(record => record._id) } }).sort({ _id: 1 }).limit(1))
})

test('sorted metadata cursors use stored thumbnails even when their projection omits them', async t => {
  const collection = memory(t).collections.videoMetadataCache
  const portable = new Datastore()
  const records = [{ _id: 'a', thumbnail: '\uE000' }, { _id: 'b', thumbnail: '😀' }]
  await collection.insertAsync(records)
  await portable.insertAsync(records)
  const projection = { thumbnail: 0 }
  assert.deepEqual(await collection.findAsync({}, projection).sort({ thumbnail: 1 }).limit(1), await portable.findAsync({}, projection).sort({ thumbnail: 1 }).limit(1))
})

test('generic sorted windows hydrate unrelated playlist members and thumbnails only for the page', async t => {
  const engine = memory(t)
  const records = Array.from({ length: 40 }, (_, index) => ({ _id: String(index).padStart(2, '0'), title: String(40 - index).padStart(2, '0'), videos: [{ videoId: 'retained', unknown: new Date(2) }], thumbnail: `data:image/png;base64,${index}` }))
  await engine.collections.playlists.insertAsync(records)
  await engine.collections.videoMetadataCache.insertAsync(records)
  const materialize = engine.materialize.bind(engine)
  const hydration = { arrays: 0, blobs: 0 }
  t.mock.method(engine, 'materialize', (collection, row, options) => {
    if (options.arrays) hydration.arrays++
    if (options.blobs) hydration.blobs++
    return materialize(collection, row, options)
  })
  for (const name of ['playlists', 'videoMetadataCache']) {
    assert.deepEqual(await engine.collections[name].findAsync({}).sort({ title: 1 }).skip(2).limit(3), records.toReversed().slice(2, 5))
  }
  assert.deepEqual(hydration, { arrays: 3, blobs: 6 })
})

test('numeric history sort ties retain NeDB Unicode ID ordering within the requested window', async t => {
  const collection = memory(t).collections.history
  const portable = new Datastore()
  const records = ['\uE000', '😀', '😁'].map(_id => ({ _id, timeWatched: 123 }))
  await collection.insertAsync(records)
  await portable.insertAsync(records)
  for (const direction of [-1, 1]) {
    const sort = { timeWatched: direction }
    assert.deepEqual(await collection.findAsync({}).sort(sort).skip(1).limit(1), await portable.findAsync({}).sort(sort).skip(1).limit(1))
  }
})

test('indexed ID queries retain every non-string scalar and match released NeDB semantics', async t => {
  const engine = memory(t)
  const portable = new Datastore()
  const values = [42, 1.5, true, false, null, '42', [42], ['42'], { kept: true }]
  const records = values.map((videoId, index) => ({ _id: String(index), videoId, videos: [{ videoId, playlistItemId: videoId }] }))
  records.push({ _id: 'missing', videos: [{}] })
  await engine.collections.playlists.insertAsync(records)
  await portable.insertAsync(records)
  for (const field of ['videoId', 'playlistItemId']) {
    for (const condition of [...values, { $in: [42, true, false] }, { $gt: 1 }, { $lte: 42 }, { $ne: 42 }, { $exists: false }]) {
      const queries = [{ videos: { $elemMatch: { [field]: condition } } }]
      if (field === 'videoId') queries.push({ videoId: condition })
      for (const query of queries) {
        const expected = await portable.findAsync(query).sort({ _id: 1 })
        assert.deepEqual(await engine.collections.playlists.findAsync(query).sort({ _id: 1 }), expected, JSON.stringify(query))
        assert.equal(await engine.collections.playlists.countAsync(query), expected.length, JSON.stringify(query))
      }
    }
  }
})

for (const watched of [false, true]) {
  test(`watched cleanup uses the newest tied occurrence when its watched state is ${watched}`, async t => {
    const engine = memory(t)
    // Exercise a valid query plan whose equal timestamps are ordered by ascending ID.
    engine.database.exec('DROP INDEX records_video_time; CREATE INDEX records_video_time ON records(collection, video_id, sort_time DESC, id ASC)')
    const videos = [{ videoId: 'same', playlistItemId: 'member', unknown: new Date(1) }]
    await engine.collections.playlists.insertAsync({ _id: 'p', protected: true, videos })
    await engine.collections.history.insertAsync([
      { _id: 'a', videoId: 'same', timeWatched: 1, isWatched: !watched, watchProgress: 0 },
      { _id: 'z', videoId: 'same', timeWatched: 1, isWatched: watched, watchProgress: 0 },
    ])
    assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), watched ? 1 : 0)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, watched ? [] : videos)
    assert.equal((await engine.playlistSnapshot({ id: 'p' })).protected, true)
  })
}


test('bulk replay preserves exact object and primitive members, duplicate identities and scalar indexes', async t => {
  const path = await directory(t)
  const objects = [
    { videoId: 'same', playlistItemId: 'same', exact: 1.2345678901234567, future: [null, false, new Date(123)], text: 'NUL \0 and emoji 😀' },
    { videoId: 'same', playlistItemId: 'same', exact: 1e-280, future: { date: new Date(456) } },
    { videoId: null, postId: 'post', playlistItemId: 42 },
    { videoId: 123, postId: 'ignored', playlistItemId: 'item' },
    [{ date: new Date(789), exact: 1.2345678901234567 }],
    new Date(0),
    { videoId: 'escaped', text: 'quote " slash \\ newline\n tab\t lone \uD800 \uDFFF $$date $$escaped', unknown: { date: new Date(123) } },
    JSON.parse('{"__proto__":{"keep":true},"constructor":"kept"}'),
  ]
  const primitives = [null, true, false, 1.2345678901234567, 1e-280, 'NUL \0 and emoji 😀', '', -42]
  const records = [{ _id: 'objects', videos: objects }, { _id: 'primitives', videos: primitives }]
  const original = records.map(model.serialize).join('\n')
  await writeFile(join(path, 'playlists.db'), original)
  const engine = await openLibrary(path)
  assert.deepEqual(await engine.collections.playlists.findAsync({}).sort({ _id: 1 }), records)
  const rows = engine.prepare("SELECT membership_id, item_id, video_id FROM members WHERE record_id = 'objects' ORDER BY position").all()
  assert.equal(new Set(rows.map(row => row.membership_id)).size, objects.length)
  assert.deepEqual(rows.map(row => [row.item_id, row.video_id]), [['same', 'same'], ['same', 'same'], [null, 'post'], ['item', null], [null, null], [null, null], [null, 'escaped'], [null, null]])
  const identities = rows.map(row => row.membership_id)
  engine.database.close()
  const reopened = await openLibrary(path)
  t.after(() => reopened.database.close())
  assert.deepEqual(await reopened.collections.playlists.findAsync({}).sort({ _id: 1 }), records)
  assert.deepEqual(reopened.prepare("SELECT membership_id FROM members WHERE record_id = 'objects' ORDER BY position").all().map(row => row.membership_id), identities)
  assert.equal(await readFile(join(path, 'playlists.db'), 'utf8'), original)
})

test('bulk replay falls back when only the complete legacy document exceeds SQLite JSON depth', async t => {
  const path = await directory(t)
  let nested = 'retained'
  for (let depth = 0; depth < 996; depth++) nested = { next: nested }
  const member = { videoId: 'deep', unknown: nested }
  const record = { _id: 'deep', videos: [member] }
  const original = model.serialize(record)
  const database = new DatabaseSync(':memory:')
  try {
    // Locate the boundary using this runtime's actual JSON parser limit.
    while (database.prepare('SELECT json_valid(?) AS valid').get(model.serialize(record)).valid) {
      member.unknown = { next: member.unknown }
    }
    assert.equal(database.prepare('SELECT json_valid(?) AS valid').get(model.serialize(member)).valid, 1)
  } finally { database.close() }
  const contents = model.serialize(record)
  await writeFile(join(path, 'playlists.db'), contents)
  const engine = await openLibrary(path)
  t.after(() => engine.database.close())
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'deep' }), record)
  assert.equal(await readFile(join(path, 'playlists.db'), 'utf8'), contents)
  assert.notEqual(original, contents)
})

test('bulk replay indexes the final occurrence of repeated JSON keys without modifying the source', async t => {
  const path = await directory(t)
  const contents = '{"_id":"repeated","videos":[{"videoId":"first","videoId":"last","unknown":{"value":1,"value":2}}]}'
  await writeFile(join(path, 'playlists.db'), contents)
  const engine = await openLibrary(path)
  t.after(() => engine.database.close())
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'repeated' }), model.deserialize(contents))
  assert.equal(engine.prepare("SELECT video_id FROM members WHERE record_id = 'repeated'").get().video_id, 'last')
  assert.equal(await readFile(join(path, 'playlists.db'), 'utf8'), contents)
})

for (const key of ['bad.field', '$unexpected']) {
  test(`migration rejects a nested invalid ${key} key before activation and remains lossless on retry`, async t => {
    const path = await directory(t)
    const first = { _id: 'first', videos: [{ videoId: 'first', unknown: ['雪😀', null] }] }
    const second = { _id: 'second', videos: [[{ [key]: 'invalid' }]] }
    const original = [first, second].map(record => JSON.stringify(record)).join('\n')
    await writeFile(join(path, 'playlists.db'), original)
    await assert.rejects(openLibrary(path), /Cannot migrate playlists\.db at line 2: Field names cannot/)
    assert.equal(await readFile(join(path, 'playlists.db'), 'utf8'), original)
    await assert.rejects(readFile(join(path, 'library.sqlite')), { code: 'ENOENT' })
    const records = [first, { _id: 'second', videos: [[{ unknown: 'retained' }]] }]
    const corrected = records.map(model.serialize).join('\n')
    await writeFile(join(path, 'playlists.db'), corrected)
    const engine = await openLibrary(path)
    t.after(() => engine.database.close())
    assert.deepEqual(await engine.collections.playlists.findAsync({}).sort({ _id: 1 }), records)
    assert.equal(await readFile(join(path, 'playlists.db'), 'utf8'), corrected)
  })
}

test('history sorting retains NeDB ordering for nonnumeric stored timestamps and cursor bounds', async t => {
  const engine = memory(t)
  const records = [{ _id: 'a', timeWatched: 'a', cachedAt: 200 }, { _id: 'z', timeWatched: 'z', cachedAt: 100 }, { _id: 'missing', cachedAt: 300 }, { _id: 'number', timeWatched: 20 }, { _id: 'date', timeWatched: new Date(10), cachedAt: 400 }]
  await engine.collections.history.insertAsync(records)
  for (const direction of [-1, 1]) {
    const expected = records.toSorted((a, b) => direction * model.compareThings(a.timeWatched, b.timeWatched))
    assert.deepEqual(await engine.collections.history.findAsync({}).sort({ timeWatched: direction }), expected)
    assert.deepEqual(await engine.collections.history.findAsync({}).sort({ timeWatched: direction }).skip(1).limit(1), expected.slice(1, 2))
  }
})

test('legacy history pages preserve NeDB timestamp ordering, filtering and complete records', async t => {
  const engine = memory(t)
  const portable = new Datastore({ inMemoryOnly: true })
  const values = [undefined, null, false, true, 2, 10, 'a', 'z', new Date(2), new Date(10), [2], { value: 10 }]
  const records = values.map((timeWatched, index) => ({ _id: String(index).padStart(2, '0'), videoId: String(index), timeWatched, cachedAt: 1000 - index, title: index % 3 ? 'matching needle' : 'other', unknown: { date: new Date(index), values: [1, 2] } }))
  records.push(...['\uE000', '😀'].map(_id => ({ _id, videoId: _id, timeWatched: 10, cachedAt: 20, title: 'matching needle', unknown: new Date(123) })))
  await engine.collections.history.insertAsync(records)
  await portable.insertAsync(records)
  const before = await engine.collections.history.findAsync({}).sort({ _id: 1 })
  for (const oldest of [false, true]) {
    for (const query of ['', 'matching needle']) {
      const direction = oldest ? 1 : -1
      const expected = filterVideosWithQuery(await portable.findAsync({}).sort({ timeWatched: direction, _id: direction }), query).map(record => migrateLegacyHistoryRecord(model.deserialize(model.serialize(record))))
      const actual = []
      let cursor = null
      do {
        const page = engine.historyPage({ oldest, query, cursor, limit: 2 })
        actual.push(...page.records)
        cursor = page.cursor
      } while (cursor)
      assert.deepEqual(actual, expected, JSON.stringify({ oldest, query }))
    }
  }
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), before)
})

test('legacy history pagination reuses its ordering and discards views after writes or rollback', async t => {
  const engine = memory(t)
  await engine.collections.history.insertAsync(Array.from({ length: 300 }, (_, index) => ({ _id: String(index).padStart(3, '0'), timeWatched: String(index).padStart(3, '0'), title: 'matching', unknown: new Date(index) })))
  const prepare = engine.prepare.bind(engine)
  let scans = 0, orderedScans = 0
  t.mock.method(engine, 'prepare', sql => {
    if (sql.startsWith("SELECT r.id, r.watchable_after, r.data -> '$.timeWatched' AS watched")) orderedScans++
    if (sql.startsWith("SELECT id, data FROM records WHERE collection = 'history'") && !sql.endsWith("AND id = ?")) scans++
    return prepare(sql)
  })
  const first = engine.historyPage({ limit: 2 })
  assert.deepEqual(first.records.map(record => record._id), ['299', '298'])
  assert.deepEqual([...engine.orderedHistoryRows({ limit: 2 })].map(row => row.id), ['299', '298'])
  assert.deepEqual(engine.historyPage({ limit: 2, cursor: first.cursor }).records.map(record => record._id), ['297', '296'])
  assert.deepEqual([...engine.orderedHistoryRows({ offset: 2, limit: 2 })].map(row => row.id), ['297', '296'])
  assert.equal(orderedScans, 1, 'Continue Watching must reuse its separate timestamp ordering')
  assert.equal(scans, 1, 'later pages must reuse the first ordering instead of rescanning all documents')
  first.records[0].unknown = 'caller edit'
  assert.deepEqual(engine.historyPage({ limit: 2 }).records[0].unknown, new Date(299))

  await engine.collections.history.updateAsync({ _id: '000' }, { $set: { timeWatched: '999' } })
  assert.equal(engine.historyPage({ cursor: first.cursor }).stale, true)
  assert.equal(engine.historyPage({ limit: 2 }).records[0]._id, '000')
  assert.equal(scans, 2)
  assert.deepEqual([...engine.orderedHistoryRows({ limit: 1 })].map(row => row.id), ['000'])
  assert.equal(orderedScans, 2)
  await assert.rejects(engine.transaction(async () => {
    await engine.collections.history.insertAsync({ _id: 'rolled-back', timeWatched: 'zzz' })
    assert.equal(engine.historyPage({ limit: 2 }).records[0]._id, 'rolled-back')
    assert.deepEqual([...engine.orderedHistoryRows({ limit: 1 })].map(row => row.id), ['rolled-back'])
    throw new Error('abort')
  }), /abort/)
  assert.equal(engine.historyPage({ limit: 2 }).records[0]._id, '000')
  assert.equal(scans, 4, 'rollback must discard an order built from uncommitted data')
  assert.deepEqual([...engine.orderedHistoryRows({ limit: 1 })].map(row => row.id), ['000'])
  assert.equal(orderedScans, 4, 'rollback must discard both timestamp orderings')
})

test('numeric history sorting uses an indexed legacy check and materializes only the requested window', async t => {
  const engine = memory(t)
  await engine.collections.history.insertAsync(Array.from({ length: 2000 }, (_, i) => ({ _id: `h${i}`, timeWatched: i })))
  const prepare = engine.prepare.bind(engine)
  let plan
  engine.prepare = sql => {
    if (sql.startsWith('SELECT 1 FROM records r')) plan = prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
    return prepare(sql)
  }
  const materialize = engine.materialize.bind(engine)
  let materialized = 0
  engine.materialize = (...args) => { materialized++; return materialize(...args) }
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ timeWatched: -1 }).limit(2), [{ _id: 'h1999', timeWatched: 1999 }, { _id: 'h1998', timeWatched: 1998 }])
  assert.equal(materialized, 2)
  assert.ok(plan.some(row => row.detail.includes('records_history_legacy_time') && row.detail.startsWith('SEARCH ')), JSON.stringify(plan))
})

test('duplicate cleanup retains distinct non-string and unidentified member IDs', async t => {
  const engine = memory(t)
  const videos = [{ videoId: 1 }, { videoId: 2 }, { videoId: { value: 1 } }, { videoId: { value: 2 } }, { unknown: 'keep first' }, { unknown: 'keep second' }, { videoId: 'same', unknown: 'first' }, { videoId: 'same', unknown: 'duplicate' }, { videoId: 1, unknown: 'numeric duplicate' }]
  await engine.collections.playlists.insertAsync({ _id: 'mixed', videos })
  const identities = () => engine.prepare("SELECT membership_id FROM members WHERE record_id = 'mixed' ORDER BY position").all().map(row => row.membership_id)
  const before = identities()
  assert.equal(await engine.cleanupPlaylist({ id: 'mixed', mode: 'duplicates' }), 2)
  const after = await engine.playlistSnapshot({ id: 'mixed' })
  assert.deepEqual(after.videos, videos.slice(0, -2))
  assert.deepEqual(identities(), before.slice(0, -2))
})

test('automatic SQLite rollback preserves the original failure and rebuilds transient playlist views', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', videos: [{ videoId: 'a' }, { videoId: 'b' }] })
  engine.database.exec("CREATE TEMP TRIGGER abort_review BEFORE INSERT ON records WHEN NEW.id = 'abort' BEGIN SELECT RAISE(ROLLBACK, 'simulated automatic rollback'); END")
  let failure
  await assert.rejects(engine.transaction(async () => {
    assert.equal((await engine.playlistWindow({ id: 'p' })).total, 2)
    try { await engine.collections.history.insertAsync({ _id: 'abort', videoId: 'failed' }) }
    catch (error) { failure = error; throw error }
  }), error => error === failure)
  assert.equal(engine.playlistOrders.size, 0)
  assert.equal((await engine.playlistWindow({ id: 'p' })).total, 2)
  assert.equal(engine.collections.history.count(), 0)
})

test('failed rollback blocks subsequent reads and writes instead of exposing uncommitted records', async t => {
  const engine = memory(t)
  const exec = engine.database.exec.bind(engine.database)
  const rollbackFailure = new Error('rollback I/O failure')
  const original = new Error('original operation failed')
  t.mock.method(engine.database, 'exec', sql => { if (sql === 'ROLLBACK') throw rollbackFailure; return exec(sql) })
  await assert.rejects(engine.transaction(async () => {
    await engine.collections.history.insertAsync({ _id: 'dirty', videoId: 'dirty' })
    throw original
  }), error => error === original)
  await assert.rejects(Promise.resolve(engine.collections.history.findAsync({})), error => error === original)
  await assert.rejects(engine.collections.history.insertAsync({ _id: 'later', videoId: 'later' }), error => error === original)
  exec('ROLLBACK')
})

test('failed rollback view cleanup preserves the original error and blocks later requests', async t => {
  const engine = memory(t)
  const original = new Error('original operation failed')
  const exec = engine.database.exec.bind(engine.database)
  t.mock.method(engine.database, 'exec', sql => {
    if (sql === 'DELETE FROM playlist_orders') throw new Error('view cleanup failed')
    return exec(sql)
  })
  await assert.rejects(engine.transaction(() => { throw original }), error => error === original)
  await assert.rejects(Promise.resolve(engine.collections.history.findAsync({})), error => error === original)
  await assert.rejects(engine.collections.history.insertAsync({ _id: 'later' }), error => error === original)
  assert.equal(engine.database.isTransaction, false)
})

test('$pull closes the member read cursor before deletion and preserves every unrelated entry', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 300 }, (_, i) => ({ videoId: String(i), group: i % 2 ? 'remove' : 'keep', unknown: new Date(i) }))
  await engine.collections.playlists.insertAsync({ _id: 'p', videos })
  const prepare = engine.prepare.bind(engine)
  let reading = false
  let observed = false
  engine.prepare = sql => {
    const statement = prepare(sql)
    if (sql === 'SELECT position, data FROM members WHERE collection = ? AND record_id = ? AND field = ?') return {
      *iterate(...args) { observed = true; reading = true; try { yield * statement.iterate(...args) } finally { reading = false } }
    }
    if (sql === 'DELETE FROM members WHERE collection = ? AND record_id = ? AND field = ? AND position = ?') return {
      run(...args) { assert.equal(reading, false, 'member mutation must not overlap its read cursor'); return statement.run(...args) }
    }
    return statement
  }
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $pull: { videos: { group: 'remove' } } })
  assert.equal(observed, true)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, videos.filter(video => video.group === 'keep'))
})


test('cross-type scalar predicates retain NeDB candidates for reads and mutations', async t => {
  const values = [0, 1, 2, false, true, null, '0', '1', 'true', new Date(1), [true], { nested: true }, undefined]
  const conditions = [{ $in: [null] }, { $in: [null, 1] }, { $nin: [null] }, { $ne: true }, { $ne: false }, { $ne: 1 }, { $nin: [true] }, { $nin: [1] }, { $nin: [false, 1, 'true'] }, { $in: [true, 1] }, ...['$lt', '$lte', '$gt', '$gte'].flatMap(operator => [false, true, 1, new Date(1)].map(value => ({ [operator]: value })))]
  for (const field of ['value', 'videoId', 'videos']) {
    for (const condition of conditions) {
      await t.test(`${field}: ${JSON.stringify(condition)}`, async t => {
        const collection = memory(t).collections.playlists
        const portable = new Datastore()
        const records = values.map((value, index) => ({ _id: String(index).padStart(2, '0'), ...(value === undefined ? {} : { value, videoId: value }), videos: [{ ...(value === undefined ? {} : { value, videoId: value }), unknown: new Date(index) }], retained: new Date(123) }))
        const query = field === 'videos' ? { videos: { $elemMatch: { value: condition } } } : { [field]: condition }
        await collection.insertAsync(records)
        await portable.insertAsync(records)
        assert.deepEqual(await collection.findAsync(query).sort({ _id: 1 }), await portable.findAsync(query).sort({ _id: 1 }))
        assert.equal(await collection.countAsync(query), await portable.countAsync(query))
        assert.deepEqual(await collection.findAsync(query).sort({ _id: 1 }).skip(1).limit(2), await portable.findAsync(query).sort({ _id: 1 }).skip(1).limit(2))
        const update = { $set: { changed: true } }
        assert.equal((await collection.updateAsync(query, update, { multi: true })).numAffected, (await portable.updateAsync(query, update, { multi: true })).numAffected)
        assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
        assert.equal(await collection.removeAsync(query, { multi: true }), await portable.removeAsync(query, { multi: true }))
        assert.deepEqual(await collection.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
      })
    }
  }
})

test('literal pulls preserve every unrelated primitive and object member with NeDB semantics', async t => {
  const videos = [false, true, 0, 1, null, 'literal', '', new Date(1), [false], { unknown: new Date(2) }, false]
  for (const predicate of [false, true, 0, 1, null, 'literal', '', new Date(1), /literal/, [false], {}, Object.create(null)]) {
    await t.test(JSON.stringify(predicate), async t => {
      const collection = memory(t).collections.playlists
      const portable = new Datastore()
      const playlist = { _id: 'p', videos, unknown: { date: new Date(123) } }
      await collection.insertAsync(playlist)
      await portable.insertAsync(playlist)
      const update = { $pull: { videos: predicate } }
      await collection.updateAsync({ _id: 'p' }, update)
      await portable.updateAsync({ _id: 'p' }, update)
      assert.deepEqual(await collection.findOneAsync({ _id: 'p' }), await portable.findOneAsync({ _id: 'p' }))
    })
  }
})

test('watched cleanup matches typed legacy identities using only their newest history', async t => {
  const engine = memory(t)
  const portable = new Datastore()
  const identities = [42, false, true, 0, null, undefined, '42', 'false', [42], { kept: true }, new Date(42)]
  const videos = identities.flatMap((videoId, index) => [{ ...(videoId === undefined ? {} : { videoId }), playlistItemId: String(index), unknown: new Date(index) }, { ...(videoId === undefined ? {} : { videoId }), playlistItemId: `duplicate-${index}`, unknown: new Date(index) }])
  const history = identities.slice(0, 8).flatMap((videoId, index) => [
    { _id: `old-${index}`, ...(videoId === undefined ? {} : { videoId }), timeWatched: 1, isWatched: index % 2 !== 0, unknown: new Date(index) },
    { _id: `new-${index}`, ...(videoId === undefined ? {} : { videoId }), timeWatched: 2, isWatched: index % 2 === 0, unknown: new Date(index) },
  ])
  await portable.insertAsync(history)
  const byId = new Map()
  for (const row of await portable.findAsync({}).sort({ timeWatched: -1, _id: -1 })) if (!byId.has(row.videoId)) byId.set(row.videoId, row)
  const expected = videos.filter(video => byId.get(video.videoId)?.isWatched !== true)
  await engine.collections.playlists.insertAsync({ _id: 'p', videos, unknown: new Date(123) })
  await engine.collections.history.insertAsync(history)
  assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), videos.length - expected.length)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), { _id: 'p', videos: expected, unknown: new Date(123), lastUpdatedAt: (await engine.playlistSnapshot({ id: 'p' })).lastUpdatedAt })
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
})


test('legacy watched cleanup clears only removed typed identities and preserves ambiguous context', async t => {
  const engine = memory(t)
  const identities = [42, false, '42', 'false', null, undefined]
  const videos = identities.map((videoId, index) => ({ ...(videoId === undefined ? {} : { videoId }), playlistItemId: String(index), unknown: new Date(index) }))
  const histories = identities.flatMap((videoId, index) => [0, 1].map(older => ({ _id: `${index}-${older}`, ...(videoId === undefined ? {} : { videoId }), timeWatched: 2 - older, isWatched: typeof videoId !== 'string', lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: String(index), unknown: { date: new Date(index) } })))
  await engine.collections.playlists.insertAsync({ _id: 'p', videos })
  await engine.collections.history.insertAsync(histories)
  assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), 4)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, videos.filter(video => typeof video.videoId === 'string'))
  for (const history of histories) {
    const expected = { ...history }
    if (typeof history.videoId === 'number' || typeof history.videoId === 'boolean') {
      delete expected.lastViewedPlaylistId
      delete expected.lastViewedPlaylistType
      delete expected.lastViewedPlaylistItemId
    }
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: history._id }), expected)
  }
})


test('Continue Watching exposes every eligible occurrence through bounded indexed pages', async t => {
  const engine = memory(t)
  const records = Array.from({ length: 123 }, (_, index) => ({ _id: `h-${String(index).padStart(3, '0')}`, videoId: `v-${index}`, timeWatched: index + 1, watchProgress: 10, lengthSeconds: 100, isWatched: false, unknown: new Date(index) }))
  await engine.collections.history.insertAsync([...records, { _id: 'complete', videoId: 'complete', timeWatched: 999, watchProgress: 100, lengthSeconds: 100, isWatched: true }])
  const summary = engine.historySummary()
  assert.equal(summary.continuedTotal, records.length)
  assert.equal(summary.continued.length, 50)
  const collected = [...summary.continued]
  while (collected.length < summary.continuedTotal) {
    const page = engine.continuedHistoryPage({ offset: collected.length, limit: 17, revision: summary.revision })
    assert.equal(page.stale, false)
    assert.ok(page.records.length <= 17)
    collected.push(...page.records)
  }
  assert.deepEqual(collected, records.toReversed())
  await engine.collections.history.updateAsync({ _id: 'h-000' }, { $set: { isWatched: true } })
  assert.equal(engine.continuedHistoryPage({ offset: 50, revision: summary.revision }).stale, true)
  assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'h-001' }), records[1])
})


test('legacy watched lookup retains NeDB timestamp types and Unicode ID ties', async t => {
  const cases = [
    [{ _id: '\uE000', timeWatched: 2, isWatched: false }, { _id: '😀', timeWatched: 2, isWatched: true }],
    [{ _id: 'a', timeWatched: new Date(2), isWatched: false }, { _id: 'z', timeWatched: 1, isWatched: true }],
    [{ _id: 'a', timeWatched: '2026-01-01', isWatched: false }, { _id: 'z', timeWatched: 1000, isWatched: true }],
    [{ _id: 'a', timeWatched: 1, isWatched: false }, { _id: 'z', cachedAt: 999, isWatched: true }],
  ]
  for (const [index, input] of cases.entries()) {
    await t.test(String(index), async t => {
      const engine = memory(t)
      const portable = new Datastore()
      const histories = input.map(record => ({ ...record, videoId: 42, lengthSeconds: 100, watchProgress: record.isWatched ? 100 : 10, unknown: new Date(123) }))
      const playlist = { _id: 'p', videos: [{ videoId: 42, unknown: new Date(456) }] }
      await engine.collections.history.insertAsync(histories)
      await portable.insertAsync(histories)
      await engine.collections.playlists.insertAsync(playlist)
      const newest = (await portable.findAsync({}).sort({ timeWatched: -1, _id: -1 }))[0]
      assert.equal(newest.isWatched, false)
      assert.equal(engine.playlistStatistics({ id: 'p' }).watchedCount, 0)
      assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), 0)
      assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
      assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await portable.findAsync({}).sort({ _id: 1 }))
    })
  }
})

for (const collection of ['playlists', 'subscriptionCache']) {
  for (const value of [null, false, 42, 'retained', { unknown: new Date(2) }]) {
    for (const operator of ['$push', '$pull']) {
      test(`normalized ${collection} ${operator} rejects retained non-array ${model.serialize(value)} atomically`, async t => {
        const engine = memory(t)
        const legacy = new Datastore({ inMemoryOnly: true })
        const record = { _id: 'p', videos: value, unknown: new Date(1) }
        await engine.collections[collection].insertAsync(record)
        await legacy.insertAsync(record)
        const update = { $set: { unknown: 'must roll back' }, [operator]: { videos: { videoId: 'appended' } } }
        await assert.rejects(legacy.updateAsync({ _id: 'p' }, update), /non-array/)
        await assert.rejects(engine.collections[collection].updateAsync({ _id: 'p' }, update), /non-array/)
        assert.deepEqual(await engine.collections[collection].findOneAsync({ _id: 'p' }), await legacy.findOneAsync({ _id: 'p' }))
        assert.equal(engine.prepare('SELECT count(*) AS count FROM members').get().count, 0)
      })
    }
  }
}

for (const batch of [false, true]) {
  test(`removing a null playlist member preserves unidentified history context in a ${batch ? 'batch' : 'single'} deletion`, async t => {
    const engine = memory(t)
    const retained = { videoId: 'retained', unknown: new Date(3) }
    const playlist = { _id: 'p', videos: [null, { videoId: 'removed' }, retained], unknown: new Date(2) }
    const histories = [
      { _id: 'ambiguous', videoId: 'ambiguous', lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', unknown: new Date(4) },
      { _id: 'known', videoId: 'removed', lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', unknown: new Date(5) },
    ]
    await engine.collections.playlists.insertAsync(playlist)
    await engine.collections.history.insertAsync(histories)
    const page = engine.playlistPage({ id: 'p' })
    const count = await engine.transaction(() => removePlaylistMembers(engine, { id: 'p', memberIds: page.records.slice(0, batch ? 2 : 1).map(record => record._libraryMemberId) }))
    assert.equal(count, batch ? 2 : 1)
    const saved = await engine.playlistSnapshot({ id: 'p' })
    assert.deepEqual(saved.videos, batch ? [retained] : playlist.videos.slice(1))
    assert.deepEqual(saved.unknown, playlist.unknown)
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'ambiguous' }), histories[0])
    const { lastViewedPlaylistId, lastViewedPlaylistType, ...cleared } = histories[1]
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'known' }), batch ? cleared : histories[1])
  })
}

for (const update of [
  { $push: { videos: { videoId: 'new' } }, $set: { videos: [] } },
  { $set: { videos: [] }, $push: { videos: { videoId: 'new' } } },
  { $push: { videos: { videoId: 'new' } }, $unset: { videos: true } },
  { $unset: { videos: true }, $push: { videos: { videoId: 'new' } } },
  { $push: { videos: { videoId: 'old' } }, $pull: { videos: { videoId: 'old' } } },
  { $pull: { videos: { videoId: 'old' } }, $push: { videos: { videoId: 'old' } } },
]) {
  test(`normalized array modifiers retain NeDB order ${Object.keys(update).join(',')}`, async t => {
    const engine = memory(t)
    const nedb = new Datastore({ inMemoryOnly: true })
    const original = { _id: 'playlist', videos: [{ videoId: 'old' }], unknown: { kept: new Date(1) } }
    await nedb.insertAsync(original)
    await engine.collections.playlists.insertAsync(original)
    await nedb.updateAsync({ _id: original._id }, structuredClone(update))
    await engine.collections.playlists.updateAsync({ _id: original._id }, structuredClone(update))
    assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: original._id }), await nedb.findOneAsync({ _id: original._id }))
  })
}

test('staging replay parses large nonempty arrays once and skips empty-array source scans', t => {
  const engine = memory(t)
  const record = { _id: 'channel', videos: Array.from({ length: 1000 }, (_, index) => ({ videoId: String(index), title: '雪😀'.repeat(40) })), shorts: [], videosTimestamp: new Date(1), shortsTimestamp: new Date(2) }
  const prepare = engine.prepare.bind(engine)
  let parsed = 0
  engine.prepare = sql => {
    const statement = prepare(sql)
    if (!sql.includes('FROM jsonb_each(?, ?)')) return statement
    return { run(...args) { parsed += Buffer.byteLength(args.at(-2)); return statement.run(...args) } }
  }
  const serialized = model.serialize(record)
  engine.writeSerialized('subscriptionCache', serialized, true, true)
  assert.equal(parsed, Buffer.byteLength(serialized))
  const row = prepare('SELECT id, data FROM records WHERE id = ?').get(record._id)
  assert.deepEqual(engine.materialize('subscriptionCache', row), record)
  engine.writeSerialized('subscriptionCache', model.serialize({ ...record, videos: [] }), true, true)
  assert.equal(parsed, Buffer.byteLength(serialized))
  assert.equal(prepare('SELECT count(*) AS n FROM members').get().n, 0)
})

test('changed migration sources discard only their old index declarations', async t => {
  const path = await directory(t)
  const settings = { _id: 'theme', value: 'dark', unknown: new Date(1) }
  const index = model.serialize({ $$indexCreated: { fieldName: 'videoId', unique: false } })
  const settingsIndex = model.serialize({ $$indexCreated: { fieldName: 'value', unique: false } })
  const oldSource = [index, model.serialize({ _id: 'old', videoId: 'old' }), model.serialize({ $$indexRemoved: 'videoId' })].join('\n') + '\n'
  const settingsSource = [settingsIndex, model.serialize(settings)].join('\n') + '\n'
  await writeFile(join(path, 'settings.db'), settingsSource)
  await writeFile(join(path, 'history.db'), oldSource)
  await assert.rejects(openLibrary(path, { batchSize: 1, onCheckpoint: ({ collection, lines }) => {
    if (collection === 'history' && lines === 3) throw new Error('interrupted before activation')
  } }), /interrupted before activation/)
  const record = { _id: 'new', videoId: 'new', unknown: { keep: true } }
  const changedSource = [model.serialize(record), index].join('\n') + '\n'
  await writeFile(join(path, 'history.db'), changedSource)
  const engine = await openLibrary(path)
  try {
    assert.deepEqual(engine.prepare("SELECT key, value FROM metadata WHERE key GLOB 'legacyIndex:*' ORDER BY key").all().map(row => ({ ...row })), [
      { key: 'legacyIndex:history:2', value: index }, { key: 'legacyIndex:settings:1', value: settingsIndex }
    ])
    assert.deepEqual(await engine.collections.history.findAsync({}), [record])
    assert.deepEqual(await engine.collections.settings.findAsync({}), [settings])
    assert.equal(await readFile(join(path, 'history.db'), 'utf8'), changedSource)
    assert.equal(await readFile(join(path, 'settings.db'), 'utf8'), settingsSource)
  } finally { engine.database.close() }
})

for (const invalid of [
  { ids: null }, { ids: 'p' }, { ids: ['p', 42] }, { ids: ['p', null] },
  { videos: null }, { videos: {} }, { videos: 'video' },
  ...[null, false, {}, { videoId: 42 }, { videoId: null }].map(video => ({ videos: [{ videoId: 'new' }, video] })),
]) {
  test(`adding selected playlist videos rejects the complete invalid batch before writes: ${JSON.stringify(invalid)}`, async t => {
    const engine = memory(t)
    const playlists = ['p', 'q'].map(_id => ({ _id, playlistName: _id, lastUpdatedAt: 1, videos: [{ videoId: 'keep' }], unknown: new Date(2) }))
    await engine.collections.playlists.insertAsync(playlists)
    const revision = engine.revision('playlists')
    await assert.rejects(addSelectedPlaylistVideos(engine, { ids: ['p', 'q'], videos: [{ videoId: 'new' }], ...invalid }), TypeError)
    assert.deepEqual(await engine.collections.playlists.findAsync({}).sort({ _id: 1 }), playlists)
    assert.equal(engine.revision('playlists'), revision)
  })
}

for (const surrogate of ['\ud800', '\udc00']) {
  for (const kind of ['item', 'video', 'both']) {
    for (const reverse of [false, true]) {
      test(`legacy playlist anchors preserve surrogate identity for ${kind}/${surrogate.charCodeAt(0).toString(16)}/reverse=${reverse}`, async t => {
        const engine = memory(t)
        const videoId = kind === 'item' ? 'video' : surrogate
        const playlistItemId = kind === 'video' ? undefined : surrogate
        const members = [
          { videoId: kind === 'item' ? 'video' : '\uFFFD', ...(kind === 'video' ? {} : { playlistItemId: '\uFFFD' }), unknown: new Date(1) },
          { videoId, ...(playlistItemId === undefined ? {} : { playlistItemId }), unknown: new Date(2) },
          { videoId: 'after', playlistItemId: 'after', unknown: new Date(3) },
        ]
        const playlist = { _id: 'p', playlistName: 'Retained', videos: members, unknown: new Date(4) }
        await engine.collections.playlists.insertAsync(playlist)
        const window = engine.playlistWindow({ id: 'p', reverse, anchor: { videoId, ...(playlistItemId === undefined ? {} : { itemId: playlistItemId }) } })
        assert.equal(window.index, 1)
        assert.equal(window.previous.videoId, members[reverse ? 2 : 0].videoId)
        assert.equal(window.next.videoId, members[reverse ? 0 : 2].videoId)
        assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
      })
    }
  }
}

for (const surrogate of ['\ud800', '\udc00']) {
  for (const kind of ['item', 'video', 'both', 'numeric-video']) {
    test(`removing a duplicate retains surviving surrogate history context for ${kind}/${surrogate.charCodeAt(0).toString(16)}`, async t => {
      const engine = memory(t)
      const videoId = kind === 'item' ? 'video' : kind === 'numeric-video' ? 42 : surrogate
      const itemId = kind === 'video' ? 'kept' : surrogate
      const history = { _id: 'history', videoId, watchProgress: 97, isWatched: true, lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: itemId, unknown: new Date(1) }
      const kept = { videoId, playlistItemId: itemId, unknown: new Date(2) }
      await engine.collections.history.insertAsync(history)
      await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Retained', videos: [kept, { videoId, playlistItemId: 'remove' }], unknown: new Date(3) })
      const removed = engine.playlistPage({ id: 'p' }).records.find(member => member.playlistItemId === 'remove')
      await removePlaylistMembers(engine, { id: 'p', memberIds: [removed._libraryMemberId] })
      assert.deepEqual(await engine.collections.history.findOneAsync({ _id: history._id }), history)
      assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, [kept])
      const remaining = engine.playlistPage({ id: 'p' }).records[0]
      await removePlaylistMembers(engine, { id: 'p', memberIds: [remaining._libraryMemberId] })
      const withoutContext = { ...history }
      for (const field of ['lastViewedPlaylistId', 'lastViewedPlaylistType', 'lastViewedPlaylistItemId']) delete withoutContext[field]
      assert.deepEqual(await engine.collections.history.findOneAsync({ _id: history._id }), withoutContext)
      assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, [])
      if (typeof videoId === 'string') assert.equal(engine.prepare("SELECT id FROM records WHERE collection = 'history' AND video_id = json_extract(?, '$')").get(JSON.stringify(videoId))?.id, history._id)
    })
  }
}

for (const videoId of ['\ud800', '\udc00', '\uFFFD']) {
  test(`scalar history updates retain the indexed video identity ${videoId.charCodeAt(0).toString(16)}`, async t => {
    const engine = memory(t)
    const record = { _id: 'target', videoId: 'before', watchProgress: 12, unknown: new Date(1) }
    const replacement = { _id: 'replacement', videoId: '\uFFFD', unknown: new Date(2) }
    await engine.collections.history.insertAsync([record, replacement])
    await engine.collections.history.updateAsync({ _id: record._id }, { $set: { videoId, watchProgress: 97 } })
    const rows = engine.prepare("SELECT id FROM records WHERE collection = 'history' AND video_id = json_extract(?, '$') ORDER BY id").all(JSON.stringify(videoId))
    assert.deepEqual(rows.map(row => row.id), videoId === '\uFFFD' ? ['replacement', 'target'] : ['target'])
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), { ...record, videoId, watchProgress: 97 })
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: replacement._id }), replacement)
    await engine.collections.history.updateAsync({ _id: record._id }, { $unset: { videoId: true } })
    assert.equal(engine.prepare("SELECT video_id FROM records WHERE collection = 'history' AND id = 'target'").get().video_id, null)
  })
}


test('playable desktop windows skip opaque neighbors and retain complete memberships', async t => {
  const engine = memory(t)
  const videos = [{ videoId: 'A', unknown: new Date(1) }, null, false, 42, { postId: 'post' }, { videoId: '' }, { videoId: 42 }, { videoId: 'B', unknown: new Date(2) }]
  const playlist = { _id: 'p', videos, unknown: new Date(3) }
  await engine.collections.playlists.insertAsync(playlist)
  for (const reverse of [false, true]) {
    const result = engine.playlistWindow({ id: 'p', anchor: { videoId: 'A' }, playableOnly: true, reverse, limit: 1 })
    assert.equal(result.total, 2)
    assert.equal(result.next.videoId, 'B')
    assert.equal(result.previous.videoId, 'B')
    assert.equal(result.records.length, 1)
  }
  assert.equal(engine.playlistWindow({ id: 'p' }).total, videos.length)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
})


test('nullable profile imports retain distinct identities and repeat imports do not create copies', async t => {
  const engine = memory(t)
  await engine.collections.profiles.insertAsync({ _id: 'allChannels', name: null, subscriptions: [] })
  const profiles = ['first', 'second'].map((_id, index) => ({ _id, name: null, unknown: new Date(index), subscriptions: [{ id: _id }] }))
  for (let repeat = 0; repeat < 2; repeat++) {
    await importSubscriptionProfiles(engine, { profiles })
    assert.deepEqual(await engine.collections.profiles.findAsync({ _id: { $ne: 'allChannels' } }).sort({ _id: 1 }), profiles)
    assert.equal(await engine.collections.profiles.countAsync({}), 3)
  }
})


for (const timeWatched of [2, new Date(2)]) {
  test(`indexed history readers retain unpaired legacy video identities with timestamp ${model.serialize(timeWatched)}`, async t => {
    const engine = memory(t), videoId = '\ud800'
    const record = { _id: 'history', videoId, timeWatched, isWatched: true, lengthSeconds: 120, unknown: new Date(1) }
    const good = { videoId: 'good', lengthSeconds: 1 }
    const playlist = { _id: 'p', videos: [null, { videoId, unknown: new Date(2) }, good], unknown: new Date(3) }
    await engine.collections.history.insertAsync(record)
    await engine.collections.playlists.insertAsync(playlist)
    assert.deepEqual((await engine.videoState({ ids: [videoId] })).history, [record])
    const stats = await engine.playlistStatistics({ id: 'p' })
    assert.equal(stats.watchedCount, 1)
    assert.equal(stats.duration, 121)
    const page = await engine.playlistPage({ id: 'p', sort: 'video_duration_ascending' })
    assert.equal(page.records.find(video => video.videoId === videoId).lengthSeconds, 120)
    assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), 1)
    const saved = await engine.playlistSnapshot({ id: 'p' })
    assert.deepEqual(saved, { ...playlist, videos: [null, good], lastUpdatedAt: saved.lastUpdatedAt })
    assert.deepEqual(await engine.collections.history.findAsync({}), [record])
  })
}


for (const videoId of [undefined, null]) {
  test(`post-only retained members keep statistics and cleanup readable with videoId ${videoId}`, async t => {
    const engine = memory(t)
    const playlist = { _id: 'p', videos: [{ ...(videoId === undefined ? {} : { videoId }), postId: 'post', unknown: new Date(1) }], unknown: new Date(2) }
    await engine.collections.playlists.insertAsync(playlist)
    assert.equal((await engine.playlistStatistics({ id: 'p' })).total, 1)
    assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'watched' }), 0)
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), playlist)
  })
}

for (const videoId of ['\ud800', '\udc00']) {
  test(`video-state memberships retain requested legacy identity ${videoId.charCodeAt(0).toString(16)}`, async t => {
    const engine = memory(t)
    await engine.collections.playlists.insertAsync({ _id: 'p', videos: [{ videoId }, { videoId }, { videoId: '\uFFFD' }] })
    assert.deepEqual((await engine.videoState({ ids: [videoId, videoId, '\uFFFD'] })).memberships, [
      { videoId, playlistId: 'p', count: 2 }, { videoId: '\uFFFD', playlistId: 'p', count: 1 },
    ])
  })
}


for (const mode of ['watched', 'duplicates']) {
  test(`playlist ${mode} cleanup preserves original surrogate history context decisions`, async t => {
    const engine = memory(t), videoId = '\ud800'
    const kept = { videoId, playlistItemId: 'keep' }
    const removed = { videoId, playlistItemId: 'remove' }
    const history = { _id: 'h', videoId, timeWatched: 1, isWatched: true, lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'remove', unknown: new Date(1) }
    await engine.collections.history.insertAsync(history)
    await engine.collections.playlists.insertAsync({ _id: 'p', videos: [kept, removed] })
    assert.equal(await engine.cleanupPlaylist({ id: 'p', mode }), mode === 'watched' ? 2 : 1)
    const expected = { ...history }
    for (const field of ['lastViewedPlaylistId', 'lastViewedPlaylistType', 'lastViewedPlaylistItemId']) delete expected[field]
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'h' }), expected)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, mode === 'watched' ? [] : [kept])
  })
}


for (const direction of [-1, 1]) {
  test(`Watch moves the adjacent playable member across hidden retained slots: ${direction}`, async t => {
    const engine = memory(t)
    const a = { videoId: 'A', unknown: new Date(1) }, b = { videoId: 'B', unknown: new Date(2) }
    const opaque = [null, false, { postId: 'post' }, { videoId: 42 }, { videoId: '' }]
    const videos = [a, ...opaque, b]
    await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Retained', videos })
    const page = engine.playlistWindow({ id: 'p', playableOnly: true })
    const item = page.records.find(row => row.videoId === (direction === 1 ? 'A' : 'B'))
    assert.equal(await engine.movePlaylistMember({ id: 'p', memberId: item._libraryMemberId, direction, revision: page.revision, playableOnly: true }), true)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, [b, ...opaque, a])
  })
}


for (const failure of ['metadata', 'history']) {
  test(`worker transaction rolls back single-member removal when ${failure} fails`, async t => {
    const engine = memory(t)
    const playlist = { _id: 'atomic', lastUpdatedAt: 1, videos: [{ videoId: 'video', playlistItemId: 'member', unknown: new Date(1) }] }
    const history = { _id: 'h', videoId: 'video', timeWatched: 2, lastViewedPlaylistId: 'atomic', lastViewedPlaylistType: 'user', unknown: new Date(2) }
    await engine.collections.playlists.insertAsync(playlist)
    await engine.collections.history.insertAsync(history)
    const memberId = engine.playlistPage({ id: 'atomic' }).records[0]._libraryMemberId
    const revision = engine.revision('playlists')
    if (failure === 'metadata') t.mock.method(engine.collections.playlists, 'updateAsync', async () => { throw new Error('injected write failure') })
    else t.mock.method(engine, 'clearRemovedPlaylistContext', () => { throw new Error('injected write failure') })
    // libraryWorker dispatches every operation through this transaction boundary.
    await assert.rejects(engine.transaction(() => removePlaylistMember(engine, { id: 'atomic', memberId })), /injected write failure/)
    assert.deepEqual(await engine.playlistSnapshot({ id: 'atomic' }), playlist)
    assert.deepEqual(await engine.collections.history.findAsync({}), [history])
    assert.equal(engine.playlistPage({ id: 'atomic' }).records[0]._libraryMemberId, memberId)
    assert.equal(engine.revision('playlists'), revision)
  })
}


test('worker transaction rolls back selected playlist additions when a later target is missing', async t => {
  const engine = memory(t)
  const original = { _id: 'retained', lastUpdatedAt: 1, videos: [{ videoId: 'keep', unknown: new Date(1) }], unknown: new Date(2) }
  await engine.collections.playlists.insertAsync(original)
  const revision = engine.revision('playlists')
  await assert.rejects(engine.transaction(() => addSelectedPlaylistVideos(engine, { ids: [original._id, 'missing'], videos: [{ videoId: 'new' }] })), /playlist no longer exists/)
  assert.deepEqual(await engine.playlistSnapshot({ id: original._id }), original)
  assert.equal(engine.revision('playlists'), revision)
})


test('selected additions preserve repeated incoming occurrences and exclude already stored video IDs', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'batch', videos: [], unknown: new Date(1) })
  const videos = [{ videoId: 'same', title: 'First', unknown: new Date(2) }, { videoId: 'same', title: 'Second', unknown: new Date(3) }]
  assert.deepEqual(await engine.transaction(() => addSelectedPlaylistVideos(engine, { ids: ['batch'], videos, allowDuplicates: false })), { changedIds: ['batch'] })
  const first = await engine.playlistSnapshot({ id: 'batch' })
  assert.deepEqual(first.videos.map(({ playlistItemId, timeAdded, ...record }) => record), videos.map(video => ({ ...video, type: 'video' })))
  assert.equal(new Set(first.videos.map(video => video.playlistItemId)).size, 2)
  const revision = engine.revision('playlists')
  assert.deepEqual(await engine.transaction(() => addSelectedPlaylistVideos(engine, { ids: ['batch'], videos, allowDuplicates: false })), { changedIds: [] })
  assert.equal(engine.revision('playlists'), revision)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'batch' }), first)
})


test('SQLite duplicate statistics count exactly the members cleanup removes', async t => {
  const database = new DatabaseSync(':memory:')
  t.after(() => database.close())
  database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
  const engine = new LibraryEngine(database)
  const videos = [null, false, {}, { videoId: null }, { videoId: null }, { videoId: { retained: true } }, { videoId: { retained: true } }, { videoId: 'same' }, { videoId: 'same' }, { videoId: 42 }, { videoId: 42 }]
  const original = { _id: 'p', videos, unknown: new Date(123) }
  await engine.collections.playlists.insertAsync(original)
  const stats = engine.playlistStatistics({ id: 'p' })
  assert.equal(stats.total - stats.uniqueCount, 2)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), original)
  assert.equal(await engine.cleanupPlaylist({ id: 'p', mode: 'duplicates' }), 2)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, videos.filter((_, index) => index !== 8 && index !== 10))
  const cleaned = engine.playlistStatistics({ id: 'p' })
  assert.equal(cleaned.uniqueCount, cleaned.total)
})

test('playlist download IDs preserve member order without hydrating metadata or opaque entries', async t => {
  const engine = memory(t)
  const videos = [null, false, {}, { videoId: '' }, { videoId: 42 }, { videoId: '\ud800', unknown: new Date(1) }, ...Array.from({ length: 20000 }, (_, i) => ({ videoId: `id-${i}`, title: 'Retained', unknown: new Date(i) })), { videoId: 'id-0' }]
  await engine.collections.playlists.insertAsync({ _id: 'p', videos })
  t.mock.method(engine, 'materialize', () => { throw new Error('must not hydrate records') })
  assert.deepEqual(playlistVideoIds(engine, { id: 'p' }), videos.filter(video => typeof video?.videoId === 'string' && video.videoId).map(video => video.videoId))
  assert.throws(() => playlistVideoIds(engine, { id: 'missing' }), /no longer exists/)
})

test('Takeout target lookup returns matching headers without reading member arrays', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 20000 }, (_, i) => ({ videoId: `v-${i}`, unknown: new Date(i) }))
  await engine.collections.playlists.insertAsync([{ _id: 'saved', playlistName: 'Target', videos, unknown: new Date(1) }, { _id: 'other', playlistName: 'Other', videos }])
  const original = engine.materialize.bind(engine)
  const guard = t.mock.method(engine, 'materialize', (collection, row, options) => { assert.equal(options.arrays, false); return original(collection, row, options) })
  assert.deepEqual(await playlistImportCandidates(engine, { name: 'Target' }), [{ _id: 'saved', playlistName: 'Target' }])
  assert.deepEqual(await playlistImportCandidates(engine, { name: 'missing' }), [])
  guard.mock.restore()
  assert.deepEqual((await engine.playlistSnapshot({ id: 'saved' })).videos, videos)
})

test('legacy profile import retains own prototype keys safely and rolls back invalid NeDB keys', async t => {
  const engine = memory(t)
  await engine.collections.profiles.insertAsync({ _id: 'allChannels', name: 'All', subscriptions: [] })
  const incoming = JSON.parse('{"_id":"safe","name":"Safe","__proto__":{"polluted":true},"subscriptions":[{"id":"channel","unknown":{"__proto__":{"polluted":true}}}]}')
  await importSubscriptionProfiles(engine, { profiles: [incoming] })
  assert.deepEqual(await engine.collections.profiles.findOneAsync({ _id: 'safe' }), incoming)
  assert.equal(Object.prototype.polluted, undefined)
  const before = await engine.collections.profiles.findAsync({}).sort({ _id: 1 })
  await assert.rejects(importSubscriptionProfiles(engine, { profiles: [{ _id: 'earlier', name: 'Earlier', subscriptions: [] }, { _id: 'invalid', name: 'Invalid', subscriptions: [], unknown: { $bad: true } }] }), /\$/)
  assert.deepEqual(await engine.collections.profiles.findAsync({}).sort({ _id: 1 }), before)
  assert.equal(Object.prototype.polluted, undefined)
})


for (const previous of [undefined, null, false, 42, 'retained', { retained: new Date(1) }, new Date(2), [null, null, false, {}, {}, { id: 42 }, { id: '' }, { id: 'existing', unknown: new Date(3) }, { id: 'existing', unknown: new Date(4) }]]) {
  test(`legacy subscription imports retain every previous membership value: ${model.serialize({ previous })}`, async t => {
    const engine = memory(t)
    const originals = [{ _id: 'allChannels', name: 'Primary' }, { _id: 'custom', name: 'Saved' }].map(profile => ({ ...profile, ...(previous === undefined ? {} : { subscriptions: previous }), unknown: new Date(5) }))
    await engine.collections.profiles.insertAsync(originals)
    const existing = { id: 'existing', name: 'Incoming' }, added = { id: 'new', unknown: new Date(6) }
    await importSubscriptionProfiles(engine, { profiles: [{ _id: 'incoming', name: 'Saved', subscriptions: [existing, added, added] }] })
    const retained = Array.isArray(previous) ? previous : previous === undefined ? [] : [previous]
    const expected = [...retained, ...(Array.isArray(previous) ? [] : [existing]), added]
    assert.deepEqual(await engine.collections.profiles.findAsync({}).sort({ _id: 1 }), originals.map(profile => ({ ...profile, subscriptions: expected })).toSorted((a, b) => a._id.localeCompare(b._id)))
  })
}


test('empty legacy subscription imports retain non-array field shapes and missing fields', async t => {
  for (const subscriptions of [undefined, null, false, 'retained', { unknown: new Date(1) }]) {
    const engine = memory(t)
    const originals = [{ _id: 'allChannels', name: 'Primary' }, { _id: 'custom', name: 'Saved' }].map(profile => ({ ...profile, ...(subscriptions === undefined ? {} : { subscriptions }), unknown: new Date(2) }))
    await engine.collections.profiles.insertAsync(originals)
    await importSubscriptionProfiles(engine, { profiles: [{ _id: 'incoming', name: 'Saved', subscriptions: [] }] })
    assert.deepEqual(await engine.collections.profiles.findAsync({}).sort({ _id: 1 }), originals)
  }
})
