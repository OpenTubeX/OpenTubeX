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
import { openLibrary } from '../../src/datastores/sqlite/migration.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { metadataPage } from '../../src/datastores/sqlite/metadata.js'
import { LibraryExports } from '../../src/datastores/sqlite/export.js'
import { filterVideosWithQuery } from '../../src/renderer/helpers/historySearch.js'

function memory(t) {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(SCHEMA_SQL)
  t.after(() => database.close())
  return new LibraryEngine(database)
}

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
  const exported = Buffer.concat(chunks).toString().trim().split('\n').map(line => JSON.parse(line)).sort((a, b) => a._id.localeCompare(b._id))
  assert.deepEqual(exported, JSON.parse(JSON.stringify(records)).sort((a, b) => a._id.localeCompare(b._id)))
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

test('resumed legacy metadata migration retains equal-time arrival order through replacement records', async t => {
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
    assert.deepEqual((await metadataPage(engine, { videoId: 'abcdefghijk', field: 'title' })).records.map(row => row.value), ['Second', 'First'])
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
