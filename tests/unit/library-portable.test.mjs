import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import Datastore from '@seald-io/nedb'
import model from '@seald-io/nedb/lib/model.js'
import * as historyHelpers from '../../src/history.js'
import { createIdQuery } from '../../src/datastores/idQuery.js'
import { createRecommendationStore } from '../../src/datastores/recommendations.js'
import { createPortableLibrary } from '../../src/datastores/handlers/library-web.js'

async function fixture(newestWatched) {
  const db = Object.fromEntries(['history', 'playlists', 'settings', 'recommendations']
    .map(name => [name, new Datastore({ inMemoryOnly: true })]))
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  const source = (await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replace(/^export \{[\s\S]*?\}\n/gm, '')
  const dependencies = { db, model, createRecommendationStore, createIdQuery, ...historyHelpers }
  const handlers = compileFunction(source + '\nreturn { history: History, playlists: Playlists }', Object.keys(dependencies))(...Object.values(dependencies))
  const records = [
    { _id: 'z-old', videoId: 'repeated', timeWatched: 1000, isWatched: !newestWatched, lengthSeconds: 600, watchProgress: 456, unknown: { keep: new Date(1) } },
    { _id: 'a-new', videoId: 'repeated', timeWatched: 2000, isWatched: newestWatched, lengthSeconds: 120, watchProgress: 12, unknown: ['keep'] },
    { _id: 'explicit', videoId: 'explicit', timeWatched: 3000, isWatched: true, lengthSeconds: 900 },
  ]
  const playlist = { _id: 'p', unknown: { keep: new Date(2) }, lastUpdatedAt: 1, videos: [
    { videoId: 'repeated', playlistItemId: 'first', unknown: { keep: 1 } },
    { videoId: 'repeated', playlistItemId: 'second', unknown: { keep: 2 } },
    { videoId: 'explicit', playlistItemId: 'duration', lengthSeconds: 30 },
    { videoId: 'missing', playlistItemId: 'missing' },
  ] }
  await db.history.insertAsync(records)
  await db.playlists.insertAsync(playlist)
  assert.deepEqual((await handlers.history.find()).map(record => record._id), ['explicit', 'a-new', 'z-old'])
  return { db, library: createPortableLibrary(handlers), records, playlist }
}

for (const value of [undefined, null, false, 42, 'retained', { unknown: new Date(1) }, new Date(2)]) {
  test(`portable playlist queries preserve a non-array membership: ${String(value)}`, async t => {
    const { db, library, records } = await fixture(false)
    const playlist = { _id: 'p', playlistName: 'Retained', unknown: new Date(3), ...(value === undefined ? {} : { videos: value }) }
    await db.playlists.updateAsync({ _id: 'p' }, playlist)
    t.mock.method(db.playlists, 'updateAsync', () => assert.fail('a read or empty cleanup must not rewrite the retained value'))
    assert.deepEqual(await library.query('playlistSummaries'), [{ ...playlist, videoCount: 0, firstVideo: null, videos: [] }])
    assert.deepEqual(await library.query('playlistSnapshot', { id: 'p' }), playlist)
    const page = await library.query('playlistPage', { id: 'p' })
    assert.deepEqual(page.records, [])
    assert.equal(page.cursor, null)
    assert.deepEqual(await library.query('playlistStatistics', { id: 'p' }), { total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 })
    for (const mode of ['watched', 'duplicates']) assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode }), 0)
    assert.equal(await library.query('reorderPlaylistMembers', { id: 'p', revision: page.revision, memberIds: [] }), false)
    await assert.rejects(library.query('movePlaylistMember', { id: 'p', revision: page.revision, memberId: '0', direction: 1 }), /member no longer exists/)
    assert.deepEqual((await library.query('videoState', { ids: ['repeated'] })).memberships, [])
    assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
    assert.deepEqual(await db.history.findAsync({}).sort({ timeWatched: 1 }), records)
  })
}

for (const videoId of [undefined, null]) {
  test(`portable watched cleanup preserves context for unidentified ${videoId} history`, async () => {
    const { db, library } = await fixture(false)
    const videos = [videoId, 'identified', 42, false].map((videoId, index) => ({ ...(videoId === undefined ? {} : { videoId }), playlistItemId: String(index), unknown: new Date(index) }))
    const records = videos.map((video, index) => ({ _id: String(index), ...(Object.hasOwn(video, 'videoId') ? { videoId: video.videoId } : {}), timeWatched: 1, isWatched: true, watchProgress: 123, unknown: new Date(index), lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: video.playlistItemId }))
    await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos } })
    await db.history.removeAsync({}, { multi: true })
    await db.history.insertAsync(records)
    assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'watched' }), 4)
    assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, [])
    assert.deepEqual(await db.history.findOneAsync({ _id: '0' }), records[0])
    for (const record of records.slice(1)) {
      const { lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId, ...retained } = record
      assert.deepEqual(await db.history.findOneAsync({ _id: record._id }), retained)
    }
  })
}

for (const mode of ['watched', 'duplicates']) {
  test(`portable ${mode} cleanup performs no writes when nothing is removed`, async t => {
    const { db, library } = await fixture(false)
    const playlist = { _id: 'p', lastUpdatedAt: 1, unknown: new Date(1), videos: [{ videoId: 'first' }, { videoId: 'second' }] }
    await db.playlists.updateAsync({ _id: 'p' }, playlist)
    const history = await db.history.findAsync({}).sort({ _id: 1 })
    t.mock.method(db.playlists, 'updateAsync', () => assert.fail('a no-op must not write or advance lastUpdatedAt'))
    t.mock.method(db.history, 'updateAsync', () => assert.fail('a no-op must not edit history context'))
    assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode }), 0)
    assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
    assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), history)
  })
}

test('portable duplicate cleanup preserves every unidentified or object-valued member', async () => {
  const { db, library } = await fixture(false)
  const videos = [undefined, undefined, null, null, { retained: true }, { retained: true }, 42, 42, false, false].map((videoId, index) => ({ ...(videoId === undefined ? {} : { videoId }), playlistItemId: String(index), unknown: new Date(index) }))
  const playlist = { _id: 'p', videos, lastUpdatedAt: 1, unknown: new Date(1) }
  await db.playlists.updateAsync({ _id: 'p' }, playlist)
  const before = await db.history.findAsync({}).sort({ _id: 1 })
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), 2)
  const saved = await db.playlists.findOneAsync({ _id: 'p' })
  assert.deepEqual(saved, { ...playlist, lastUpdatedAt: saved.lastUpdatedAt, videos: videos.filter((_, i) => i !== 7 && i !== 9) })
  assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), before)
})

for (const mode of [undefined, null, '', 'duplicate', 'unknown']) {
  test(`portable cleanup rejects invalid mode ${mode} without changing playlist or history`, async () => {
    const { db, library, playlist, records } = await fixture(false)
    await assert.rejects(library.query('cleanupPlaylist', { id: 'p', mode }), /Invalid playlist cleanup mode/)
    assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
    assert.deepEqual(await db.history.findAsync({}).sort({ timeWatched: 1 }), records)
  })
}

test('portable video state and duration sorting use descending Unicode record IDs for tied history', async () => {
  const { db, library } = await fixture(false)
  await db.history.removeAsync({}, { multi: true })
  const records = [{ _id: '😀', videoId: 'repeated', timeWatched: 2, lengthSeconds: 600, isWatched: true }, { _id: '\uE000', videoId: 'repeated', timeWatched: 2, lengthSeconds: 120, isWatched: false }]
  await db.history.insertAsync(records)
  assert.deepEqual((await library.query('videoState', { ids: ['repeated'] })).history, [records[1]])
  assert.equal((await library.query('playlistStatistics', { id: 'p' })).watchedCount, 0)
  const page = await library.query('playlistPage', { id: 'p', sort: 'video_duration_asc' })
  assert.equal(page.records.find(video => video.videoId === 'repeated').lengthSeconds, 120)
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'watched' }), 0)
  assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), records)
})

for (const newestWatched of [false, true]) {
  test(`portable playlist statistics use the newest history occurrence when watched=${newestWatched}`, async () => {
    const { db, library, records, playlist } = await fixture(newestWatched)
    assert.deepEqual(await library.query('playlistStatistics', { id: 'p' }), {
      total: 4, uniqueCount: 3, duration: 270, missingDuration: 1, watchedCount: newestWatched ? 3 : 1,
    })
    assert.deepEqual(await db.history.findAsync({}).sort({ timeWatched: 1 }), records)
    assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
  })

  test(`portable watched cleanup uses the newest history occurrence when watched=${newestWatched}`, async () => {
    const { db, library, records, playlist } = await fixture(newestWatched)
    assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'watched' }), newestWatched ? 3 : 1)
    const saved = await db.playlists.findOneAsync({ _id: 'p' })
    assert.equal(typeof saved.lastUpdatedAt, 'number')
    assert.ok(saved.lastUpdatedAt > playlist.lastUpdatedAt)
    assert.deepEqual(saved, {
      ...playlist, lastUpdatedAt: saved.lastUpdatedAt,
      videos: newestWatched ? [playlist.videos[3]] : [playlist.videos[0], playlist.videos[1], playlist.videos[3]],
    })
    assert.deepEqual(await db.history.findAsync({}).sort({ timeWatched: 1 }), records)
  })
}

test('portable duplicate cleanup keeps the first member independently of history watched state', async () => {
  const { db, library, records, playlist } = await fixture(true)
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), 1)
  const saved = await db.playlists.findOneAsync({ _id: 'p' })
  assert.deepEqual(saved, { ...playlist, lastUpdatedAt: saved.lastUpdatedAt, videos: [playlist.videos[0], playlist.videos[2], playlist.videos[3]] })
  assert.deepEqual(await db.history.findAsync({}).sort({ timeWatched: 1 }), records)
})

test('portable video state returns only the newest history occurrence for each requested video', async () => {
  const { db, library, records, playlist } = await fixture(false)
  assert.deepEqual(await library.query('videoState', { ids: ['repeated', 'explicit', 'missing', 'repeated'] }), {
    history: [records[2], records[1]],
    memberships: [
      { videoId: 'repeated', playlistId: 'p', count: 2 },
      { videoId: 'explicit', playlistId: 'p', count: 1 },
      { videoId: 'missing', playlistId: 'p', count: 1 },
    ],
  })
  assert.deepEqual(await library.query('videoState', { ids: [] }), { history: [], memberships: [] })
  assert.deepEqual(await db.history.findAsync({}).sort({ timeWatched: 1 }), records)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
})

test('portable duplicate cleanup preserves legacy playlist context when an occurrence survives', async () => {
  const { db, library } = await fixture(false)
  for (const item of [undefined, null, 'first', 'second']) {
    await db.history.insertAsync({ _id: `context-${String(item)}`, videoId: 'repeated', lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', ...(item === undefined ? {} : { lastViewedPlaylistItemId: item }), watchProgress: 123, unknown: new Date(1) })
  }
  const before = await db.history.findAsync({}).sort({ _id: 1 })
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), 1)
  const expected = before.map(record => {
    if (record._id !== 'context-second') return record
    const { lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId, ...retained } = record
    return retained
  })
  assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), expected)
})

for (const playlistItemId of [undefined, null]) {
  test(`portable duplicate cleanup preserves ambiguous context when a surviving legacy member ID is ${playlistItemId}`, async () => {
    const { db, library, playlist } = await fixture(false)
    const first = { ...playlist.videos[0], playlistItemId }
    await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos: [first, ...playlist.videos.slice(1)] } })
    const record = { _id: 'context', videoId: 'repeated', lastViewedPlaylistId: 'p', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'second', watchProgress: 123, unknown: new Date(1) }
    await db.history.insertAsync(record)
    assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), 1)
    assert.deepEqual(await db.history.findOneAsync({ _id: record._id }), record)
  })
}

test('portable positional playlist moves and reorders reject a changed membership snapshot', async () => {
  const { db, library, playlist } = await fixture(false)
  const page = await library.query('playlistPage', { id: 'p', limit: 2 })
  const concurrent = { ...playlist, videos: [playlist.videos[1], playlist.videos[0], ...playlist.videos.slice(2)] }
  await db.playlists.updateAsync({ _id: 'p' }, concurrent)
  for (const [method, options] of [
    ['movePlaylistMember', { memberId: page.records[0]._libraryMemberId, direction: 'bottom' }],
    ['reorderPlaylistMembers', { memberIds: page.records.map(video => video._libraryMemberId).toReversed() }],
  ]) {
    await assert.rejects(library.query(method, { id: 'p', revision: page.revision, ...options }), /playlist changed/)
    assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), concurrent)
  }
  assert.deepEqual(await library.query('playlistPage', { id: 'p', cursor: page.cursor }), { stale: true })
})

test('portable playlist edits validate every positional member before changing data', async () => {
  const { db, library, playlist } = await fixture(false)
  const page = await library.query('playlistPage', { id: 'p' })
  for (const memberId of ['4', '-1', '1.5', '', '01', 'NaN']) {
    await assert.rejects(library.query('movePlaylistMember', { id: 'p', memberId, direction: 'top', revision: page.revision }), /member/)
    await assert.rejects(library.query('reorderPlaylistMembers', { id: 'p', memberIds: ['0', memberId], revision: page.revision }), /member/)
  }
  await assert.rejects(library.query('reorderPlaylistMembers', { id: 'p', memberIds: ['0', '0'], revision: page.revision }), /member/)
  await assert.rejects(library.query('movePlaylistMember', { id: 'p', memberId: '0', direction: 2, revision: page.revision }), /move/)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
})

test('portable playlist writes reject changes made between reading and the atomic update', async t => {
  const { db, library, playlist } = await fixture(false)
  const page = await library.query('playlistPage', { id: 'p' })
  const update = db.playlists.updateAsync.bind(db.playlists)
  const concurrent = { ...playlist, description: 'Concurrent metadata', videos: [...playlist.videos, { videoId: 'concurrent', unknown: new Date(12) }] }
  t.mock.method(db.playlists, 'updateAsync', async (...args) => {
    await update({ _id: 'p' }, concurrent)
    return update(...args)
  })
  await assert.rejects(library.query('movePlaylistMember', { id: 'p', memberId: '0', direction: 'bottom', revision: page.revision }), /playlist changed/)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), concurrent)
})

test('portable duration sorting uses the newest history duration without modifying either collection', async () => {
  const { db, library, records, playlist } = await fixture(false)
  for (const direction of ['ascending', 'descending']) {
    const page = await library.query('playlistPage', { id: 'p', sort: `video_duration_${direction}` })
    const expected = direction === 'ascending' ? ['missing', 'duration', 'first', 'second'] : ['first', 'second', 'duration', 'missing']
    assert.deepEqual(page.records.map(video => video.playlistItemId), expected)
  }
  assert.deepEqual(await db.history.findAsync({}).sort({ timeWatched: 1 }), records)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
})

test('portable atomic edits compare canonical members with freshly omitted fields and Date values', async () => {
  const { db, library, playlist } = await fixture(false)
  const videos = playlist.videos.map(video => ({ ...video, missing: undefined, date: new Date(1) }))
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos } })
  const page = await library.query('playlistPage', { id: 'p' })
  assert.equal(await library.query('movePlaylistMember', { id: 'p', memberId: '0', direction: 'bottom', revision: page.revision }), true)
  assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, [...videos.slice(1), videos[0]])
})

for (const change of ['insert', 'delete', 'move']) {
  test(`portable history pagination rejects a cursor after a concurrent ${change}`, async () => {
    const { db, library } = await fixture(false)
    const page = await library.query('historyPage', { limit: 2 })
    assert.ok(page.cursor)
    if (change === 'insert') await db.history.insertAsync({ _id: 'concurrent', videoId: 'new', timeWatched: 4000, unknown: new Date(2) })
    if (change === 'delete') await db.history.removeAsync({ _id: 'explicit' })
    if (change === 'move') await db.history.updateAsync({ _id: 'z-old' }, { $set: { timeWatched: 5000 } })
    const before = await db.history.findAsync({}).sort({ _id: 1 })
    assert.deepEqual(await library.query('historyPage', { cursor: page.cursor }), { stale: true })
    assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), before)
  })
}

test('portable history and playlist cursors bind the complete view options', async () => {
  const { db, library, playlist } = await fixture(false)
  await db.playlists.insertAsync({ ...playlist, _id: 'other' })
  const historyPage = await library.query('historyPage', { limit: 1 })
  const playlistPage = await library.query('playlistPage', { id: 'p', limit: 1 })
  for (const options of [{ oldest: true }, { query: 'repeated' }, { caseSensitive: true }, { locale: 'de-DE' }]) {
    assert.deepEqual(await library.query('historyPage', { ...options, cursor: historyPage.cursor }), { stale: true })
  }
  for (const options of [{ sort: 'video_title_ascending' }, { query: 'missing' }, { reverse: true }, { locale: 'de-DE' }, { id: 'other' }]) {
    assert.deepEqual(await library.query('playlistPage', { id: 'p', ...options, cursor: playlistPage.cursor }), { stale: true })
  }
  assert.deepEqual((await library.query('historyPage', { limit: 1, cursor: historyPage.cursor })).records.map(record => record._id), ['a-new'])
  assert.deepEqual((await library.query('playlistPage', { id: 'p', limit: 1, cursor: playlistPage.cursor })).records.map(record => record.playlistItemId), ['second'])
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
})

test('portable duration page cursors reject changes to their history fallback', async () => {
  const { db, library } = await fixture(false)
  const page = await library.query('playlistPage', { id: 'p', sort: 'video_duration_ascending', limit: 2 })
  await db.history.updateAsync({ _id: 'a-new' }, { $set: { lengthSeconds: 10 } })
  assert.deepEqual(await library.query('playlistPage', { id: 'p', sort: 'video_duration_ascending', cursor: page.cursor }), { stale: true })
})

test('portable playlist paging sorts an unchanged view once and returns independent page copies', async t => {
  const { db, library, playlist } = await fixture(false)
  const videos = Array.from({ length: 300 }, (_, index) => ({ videoId: String(index), title: String(300 - index).padStart(3, '0'), unknown: { date: new Date(index) } }))
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos } })
  const Collator = Intl.Collator
  let sorts = 0
  t.mock.method(Intl, 'Collator', function (...args) { sorts++; return new Collator(...args) })
  const options = { id: 'p', sort: 'video_title_ascending', limit: 100 }
  const first = await library.query('playlistPage', options)
  first.records[0].unknown.date = 'caller edit'
  const second = await library.query('playlistPage', { ...options, cursor: first.cursor })
  const third = await library.query('playlistPage', { ...options, cursor: second.cursor })
  assert.equal(sorts, 1, 'continuing the same revision and view must not sort every playlist member again')
  assert.deepEqual([...first.records, ...second.records, ...third.records].map(record => record.videoId), videos.toReversed().map(record => record.videoId))
  assert.deepEqual((await library.query('playlistPage', options)).records[0].unknown.date, new Date(299))
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), { ...playlist, videos })
})

test('mounted portable playlist statistics tolerate opaque members and follow in-place edits', async t => {
  const { reactive, watch, ref, nextTick } = await import('vue')
  const { setImmediate } = await import('node:timers/promises')
  const { db, library, playlist } = await fixture(false)
  const original = { ...playlist, videos: [null, false, 42, 'retained', ...playlist.videos] }
  await db.playlists.updateAsync({ _id: 'p' }, original)
  const history = await db.history.findAsync({}).sort({ _id: 1 })
  const cached = reactive(structuredClone(original))
  const state = reactive({ history: { historyRevision: 0 }, playlists: [cached] })
  const store = { state, getters: { getPlaylist: () => state.playlists.find(playlist => playlist._id === 'p') } }
  let queries = 0
  const observedLibrary = { query: (...args) => { queries++; return library.query(...args) } }
  const source = (await readFile(new URL('../../src/renderer/composables/usePlaylistStatistics.js', import.meta.url), 'utf8'))
    .replace(/^import.*\n/gm, '').replace('export function', 'function')
  const stops = []
  const useStatistics = compileFunction(source + '\nreturn usePlaylistStatistics', ['ref', 'watch', 'DBLibraryHandlers', 'onScopeDispose'])(ref, (...args) => {
    const stop = watch(...args); stops.push(stop); return stop
  }, observedLibrary, callback => t.after(callback))
  t.after(() => stops.forEach(stop => stop()))
  const statistics = useStatistics(store, () => 'p', () => true)
  const settle = async () => { await nextTick(); await setImmediate() }
  await settle()
  assert.deepEqual(statistics.value, { total: 8, uniqueCount: 7, duration: 270, missingDuration: 5, watchedCount: 1 })
  assert.equal(queries, 1)
  state.playlists = [structuredClone(original), { _id: 'unrelated', videos: [] }]
  await settle()
  assert.equal(queries, 1, 'an unchanged playlist must not be queried after unrelated store replacements')
  state.playlists = [cached]
  await settle()
  assert.equal(queries, 1)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), original)
  const added = { videoId: 'added', lengthSeconds: 15, unknown: new Date(2) }
  await db.playlists.updateAsync({ _id: 'p' }, { $push: { videos: added } })
  cached.videos.push(added)
  await settle()
  assert.equal(statistics.value.total, 9)
  assert.equal(statistics.value.duration, 285)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), { ...original, videos: [...original.videos, added] })
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos: [...original.videos, { ...added, lengthSeconds: 25 }] } })
  cached.videos.at(-1).lengthSeconds = 25
  await settle()
  assert.equal(statistics.value.duration, 295)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), { ...original, videos: [...original.videos, { ...added, lengthSeconds: 25 }] })
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos: original.videos.slice(1) } })
  cached.videos.splice(0, 1)
  cached.videos.pop()
  await settle()
  assert.equal(statistics.value.total, 7)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), { ...original, videos: original.videos.slice(1) })
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos: [] } })
  cached.videos = []
  await settle()
  assert.deepEqual(statistics.value, { total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 })
  const typed = [{ unknown: new Date(3) }, { videoId: null, lengthSeconds: 1 }]
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos: typed } })
  cached.videos = typed
  await settle()
  assert.equal(statistics.value.uniqueCount, 2)
  const beforeIdentityChangeQueries = queries
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos: typed.map(video => ({ ...video, videoId: null })) } })
  cached.videos[0].videoId = null
  await settle()
  assert.equal(statistics.value.uniqueCount, 2, 'cleanup preserves both unidentified occurrences')
  assert.equal(queries, beforeIdentityChangeQueries + 1, 'missing and null identities must remain distinct in the change signature')
  assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, typed.map(video => ({ ...video, videoId: null })))
  assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), history)
})

test('portable statistics validate retained durations without rewriting imported values', async () => {
  const { db, library } = await fixture(false)
  const videos = [
    { videoId: 'repeated', lengthSeconds: -1, unknown: new Date(2) },
    { videoId: 'repeated', lengthSeconds: '300' },
    { videoId: 'repeated', lengthSeconds: 0 },
    { videoId: 'bad-history' },
    { videoId: 'missing', lengthSeconds: '90' },
    { videoId: 'explicit', lengthSeconds: 30 },
  ]
  await db.playlists.updateAsync({ _id: 'p' }, { $set: { videos } })
  await db.history.insertAsync({ _id: 'invalid-duration', videoId: 'bad-history', lengthSeconds: '500', timeWatched: 4000 })
  const before = await db.history.findAsync({}).sort({ _id: 1 })
  assert.deepEqual(await library.query('playlistStatistics', { id: 'p' }), { total: 6, uniqueCount: 4, duration: 390, missingDuration: 2, watchedCount: 1 })
  assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, videos)
  assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), before)
})

test('disabled statistics clear the previous playlist and ignore its suspended read', async t => {
  const { reactive, watch, ref, nextTick } = await import('vue')
  const { setImmediate } = await import('node:timers/promises')
  const source = (await readFile(new URL('../../src/renderer/composables/usePlaylistStatistics.js', import.meta.url), 'utf8'))
    .replace(/^import.*\n/gm, '').replace('export function', 'function')
  const stops = [], pending = Promise.withResolvers()
  let calls = 0
  const query = () => ++calls === 1 ? Promise.resolve({ total: 1, uniqueCount: 1, duration: 20, missingDuration: 0, watchedCount: 0 }) : pending.promise
  const useStatistics = compileFunction(source + '\nreturn usePlaylistStatistics', ['ref', 'watch', 'DBLibraryHandlers', 'onScopeDispose'])(ref, (...args) => {
    const stop = watch(...args); stops.push(stop); return stop
  }, { query }, callback => t.after(callback))
  t.after(() => stops.forEach(stop => stop()))
  const state = reactive({ history: { historyRevision: 0 } }), id = ref('p'), enabled = ref(true)
  const statistics = useStatistics({ state, getters: { getPlaylist: () => ({ videos: [] }) } }, () => id.value, () => enabled.value)
  const settle = async () => { await nextTick(); await setImmediate() }
  await settle(); assert.equal(statistics.value.total, 1)
  state.history.historyRevision++
  await nextTick()
  enabled.value = false
  await settle()
  const empty = { total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 }
  assert.deepEqual(statistics.value, empty)
  pending.resolve({ total: 100, uniqueCount: 100, duration: 1000, missingDuration: 0, watchedCount: 0 })
  await settle(); assert.deepEqual(statistics.value, empty)
  id.value = null; enabled.value = true
  await settle(); assert.deepEqual(statistics.value, empty)
  assert.equal(calls, 2)
})

for (const method of ['playlistStatistics', 'videoState', 'cleanupPlaylist:watched', 'cleanupPlaylist:duplicates']) {
  test(`portable ${method} handles retained null and primitive playlist members without losing data`, async () => {
    const { db, library, playlist } = await fixture(false)
    const unidentified = [null, false, 42, 'legacy', null]
    const videos = [...unidentified, ...playlist.videos]
    const original = { ...playlist, videos }
    await db.playlists.updateAsync({ _id: 'p' }, original)
    await db.history.insertAsync({ _id: 'unidentified', timeWatched: 4000, isWatched: true, lengthSeconds: 999, lastViewedPlaylistId: 'p', unknown: new Date(3) })
    const history = await db.history.findAsync({}).sort({ _id: 1 })
    if (method === 'playlistStatistics') {
      assert.deepEqual(await library.query(method, { id: 'p' }), {
        total: 9, uniqueCount: 8, duration: 270, missingDuration: 6, watchedCount: 1,
      })
    } else if (method === 'videoState') {
      const state = await library.query(method, { ids: ['repeated', 'explicit', 'missing'] })
      assert.deepEqual(state.memberships, [
        { videoId: 'repeated', playlistId: 'p', count: 2 },
        { videoId: 'explicit', playlistId: 'p', count: 1 },
        { videoId: 'missing', playlistId: 'p', count: 1 },
      ])
      assert.deepEqual(state.history, [history.find(record => record.videoId === 'explicit'), history.find(record => record._id === 'a-new')])
    } else {
      const mode = method.split(':')[1]
      assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode }), 1)
      const saved = await db.playlists.findOneAsync({ _id: 'p' })
      assert.deepEqual(saved, { ...original, lastUpdatedAt: saved.lastUpdatedAt, videos: videos.filter((_, index) => index !== (mode === 'watched' ? 7 : 6)) })
    }
    if (!method.startsWith('cleanupPlaylist')) assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), original)
    assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), history)
  })
}

test('portable playlist search ignores non-string titles and authors without changing retained members', async () => {
  const { db, library, playlist } = await fixture(false)
  const videos = [
    null, { videoId: 'number', title: 42, author: false },
    { videoId: 'object', title: { keep: true }, author: ['legacy'] },
    { videoId: 'title', title: 'Needle title', author: 1 },
    { videoId: 'author', title: false, author: 'Needle author' },
  ]
  const original = { ...playlist, videos }
  await db.playlists.updateAsync({ _id: 'p' }, original)
  const page = await library.query('playlistPage', { id: 'p', query: 'NEEDLE' })
  assert.deepEqual(page.records, videos.slice(3).map((video, index) => ({ ...video, _libraryMemberId: String(index + 3) })))
  assert.deepEqual((await library.query('playlistPage', { id: 'p', query: 'unmatched' })).records, [])
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), original)
})


test('switching enabled playlists clears old statistics before a failed read', async t => {
  const { reactive, watch, ref, nextTick } = await import('vue')
  const { setImmediate } = await import('node:timers/promises')
  const { db, library, playlist } = await fixture(false)
  const other = { ...playlist, _id: 'other', videos: [{ videoId: 'missing' }] }
  await db.playlists.insertAsync(other)
  const before = await db.playlists.findAsync({}).sort({ _id: 1 })
  const source = (await readFile(new URL('../../src/renderer/composables/usePlaylistStatistics.js', import.meta.url), 'utf8'))
    .replace(/^import.*\n/gm, '').replace('export function', 'function')
  const stops = [], pending = Promise.withResolvers()
  const errors = []
  const useStatistics = compileFunction(source + '\nreturn usePlaylistStatistics', ['ref', 'watch', 'DBLibraryHandlers', 'console', 'onScopeDispose'])(ref, (...args) => {
    const stop = watch(...args); stops.push(stop); return stop
  }, { query: (method, options) => options.id === 'other' ? pending.promise : library.query(method, options) }, { error: error => errors.push(error.message) }, callback => t.after(callback))
  t.after(() => stops.forEach(stop => stop()))
  const state = reactive({ history: { historyRevision: 0 } }), id = ref('p')
  const statistics = useStatistics({ state, getters: { getPlaylist: () => ({ videos: [] }) } }, () => id.value, () => true)
  const settle = async () => { await nextTick(); await setImmediate() }
  await settle()
  assert.equal(statistics.value.total, 4)
  id.value = 'other'
  await nextTick()
  const empty = { total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 }
  assert.deepEqual(statistics.value, empty, 'the new playlist must never display the previous playlist statistics')
  pending.reject(new Error('statistics unavailable'))
  await settle()
  assert.deepEqual(statistics.value, empty)
  assert.deepEqual(errors, ['statistics unavailable'])
  assert.deepEqual(await db.playlists.findAsync({}).sort({ _id: 1 }), before)
})

test('failed visible-card hydration retains its batch for the next explicit refresh', async t => {
  const { library, db } = await fixture(false)
  const ids = Array.from({ length: 301 }, (_, index) => `video-${index}`)
  const history = ids.map((videoId, index) => ({ _id: videoId, videoId, timeWatched: index, watchProgress: index, unknown: new Date(index) }))
  await db.history.insertAsync(history)
  const before = await db.history.findAsync({}).sort({ _id: 1 })
  const source = (await readFile(new URL('../../src/renderer/helpers/libraryState.js', import.meta.url), 'utf8'))
    .replace(/^import.*\n/gm, '').replaceAll('export function', 'function')
  const gate = Promise.withResolvers(), entered = Promise.withResolvers(), calls = [], cached = new Map(), memberships = new Map(), errors = []
  let fail = true
  const hydrate = compileFunction(source + '\nreturn hydrateVideoState', ['DBLibraryHandlers', 'console'])({ query: async (method, options) => {
    calls.push(options.ids)
    if (fail) { entered.resolve(); await gate.promise; throw new Error('video state unavailable') }
    return library.query(method, options)
  } }, { error: error => errors.push(error.message) })
  const store = {
    state: { history: { libraryPaged: true, activeVideoIds: Object.fromEntries(ids.map(id => [id, 1])) } },
    commit(method, payload) {
      if (method === 'cacheHistoryRecords') for (const record of payload.records) cached.set(record.videoId, record)
      else if (method === 'cachePlaylistMemberships') for (const id of payload.ids) memberships.set(id, payload.memberships.filter(member => member.videoId === id))
      else assert.fail(`unexpected mutation ${method}`)
    },
  }
  const first = hydrate(store, ids.slice(0, 300))
  const rejection = assert.rejects(first, /video state unavailable/)
  await entered.promise
  assert.equal(hydrate(store, ids.slice(300)), first)
  gate.resolve()
  await rejection
  assert.equal(calls.length, 1, 'a failed batch must not automatically spin retries')
  assert.equal(cached.size, 0)
  fail = false
  await hydrate(store, [])
  assert.ok(calls.every(batch => batch.length <= 250))
  assert.deepEqual([...cached.values()].sort((a, b) => a._id.localeCompare(b._id)), history.toSorted((a, b) => a._id.localeCompare(b._id)))
  assert.equal(memberships.size, ids.length)
  assert.deepEqual(errors, ['video state unavailable'])
  assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), before)
})


for (const backend of ['portable', 'sqlite']) {
  test(`${backend} mounted statistics refresh at a premiere boundary and dispose their timer`, async t => {
    const { effectScope, onScopeDispose, reactive, ref, watch, nextTick } = await import('vue')
    const { setImmediate } = await import('node:timers/promises')
    const { db, library: portable } = await fixture(false)
    const premiere = { _id: 'premiere', videoId: 'premiere', timeWatched: 1, isUpcoming: true, premiereTimestamp: 11, lengthSeconds: 100, isWatched: true, unknown: new Date(1) }
    const playlist = { _id: 'clock', videos: [{ videoId: 'premiere', unknown: { keep: true } }] }
    let library = portable
    if (backend === 'sqlite') {
      const { DatabaseSync } = await import('node:sqlite')
      const { SCHEMA_SQL } = await import('../../src/datastores/sqlite/schema.js')
      const { LibraryEngine } = await import('../../src/datastores/sqlite/engine.js')
      const database = new DatabaseSync(':memory:')
      database.exec(SCHEMA_SQL)
      t.after(() => database.close())
      const engine = new LibraryEngine(database)
      await engine.collections.history.insertAsync(premiere)
      await engine.collections.playlists.insertAsync(playlist)
      library = { query: (method, options) => engine[method](options) }
    } else {
      await db.history.insertAsync(premiere)
      await db.playlists.insertAsync(playlist)
    }
    const source = (await readFile(new URL('../../src/renderer/composables/usePlaylistStatistics.js', import.meta.url), 'utf8'))
      .replace(/^import.*\n/gm, '').replace('export function', 'function')
    let queries = 0
    const useStatistics = compileFunction(source + '\nreturn usePlaylistStatistics', ['ref', 'watch', 'onScopeDispose', 'DBLibraryHandlers'])(ref, watch, onScopeDispose, {
      query: (...args) => { queries++; return library.query(...args) },
    })
    const scope = effectScope()
    t.after(() => scope.stop())
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
    const state = reactive({ history: { historyRevision: 0 } })
    const statistics = scope.run(() => useStatistics({ state, getters: { getPlaylist: () => playlist } }, () => playlist._id, () => true))
    const settle = async () => { await nextTick(); await setImmediate() }
    await settle()
    assert.deepEqual(statistics.value, { total: 1, uniqueCount: 1, duration: 100, missingDuration: 0, watchedCount: 0 })
    t.mock.timers.tick(999)
    await settle()
    assert.equal(queries, 1)
    t.mock.timers.tick(1)
    await settle()
    assert.equal(statistics.value.watchedCount, 1, 'time alone must refresh the watched count')
    assert.equal(queries, 2)
    assert.equal(state.history.historyRevision, 0)
    t.mock.timers.setTime(10000)
    state.history.historyRevision++
    await settle()
    assert.equal(statistics.value.watchedCount, 0)
    scope.stop()
    t.mock.timers.tick(2000)
    await settle()
    assert.equal(queries, 3, 'unmount must cancel the next premiere refresh')
    if (backend === 'portable') {
      assert.deepEqual(await db.history.findOneAsync({ _id: premiere._id }), premiere)
      assert.deepEqual(await db.playlists.findOneAsync({ _id: playlist._id }), playlist)
    }
  })
}

test('statistics keep the current playlist during refresh but clear on identity or availability changes', async t => {
  const { ref, watch, nextTick } = await import('vue')
  const { setImmediate } = await import('node:timers/promises')
  const source = (await readFile(new URL('../../src/renderer/composables/usePlaylistStatistics.js', import.meta.url), 'utf8'))
    .replace(/^import.*\n/gm, '').replace('export function', 'function')
  const requests = [], stops = []
  const useStatistics = compileFunction(source + '\nreturn usePlaylistStatistics', ['ref', 'watch', 'onScopeDispose', 'DBLibraryHandlers', 'console'])(ref, (...args) => {
    const stop = watch(...args); stops.push(stop); return stop
  }, callback => t.after(callback), { query: (_method, options) => {
    const pending = Promise.withResolvers(); requests.push({ ...pending, id: options.id }); return pending.promise
  } }, { error() {} })
  t.after(() => stops.forEach(stop => stop()))
  const id = ref('a'), enabled = ref(true), revision = ref(0)
  const statistics = useStatistics({ state: { history: { get historyRevision() { return revision.value } } }, getters: { getPlaylist: () => ({ videos: [] }) } }, () => id.value, () => enabled.value)
  const first = { total: 200, uniqueCount: 190, duration: 600, missingDuration: 1, watchedCount: 2 }
  const empty = { total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 }
  const settle = async () => { await nextTick(); await setImmediate() }
  requests[0].resolve(first); await settle()
  revision.value++; await nextTick()
  assert.deepEqual(statistics.value, first)
  id.value = 'b'; await nextTick()
  assert.deepEqual(statistics.value, empty)
  requests[1].resolve({ ...first, duration: 999 }); await settle()
  assert.deepEqual(statistics.value, empty)
  requests[2].resolve({ ...first, total: 100 }); await settle()
  assert.equal(statistics.value.total, 100)
  enabled.value = false; await settle()
  assert.deepEqual(statistics.value, empty)
  id.value = null; enabled.value = true; await settle()
  assert.deepEqual(statistics.value, empty)
  assert.deepEqual(requests.map(request => request.id), ['a', 'a', 'b'])
})

test('disabled portable statistics tolerate retained scalar and opaque memberships without rewriting them', async t => {
  const { effectScope, ref, watch, onScopeDispose, nextTick } = await import('vue')
  const source = (await readFile(new URL('../../src/renderer/composables/usePlaylistStatistics.js', import.meta.url), 'utf8'))
    .replace(/^import.*\n/gm, '').replace('export function', 'function')
  const useStatistics = compileFunction(source + '\nreturn usePlaylistStatistics', ['ref', 'watch', 'onScopeDispose', 'DBLibraryHandlers'])(ref, watch, onScopeDispose, {
    query() { assert.fail('disabled portable statistics must not request desktop data') },
  })
  const db = new Datastore({ inMemoryOnly: true })
  const records = [undefined, null, false, 42, 'retained', {}, [null, false, {}, { videoId: 'valid' }]].map((videos, index) => ({
    _id: `retained-${index}`, playlistName: 'Retained', unknown: new Date(index), ...(videos === undefined ? {} : { videos }),
  }))
  await db.insertAsync(records)
  const playlist = ref(records[0]), state = { history: { historyRevision: 0 } }, scope = effectScope()
  t.after(() => scope.stop())
  const statistics = scope.run(() => useStatistics({ state, getters: { getPlaylist: () => playlist.value } }, () => playlist.value._id, () => false))
  for (const record of records) {
    playlist.value = await db.findOneAsync({ _id: record._id })
    await nextTick()
    assert.deepEqual(statistics.value, { total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 })
    assert.deepEqual(await db.findOneAsync({ _id: record._id }), record)
  }
})


test('portable full-record compare-and-swap rejects concurrent membership and metadata changes', async () => {
  const db = { playlists: new Datastore({ inMemoryOnly: true }) }
  const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
  const Playlists = compileFunction(source.slice(source.indexOf('class Playlists {'), source.indexOf('class SearchHistory {')) + '\nreturn Playlists', ['db', 'model'])(db, model)
  const original = { _id: 'p', playlistName: 'Original', videos: [{ videoId: 'A' }], unknown: new Date(1) }
  assert.equal((await Playlists.replaceIfUnchanged(null, original)).numAffected, 1)
  assert.equal((await Playlists.replaceIfUnchanged(null, { ...original, playlistName: 'Concurrent attempt' })).numAffected, 0)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), original)
  const replacement = { ...original, videos: [...original.videos, { videoId: 'B' }] }
  for (const patch of [{ videos: [{ videoId: 'concurrent' }] }, { playlistName: 'Concurrent' }]) {
    await db.playlists.updateAsync({ _id: 'p' }, original)
    await db.playlists.updateAsync({ _id: 'p' }, { $set: patch })
    const saved = await db.playlists.findOneAsync({ _id: 'p' })
    assert.equal((await Playlists.replaceIfUnchanged(original, replacement)).numAffected, 0)
    assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), saved)
  }
})


for (const direction of [-1, 1]) {
  test(`portable playable-only moves swap visible neighbors and retain hidden slots: ${direction}`, async () => {
    const { db, library } = await fixture(false)
    const a = { videoId: 'A', unknown: new Date(1) }, b = { videoId: 'B', unknown: new Date(2) }
    const hidden = [null, false, { postId: 'post' }, { videoId: 42 }, { videoId: '' }]
    await db.playlists.updateAsync({ _id: 'p' }, { _id: 'p', playlistName: 'Retained', videos: [a, ...hidden, b] })
    const page = await library.query('playlistPage', { id: 'p' })
    const member = page.records.find(video => video?.videoId === (direction === 1 ? 'A' : 'B'))
    assert.equal(await library.query('movePlaylistMember', { id: 'p', memberId: member._libraryMemberId, direction, revision: page.revision, playableOnly: true }), true)
    assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, [b, ...hidden, a])
  })
}

for (const adapter of ['nedb', 'sqlite']) {
  test(`profile form patches retain concurrent metadata and subscriptions: ${adapter}`, async t => {
    let database
    const collection = adapter === 'nedb' ? new Datastore({ inMemoryOnly: true }) : await (async () => {
      const { DatabaseSync } = await import('node:sqlite')
      const { LibraryEngine } = await import('../../src/datastores/sqlite/engine.js')
      const { SCHEMA_SQL } = await import('../../src/datastores/sqlite/schema.js')
      database = new DatabaseSync(':memory:')
      database.exec(SCHEMA_SQL)
      t.after(() => database.close())
      return new LibraryEngine(database).collections.profiles
    })()
    const db = { profiles: collection }
    const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
    const Profiles = compileFunction(source.slice(source.indexOf('class Profiles {'), source.indexOf('class Playlists {')) + '\nreturn Profiles', ['db'])(db)
    const captured = { _id: 'p', name: null, icon: { type: 'icon', value: 'circle-user' } }
    const stored = { _id: 'p', name: null, subscriptions: [{ id: 'concurrent-channel', retained: new Date(123) }], unknown: { concurrent: true, date: new Date(456) } }
    await collection.insertAsync(stored)
    const result = await Profiles.upsert(captured)
    const expected = { ...stored, icon: captured.icon }
    assert.deepEqual(await collection.findOneAsync({ _id: 'p' }), expected)
    assert.deepEqual(result.affectedDocuments, expected)
  })
}


test('portable duplicate statistics count exactly the members cleanup removes', async () => {
  const { db, library } = await fixture(false)
  const videos = [null, false, {}, { videoId: null }, { videoId: null }, { videoId: { retained: true } }, { videoId: { retained: true } }, { videoId: 'same' }, { videoId: 'same' }, { videoId: 42 }, { videoId: 42 }]
  const original = { _id: 'p', videos, unknown: new Date(123) }
  await db.playlists.updateAsync({ _id: 'p' }, original)
  const stats = await library.query('playlistStatistics', { id: 'p' })
  assert.equal(stats.total - stats.uniqueCount, 2)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), original)
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), 2)
  const saved = await db.playlists.findOneAsync({ _id: 'p' })
  assert.deepEqual(saved.videos, videos.filter((_, index) => index !== 8 && index !== 10))
  const cleaned = await library.query('playlistStatistics', { id: 'p' })
  assert.equal(cleaned.uniqueCount, cleaned.total)
})


for (const direction of ['top', 'bottom']) {
  test(`portable playable-only endpoint moves retain every opaque slot: ${direction}`, async () => {
    const { db, library } = await fixture(false)
    const a = { videoId: 'A', unknown: new Date(1) }, b = { videoId: 'B', unknown: new Date(2) }, c = { videoId: 'C', unknown: new Date(3) }
    const original = { _id: 'p', playlistName: 'Retained', unknown: new Date(4), videos: [null, a, false, b, { postId: 'post' }, c, 'opaque'] }
    await db.playlists.updateAsync({ _id: 'p' }, original)
    const first = await library.query('playlistPage', { id: 'p' })
    const member = first.records.find(video => video?.videoId === 'B')
    assert.equal(await library.query('movePlaylistMember', { id: 'p', memberId: member._libraryMemberId, direction, revision: first.revision, playableOnly: true }), true)
    const saved = await db.playlists.findOneAsync({ _id: 'p' })
    assert.deepEqual(saved, { ...original, lastUpdatedAt: saved.lastUpdatedAt, videos: direction === 'top' ? [null, b, false, a, { postId: 'post' }, c, 'opaque'] : [null, a, false, c, { postId: 'post' }, b, 'opaque'] })
    const page = await library.query('playlistPage', { id: 'p' })
    const endpoint = page.records.find(video => video?.videoId === 'B')
    assert.equal(await library.query('movePlaylistMember', { id: 'p', memberId: endpoint._libraryMemberId, direction, revision: page.revision, playableOnly: true }), false)
    assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), saved)
  })
}
