import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { zipSync, strToU8, unzipSync } from 'fflate'
import { openLibrary } from '../../src/datastores/sqlite/migration.js'
import { LibraryExports } from '../../src/datastores/sqlite/export.js'
import { LibraryImports } from '../../src/datastores/sqlite/import.js'
import { mergeBackupPlaylist, validateUnifiedBackup } from '../../src/renderer/helpers/unifiedBackup.js'
import { importTakeoutPlaylist } from '../../src/renderer/helpers/takeout-playlist-import.js'

async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'opentubex-library-backup-'))
  const engine = await openLibrary(path)
  const imports = new LibraryImports(engine)
  const exports = new LibraryExports(engine)
  t.after(async () => {
    for (const id of imports.jobs.keys()) imports.cancel({ id })
    for (const id of exports.jobs.keys()) exports.cancel({ id })
    engine.database.close()
    await rm(path, { recursive: true, force: true })
  })
  return { engine, imports, exports }
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

test('Takeout playlist imports retain off-page members, protection and stable identities on repeat imports', async t => {
  const { engine, imports } = await fixture(t)
  const saved = Array.from({ length: 200 }, (_, index) => ({ videoId: `saved-${index}`, playlistItemId: `saved-item-${index}`, timeAdded: index }))
  saved.push({ videoId: 'abcdefghijk', playlistItemId: 'existing-csv-member', timeAdded: Date.parse('2025-01-01T00:00:00Z') })
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Shared name', protected: true, future: { keep: true }, videos: saved })
  const storage = {
    importRecords: async (section, records) => {
      const job = imports.start({ format: 'records' })
      imports.chunk({ ...job, section, records: structuredClone(records) })
      imports.finish(job)
      await imports.apply({ ...job, sections: [section] }, {})
    },
  }
  const entry = { path: 'Takeout/YouTube/playlists/Shared name.csv', content: 'Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\nmnopqrstuvw,2025-01-02T00:00:00Z\n' }
  await importTakeoutPlaylist(entry, 'Shared name', storage)
  let playlist = await engine.playlistSnapshot({ id: 'p' })
  assert.equal(playlist.videos.length, saved.length + 1)
  assert.deepEqual(playlist.videos.slice(0, saved.length), saved)
  assert.equal(playlist.protected, true)
  assert.deepEqual(playlist.future, { keep: true })
  assert.equal(typeof playlist.videos.at(-1).playlistItemId, 'string')
  const identities = playlist.videos.map(video => video.playlistItemId)
  await importTakeoutPlaylist(entry, 'Shared name', storage)
  playlist = await engine.playlistSnapshot({ id: 'p' })
  assert.deepEqual(playlist.videos.map(video => video.playlistItemId), identities)
  await importTakeoutPlaylist(entry, 'New imported playlist', storage)
  const created = await engine.collections.playlists.findOneAsync({ playlistName: 'New imported playlist' })
  assert.equal(created.videos.length, 2)
  assert.equal(created.protected, false)
  assert.ok(Number.isFinite(created.createdAt))
  assert.ok(created.videos.every(video => typeof video.playlistItemId === 'string'))
  await importTakeoutPlaylist(entry, 'New imported playlist', storage)
  assert.deepEqual((await engine.playlistSnapshot({ id: created._id })).videos, created.videos)
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
  assert.deepEqual(playlist.videos.map(video => video.videoId), ['first', 'different'])
  assert.equal(playlist.protected, true)
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
  const data = Object.fromEntries(Object.entries(contents).filter(([key]) => key !== 'manifest.json').map(([key, value]) => [key.slice(0, -5), JSON.parse(new TextDecoder().decode(value))]))
  validateUnifiedBackup(data)
  assert.equal(JSON.parse(new TextDecoder().decode(contents['manifest.json'])).version, 1)
  assert.equal(data.playlists[0].playlistName, 'Large')
  assert.equal(data.playlists[0].videos.length, 20000)
  assert.equal(data.playlists[0].videos[0].timeAdded, new Date(0).toISOString())
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
  assert.throws(() => stage(imports, archive({ ...empty(), history: [{ videoId: 'bad', timeWatched: -1 }] })), /Invalid backup history/)
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
