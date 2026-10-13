import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { zipSync, strToU8, unzipSync } from 'fflate'
import { openLibrary } from '../../src/datastores/sqlite/migration.js'
import { LibraryExports } from '../../src/datastores/sqlite/export.js'
import { LibraryImports } from '../../src/datastores/sqlite/import.js'
import { mergeBackupHistoryRecord, mergeBackupPlaylist, mergeBackupProfile, validateUnifiedBackup, readUnifiedBackup, createUnifiedBackup } from '../../src/renderer/helpers/unifiedBackup.js'
import { parseTakeoutPlaylistCsv } from '../../src/renderer/helpers/youtube-takeout-zip.js'
import { importTakeoutPlaylist } from '../../src/renderer/helpers/takeout-playlist-import.js'
import Datastore from '@seald-io/nedb'
import model from '@seald-io/nedb/lib/model.js'
import { migrateLegacyHistoryRecord } from '../../src/history.js'
import { mergeSearchHistoryEntries } from '../../src/search-history.js'

async function fixture(t, legacyPlaylists, legacyProfiles) {
  const path = await mkdtemp(join(tmpdir(), 'opentubex-library-backup-'))
  if (legacyPlaylists) await writeFile(join(path, 'playlists.db'), legacyPlaylists.map(record => model.serialize(record)).join('\n') + '\n')
  if (legacyProfiles) await writeFile(join(path, 'profiles.db'), legacyProfiles.map(record => model.serialize(record)).join('\n') + '\n')
  const engine = await openLibrary(path)
  const imports = new LibraryImports(engine)
  const exports = new LibraryExports(engine)
  t.after(async () => {
    for (const id of imports.jobs.keys()) imports.cancel({ id })
    for (const id of exports.jobs.keys()) exports.cancel({ id })
    engine.database.close()
    await rm(path, { recursive: true, force: true })
  })
  return { engine, imports, exports, path }
}
function archive(data) {
  const manifest = { format: 'opentubex-backup', version: 1 }
  return zipSync(Object.fromEntries(Object.entries({ manifest, ...data }).map(([key, value]) => [key + '.json', strToU8(JSON.stringify(value))])))
}
function stage(imports, bytes, chunkSize = 65536) {
  const job = imports.start()
  for (let offset = 0; offset < bytes.length; offset += chunkSize) imports.chunk({ ...job, data: bytes.subarray(offset, offset + chunkSize) })
  imports.finish(job)
  return job
}
const empty = () => ({ settings: {}, profiles: [], playlists: [], history: [], searchHistory: [], watchStats: { records: [], adjustment: null } })

test('generated backups restore retained profile memberships on SQLite and NeDB without changing originals', async t => {
  const originals = [undefined, null, false, 42, 'retained', [null, false, { unknown: new Date(2) }, { id: 'channel', unknown: true }, { id: 'channel', second: true }]].map((subscriptions, index) => ({
    _id: `profile-${index}`, name: `Retained ${index}`, unknown: new Date(index), ...(subscriptions === undefined ? {} : { subscriptions }),
  }))
  const source = await fixture(t, undefined, originals)
  const originalFile = await readFile(join(source.path, 'profiles.db'))
  const job = source.exports.start({ settings: {} }), chunks = []
  for (;;) { const next = source.exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data.profiles, originals)
  for (const format of ['backup', 'records']) {
    const target = await fixture(t)
    for (let repeat = 0; repeat < 2; repeat++) {
      const imported = format === 'backup' ? stage(target.imports, bytes, 7) : target.imports.start({ format })
      if (format === 'records') { target.imports.chunk({ ...imported, section: 'profiles', records: originals }); target.imports.finish(imported) }
      await target.imports.apply({ ...imported, sections: ['profiles'] }, {})
      assert.deepEqual(await target.engine.collections.profiles.findAsync({}).sort({ _id: 1 }), originals)
    }
  }
  const portable = new Datastore({ inMemoryOnly: true })
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const imported of (await readUnifiedBackup(new Blob([bytes]))).data.profiles) {
      await portable.updateAsync({ _id: imported._id }, mergeBackupProfile(await portable.findOneAsync({ _id: imported._id }), imported), { upsert: true })
    }
    assert.deepEqual(await portable.findAsync({}).sort({ _id: 1 }), originals)
  }
  const before = await source.engine.collections.profiles.findAsync({}).sort({ _id: 1 })
  const conflict = source.imports.start({ format: 'records' })
  source.imports.chunk({ ...conflict, section: 'profiles', records: [{ _id: 'earlier', name: 'Earlier', subscriptions: [] }, { ...originals[1], subscriptions: [] }] })
  source.imports.finish(conflict)
  await assert.rejects(source.imports.apply({ ...conflict, sections: ['profiles'] }, {}), /incompatible profile subscriptions/)
  assert.deepEqual(await source.engine.collections.profiles.findAsync({}).sort({ _id: 1 }), before)
  assert.deepEqual(await readFile(join(source.path, 'profiles.db')), originalFile)
})

test('desktop backup jobs preserve development selective exports and released partial archives', async t => {
  const source = await fixture(t)
  const profile = { _id: 'p', name: 'Retained', subscriptions: [null, { id: 'channel', unknown: true }] }
  await source.engine.collections.profiles.insertAsync(profile)
  const exported = source.exports.start({ sections: ['profiles'] }), chunks = []
  for (;;) { const next = source.exports.next(exported); chunks.push(next.data); if (next.done) break }
  const encoded = Buffer.concat(chunks)
  const plain = zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'opentubex-backup', version: 1, sections: ['profiles'] })),
    'profiles.json': strToU8(JSON.stringify([profile])),
  })
  for (const bytes of [encoded, plain]) {
    assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data, { profiles: [profile] })
    const target = await fixture(t)
    const staged = stage(target.imports, bytes, 7)
    assert.deepEqual(target.imports.jobs.get(staged.id).sections, ['profiles'])
    await assert.rejects(target.imports.apply({ ...staged, sections: ['history'] }, {}), /Invalid library import selection/)
    assert.equal(target.engine.collections.profiles.count(), 0)
    await target.imports.apply({ ...staged, sections: ['profiles'] }, {})
    assert.deepEqual(await target.engine.collections.profiles.findAsync({}), [profile])
  }
})

test('desktop backups and NeDB exports retain Dates in records, normalized members and opaque members', async t => {
  const source = await fixture(t)
  const playlist = { _id: 'p', playlistName: 'Dates', unknown: new Date(0), videos: [new Date(1), { videoId: 'v', playlistItemId: 'item', unknown: [new Date(2)] }, null] }
  const profile = { _id: 'profile', name: null, unknown: new Date(3), subscriptions: [{ id: 'channel', unknown: new Date(4) }] }
  await source.engine.collections.playlists.insertAsync(playlist)
  await source.engine.collections.profiles.insertAsync(profile)
  const readExport = format => {
    const job = source.exports.start({ settings: {}, format, collection: 'playlists' }), chunks = []
    for (;;) { const next = source.exports.next(job); chunks.push(next.data); if (next.done) break }
    return Buffer.concat(chunks)
  }
  assert.deepEqual(model.deserialize(readExport('ndjson').toString().trim()), playlist)
  const bytes = readExport('backup')
  const decoded = (await readUnifiedBackup(new Blob([bytes]))).data
  assert.deepEqual(decoded.playlists, [playlist])
  assert.deepEqual(decoded.profiles, [profile])
  const target = await fixture(t)
  await target.imports.apply({ ...stage(target.imports, bytes, 7), sections: ['profiles', 'playlists'] }, {})
  assert.deepEqual(await target.engine.playlistSnapshot({ id: 'p' }), playlist)
  assert.deepEqual(await target.engine.collections.profiles.findOneAsync({ _id: 'profile' }), profile)
})

test('generated backups restore retained scalar and missing playlist fields without altering migration originals', async t => {
  const originals = [undefined, null, false, true, 0, '', 'retained', { nested: [null, false, { keep: '雪😀' }] }].map((videos, index) => ({
    _id: `scalar-${index}`, playlistName: `Retained ${index}`, protected: true, createdAt: 1, lastUpdatedAt: 2,
    unknown: { keep: index }, ...(videos === undefined ? {} : { videos }),
  }))
  const source = await fixture(t, originals)
  const originalFile = await readFile(join(source.path, 'playlists.db'))
  assert.deepEqual(await source.engine.collections.playlists.findAsync({}).sort({ _id: 1 }), originals)
  const job = source.exports.start({ settings: {} }), chunks = []
  for (;;) { const next = source.exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data.playlists, originals)
  for (const format of ['backup', 'records']) {
    const restored = await fixture(t)
    for (let repeat = 0; repeat < 2; repeat++) {
      const staged = format === 'backup' ? stage(restored.imports, bytes, 7) : restored.imports.start({ format })
      if (format === 'records') {
        restored.imports.chunk({ ...staged, section: 'playlists', records: originals })
        restored.imports.finish(staged)
      }
      await restored.imports.apply({ ...staged, sections: ['playlists'] }, {})
      assert.deepEqual(await restored.engine.collections.playlists.findAsync({}).sort({ _id: 1 }), originals)
    }
  }
  const portable = new Datastore({ inMemoryOnly: true })
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const imported of (await readUnifiedBackup(new Blob([bytes]))).data.playlists) {
      const current = await portable.findOneAsync({ _id: imported._id })
      await portable.updateAsync({ _id: imported._id }, mergeBackupPlaylist(current, imported), { upsert: true })
    }
    assert.deepEqual(await portable.findAsync({}).sort({ _id: 1 }), originals)
  }
  assert.deepEqual(await source.engine.collections.playlists.findAsync({}).sort({ _id: 1 }), originals)
  assert.deepEqual(await readFile(join(source.path, 'playlists.db')), originalFile)
})

test('conflicting scalar playlist imports roll back earlier writes and preserve both membership shapes', async t => {
  const { engine, imports } = await fixture(t)
  const fields = [undefined, null, false, [{ videoId: 'local' }], { retained: ['local'] }]
  for (const currentVideos of fields) for (const incomingVideos of fields) {
    if (currentVideos === incomingVideos) continue
    const current = { _id: 'shared', playlistName: 'Local', unknown: { keep: true }, ...(currentVideos === undefined ? {} : { videos: currentVideos }) }
    const incoming = { _id: 'shared', playlistName: 'Imported', ...(incomingVideos === undefined ? {} : { videos: incomingVideos }) }
    await engine.collections.playlists.removeAsync({}, { multi: true })
    await engine.collections.playlists.insertAsync(current)
    for (const format of ['backup', 'records']) {
      const records = [{ _id: 'earlier', playlistName: 'Earlier write', videos: [] }, incoming]
      const job = format === 'backup' ? stage(imports, archive({ ...empty(), playlists: records })) : imports.start({ format })
      if (format === 'records') { imports.chunk({ ...job, section: 'playlists', records }); imports.finish(job) }
      await assert.rejects(imports.apply({ ...job, sections: ['playlists'] }, {}), /Cannot merge incompatible playlist videos/)
      assert.deepEqual(await engine.collections.playlists.findAsync({}), [current])
      assert.equal(engine.database.isTransaction, false)
      assert.throws(() => mergeBackupPlaylist(current, incoming), /Cannot merge incompatible playlist videos/)
      assert.deepEqual(current, await engine.collections.playlists.findOneAsync({ _id: 'shared' }))
      assert.deepEqual(imports.jobs.get(job.id).database.prepare("SELECT data FROM incoming WHERE section = 'playlists' ORDER BY ordinal").all().map(row => model.deserialize(row.data)), records)
      imports.cancel(job)
    }
  }
})

for (const withExisting of [false, true]) {
  test(`generated search backups preserve distinct surrogate queries through repeated restore, existing: ${withExisting}`, async t => {
    const source = await fixture(t)
    const searches = ['\uD800', '\uD801', '\uDC00', '\uDC01', '\uFFFD', '\\ud800'].map((query, index) => ({
      _id: `source-${index}`, query, lastUpdatedAt: index + 2, unknown: { retained: index },
    }))
    await source.engine.collections.searchHistory.insertAsync(searches)
    const job = source.exports.start({ settings: {} }), chunks = []
    for (;;) { const next = source.exports.next(job); chunks.push(next.data); if (next.done) break }
    const bytes = Buffer.concat(chunks)
    const restored = await fixture(t)
    const existing = withExisting ? searches.map((record, index) => ({ ...record, _id: `existing-${index}`, lastUpdatedAt: 1 })) : []
    if (existing.length) await restored.engine.collections.searchHistory.insertAsync(existing)
    const expected = mergeSearchHistoryEntries(existing, searches).toSorted((a, b) => model.compareThings(a._id, b._id))
    for (let repeat = 0; repeat < 2; repeat++) {
      await restored.imports.apply({ ...stage(restored.imports, bytes, 7), sections: ['searchHistory'] }, {})
      assert.deepEqual(await restored.engine.collections.searchHistory.findAsync({}).sort({ _id: 1 }), expected)
    }
    assert.deepEqual(await source.engine.collections.searchHistory.findAsync({}).sort({ _id: 1 }), searches)
  })
}

test('generated backups restore legacy search queries and retained non-string history identities', async t => {
  const { engine, exports } = await fixture(t)
  const history = [undefined, null, false, true, 0, 42, '\ud800', '\ud801', [42], { retained: true }].map((videoId, index) => ({
    _id: `retained-${index}`, ...(videoId === undefined ? {} : { videoId }), timeWatched: index + 1,
    watchProgress: 20, isWatched: true, title: `Retained ${index}`, unknown: { index },
  }))
  const searches = [{ _id: 'older search text', lastUpdatedAt: 123, unknown: { keep: true } }]
  await engine.collections.history.insertAsync(history)
  await engine.collections.searchHistory.insertAsync(searches)
  const job = exports.start({ settings: { theme: 'dark' } })
  const chunks = []
  for (;;) { const next = exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  const decoded = await readUnifiedBackup(new Blob([bytes]))
  assert.deepEqual(decoded.data.history, history)
  assert.deepEqual(decoded.data.searchHistory, searches)
  const restored = await fixture(t)
  const existing = ['42', '\uFFFD'].map((videoId, index) => ({ _id: `existing-${index}`, videoId, timeWatched: 50, watchProgress: 99, isWatched: true, unknown: { original: true } }))
  await restored.engine.collections.history.insertAsync(existing)
  const expected = [...existing, ...history].toSorted((a, b) => model.compareThings(a._id, b._id))
  for (let repeat = 0; repeat < 2; repeat++) {
    await restored.imports.apply({ ...stage(restored.imports, bytes, 7), sections: ['history', 'searchHistory'] }, {})
    assert.deepEqual(await restored.engine.collections.history.findAsync({}).sort({ _id: 1 }), expected)
    const savedSearches = await restored.engine.collections.searchHistory.findAsync({})
    assert.equal(savedSearches.length, 1)
    assert.equal(savedSearches[0].query, searches[0]._id)
    assert.equal(savedSearches[0].lastUpdatedAt, 123)
    assert.deepEqual(savedSearches[0].unknown, { keep: true })
  }
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), history)
  assert.deepEqual(await engine.collections.searchHistory.findAsync({}), searches)
  const selected = await fixture(t)
  assert.deepEqual(await selected.imports.apply({ ...stage(selected.imports, bytes, 11), sections: ['settings'] }, {}), { settings: { theme: 'dark' } })
  assert.deepEqual(await selected.engine.collections.history.findAsync({}), [])
  assert.deepEqual(await selected.engine.collections.searchHistory.findAsync({}), [])
})

test('generated backups and legacy imports retain opaque playlist entries across repeated restores', async t => {
  const original = { _id: 'opaque', playlistName: 'Opaque legacy members', protected: true, videos: [null, false, true, 1.2345678901234567, 'retained string', ['retained array'], null, false] }
  const { engine, exports } = await fixture(t)
  await engine.collections.playlists.insertAsync(original)
  const job = exports.start({ settings: { theme: 'dark' } })
  const chunks = []
  for (;;) { const next = exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  const restored = await fixture(t)
  for (let repeat = 0; repeat < 2; repeat++) {
    await restored.imports.apply({ ...stage(restored.imports, bytes, 7), sections: ['playlists'] }, {})
    assert.deepEqual(await restored.engine.playlistSnapshot({ id: original._id }), original)
  }
  const selected = stage(restored.imports, bytes, 11)
  assert.deepEqual(await restored.imports.apply({ ...selected, sections: ['settings'] }, {}), { settings: { theme: 'dark' } })
  const legacy = await fixture(t)
  const legacyRecord = { ...original, videos: [...original.videos, new Date(7)] }
  for (let repeat = 0; repeat < 2; repeat++) {
    const incoming = legacy.imports.start({ format: 'records' })
    legacy.imports.chunk({ ...incoming, section: 'playlists', records: [legacyRecord] })
    legacy.imports.finish(incoming)
    await legacy.imports.apply({ ...incoming, sections: ['playlists'] }, {})
    assert.deepEqual((await legacy.engine.playlistSnapshot({ id: original._id })).videos, legacyRecord.videos)
  }
  assert.deepEqual(await engine.playlistSnapshot({ id: original._id }), original)
})

test('a generated backup restores retained playlist members with missing and non-string video identities', async t => {
  const original = { _id: 'legacy', playlistName: 'Retained', protected: true, unknown: { keep: true }, videos: [
    { title: 'Missing identity', unknown: [1, false] },
    ...[null, 0, 42, false, true].map((videoId, index) => ({ videoId, playlistItemId: `member-${index}`, title: 'Retained member', unknown: { index } })),
  ] }
  const { engine, exports } = await fixture(t)
  await engine.collections.playlists.insertAsync(original)
  const job = exports.start({ settings: { theme: 'dark' } })
  const chunks = []
  for (;;) { const next = exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  const restored = await fixture(t)
  await restored.imports.apply({ ...stage(restored.imports, bytes, 7), sections: ['playlists'] }, {})
  const result = await restored.engine.playlistSnapshot({ id: 'legacy' })
  assert.deepEqual(result.videos.map(({ playlistItemId, ...video }) => video), original.videos.map(({ playlistItemId, ...video }) => video))
  assert.deepEqual(result.videos.slice(1), original.videos.slice(1))
  assert.equal(result.protected, true)
  assert.deepEqual(result.unknown, original.unknown)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'legacy' }), original)
  const selective = await fixture(t)
  const selected = stage(selective.imports, bytes, 11)
  assert.equal(selective.imports.jobs.get(selected.id).ready, true)
  assert.deepEqual(await selective.imports.apply({ ...selected, sections: ['settings'] }, {}), { settings: { theme: 'dark' } })
  assert.deepEqual(await selective.engine.collections.playlists.findAsync({}), [])
})

for (const timeWatched of ['2026-01-01', undefined, null, false, [1], { legacy: 'timestamp' }, -1]) {
  test(`a generated backup can restore a retained legacy timestamp ${JSON.stringify(timeWatched)}`, async t => {
    const { engine, exports } = await fixture(t)
    const record = { _id: 'retained', videoId: 'same', ...(timeWatched === undefined ? {} : { timeWatched }), watchProgress: 20, isWatched: true, unknown: { keep: true }, description: '' }
    await engine.collections.history.insertAsync(record)
    const job = exports.start({ settings: {} })
    const chunks = []
    for (;;) { const next = exports.next(job); chunks.push(next.data); if (next.done) break }
    const bytes = Buffer.concat(chunks)
    const contents = unzipSync(bytes)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(contents['history.json'])), [record])
    const restored = await fixture(t)
    await restored.imports.apply({ ...stage(restored.imports, bytes, 7), sections: ['history'] }, {})
    assert.deepEqual(await restored.engine.collections.history.findAsync({}), [migrateLegacyHistoryRecord(record)])
    assert.deepEqual(await engine.collections.history.findAsync({}), [record])
  })
}

for (const watchProgress of [undefined, null, '12', -1, false, [12], { legacy: 'progress' }]) {
  test(`a generated backup restores retained progress ${JSON.stringify(watchProgress)} twice without normalization`, async t => {
    const { engine, exports } = await fixture(t)
    const record = { _id: 'retained', videoId: 'same', timeWatched: 1, ...(watchProgress === undefined ? {} : { watchProgress }), isWatched: true, unknown: { keep: true } }
    await engine.collections.history.insertAsync(record)
    const job = exports.start({ settings: {} })
    const chunks = []
    for (;;) { const next = exports.next(job); chunks.push(next.data); if (next.done) break }
    const bytes = Buffer.concat(chunks)
    assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data.history, [record])
    const restored = await fixture(t)
    for (let repeat = 0; repeat < 2; repeat++) {
      await restored.imports.apply({ ...stage(restored.imports, bytes, 7), sections: ['history'] }, {})
      assert.deepEqual(await restored.engine.collections.history.findAsync({}), [record])
    }
    assert.deepEqual(await engine.collections.history.findAsync({}), [record])
  })
}

test('invalid legacy keys abort staging instead of silently dropping fields or partially changing live history', async t => {
  const { engine, imports } = await fixture(t)
  const original = { _id: 'original', videoId: 'original', timeWatched: 1, unknown: new Date(1) }
  await engine.collections.history.insertAsync(original)
  const records = [{ _id: 'valid', videoId: 'valid', timeWatched: 2, paid: true, future: { keep: new Date(2) } }, { _id: 'invalid', videoId: 'invalid', timeWatched: 3, $custom: 'retain in the source' }]
  const before = structuredClone(records)
  const job = imports.start({ format: 'records' })
  assert.throws(() => imports.chunk({ ...job, section: 'history', records }), /Field names cannot begin/)
  assert.equal(imports.jobs.has(job.id), false)
  assert.deepEqual(await engine.collections.history.findAsync({}), [original])
  assert.deepEqual(records, before)
})

for (const timeWatched of [new Date(2), '2026-01-01', undefined, null, false, [1], { value: 1 }, 1]) {
  test(`backup history fallback uses original timestamp and UTF-16 ordering for ${model.serialize({ timeWatched })}`, async t => {
    const { engine, imports } = await fixture(t)
    const legacy = new Datastore({ inMemoryOnly: true })
    const saved = [
      { _id: '\uE000', videoId: 'same', ...(timeWatched === undefined ? {} : { timeWatched }), cachedAt: 9999, watchProgress: 10, unknown: new Date(3) },
      { _id: '😀', videoId: 'same', timeWatched: 1, watchProgress: 20, unknown: new Date(4) },
      { _id: 'exact', videoId: 'same', timeWatched: 10000, watchProgress: 30, unknown: new Date(5) },
    ]
    await engine.collections.history.insertAsync(saved)
    await legacy.insertAsync(saved)
    const incoming = { _id: 'absent', videoId: 'same', timeWatched: 3, watchProgress: 40, imported: true }
    const exact = { _id: 'exact', videoId: 'same', timeWatched: 10001, watchProgress: 35 }
    const destination = (await legacy.findAsync({ _id: { $ne: 'exact' } }).sort({ timeWatched: -1, _id: -1 }))[0]
    const expected = saved.map(record => record._id === destination._id
      ? { ...mergeBackupHistoryRecord(record, migrateLegacyHistoryRecord(incoming)), _id: record._id }
      : record._id === exact._id ? mergeBackupHistoryRecord(record, migrateLegacyHistoryRecord(exact)) : record)
      .sort((left, right) => model.compareThings(left._id, right._id))
    for (let repeat = 0; repeat < 2; repeat++) {
      await imports.apply({ ...stage(imports, archive({ ...empty(), history: [incoming, exact] })), sections: ['history'] }, {})
      assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), expected)
    }
  })
}

test('YouTube history export retains original timestamp and Unicode tie ordering without changing records', async t => {
  const { engine, exports } = await fixture(t)
  const legacy = new Datastore({ inMemoryOnly: true })
  const times = [new Date(2), '2026-01-01', undefined, null, false, [1], { value: 1 }, 1]
  const records = times.map((timeWatched, index) => ({ _id: String(index), videoId: `video-${index}`, title: `Title ${index}`, author: 'Author', authorId: 'channel', ...(timeWatched === undefined ? {} : { timeWatched }), cachedAt: 9999 - index, unknown: new Date(index) }))
  records.push(...['\uE000', '😀'].map(_id => ({ ...records.at(-1), _id, videoId: _id })))
  await engine.collections.history.insertAsync(records)
  await legacy.insertAsync(records)
  const ordered = await legacy.findAsync({}).sort({ timeWatched: -1 })
  const job = exports.start({ format: 'youtubeHistory' })
  const chunks = []
  let next
  do { next = exports.next(job); chunks.push(Buffer.from(next.data)) } while (!next.done)
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), ordered.map(entry => {
    const date = typeof entry.timeWatched === 'number' || typeof entry.timeWatched === 'string' || entry.timeWatched instanceof Date ? new Date(entry.timeWatched) : new Date(NaN)
    return { header: 'YouTube', title: `Watched ${entry.title}`, titleUrl: `https://www.youtube.com/watch?v=${entry.videoId}`, subtitles: [{ name: entry.author, url: `https://www.youtube.com/channel/${entry.authorId}` }], time: Number.isFinite(date.getTime()) ? date.toISOString() : null, products: ['YouTube'], activityControls: ['YouTube watch history'] }
  }))
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), await legacy.findAsync({}).sort({ _id: 1 }))
  assert.equal(exports.jobs.size, 0)
})

for (const format of ['records', 'backup']) {
  test(`${format} import cancels its stage and preserves the original error if rollback fails`, async t => {
    const { engine, imports } = await fixture(t)
    await engine.collections.history.insertAsync({ _id: 'saved', videoId: 'saved' })
    const job = imports.start({ format })
    const stage = imports.jobs.get(job.id)
    const exec = stage.database.exec.bind(stage.database)
    stage.database.exec = sql => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed')
      return exec(sql)
    }
    const failure = new Error('import failed')
    if (format === 'backup') stage.unzip.push = () => { throw failure }
    else stage.insert.run = () => { throw failure }
    assert.throws(() => imports.chunk(format === 'backup'
      ? { ...job, data: new Uint8Array([0]) }
      : { ...job, section: 'history', records: [{ videoId: 'incoming', timeWatched: 1 }] }), error => error === failure)
    assert.equal(imports.jobs.has(job.id), false)
    await assert.rejects(readFile(join(stage.directory, 'staging.sqlite')), { code: 'ENOENT' })
    assert.deepEqual(await engine.collections.history.findAsync({}), [{ _id: 'saved', videoId: 'saved' }])
  })
}

test('restart removes a crashed import stage while retaining live imports and unrelated data', { timeout: 15000 }, async t => {
  const { engine, imports } = await fixture(t)
  const profile = join(engine.database.prepare('PRAGMA database_list').get().file, '..')
  const original = 'retained migration original\n'
  await writeFile(join(profile, 'history.db'), original)
  await engine.collections.history.insertAsync({ _id: 'saved', videoId: 'saved', timeWatched: 1 })
  const foreign = join(profile, 'library.sqlite.imports-user-backup')
  await mkdir(foreign)
  await writeFile(join(foreign, 'keep'), 'source backup')
  const live = imports.start({ format: 'records' })
  imports.chunk({ ...live, section: 'history', records: [{ videoId: 'live', timeWatched: 2 }] })
  t.after(() => imports.cancel(live))
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    const { openLibrary } = await import(${JSON.stringify(new URL('../../src/datastores/sqlite/migration.js', import.meta.url).href)});
    const { LibraryImports } = await import(${JSON.stringify(new URL('../../src/datastores/sqlite/import.js', import.meta.url).href)});
    const engine = await openLibrary(process.argv[1]);
    const imports = new LibraryImports(engine);
    const job = imports.start({ format: 'records' });
    imports.chunk({ ...job, section: 'history', records: [{ videoId: 'unfinished', timeWatched: 3 }] });
    process.send(imports.jobs.get(job.id).directory);
    setInterval(() => {}, 1000);
  `, profile], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  t.after(() => child.kill('SIGKILL'))
  const exited = once(child, 'exit')
  const directory = await Promise.race([
    once(child, 'message').then(([message]) => message),
    exited.then(([code]) => { throw new Error(`Import child exited (${code}): ${stderr}`) }),
  ])
  child.kill('SIGKILL')
  await exited
  new LibraryImports(engine)
  await assert.rejects(readFile(join(directory, 'staging.sqlite')), { code: 'ENOENT' })
  assert.equal(imports.finish(live).counts.history, 1)
  assert.equal(await engine.collections.history.countAsync({}), 1)
  assert.equal(await readFile(join(profile, 'history.db'), 'utf8'), original)
  assert.equal(await readFile(join(foreign, 'keep'), 'utf8'), 'source backup')
})

test('Takeout playlist imports retain off-page custom members and stable identities on repeat imports', async t => {
  const { engine, imports } = await fixture(t)
  const saved = Array.from({ length: 200 }, (_, index) => ({ videoId: `saved-${index}`, playlistItemId: `saved-item-${index}`, timeAdded: index }))
  saved.push({ videoId: 'abcdefghijk', playlistItemId: 'existing-csv-member', timeAdded: Date.parse('2025-01-01T00:00:00Z') })
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Shared name', protected: false, future: { keep: true }, videos: saved })
  const storage = {
    find: () => engine.collections.playlists.findAsync({}),
    importRecords: async (section, records) => {
      const job = imports.start({ format: 'records' })
      imports.chunk({ ...job, section, records: structuredClone(records) })
      imports.finish(job)
      await imports.apply({ ...job, sections: [section] }, {})
    },
  }
  const entry = { path: 'Takeout/YouTube/playlists/Shared name.csv', content: 'Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\nmnopqrstuvw,2025-01-02T00:00:00Z\n' }
  await importTakeoutPlaylist({ ...parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1)), playlistName: 'Shared name' }, storage)
  let playlist = await engine.playlistSnapshot({ id: 'p' })
  assert.equal(playlist.videos.length, saved.length + 1)
  assert.deepEqual(playlist.videos.slice(0, saved.length), saved)
  assert.equal(playlist.protected, false)
  assert.deepEqual(playlist.future, { keep: true })
  assert.equal(typeof playlist.videos.at(-1).playlistItemId, 'string')
  assert.equal(playlist.videos.at(-1).type, 'video')
  const identities = playlist.videos.map(video => video.playlistItemId)
  await importTakeoutPlaylist({ ...parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1)), playlistName: 'Shared name' }, storage)
  playlist = await engine.playlistSnapshot({ id: 'p' })
  assert.deepEqual(playlist.videos.map(video => video.playlistItemId), identities)
  await importTakeoutPlaylist({ ...parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1)), playlistName: 'New imported playlist' }, storage)
  const created = await engine.collections.playlists.findOneAsync({ playlistName: 'New imported playlist' })
  assert.equal(created.videos.length, 2)
  assert.equal(created.protected, false)
  assert.ok(Number.isFinite(created.createdAt))
  assert.ok(created.videos.every(video => typeof video.playlistItemId === 'string' && video.type === 'video'))
  await importTakeoutPlaylist({ ...parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1)), playlistName: 'New imported playlist' }, storage)
  assert.deepEqual((await engine.playlistSnapshot({ id: created._id })).videos, created.videos)
})

test('portable Takeout imports consume saved occurrences once and retain excess duplicate CSV rows', async () => {
  const timeAdded = Date.parse('2025-01-01T00:00:00Z')
  const videos = [1, 2].map(index => ({ videoId: 'abcdefghijk', timeAdded, playlistItemId: `saved-${index}`, unknown: new Date(index) }))
  let saved = { _id: 'p', playlistName: 'Shared', videos }
  const entry = { path: 'Shared.csv', content: 'Video ID,Playlist video creation timestamp\n' + 'abcdefghijk,2025-01-01T00:00:00Z\n'.repeat(3) }
  const storage = { find: async () => [saved], update: async record => { saved = record } }
  await importTakeoutPlaylist({ ...parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1)), playlistName: 'Shared' }, storage)
  assert.equal(saved.videos.length, 3)
  assert.deepEqual(saved.videos.slice(0, 2), videos)
  const first = structuredClone(saved)
  await importTakeoutPlaylist({ ...parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1)), playlistName: 'Shared' }, storage)
  assert.deepEqual(saved, first)
})

test('the streaming array reader rejects a record that closes beyond its bound before parsing it', async () => {
  const source = await readFile(new URL('../../src/datastores/sqlite/import.js', import.meta.url), 'utf8')
  const readerSource = source.slice(source.indexOf('class ArrayReader {'), source.indexOf('\nfunction emptyBackup'))
  // Exercise the production parser with a small bound instead of allocating 128 MiB.
  const Reader = compileFunction(readerSource + '\nreturn ArrayReader', ['MAX_RECORD', 'model'])(64, model)
  for (const split of [false, true]) {
    const records = []
    const reader = new Reader(record => records.push(record))
    if (split) reader.push('[{"title":"' + 'x'.repeat(30), false)
    assert.throws(() => reader.push(split ? 'x'.repeat(40) + '"}]' : '[{"title":"' + 'x'.repeat(70) + '"}]', true), /record is too large/)
    assert.deepEqual(records, [])
  }
  const records = []
  const reader = new Reader(record => records.push(record))
  reader.push('[{"title":"' + 'x'.repeat(52) + '"}]', true)
  assert.deepEqual(records, [{ title: 'x'.repeat(52) }])
})

for (const failure of ['write', 'backup transaction', 'records transaction']) {
  test(`failed ${failure} releases the staging import and leaves the active library unchanged`, async t => {
    const { engine, imports } = await fixture(t)
    const original = { _id: 'saved', videoId: 'saved', timeWatched: 1, unknown: new Date(1) }
    await engine.collections.history.insertAsync(original)
    const job = imports.start({ format: failure.startsWith('records') ? 'records' : 'backup' })
    const stage = imports.jobs.get(job.id)
    const { closeSync, fstatSync } = await import('node:fs')
    t.mock.method(console, 'error', () => {})
    if (failure === 'write') closeSync(stage.fd)
    else {
      const exec = stage.database.exec.bind(stage.database)
      t.mock.method(stage.database, 'exec', sql => { if (sql === 'BEGIN') throw new Error('simulated transaction failure'); return exec(sql) })
    }
    assert.throws(() => imports.chunk({ ...job, data: new Uint8Array([0]), section: 'history', records: [original] }), failure === 'write' ? /EBADF/ : /transaction failure/)
    assert.equal(imports.jobs.size, 0)
    assert.throws(() => fstatSync(stage.fd), { code: 'EBADF' })
    assert.throws(() => stage.database.prepare('SELECT 1'), /not open|closed/i)
    await assert.rejects(readFile(join(stage.directory, 'staging.sqlite')), { code: 'ENOENT' })
    assert.deepEqual(await engine.collections.history.findAsync({}), [original])
    assert.ok(imports.start().id)
  })
}

test('YouTube exports retain invalid-identity rows without inventing watch or channel links', async t => {
  const { engine, exports } = await fixture(t)
  await engine.collections.history.insertAsync([undefined, null, 42, 'valid'].map((id, index) => ({ _id: String(index), videoId: id, authorId: id, title: `Title ${index}`, timeWatched: index })))
  const job = exports.start({ format: 'youtubeHistory' })
  const chunks = []
  for (;;) { const part = exports.next(job); chunks.push(part.data); if (part.done) break }
  const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  assert.equal(rows.length, 4)
  for (const row of rows) {
    if (row.title === 'Watched Title 3') {
      assert.equal(row.titleUrl, 'https://www.youtube.com/watch?v=valid')
      assert.equal(row.subtitles[0].url, 'https://www.youtube.com/channel/valid')
    } else {
      assert.equal(row.titleUrl, null)
      assert.equal(Object.hasOwn(row.subtitles[0], 'url'), false)
    }
  }
})

test('portable Takeout imports preserve Date fields and leave the original members untouched', async () => {
  const saved = { videoId: 'saved', playlistItemId: 'saved-member', timeAdded: 1, unknown: { date: new Date(123) } }
  const existing = { _id: 'p', playlistName: 'Shared name', videos: [saved] }
  let updated
  await importTakeoutPlaylist(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n', 'Shared name.csv'), {
    find: async () => [existing], update: async playlist => { updated = playlist },
  })
  assert.deepEqual(updated.videos[0], saved)
  assert.notEqual(updated.videos[0], saved)
  assert.deepEqual(existing.videos, [saved])
  assert.equal(updated.videos.length, 2)
})

test('YouTube history export retains every row when legacy timestamps are missing or invalid', async t => {
  const { engine, exports } = await fixture(t)
  const records = [undefined, null, 'invalid', {}, 9e15, 0, new Date(123)].map((timeWatched, index) => ({
    _id: `h${index}`, videoId: `v${index}`, title: `Title ${index}`, author: 'Author', authorId: 'channel',
    ...(timeWatched === undefined ? {} : { timeWatched }),
  }))
  await engine.collections.history.insertAsync(records)
  const job = exports.start({ format: 'youtubeHistory' })
  const chunks = []
  let next
  do { next = exports.next(job); chunks.push(Buffer.from(next.data)) } while (!next.done)
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  assert.equal(exported.length, records.length)
  for (const entry of exported) {
    const index = Number(entry.titleUrl.split('=')[1].slice(1))
    assert.deepEqual(entry, {
      header: 'YouTube', title: `Watched Title ${index}`, titleUrl: `https://www.youtube.com/watch?v=v${index}`,
      subtitles: [{ name: 'Author', url: 'https://www.youtube.com/channel/channel' }],
      time: index === 5 ? new Date(0).toISOString() : index === 6 ? new Date(123).toISOString() : null,
      products: ['YouTube'], activityControls: ['YouTube watch history'],
    })
  }
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), records)
  assert.equal(exports.jobs.size, 0)
})

test('playlist imports match explicit IDs before legacy timestamps and retain excess duplicate occurrences', () => {
  const first = { videoId: 'same', playlistItemId: 'first', timeAdded: 1 }
  const second = { videoId: 'same', playlistItemId: 'second', timeAdded: 1 }
  const current = { videos: [first, second], protected: true }
  const legacy = { videoId: 'same', timeAdded: 1 }
  assert.deepEqual(mergeBackupPlaylist(current, { videos: [legacy, first] }).videos, current.videos)
  assert.deepEqual(mergeBackupPlaylist(current, { videos: [legacy, legacy, legacy] }).videos, [first, second, legacy])
  assert.deepEqual(mergeBackupPlaylist(current, { videos: [{ ...first, videoId: 'different' }] }).videos, [first, second, { ...first, videoId: 'different' }])
})

test('individual legacy exports stream bounded chunks from a consistent snapshot and remain importable', async t => {
  const { engine, imports, exports } = await fixture(t)
  const playlist = { _id: 'p', playlistName: '雪😀', protected: true, videos: Array.from({ length: 20000 }, (_, i) => ({ videoId: String(i), playlistItemId: 'duplicate', timeAdded: i, title: '😀'.repeat(20) })) }
  await engine.collections.playlists.insertAsync(playlist)
  const job = exports.start({ format: 'ndjson', collection: 'playlists' })
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $push: { videos: { videoId: 'concurrent', title: 'Keep this edit' } } })
  const chunks = []
  for (;;) {
    const page = exports.next(job)
    assert.ok(page.data.length <= 98304)
    chunks.push(page.data)
    if (page.done) break
  }
  assert.ok(chunks.length > 10)
  const oldFormat = JSON.parse(Buffer.concat(chunks).toString('utf8').trim())
  assert.deepEqual(oldFormat, playlist)
  const incoming = imports.start({ format: 'records' })
  imports.chunk({ ...incoming, section: 'playlists', records: [oldFormat] })
  imports.finish(incoming)
  await imports.apply({ ...incoming, sections: ['playlists'] }, {})
  assert.equal((await engine.playlistSnapshot({ id: 'p' })).videos.length, 20001)
})

test('old record imports retain progress, concurrent writes, duplicate item IDs for different videos and unknown fields', async t => {
  const { engine, imports } = await fixture(t)
  await engine.collections.history.insertAsync({ _id: 'existing', videoId: 'video', timeWatched: 10, watchProgress: 40, isWatched: true, future: { keep: true } })
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Shared name', protected: true, videos: [{ videoId: 'first', playlistItemId: 'same' }] })
  const job = imports.start({ format: 'records' })
  imports.chunk({ ...job, section: 'history', records: [{ videoId: 'video', timeWatched: 5, watchProgress: 1, isWatched: false, importedUnknown: 1 }] })
  imports.chunk({ ...job, section: 'playlists', records: [{ _id: 'other', playlistName: 'Shared name', protected: false, videos: [{ videoId: 'different', playlistItemId: 'same' }] }] })
  imports.finish(job)
  await engine.collections.history.insertAsync({ videoId: 'concurrent', timeWatched: 20 })
  await imports.apply({ ...job, sections: ['history', 'playlists'] }, {})
  assert.equal(await engine.collections.history.countAsync({}), 2)
  const history = await engine.collections.history.findOneAsync({ videoId: 'video' })
  assert.equal(history.watchProgress, 40)
  assert.equal(history.timeWatched, 10)
  assert.equal(history.isWatched, true)
  assert.deepEqual(history.future, { keep: true })
  assert.equal(history.importedUnknown, 1)
  const playlist = await engine.playlistSnapshot({ id: 'p' })
  assert.deepEqual(playlist.videos.map(video => video.videoId), ['first'])
  assert.equal(playlist.protected, true)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'other' })).videos.map(video => video.videoId), ['different'])
})

test('streamed desktop backups retain version 1, duplicate order, unknown fields, dates and watch-stat adjustment', async t => {
  const { engine, exports } = await fixture(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Large', protected: true, future: { enabled: true }, videos: Array.from({ length: 20000 }, (_, index) => ({ videoId: 'duplicate', playlistItemId: 'duplicate-item', title: `Video ${index} 雪😀`, timeAdded: new Date(index) })) })
  await engine.collections.history.insertAsync({ _id: 'h', videoId: 'h', timeWatched: 1, watchProgress: 0, isWatched: false })
  await engine.collections.watchStats.insertAsync([{ _id: 'day', date: '2026-10-09', seconds: 100 }, { _id: 'history-watch-time-v1', adjustment: { defaultSpeed: 1.5 } }])
  const job = exports.start({ settings: { theme: 'dark' } })
  // A writer may continue while the export retains its original read snapshot.
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $set: { playlistName: 'New name' } })
  const chunks = []
  for (;;) { const next = exports.next(job); assert.ok(next.data.length < 256 * 1024); chunks.push(next.data); if (next.done) break }
  const contents = unzipSync(Buffer.concat(chunks))
  const data = Object.fromEntries(Object.entries(contents).filter(([key]) => key !== 'manifest.json').map(([key, value]) => [key.slice(0, -5), model.deserialize(new TextDecoder().decode(value))]))
  validateUnifiedBackup(data)
  assert.equal(JSON.parse(new TextDecoder().decode(contents['manifest.json'])).version, 1)
  assert.equal(data.playlists[0].playlistName, 'Large')
  assert.equal(data.playlists[0].videos.length, 20000)
  assert.deepEqual(data.playlists[0].videos[0].timeAdded, new Date(0))
  assert.equal(data.playlists[0].videos.at(-1).title, 'Video 19999 雪😀')
  assert.deepEqual(data.watchStats, { records: [{ _id: 'day', date: '2026-10-09', seconds: 100 }], adjustment: { defaultSpeed: 1.5 } })
  assert.equal(exports.jobs.size, 0)
})

test('older format imports stage before selection and merge atomically with current records rather than a stale UI snapshot', async t => {
  const { engine, imports } = await fixture(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Protected', protected: true, videos: [{ videoId: 'same', playlistItemId: 'duplicate', title: 'First' }], future: 42 })
  await engine.collections.history.insertAsync({ _id: 'h', videoId: 'same', timeWatched: 20, watchProgress: 30, future: { old: true }, isWatched: false })
  const data = { ...empty(), playlists: [{ _id: 'p', playlistName: 'Import', protected: false, videos: [{ videoId: 'same', playlistItemId: 'duplicate', title: 'First' }, { videoId: 'same', playlistItemId: 'duplicate', title: 'Second' }] }], history: [{ _id: 'h', videoId: 'same', timeWatched: 10, watchProgress: 80, isWatched: true, additional: 'Keep' }] }
  const job = stage(imports, archive(data), 7)
  assert.equal((await engine.playlistSnapshot({ id: 'p' })).videos.length, 1)
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $push: { videos: { videoId: 'concurrent', playlistItemId: 'new' } } })
  await imports.apply({ ...job, sections: ['playlists', 'history'] }, {})
  const saved = await engine.playlistSnapshot({ id: 'p' })
  assert.deepEqual(saved.videos.map(video => video.title ?? video.videoId), ['First', 'concurrent', 'Second'])
  assert.equal(saved.protected, true)
  assert.equal(saved.future, 42)
  const history = await engine.collections.history.findOneAsync({ _id: 'h' })
  assert.equal(history.timeWatched, 20)
  assert.equal(history.watchProgress, 80)
  assert.equal(history.isWatched, true)
  assert.deepEqual(history.future, { old: true })
  assert.equal(history.additional, 'Keep')
})

test('unified history restores merge differing IDs into the latest existing occurrence', async t => {
  const { engine, imports } = await fixture(t)
  const older = { _id: 'older', videoId: 'same', timeWatched: 5, watchProgress: 3, unknown: 'older' }
  await engine.collections.history.insertAsync([older, { _id: 'latest', videoId: 'same', timeWatched: 20, watchProgress: 30, isWatched: false, future: { keep: true } }])
  const data = { ...empty(), history: [{ _id: 'restored', videoId: 'same', timeWatched: 10, watchProgress: 80, isWatched: true, additional: 'Keep' }] }
  for (let repeat = 0; repeat < 2; repeat++) {
    const job = stage(imports, archive(data))
    await imports.apply({ ...job, sections: ['history'] }, {})
    assert.equal(await engine.collections.history.countAsync({}), 2)
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'older' }), older)
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'latest' }), {
      _id: 'latest', videoId: 'same', timeWatched: 20, watchProgress: 80, isWatched: true,
      future: { keep: true }, additional: 'Keep',
    })
  }
})

for (const order of ['fallback-first', 'exact-first']) {
  test(`unified history reserves exact matches before fallback matching (${order})`, async t => {
    const { engine, imports } = await fixture(t)
    await engine.collections.history.insertAsync({ _id: 'exact', videoId: 'same', timeWatched: 20, watchProgress: 40, isWatched: true })
    const exact = { _id: 'exact', videoId: 'same', timeWatched: 30, watchProgress: 60, source: 'exact' }
    const extra = { _id: 'extra', videoId: 'same', timeWatched: 15, watchProgress: 2, isWatched: false, source: 'extra' }
    const data = { ...empty(), history: order === 'fallback-first' ? [extra, exact] : [exact, extra] }
    for (let repeat = 0; repeat < 2; repeat++) {
      await imports.apply({ ...stage(imports, archive(data)), sections: ['history'] }, {})
      assert.equal(await engine.collections.history.countAsync({}), 2)
      assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'extra' }), extra)
      assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'exact' }), { ...exact, isWatched: true })
    }
  })
}

test('unified history restores every duplicate occurrence into an empty profile and on repeat restores', async t => {
  const { engine, imports } = await fixture(t)
  const history = [{ _id: 'first', videoId: 'same', timeWatched: 10, watchProgress: 1, isWatched: false, unknown: 'first' }, { _id: 'second', videoId: 'same', timeWatched: 20, watchProgress: 2, isWatched: false, unknown: 'second' }]
  for (let repeat = 0; repeat < 2; repeat++) {
    await imports.apply({ ...stage(imports, archive({ ...empty(), history })), sections: ['history'] }, {})
    assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), history)
  }
})

test('unified history retains ambiguous excess occurrences and rolls matching back with failed writes', async t => {
  const { engine, imports } = await fixture(t)
  const history = [{ _id: 'older', videoId: 'same', timeWatched: 10, watchProgress: 20, retained: 'older' }, { _id: 'latest', videoId: 'same', timeWatched: 20, watchProgress: 40, retained: 'latest' }]
  await engine.collections.history.insertAsync(history)
  const incoming = [{ _id: 'first', videoId: 'same', timeWatched: 5, watchProgress: 50 }, { _id: 'second', videoId: 'same', timeWatched: 6, watchProgress: 30 }, { _id: 'extra', videoId: 'same', timeWatched: 7, watchProgress: 1 }]
  const job = stage(imports, archive({ ...empty(), history: incoming }))
  const update = engine.collections.history.updateAsync
  let writes = 0
  engine.collections.history.updateAsync = function (...args) {
    if (++writes === 2) throw new Error('simulated history disk failure')
    return update.apply(this, args)
  }
  try {
    await assert.rejects(imports.apply({ ...job, sections: ['history'] }, {}), /history disk failure/)
  } finally {
    engine.collections.history.updateAsync = update
  }
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), [history[1], history[0]])
  await imports.apply({ ...job, sections: ['history'] }, {})
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), [
    { ...incoming[2], isWatched: false }, { ...history[1], watchProgress: 50, isWatched: false }, history[0], { ...incoming[1], isWatched: false },
  ])
  const restored = await engine.collections.history.findAsync({}).sort({ _id: 1 })
  await imports.apply({ ...stage(imports, archive({ ...empty(), history: incoming })), sections: ['history'] }, {})
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), restored)
})

for (const times of [[30, 40], [30, 30], [40, 30]]) {
  test(`unified duplicate restores retain distinct documents after timestamps change fallback order (${times.join(', ')})`, async t => {
    const { engine, imports } = await fixture(t)
    const older = { _id: 'z', videoId: 'same', timeWatched: 10, watchProgress: 1, title: 'Saved older' }
    await engine.collections.history.insertAsync([older, { _id: 'a', videoId: 'same', timeWatched: 20, watchProgress: 2, title: 'Saved latest' }])
    const history = [{ _id: 'x', videoId: 'same', timeWatched: times[0], watchProgress: 30, isWatched: false, title: 'Distinct X' }, { _id: 'y', videoId: 'same', timeWatched: times[1], watchProgress: 40, isWatched: true, title: 'Distinct Y' }]
    const expected = [{ ...history[0], _id: 'a' }, history[1], older]
    for (let repeat = 0; repeat < 3; repeat++) {
      await imports.apply({ ...stage(imports, archive({ ...empty(), history })), sections: ['history'] }, {})
      assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), expected)
    }
  })
}

test('ID-less unified history occurrences remain separate and cannot replace identified rows', async t => {
  const { engine, imports } = await fixture(t)
  const saved = { _id: 'saved', videoId: 'same', timeWatched: 20, watchProgress: 2, title: 'Saved', isWatched: false }
  await engine.collections.history.insertAsync(saved)
  const identified = { _id: 'identified', videoId: 'same', timeWatched: 30, watchProgress: 3, title: 'Identified', isWatched: false, identifiedOnly: true }
  const idless = [{ videoId: 'same', timeWatched: 40, watchProgress: 4, title: 'ID-less first', isWatched: false }, { videoId: 'same', timeWatched: 50, watchProgress: 5, title: 'ID-less second', isWatched: true }]
  await imports.apply({ ...stage(imports, archive({ ...empty(), history: [...idless, identified] })), sections: ['history'] }, {})
  const first = await engine.collections.history.findAsync({}).sort({ _id: 1 })
  assert.equal(first.length, 4)
  assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'saved' }), saved)
  assert.deepEqual(await engine.collections.history.findOneAsync({ _id: 'identified' }), identified)
  for (const row of idless) assert.equal(first.filter(record => record.title === row.title).length, 1)
  // A record without an identity cannot be proved to be an existing occurrence.
  // Retaining another copy is safer than overwriting a distinct duplicate.
  await imports.apply({ ...stage(imports, archive({ ...empty(), history: [...idless, identified] })), sections: ['history'] }, {})
  const second = await engine.collections.history.findAsync({}).sort({ _id: 1 })
  assert.equal(second.length, 6)
  for (const row of first) assert.deepEqual(second.find(record => record._id === row._id), row)
})

test('invalid, truncated and checksum-corrupted old archives cannot change the active library', async t => {
  const { engine, imports } = await fixture(t)
  await engine.collections.history.insertAsync({ _id: 'safe', videoId: 'safe', timeWatched: 1 })
  const bytes = archive({ ...empty(), history: [{ videoId: 'new', timeWatched: 2 }] })
  const corrupt = bytes.slice()
  const directory = corrupt.findIndex((value, index) => value === 0x50 && corrupt[index + 1] === 0x4B && corrupt[index + 2] === 1 && corrupt[index + 3] === 2)
  corrupt[directory + 16] ^= 1
  assert.throws(() => stage(imports, corrupt), /checksum/)
  assert.throws(() => stage(imports, bytes.subarray(0, bytes.length - 15)), /ZIP|truncated/i)
  assert.throws(() => stage(imports, archive({ ...empty(), history: [{ videoId: 42, timeWatched: 1 }] })), /Invalid backup history/)
  assert.deepEqual((await engine.collections.history.findAsync({})).map(record => record._id), ['safe'])
  assert.equal(imports.jobs.size, 0)
})

test('an import persistence failure rolls back earlier selected sections and remains retryable', async t => {
  const { engine, imports } = await fixture(t)
  const data = { ...empty(), playlists: [{ _id: 'p', playlistName: 'New', videos: [{ videoId: 'v' }] }], profiles: [{ _id: 'profile', name: 'New profile', subscriptions: [] }] }
  const job = stage(imports, archive(data))
  const update = engine.collections.playlists.updateAsync
  engine.collections.playlists.updateAsync = () => { throw new Error('simulated disk failure') }
  await assert.rejects(imports.apply({ ...job, sections: ['profiles', 'playlists'] }, {}), /disk failure/)
  assert.equal(engine.collections.profiles.count(), 0)
  assert.equal(engine.collections.playlists.count(), 0)
  engine.collections.playlists.updateAsync = update
  await imports.apply({ ...job, sections: ['profiles', 'playlists'] }, {})
  assert.equal(engine.collections.profiles.count(), 1)
  assert.equal(engine.collections.playlists.count(), 1)
})


test('legacy record imports preserve distinct identified history occurrences across retries', async t => {
  const { engine, imports } = await fixture(t)
  const history = [
    { _id: 'first', videoId: 'same', title: 'First', timeWatched: 1, watchProgress: 5, isWatched: false, unknown: { keep: new Date(1) } },
    { _id: 'second', videoId: 'same', title: 'Second', timeWatched: 2, watchProgress: 10, isWatched: true, unknown: { keep: new Date(2) } },
  ]
  for (let iteration = 0; iteration < 2; iteration++) {
    const job = imports.start({ format: 'records' })
    imports.chunk({ ...job, section: 'history', records: structuredClone(history) })
    imports.finish(job)
    await imports.apply({ ...job, sections: ['history'] }, {})
    assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), history)
  }
})


test('post-commit staging cleanup failure does not report a successful import as failed', async t => {
  const { engine, imports } = await fixture(t)
  const job = stage(imports, archive({ ...empty(), history: [{ _id: 'saved', videoId: 'saved', timeWatched: 1, isWatched: false }] }))
  const cancel = imports.cancel.bind(imports)
  imports.cancel = data => { cancel(data); throw new Error('staging cleanup unavailable') }
  const warn = t.mock.method(console, 'warn', () => {})
  assert.deepEqual(await imports.apply({ ...job, sections: ['history'] }, {}), { settings: null })
  assert.deepEqual(await engine.collections.history.findAsync({}), [{ _id: 'saved', videoId: 'saved', timeWatched: 1, isWatched: false }])
  assert.equal(imports.jobs.has(job.id), false)
  assert.equal(warn.mock.calls.length, 1)
})

test('failed import setup closes its unregistered database and removes the stage', async t => {
  const { imports } = await fixture(t)
  const { DatabaseSync } = await import('node:sqlite')
  const { readdir } = await import('node:fs/promises')
  const exec = DatabaseSync.prototype.exec
  const failure = new Error('setup I/O failure')
  let failedDatabase
  let path
  t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    if (sql.startsWith('CREATE TABLE incoming')) {
      failedDatabase = this
      path = this.prepare('PRAGMA database_list').get().file
      throw failure
    }
    return Reflect.apply(exec, this, [sql])
  })
  t.after(() => { try { failedDatabase?.close() } catch {} })
  assert.throws(() => imports.start(), error => error === failure)
  assert.equal(imports.jobs.size, 0)
  assert.throws(() => failedDatabase.prepare('SELECT 1'), /not open|closed/i)
  assert.equal((await readdir(join(path, '../..'))).some(name => name.startsWith('library.sqlite.imports-')), false)
})

test('oversized archive chunks close their job and release the import capacity', async t => {
  const { imports } = await fixture(t)
  const { fstatSync } = await import('node:fs')
  const job = imports.start()
  const stage = imports.jobs.get(job.id)
  stage.bytes = 1024 * 1024 * 1024
  assert.throws(() => imports.chunk({ ...job, data: new Uint8Array([0]) }), /archive is too large/)
  assert.equal(imports.jobs.has(job.id), false)
  assert.throws(() => fstatSync(stage.fd), { code: 'EBADF' })
  assert.throws(() => stage.database.prepare('SELECT 1'), /not open|closed/i)
  await assert.rejects(readFile(join(stage.directory, 'staging.sqlite')), { code: 'ENOENT' })
  const next = imports.start()
  assert.equal(imports.jobs.has(next.id), true)
})

test('generated playlist backups preserve missing and null identities across repeated staged restores', async t => {
  const { engine, exports } = await fixture(t)
  const incoming = { _id: 'p', playlistName: 'Retained', videos: [
    { videoId: null, timeAdded: 10, unknown: 'null video' },
    { videoId: 'same', timeAdded: null, unknown: 'null time' },
    { playlistItemId: 'item', videoId: null, timeAdded: 20, unknown: 'null item video' },
  ] }
  const saved = { ...incoming, videos: [
    { timeAdded: 10, unknown: 'missing video' },
    { videoId: 'same', unknown: 'missing time' },
    { playlistItemId: 'item', timeAdded: 20, unknown: 'missing item video' },
  ] }
  await engine.collections.playlists.insertAsync(incoming)
  const job = exports.start({ settings: {} })
  const chunks = []
  for (;;) { const next = exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data.playlists, [incoming])
  const restored = await fixture(t)
  await restored.engine.collections.playlists.insertAsync(saved)
  for (let repeat = 0; repeat < 2; repeat++) {
    await restored.imports.apply({ ...stage(restored.imports, bytes, 7), sections: ['playlists'] }, {})
    assert.deepEqual(await restored.engine.playlistSnapshot({ id: 'p' }), { ...incoming, videos: [...saved.videos, ...incoming.videos] })
  }
  assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), incoming)
})

for (const name of ['Favorites', 'Watch Later', 'Custom']) {
  test(`records import preserves distinct playlist IDs sharing ${name}`, async t => {
    const existing = { _id: 'existing', playlistName: name, protected: true, videos: [{ videoId: 'old', playlistItemId: 'old-item' }] }
    const { engine, imports } = await fixture(t, [existing])
    const job = imports.start({ format: 'records' })
    imports.chunk({ ...job, section: 'playlists', records: [{ _id: 'incoming', playlistName: name, videos: [{ videoId: 'new' }] }] })
    imports.finish(job)
    await imports.apply({ ...job, sections: ['playlists'] }, {})
    assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: existing._id }), existing)
    const restored = await engine.collections.playlists.findOneAsync({ _id: 'incoming' })
    assert.equal(restored.playlistName, name)
    assert.equal(restored.protected, false)
    assert.equal(restored.videos[0].videoId, 'new')
    assert.equal(await engine.collections.playlists.countAsync({}), 2)
  })
}

for (const portable of [false, true]) {
  for (const [id, protectedValue] of [['favorites', false], ['watchLater', false], ['protected-custom', true]]) {
    test(`Takeout name matching preserves ${id} on ${portable ? 'portable' : 'desktop'} storage`, async t => {
      const original = { _id: id, playlistName: 'Shared name', protected: protectedValue, videos: [{ videoId: 'old', playlistItemId: 'old-item', timeAdded: 1 }], unknown: { keep: true } }
      const db = portable ? new Datastore({ inMemoryOnly: true }) : (await fixture(t, [original])).engine.collections.playlists
      if (portable) await db.insertAsync(original)
      let storage
      if (portable) storage = {
        find: () => db.findAsync({}), create: record => db.insertAsync(record), update: record => db.updateAsync({ _id: record._id }, { $set: record }),
      }
      else {
        const imports = new LibraryImports(db.engine)
        storage = { find: () => db.findAsync({}), importRecords: async (section, records) => {
          const job = imports.start({ format: 'records' })
          imports.chunk({ ...job, section, records })
          imports.finish(job)
          await imports.apply({ ...job, sections: [section] }, {})
        } }
      }
      const entry = { path: 'Shared name.csv', content: 'Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n' }
      for (let repeat = 0; repeat < 2; repeat++) {
        await importTakeoutPlaylist({ ...parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1)), playlistName: 'Shared name' }, storage)
        assert.deepEqual(await db.findOneAsync({ _id: id }), original)
        assert.equal(await db.countAsync({}), 2)
        const restored = (await db.findAsync({})).find(record => record._id !== id)
        assert.equal(restored.videos.length, 1)
        assert.equal(restored.videos[0].videoId, 'abcdefghijk')
      }
    })
  }
}

for (const phase of ['begin', 'constructor', 'snapshot', 'close-error']) {
  test(`export setup closes its read connection and retains the original ${phase} error`, async t => {
    const { engine, exports } = await fixture(t)
    const failure = new Error(`failed export ${phase}`)
    const originalExec = DatabaseSync.prototype.exec
    const originalPrepare = DatabaseSync.prototype.prepare
    const originalClose = DatabaseSync.prototype.close
    let opened
    t.after(() => { if (opened?.isOpen) originalClose.call(opened) })
    t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
      if (this !== engine.database && ((phase === 'begin' || phase === 'close-error') && sql === 'BEGIN' || phase === 'constructor' && sql.startsWith('CREATE TEMP TABLE'))) {
        opened = this
        throw failure
      }
      return originalExec.call(this, sql)
    })
    t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
      if (this !== engine.database && phase === 'snapshot' && sql === 'SELECT count FROM collection_counts LIMIT 1') {
        opened = this
        throw failure
      }
      return originalPrepare.call(this, sql)
    })
    if (phase === 'close-error') {
      t.mock.method(console, 'error', () => {})
      t.mock.method(DatabaseSync.prototype, 'close', function() {
        originalClose.call(this)
        if (this === opened) throw new Error('close also failed')
      })
    }
    assert.throws(() => exports.start({ settings: {} }), error => error === failure)
    assert.ok(opened)
    assert.equal(opened.isOpen, false)
    assert.equal(exports.jobs.size, 0)
    assert.equal(engine.database.isOpen, true)
    engine.compact()
  })
}


test('staged old backups keep literal markers when the manifest is the last ZIP entry', async t => {
  const { engine, imports } = await fixture(t)
  const data = { ...empty(), settings: { literal: { '$$date': 0 }, escaped: '$$literal' } }
  const files = Object.fromEntries(Object.entries(data).map(([key, value]) => [key + '.json', strToU8(JSON.stringify(value))]))
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'opentubex-backup', version: 1 }))
  const result = await imports.apply({ ...stage(imports, zipSync(files), 7), sections: ['settings'] }, {})
  assert.deepEqual(result.settings, data.settings)
  assert.equal(await engine.collections.history.countAsync({}), 0)
})


test('generated backups retain malformed identified watch statistics and allow unrelated sections to restore', async t => {
  const source = await fixture(t), target = await fixture(t)
  const records = [
    { _id: 'invalid-date', date: 'legacy', seconds: 42, unknown: new Date(1) },
    { _id: 'negative', date: '2026-10-09', seconds: -1, unknown: new Date(2) },
    { _id: 'string', date: '2026-10-10', seconds: 'retained', unknown: new Date(3) },
    { _id: 'missing', date: null, unknown: new Date(4) },
  ]
  const history = { _id: 'h', videoId: 'v', timeWatched: 1, isWatched: false }
  await source.engine.collections.watchStats.insertAsync(records)
  await source.engine.collections.history.insertAsync(history)
  const job = source.exports.start({ settings: {} }), chunks = []
  for (;;) { const next = source.exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  const data = (await readUnifiedBackup(new Blob([bytes]))).data
  assert.deepEqual(data.watchStats.records, records.toSorted((a, b) => model.compareThings(a._id, b._id)))
  await target.imports.apply({ ...stage(target.imports, bytes), sections: ['history'] }, {})
  assert.deepEqual(await target.engine.collections.history.findAsync({}), [history])
  assert.deepEqual(await target.engine.collections.watchStats.findAsync({}), [])
  assert.deepEqual(await source.engine.collections.watchStats.findAsync({}).sort({ _id: 1 }), data.watchStats.records)
})


for (const adjustment of ['retained', 42, false, [], new Date(1)]) {
  test(`generated backups retain legacy watch-stat adjustment ${model.serialize(adjustment)}`, async t => {
    const source = await fixture(t), target = await fixture(t)
    await source.engine.collections.watchStats.insertAsync({ _id: 'history-watch-time-v1', adjustment })
    const job = source.exports.start({ settings: {} }), chunks = []
    for (;;) { const next = source.exports.next(job); chunks.push(next.data); if (next.done) break }
    const bytes = Buffer.concat(chunks)
    assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data.watchStats.adjustment, adjustment)
    const imported = stage(target.imports, bytes)
    const helpers = await import('../../src/renderer/helpers/unifiedBackup.js')
    const base = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
    const bindings = { db: target.engine.collections, model, ...helpers }
    const WatchStats = compileFunction(base.slice(base.indexOf('class WatchStats {'), base.indexOf('class Profiles {')) + '\nreturn WatchStats', Object.keys(bindings))(...Object.values(bindings))
    await target.imports.apply({ ...imported, sections: ['watchStats'] }, { watchStats: WatchStats })
    assert.deepEqual((await target.engine.collections.watchStats.findOneAsync({ _id: 'history-watch-time-v1' })).adjustment, adjustment)
    assert.deepEqual((await source.engine.collections.watchStats.findOneAsync({ _id: 'history-watch-time-v1' })).adjustment, adjustment)
  })
}

for (const section of ['settings', 'watchStats']) {
  test(`records imports reject unavailable ${section} before applying any section`, async t => {
    const { engine, imports } = await fixture(t)
    const job = imports.start({ format: 'records' })
    imports.chunk({ ...job, section: 'playlists', records: [{ _id: 'p', playlistName: 'Incoming', videos: [] }] })
    imports.finish(job)
    await assert.rejects(imports.apply({ ...job, sections: ['playlists', section] }, {}), /Invalid library import selection/)
    assert.deepEqual(await engine.collections.playlists.findAsync({}), [])
  })
}


test('generated backups round trip every retained profile and playlist label shape', async t => {
  const labels = [undefined, null, false, 42, ['retained'], { future: true }, new Date(123)]
  const profiles = labels.map((name, index) => ({ _id: `label-${index}`, subscriptions: [], unknown: index, ...(name === undefined ? {} : { name }) }))
  const playlists = labels.map((playlistName, index) => ({ _id: `label-${index}`, videos: [], protected: false, unknown: index, ...(playlistName === undefined ? {} : { playlistName }) }))
  const source = await fixture(t, playlists, profiles)
  const originals = await Promise.all(['profiles.db', 'playlists.db'].map(file => readFile(join(source.path, file))))
  const job = source.exports.start({ sections: ['profiles', 'playlists'] }), chunks = []
  for (;;) { const next = source.exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data, { profiles, playlists })
  const target = await fixture(t)
  const portableProfiles = new Datastore({ inMemoryOnly: true }), portablePlaylists = new Datastore({ inMemoryOnly: true })
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const record of profiles) await portableProfiles.updateAsync({ _id: record._id }, mergeBackupProfile(await portableProfiles.findOneAsync({ _id: record._id }), record), { upsert: true })
    for (const record of playlists) await portablePlaylists.updateAsync({ _id: record._id }, mergeBackupPlaylist(await portablePlaylists.findOneAsync({ _id: record._id }), record), { upsert: true })
    assert.deepEqual(await portableProfiles.findAsync({}).sort({ _id: 1 }), profiles)
    assert.deepEqual(await portablePlaylists.findAsync({}).sort({ _id: 1 }), playlists)
    await target.imports.apply({ ...stage(target.imports, bytes, 7), sections: ['profiles', 'playlists'] }, {})
    assert.deepEqual(await target.engine.collections.profiles.findAsync({}).sort({ _id: 1 }), profiles)
    assert.deepEqual(await target.engine.collections.playlists.findAsync({}).sort({ _id: 1 }), playlists)
  }
  assert.deepEqual(await Promise.all(['profiles.db', 'playlists.db'].map(file => readFile(join(source.path, file)))), originals)
})

for (const manifestLast of [false, true]) {
  test(`staged backups validate decoded escaped records with manifest last: ${manifestLast}`, async t => {
    const data = {
      ...empty(),
      profiles: [{ _id: 'p', name: 'Retained', subscriptions: [], $$backupObject: 'literal' }],
      playlists: [{ _id: 'p', playlistName: 'Retained', videos: [], $$backupObject: 'literal' }],
      history: [{ _id: 'h', timeWatched: 1, $$backupObject: 'literal' }],
      searchHistory: [{ _id: 's', query: 'search', $$backupObject: 'literal' }],
      watchStats: { records: [], adjustment: null, $$backupObject: 'literal' },
    }
    let bytes = Buffer.from(await createUnifiedBackup(data).arrayBuffer())
    if (manifestLast) {
      const entries = unzipSync(bytes), manifest = entries['manifest.json']
      delete entries['manifest.json']
      bytes = zipSync({ ...entries, 'manifest.json': manifest })
    }
    assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data, data)
    const { engine, imports } = await fixture(t)
    const imported = stage(imports, bytes, 7), job = imports.jobs.get(imported.id)
    for (const section of ['profiles', 'playlists', 'history', 'searchHistory']) {
      assert.deepEqual(job.database.prepare('SELECT data FROM incoming WHERE section = ?').all(section).map(row => job.decode(row.data)), data[section])
    }
    assert.deepEqual(job.roots.get('watchStats'), data.watchStats)
    // An unsupported selected NeDB field must still fail atomically; unaffected sections remain restorable.
    await assert.rejects(imports.apply({ ...imported, sections: ['profiles'] }, {}), /cannot mix modifiers and normal fields/)
    assert.equal(engine.collections.profiles.count(), 0)
    await imports.apply({ ...imported, sections: ['settings'] }, {})
  })
}


test('staged decoded record validation rejects missing identity before any live write', async t => {
  const { engine, imports } = await fixture(t)
  const retained = { _id: 'retained', subscriptions: [], unknown: new Date(1) }
  await engine.collections.profiles.insertAsync(retained)
  const bytes = Buffer.from(await createUnifiedBackup({ profiles: [{ name: 'Missing identity', $$backupObject: 'literal' }] }).arrayBuffer())
  assert.throws(() => stage(imports, bytes, 7), /Invalid backup profiles/)
  assert.equal(imports.jobs.size, 0)
  assert.deepEqual(await engine.collections.profiles.findAsync({}), [retained])
})


test('streamed escaped records keep normalized arrays inside the codec envelope', async t => {
  const { engine, exports, imports } = await fixture(t)
  const original = { _id: 'escaped', playlistName: 'Retained', videos: [{ videoId: 'same', unknown: new Date(3) }, null, { videoId: 'same', unknown: new Date(4) }], unknown: new Date(2), $$backupObject: 'literal' }
  const stored = { ...original }; delete stored.$$backupObject
  await engine.collections.playlists.insertAsync(stored)
  const row = engine.prepare("SELECT data FROM records WHERE collection = 'playlists' AND id = ?").get(original._id)
  const metadata = JSON.parse(row.data)
  metadata.$$backupObject = original.$$backupObject
  engine.prepare("UPDATE records SET data = ? WHERE collection = 'playlists' AND id = ?").run(JSON.stringify(metadata), original._id)
  const job = exports.start({ sections: ['playlists'] }), chunks = []
  for (;;) { const next = exports.next(job); chunks.push(next.data); if (next.done) break }
  const bytes = Buffer.concat(chunks)
  assert.deepEqual((await readUnifiedBackup(new Blob([bytes]))).data.playlists, [original])
  const staged = stage(imports, bytes, 7)
  const incoming = imports.jobs.get(staged.id)
  assert.deepEqual(incoming.decode(incoming.database.prepare('SELECT data FROM incoming').get().data), original)
  assert.deepEqual(await engine.playlistSnapshot({ id: original._id }), original)
})


test('escaped history imports choose the decoded latest-occurrence fallback before writing', async t => {
  const { engine, imports } = await fixture(t)
  const current = { _id: 'local', videoId: 'same', timeWatched: 1, watchProgress: 10, unknown: new Date(1) }
  const incoming = { _id: 'incoming', videoId: 'same', timeWatched: 2, watchProgress: 20, $$backupObject: 'literal' }
  await engine.collections.history.insertAsync(current)
  const bytes = Buffer.from(await createUnifiedBackup({ history: [incoming] }).arrayBuffer())
  let target
  t.mock.method(engine.collections.history, 'updateAsync', async query => { target = query._id; throw new Error('stop before reserved-key write') })
  await assert.rejects(imports.apply({ ...stage(imports, bytes), sections: ['history'] }, {}), /stop before reserved-key write/)
  assert.equal(target, current._id)
  assert.deepEqual(await engine.collections.history.findAsync({}), [current])
})


for (const identity of [7, null, undefined]) {
  test(`history restores reserve exact IDs independently of video identity ${identity}`, async t => {
    const { engine, imports } = await fixture(t)
    const original = { _id: 'A', videoId: 'same', timeWatched: 1, watchProgress: 5, unknown: new Date(1) }
    await engine.collections.history.insertAsync(original)
    const incoming = [{ _id: 'B', videoId: 'same', timeWatched: 2, watchProgress: 10, imported: new Date(2) }, { _id: 'A', ...(identity === undefined ? {} : { videoId: identity }), timeWatched: 3, unknown: new Date(3) }]
    const expected = [{ ...mergeBackupHistoryRecord(original, migrateLegacyHistoryRecord(incoming[1])), _id: 'A' }, migrateLegacyHistoryRecord(incoming[0])]
    for (let repeat = 0; repeat < 2; repeat++) {
      await imports.apply({ ...stage(imports, Buffer.from(await createUnifiedBackup({ history: incoming }).arrayBuffer())), sections: ['history'] }, {})
      assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), expected)
    }
  })
}

for (const videoId of ['\ud800', '\udc00', 'x\ud800y']) {
  test(`history fallback preserves surrogate video identity ${JSON.stringify(videoId)}`, async t => {
    const { engine, imports } = await fixture(t)
    const original = { _id: 'target', videoId, timeWatched: 1, watchProgress: 5, unknown: new Date(1) }
    const other = { _id: 'replacement', videoId: videoId.toWellFormed(), timeWatched: 100, watchProgress: 90, unknown: new Date(2) }
    await engine.collections.history.insertAsync([original, other])
    const incoming = { _id: 'source', videoId, timeWatched: 2, watchProgress: 10, imported: new Date(3) }
    const expected = [other, { ...mergeBackupHistoryRecord(original, migrateLegacyHistoryRecord(incoming)), _id: original._id }]
    for (let repeat = 0; repeat < 2; repeat++) {
      await imports.apply({ ...stage(imports, Buffer.from(await createUnifiedBackup({ history: [incoming] }).arrayBuffer())), sections: ['history'] }, {})
      assert.deepEqual(await engine.collections.history.findAsync({}).sort({ _id: 1 }), expected)
    }
  })
}
