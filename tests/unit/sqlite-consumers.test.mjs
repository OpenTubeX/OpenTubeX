import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm, { compileFunction } from 'node:vm'
import { computed, ref, toRaw, unref } from 'vue'
import { createStore } from 'vuex'
import * as playlistCounts from '../../src/renderer/helpers/playlist-video-counts.js'
import { DatabaseSync } from 'node:sqlite'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { recommendationSubscriptionCandidates, playlistSelection } from '../../src/datastores/sqlite/operations.js'
import * as operations from '../../src/datastores/sqlite/operations.js'
import * as historyHelpers from '../../src/history.js'
import { repairHistory } from '../../src/historyRepair.js'
import { mergeSubscriptionSeenVideos } from '../../src/subscriptionSeenVideos.js'
import { syncSubscriptionSeenVideos } from '../../src/renderer/helpers/subscription-seen-videos.js'
import { createPortableLibrary } from '../../src/datastores/handlers/library-web.js'
import { createIdQuery } from '../../src/datastores/idQuery.js'
import { createRecommendationStore } from '../../src/datastores/recommendations.js'
import Datastore from '@seald-io/nedb'

function memory(t) {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(SCHEMA_SQL)
  t.after(() => database.close())
  return new LibraryEngine(database)
}

test('restored history occurrences have distinct stable keys through filtering and reordering', async () => {
  const source = await readFile(new URL('../../src/renderer/components/FtElementList/FtElementList.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function getResultKey(')
  const key = compileFunction(source.slice(start, source.indexOf('\nconst resultKeys', start)) + '\nreturn getResultKey', ['props'])({ stableItemKeys: true, dataType: 'video' })
  const rows = [{ _id: 'old', videoId: 'duplicate' }, { _id: 'new', videoId: 'duplicate' }]
  const keys = rows.map(key)
  assert.equal(new Set(keys).size, rows.length)
  assert.deepEqual(rows.toReversed().map(key), keys.toReversed())
  assert.equal(key({ ...rows[1], title: 'Updated' }, 0), keys[1])
  assert.notEqual(key({ ...rows[0], _libraryMemberId: 'first' }, 0), key({ ...rows[0], _libraryMemberId: 'second' }, 0))
})

async function desktopLibrary(engine) {
  const source = await readFile(new URL('../../src/datastores/handlers/electron.js', import.meta.url), 'utf8')
  const start = source.indexOf('function toPlain(')
  const end = source.indexOf('\nexport const recommendations', start)
  assert.ok(start >= 0 && end > start, 'desktop library adapter source markers must exist in order')
  return compileFunction(source.slice(start, end) + '\nreturn library', ['window'])({
    ftElectron: { libraryQuery: (method, payload) => operations[method](engine, structuredClone(payload)) },
  })
}

test('synced unseen marks update off-page desktop history while retaining later watches and playback data', async t => {
  const engine = memory(t)
  const older = { _id: 'older', videoId: 'local-only', isWatched: true, timeWatched: 1000, watchProgress: 123,
    lengthSeconds: 200, unknown: { date: new Date(0), retained: ['value'] }, lastViewedPlaylistItemId: 'member' }
  const protectedRecords = [
    { ...older, _id: 'later', timeWatched: 3000 },
    { ...older, _id: 'equal', timeWatched: 2000 },
    { ...older, _id: 'seen-again', videoId: 'seen-again' },
    { ...older, _id: 'live', videoId: 'live', isLive: true },
    { ...older, _id: 'already-unwatched', videoId: 'already-unwatched', isWatched: false },
  ]
  const legacy = { ...older, _id: 'legacy', videoId: 'legacy' }
  delete legacy.isWatched
  legacy.watchProgress = 200
  await engine.collections.history.insertAsync([
    ...Array.from({ length: 350 }, (_, index) => ({ _id: `recent-${index}`, videoId: `recent-${index}`, timeWatched: 10000 + index, isWatched: true })),
    older, { ...older, _id: 'duplicate' }, legacy, ...protectedRecords,
  ])
  await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId: 'seen-again', seenAt: 3000 }]) })
  const source = (await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replace('export default ', 'return ')
  const query = (method, options) => typeof operations[method] === 'function'
    ? engine.transaction(() => operations[method](engine, options)) : engine[method](options)
  const dependencies = { ...historyHelpers, toRaw, process: { env: { IS_ELECTRON: true } }, DBLibraryHandlers: { query } }
  const history = compileFunction(source, Object.keys(dependencies))(...Object.values(dependencies))
  const store = createStore({
    state: { settings: { subscriptionSeenVideos: '[]' } }, modules: { history },
    actions: {
      async mergeSubscriptionSeenVideos({ state }, remote) {
        const saved = await engine.collections.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })
        state.settings.subscriptionSeenVideos = JSON.stringify(mergeSubscriptionSeenVideos(saved.value, remote))
        await engine.collections.settings.updateAsync({ _id: saved._id }, { $set: { value: state.settings.subscriptionSeenVideos } })
      },
      async hydrateVideoState({ commit }, ids) {
        const result = await engine.videoState({ ids })
        commit('cacheHistoryRecords', { ids, records: result.history })
      },
    },
  })
  await store.dispatch('grabHistory')
  store.commit('retainVideoState', ['local-only'])
  await store.dispatch('hydrateVideoState', ['local-only'])
  assert.equal(store.state.history.historyCacheSorted.length, 100)
  assert.ok(!store.state.history.historyCacheSorted.some(record => record.videoId === older.videoId))
  const marks = ['local-only', 'legacy', 'seen-again', 'live', 'already-unwatched', 'missing']
    .map(videoId => ({ videoId, seenAt: 2000, unseenAt: 2000 }))
  const client = { getSeenVideos: async () => marks, getWatchHistory: async () => [], putWatchHistory: async () => {}, putSeenVideos: async () => {} }
  await syncSubscriptionSeenVideos(client, store)
  for (const record of [older, { ...older, _id: 'duplicate' }, legacy]) {
    assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), { ...record, isWatched: false })
  }
  for (const record of protectedRecords) assert.deepEqual(await engine.collections.history.findOneAsync({ _id: record._id }), record)
  assert.equal(await engine.collections.history.countAsync(), 358)
  assert.equal(store.state.history.historyHasUnwatched, true)
  assert.equal(store.state.history.historyCacheSorted.length, 100)
  assert.equal(store.state.history.historyCacheById['local-only'].timeWatched, 3000)
  assert.equal(store.state.history.historyCacheById['local-only'].isWatched, true)
  const revision = engine.revision('history')
  await syncSubscriptionSeenVideos(client, store)
  assert.equal(engine.revision('history'), revision, 'replaying marks does not rewrite history')
})

test('playlist moves skip members pending undo without removing or changing them on either adapter', async t => {
  for (const desktop of [true, false]) {
    const videos = ['first', 'pending', 'third', 'last'].map(title => ({ videoId: 'duplicate', playlistItemId: 'repeated', title, unknown: { keep: title } }))
    const engine = memory(t)
    await engine.collections.playlists.insertAsync({ _id: 'playlist', videos })
    const portable = createPortableLibrary({
      playlists: {
        find: () => engine.collections.playlists.findAsync({}),
        upsert: playlist => engine.collections.playlists.updateAsync({ _id: playlist._id }, playlist),
      },
    })
    const page = engine.playlistPage({ id: 'playlist' })
    const ids = desktop ? page.records.map(video => video._libraryMemberId) : ['0', '1', '2', '3']
    const move = options => desktop ? engine.movePlaylistMember(options) : portable.query('movePlaylistMember', options)
    assert.equal(await move({ id: 'playlist', memberId: ids[2], direction: -1, excludedMemberIds: [ids[1]], revision: page.revision }), true)
    const moved = await engine.playlistSnapshot({ id: 'playlist' })
    assert.deepEqual(moved.videos, [videos[2], videos[1], videos[0], videos[3]], `${desktop ? 'desktop' : 'portable'} move must keep pending undo intact`)
    const first = engine.playlistPage({ id: 'playlist' })
    assert.equal(await move({ id: 'playlist', memberId: desktop ? ids[2] : '0', direction: 1, excludedMemberIds: desktop ? [ids[0], ids[1], ids[3]] : ['1', '2', '3'], revision: first.revision }), false)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'playlist' })).videos, moved.videos)
  }
})

async function portableCleanupFixture() {
  const db = Object.fromEntries(['history', 'playlists', 'settings', 'recommendations'].map(name => [name, new Datastore({ inMemoryOnly: true })]))
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  const source = (await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replace(/^export \{[\s\S]*?\}\n/gm, '')
  const dependencies = { db, createRecommendationStore, createIdQuery, ...historyHelpers }
  const handlers = compileFunction(source + '\nreturn { history: History, playlists: Playlists }', Object.keys(dependencies))(...Object.values(dependencies))
  return { db, handlers, library: createPortableLibrary(handlers) }
}

test('portable duplicate cleanup retains surviving membership context and clears only removed references', async () => {
  const { db, library } = await portableCleanupFixture()
  const entries = [
    ['retained', 'first', 'second'], ['removed', 'first', 'second'],
    ['repeated', 'same', 'same'], ['legacy', undefined, undefined], ['elsewhere', 'first', 'second'],
  ]
  const playlist = { _id: 'p', unknown: new Date(0), videos: entries.flatMap(([videoId, first, second]) => [
    { videoId, playlistItemId: first, unknown: 'keep' }, { videoId, playlistItemId: second, unknown: 'duplicate' },
  ]) }
  const histories = entries.flatMap(([videoId, first, second]) => [0, 1].map(index => ({
    _id: `${videoId}-${index}`, videoId, timeWatched: index, isWatched: true, unknown: { date: new Date(index) },
    lastViewedPlaylistId: videoId === 'elsewhere' ? 'other' : 'p', lastViewedPlaylistType: 'user',
    ...(videoId === 'legacy' ? index === 0 ? {} : { lastViewedPlaylistItemId: null } : { lastViewedPlaylistItemId: videoId === 'removed' ? second : first }),
  })))
  await db.playlists.insertAsync(playlist)
  await db.history.insertAsync(histories)
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), 5)
  for (const history of histories) {
    const expected = { ...history }
    if (history.videoId === 'removed') {
      delete expected.lastViewedPlaylistId
      delete expected.lastViewedPlaylistType
      delete expected.lastViewedPlaylistItemId
    }
    assert.deepEqual(await db.history.findOneAsync({ _id: history._id }), expected)
  }
  assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, playlist.videos.filter((_, index) => index % 2 === 0))
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'watched' }), 5)
  assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, [])
  for (const history of histories) {
    const actual = await db.history.findOneAsync({ _id: history._id })
    assert.deepEqual(actual.unknown, history.unknown)
    assert.equal(actual.lastViewedPlaylistId, history.videoId === 'elsewhere' ? 'other' : undefined)
  }
})

test('portable cleanup preserves history when the playlist write fails', async t => {
  const { db, handlers, library } = await portableCleanupFixture()
  const playlist = { _id: 'p', videos: [{ videoId: 'same', playlistItemId: 'first' }, { videoId: 'same', playlistItemId: 'second' }] }
  const history = { _id: 'h', videoId: 'same', isWatched: true, lastViewedPlaylistId: 'p', lastViewedPlaylistItemId: 'second', unknown: new Date(0) }
  await db.playlists.insertAsync(playlist)
  await db.history.insertAsync(history)
  t.mock.method(handlers.playlists, 'upsert', () => { throw new Error('playlist write failed') })
  await assert.rejects(library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), /playlist write failed/)
  assert.deepEqual(await db.history.findOneAsync({ _id: 'h' }), history)
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), playlist)
})

test('portable duplicate cleanup keeps exact resume references for large ID selections', async () => {
  const { db, library } = await portableCleanupFixture()
  const videos = Array.from({ length: 300 }, (_, index) => ({ videoId: `video-${index}`, playlistItemId: 'keep', unknown: index }))
  const histories = videos.flatMap((video, index) => ['keep', 'removed'].map(itemId => ({
    _id: `${video.videoId}-${itemId}`, videoId: video.videoId, lastViewedPlaylistId: 'p', lastViewedPlaylistItemId: itemId,
    lastViewedPlaylistType: 'user', isWatched: true, unknown: new Date(index),
  })))
  await db.playlists.insertAsync({ _id: 'p', videos: videos.flatMap(video => [video, { ...video, playlistItemId: 'removed' }]) })
  await db.history.insertAsync(histories)
  assert.equal(await library.query('cleanupPlaylist', { id: 'p', mode: 'duplicates' }), 300)
  assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, videos)
  for (const history of histories) {
    const { lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId, ...withoutContext } = history
    assert.deepEqual(await db.history.findOneAsync({ _id: history._id }), history.lastViewedPlaylistItemId === 'keep' ? history : withoutContext)
  }
})

test('playlist renderer excludes pending undo memberships outside its reloaded first page', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 102 }, (_, index) => ({ videoId: `video-${index}`, playlistItemId: `item-${index}` }))
  await engine.collections.playlists.insertAsync({ _id: 'playlist', videos })
  const first = engine.playlistPage({ id: 'playlist' })
  const pending = engine.playlistPage({ id: 'playlist', limit: 102 }).records[100]
  const source = await readFile(new URL('../../src/renderer/views/Playlist/Playlist.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function moveUserVideo(')
  const end = source.indexOf('function moveVideoUp(', start)
  assert.ok(start >= 0 && end > start, 'playlist move source markers must exist in order')
  const move = vm.runInNewContext(source.slice(start, end) + '\nmoveUserVideo', {
    process: { env: { IS_ELECTRON: true } }, console,
    playlistItems: ref(first.records), playlistId: ref('playlist'), userPageRevision: first.revision,
    toBeDeletedPlaylistItemIds: ref([pending._libraryMemberId]), selectedUserPlaylist: ref({ _id: 'playlist' }),
    DBLibraryHandlers: { query: (_method, options) => engine.movePlaylistMember(options) },
    store: { dispatch: async () => {} }, parseUserPlaylist: async () => {},
  })
  const lastLoaded = first.records.at(-1)
  await move(lastLoaded.videoId, lastLoaded.playlistItemId, 1, lastLoaded._libraryMemberId)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'playlist' })).videos.slice(99), [videos[101], videos[100], videos[99]])
})

test('desktop summary refresh preserves saved indicators and rehydrates durable membership changes', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync([{ _id: 'favorites', videos: [{ videoId: 'saved' }] }, { _id: 'other', videos: [{ videoId: 'saved' }] }])
  const source = (await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replace('export default ', 'return ')
  const dependencies = { ...playlistCounts, process: { env: { IS_ELECTRON: true } }, DBLibraryHandlers: { query: () => engine.playlistSummaries() } }
  const playlists = compileFunction(source, Object.keys(dependencies))(...Object.values(dependencies))
  const store = createStore({
    state: { settings: { quickBookmarkTargetPlaylistId: 'favorites' }, history: { activeVideoIds: { saved: 1 } } },
    getters: { getQuickBookmarkTargetPlaylistId: state => state.settings.quickBookmarkTargetPlaylistId },
    modules: { playlists },
    actions: { async hydrateVideoState({ commit, state }, ids) {
      const result = await engine.videoState({ ids })
      commit('cachePlaylistMemberships', { ids, memberships: result.memberships, retained: Object.keys(state.history.activeVideoIds) })
    } },
  })
  await store.dispatch('hydrateVideoState', ['saved'])
  store.commit('setAllPlaylists', engine.playlistSummaries())
  assert.equal(store.getters.getPlaylistVideoCounts.get('saved'), 2)
  assert.equal(store.getters.getQuickBookmarkVideoIds.has('saved'), true)
  await engine.collections.playlists.updateAsync({ _id: 'other' }, { $set: { videos: [] } })
  await store.dispatch('grabAllPlaylists')
  assert.equal(store.getters.getPlaylistVideoCounts.get('saved'), 1)
  assert.equal(store.getters.getQuickBookmarkVideoIds.has('saved'), true)
  await engine.collections.playlists.updateAsync({ _id: 'favorites' }, { $set: { videos: [] } })
  await store.dispatch('grabAllPlaylists')
  assert.equal(store.getters.getPlaylistVideoCounts.has('saved'), false)
  assert.equal(store.getters.getQuickBookmarkVideoIds.has('saved'), false)
})

test('desktop repair skips a deleted occurrence without falling back to a newer duplicate', async t => {
  const engine = memory(t)
  const older = { _id: 'older', videoId: 'abcdefghijk', title: 'Imported', timeWatched: 1, watchProgress: 12, isWatched: true, unknown: { keep: true } }
  const newest = { ...older, _id: 'newest', author: 'Current', authorId: 'channel', published: 1, lengthSeconds: 600, timeWatched: 2, watchProgress: 34 }
  await engine.collections.history.insertAsync([older, newest])
  const library = await desktopLibrary(engine)
  assert.deepEqual(await library.query('historyRepairRecord', { id: older._id, videoId: older.videoId }), older)
  assert.equal(await library.query('historyRepairRecord', { id: older._id, videoId: 'different' }), null)
  for (const options of [{ videoId: older.videoId }, { id: [], videoId: older.videoId }, { id: older._id, videoId: '' }]) {
    await assert.rejects(library.query('historyRepairRecord', options), /Invalid history repair record/)
  }
  let revision
  const result = await repairHistory({
    records: [older], signal: new AbortController().signal, onProgress: () => {},
    getRecord: (videoId, id) => library.query('historyRepairRecord', { id, videoId }),
    fetchMetadata: async () => {
      await engine.collections.history.removeAsync({ _id: older._id })
      revision = engine.revision('history')
      return { author: 'Recovered', authorId: 'channel', published: 1000, lengthSeconds: 120, isLive: false, isUpcoming: false }
    },
    saveMetadata: async () => assert.fail('Deleted repair candidates must not be saved'),
  })
  assert.deepEqual(result, { total: 1, checked: 1, repaired: 0, failed: 0 })
  assert.deepEqual(await engine.collections.history.findAsync({}), [newest])
  assert.equal(engine.revision('history'), revision)
})

test('paged history repair keeps its initial denominator across repaired pages', async () => {
  const source = await readFile(new URL('../../src/renderer/helpers/historyRepair.js', import.meta.url), 'utf8')
  const totals = []
  let page = 0
  const result = vm.runInNewContext(source.replace(/^import .*\n/gm, '').replaceAll('export ', '') + '\n({ startHistoryRepair, historyRepairState })', {
    reactive: value => value, AbortController, console,
    store: { state: { history: { libraryPaged: true } } },
    DBLibraryHandlers: { query: async () => ({ records: Array.from({ length: ++page < 3 ? 100 : 50 }), total: 250, cursor: page < 3 ? { id: page, total: 250 } : null }) },
    repairHistory: async ({ records, onProgress }) => {
      totals.push(result.historyRepairState.total)
      const progress = { checked: records.length, repaired: records.length, failed: 0 }
      onProgress(progress)
      return progress
    },
  })
  await result.startHistoryRepair()
  assert.deepEqual(totals, [250, 250, 250])
  assert.equal(result.historyRepairState.checked, 250)
  assert.equal(result.historyRepairState.repaired, 250)
  assert.equal(result.historyRepairState.phase, 'finished')
})

test('desktop recommendation preferences cross the real adapter and structured-clone boundary and filter hidden channels', async t => {
  const engine = memory(t)
  const entries = [
    { _id: 'visible', videoId: 'aaaaaaaaaaa', author: 'Visible', title: 'Linux', timeWatched: 1 },
    { _id: 'hidden', videoId: 'bbbbbbbbbbb', author: 'Hidden', title: 'Linux', timeWatched: 2 },
  ]
  await engine.collections.history.insertAsync(entries)
  await engine.collections.playlists.insertAsync({ _id: 'favorites', videos: entries })
  const source = await readFile(new URL('../../src/renderer/composables/useHomeRecommendations.js', import.meta.url), 'utf8')
  const payload = source.match(/DBLibraryHandlers\.query\('recommendationInputs', ([\s\S]*?\n      \})\)/)[1]
  const options = vm.runInNewContext(`(${payload})`, {
    store: { getters: { getActiveChannelsHiddenNames: new Set(['Hidden']) } },
    shouldHideMembersOnlyContent: () => false,
  })
  const library = await desktopLibrary(engine)
  const result = await library.query('recommendationInputs', options)
  assert.deepEqual(result.history.map(video => video.videoId), ['aaaaaaaaaaa'])
  assert.deepEqual(result.favorites.map(video => video.videoId), ['aaaaaaaaaaa'])
})

test('desktop recommendation candidates retain raw cache order, members-only entries and bounded channel quotas', async t => {
  const engine = memory(t)
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos: [
    { videoId: 'public', title: 'Public', type: 'video', published: 1 },
    { videoId: 'member', title: 'Member', type: 'video', published: 2, isMembersOnly: true },
  ] })
  const source = await readFile(new URL('../../src/renderer/composables/useHomeRecommendations.js', import.meta.url), 'utf8')
  const start = source.indexOf('const channels = [...subscriptionIds]')
  const end = source.indexOf('\n    } else {', start)
  assert.ok(start >= 0 && end > start, 'desktop subscription candidate source markers must exist in order')
  const library = await desktopLibrary(engine)
  const candidates = await vm.runInNewContext(`(async () => { ${source.slice(start, end)}\nreturn subscriptionCandidates })()`, {
    subscriptionIds: new Set(['channel']), learned: { channelWeights: new Map() }, requestGeneration: 1, generation: 1,
    DBLibraryHandlers: library,
  })
  assert.deepEqual(Array.from(candidates, video => video.videoId), ['public', 'member'])
  const channels = Array.from({ length: 12 }, (_, index) => `channel-${index}`)
  await engine.collections.subscriptionCache.insertAsync(channels.map(id => ({ _id: id, videos: Array.from({ length: 40 }, (_, index) => ({ videoId: `${id}-${index}` })) })))
  const bounded = recommendationSubscriptionCandidates(engine, { channelIds: channels })
  assert.equal(bounded.length, 360)
  assert.deepEqual(bounded.map(video => video.videoId), channels.flatMap(id => Array.from({ length: 30 }, (_, index) => `${id}-${index}`)))
  assert.deepEqual(bounded[30].recommendationSources, [{ type: 'subscription', id: channels[1] }])
  assert.throws(() => recommendationSubscriptionCandidates(engine, { channelIds: [...channels, 'extra'] }), /Invalid recommendation channels/)
})

test('Watch quick bookmarks use hydrated membership when playlist summaries have no members', async () => {
  const source = await readFile(new URL('../../src/renderer/components/WatchVideoInfo/WatchVideoInfo.vue', import.meta.url), 'utf8')
  const start = source.indexOf('const isInQuickBookmarkPlaylist =')
  const end = source.indexOf('const quickBookmarkIconText =')
  assert.ok(start >= 0 && end > start, 'Watch quick-bookmark source markers must exist in order')
  const code = source.slice(start, end)
  const ids = new Set(['saved'])
  const result = vm.runInNewContext(`${code}\nisInQuickBookmarkPlaylist`, {
    computed, props: { id: 'saved' }, isQuickBookmarkEnabled: ref(true),
    quickBookmarkPlaylist: ref({ _id: 'favorites', videos: [] }),
    store: { getters: { getQuickBookmarkVideoIds: ids } },
  })
  assert.equal(result.value, true)
})

test('Watch playlist hydration clears failed or missing membership and preserves a newer route', async t => {
  const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
  const start = source.indexOf('    checkIfPlaylist: function () {')
  const end = source.indexOf('\n    checkIfTimestamp:', start)
  assert.ok(start >= 0 && end > start)
  const checkIfPlaylist = compileFunction('return ' + source.slice(start, end).trim().replace(/^checkIfPlaylist: /, '').replace(/,$/, ''))()
  const errors = []
  t.mock.method(console, 'error', error => errors.push(error))
  for (const outcome of ['member', 'missing', 'failure', 'stale-failure']) {
    let resolve, reject
    const hydration = new Promise((yes, no) => { resolve = yes; reject = no })
    const memberships = {}
    const context = {
      videoId: 'video', selectedUserPlaylist: { _id: 'playlist', videos: [] },
      tabRoute: { query: { playlistId: 'playlist', playlistType: 'user', playlistItemId: 'member' } },
      $store: {
        state: { playlists: { libraryPaged: true } },
        getters: { getPlaylistMemberships: memberships },
        dispatch: (action, ids) => { assert.equal(action, 'hydrateVideoState'); assert.deepEqual(ids, ['video']); return hydration },
      },
      checkIfPlaylist() { checkIfPlaylist.call(this) },
    }
    context.checkIfPlaylist()
    if (outcome === 'stale-failure') {
      context.videoId = 'new-video'
      context.tabRoute.query.playlistId = 'new-playlist'
      context.playlistId = 'new-playlist'
      context.playlistItemId = 'new-member'
    }
    if (outcome.endsWith('failure')) reject(new Error(outcome))
    else { memberships.video = outcome === 'member' ? { playlist: 1 } : {}; resolve() }
    await new Promise(done => setImmediate(done))
    assert.deepEqual({ id: context.playlistId, type: context.playlistType, item: context.playlistItemId, watching: context.watchingPlaylist },
      outcome === 'member' ? { id: 'playlist', type: 'user', item: 'member', watching: true }
        : outcome === 'stale-failure' ? { id: 'new-playlist', type: 'user', item: 'new-member', watching: true }
          : { id: '', type: '', item: null, watching: false }, outcome)
  }
  assert.deepEqual(errors.map(error => error.message), ['failure', 'stale-failure'])
})

test('playlist selectors display summary counts, artwork and indexed duplicate presence', async () => {
  const source = await readFile(new URL('../../src/renderer/components/FtPlaylistSelector/FtPlaylistSelector.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*\n/gm, '')
  const count = source.match(/<div>{{ (.*?) }}<\/div>/)[1]
  for (const portable of [false, true]) {
    const videos = [{ videoId: 'saved' }, { videoId: 'saved' }, { videoId: 'saved' }]
    const props = {
      playlist: portable ? { videos } : { videos: [], videoCount: 20000, firstVideo: videos[0] },
      presenceCount: portable ? null : 3,
    }
    const result = vm.runInNewContext(`${script}\nconst playlist = props.playlist; ({ thumbnail: unref(thumbnail), count: unref(${count}), presence: loneVideoPresenceCountInPlaylist.value })`, {
      computed, ref, unref, defineProps: () => props, defineEmits: () => () => {},
      useI18n: () => ({ t: () => '' }), thumbnailPlaceholder: 'placeholder',
      getVideoThumbnailUrl: id => `thumbnail:${id}`,
      store: { getters: { getToBeAddedToPlaylistVideoList: [{ videoId: 'saved' }] } },
    })
    assert.equal(result.count, portable ? 3 : 20000)
    assert.equal(result.thumbnail, 'thumbnail:saved')
    assert.equal(result.presence, 3)
  }
})

test('playlist selection separates duplicate occurrences, distinct IDs and selected input counts', async t => {
  const engine = memory(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', videos: [{ videoId: 'saved' }, { videoId: 'saved' }, { videoId: 'other' }] })
  assert.deepEqual(playlistSelection(engine, { ids: ['saved'] }).counts, [{ id: 'p', count: 1, occurrences: 2, matchingCount: 1 }])
  assert.deepEqual(playlistSelection(engine, { ids: ['saved', 'saved', 'missing', 'other'] }).counts, [{ id: 'p', count: 2, occurrences: 3, matchingCount: 3 }])
})
