import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { babelParse, parse } from 'vue/compiler-sfc'
import * as videoCounts from '../../src/renderer/helpers/playlist-video-counts.js'

const source = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
const handlers = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

function playlist(_id, playlistName, protectedValue = false) {
  return {
    _id, playlistName, protected: protectedValue, createdAt: 1, lastUpdatedAt: 1,
    videos: [{ videoId: `${_id}-video`, playlistItemId: `${_id}-item`, timeAdded: 1, type: 'video' }],
  }
}

async function fixture(records) {
  const db = { playlists: new Datastore({ inMemoryOnly: true }) }
  await db.playlists.insertAsync(records)
  const DBPlaylistHandlers = vm.runInNewContext(
    handlers.slice(handlers.indexOf('class Playlists {'), handlers.indexOf('class SearchHistory {')) + '\nPlaylists', { db }
  )
  const errors = []
  // Observe detached writes too, so the test reports their errors as assertions.
  const pending = []
  for (const method of ['create', 'upsert', 'delete']) {
    const original = DBPlaylistHandlers[method].bind(DBPlaylistHandlers)
    DBPlaylistHandlers[method] = (...args) => {
      const result = original(...args).catch(error => { errors.push(error) })
      pending.push(result)
      return result
    }
  }
  const module = vm.runInNewContext(
    source.slice(source.indexOf('function generateRandomPlaylistId()')).replace('export default', 'globalThis.playlistsModule =') + '\nplaylistsModule',
    { DBPlaylistHandlers, ...videoCounts, processToBeAddedPlaylistVideo: () => {}, console: { error: error => errors.push(error) } }
  )
  const context = {
    state: module.state,
    rootState: { settings: { quickBookmarkTargetPlaylistId: records[0]?._id } },
    commit: (name, value) => module.mutations[name](module.state, value),
    dispatch: (name, value) => module.actions[name]?.(context, value),
  }
  return {
    db, module, errors, handlers: DBPlaylistHandlers, context,
    dispatch: context.dispatch,
    async load(options) {
      const result = await module.actions.grabAllPlaylists(context, options)
      for (let i = 0; i < pending.length; i++) await pending[i]
      return result
    },
  }
}

test('adding a playlist reports a failed database write without updating the store', async () => {
  const { db, module, errors, handlers, dispatch, load } = await fixture([playlist('favorites', 'Favorites')])
  await load()
  const failure = new Error('Playlist write failed')
  handlers.create = async () => { throw failure }
  const result = await dispatch('addPlaylist', { _id: 'new-empty', playlistName: 'New empty', videos: [] })
  assert.equal(result, false)
  assert.equal(module.state.playlists.some(item => item._id === 'new-empty'), false)
  assert.equal(await db.playlists.findOneAsync({ _id: 'new-empty' }), null)
  assert.deepEqual(errors, [failure])
})

test('adding a playlist reports a successful database write', async () => {
  const { db, errors, dispatch, load } = await fixture([playlist('favorites', 'Favorites')])
  await load()
  const result = await dispatch('addPlaylist', { _id: 'new-empty', playlistName: 'New empty', videos: [] })
  assert.equal(result, true)
  assert.equal((await db.playlists.findOneAsync({ _id: 'new-empty' })).playlistName, 'New empty')
  assert.deepEqual(errors, [])
})

for (const [id, name] of [['watchLater', 'Watch Later'], ['favorites', 'Favorites']]) {
  for (const existingDefault of [false, true]) {
    test(`loading preserves a custom ${name} playlist, default present: ${existingDefault}`, async () => {
      const records = [playlist('custom', name), playlist('other', 'Other')]
      if (existingDefault) records.push(playlist(id, `Renamed ${name}`))
      const { db, module, errors, load } = await fixture(records)
      for (let restart = 0; restart < 2; restart++) {
        await load()
        const saved = await db.playlists.findAsync({})
        assert.deepEqual(saved.sort((a, b) => a._id.localeCompare(b._id)), records.toSorted((a, b) => a._id.localeCompare(b._id)))
        assert.deepEqual(Array.from(module.state.playlists, p => p._id).sort(), records.map(p => p._id).sort())
        assert.equal(module.state.playlistsReady, true)
        assert.equal(errors.length, 0)
      }
    })
  }

  test(`loading still unlocks the renamed built-in ${name} playlist`, async () => {
    const { db, load } = await fixture([playlist(id, 'Renamed', true)])
    await load()
    assert.equal((await db.playlists.findOneAsync({ _id: id })).protected, false)
  })
}

test('a failed protection repair does not hide loaded playlists', async () => {
  const records = [playlist('watchLater', 'Watch Later', true), playlist('custom', 'My playlist')]
  const { module, errors, handlers, load } = await fixture(records)
  const failure = new Error('Storage temporarily unavailable')
  handlers.upsert = async () => { throw failure }

  await load()

  assert.equal(module.state.playlistsReady, true)
  assert.deepEqual(Array.from(module.state.playlists, p => p._id).sort(), ['custom', 'watchLater'])
  assert.deepEqual(errors, [failure])
})

for (const records of [[], [{ _id: 'restored', playlistName: 'Retained', videos: [{ videoId: 'v', description: 'keep', viewCount: 42, unknown: new Date(1) }] }, { _id: 'unselected', playlistName: 'Other', protected: true, videos: [{ videoId: 'other', description: null, viewCount: 0 }] }]]) {
  test(`read-only restore refresh preserves all playlist fields and performs no writes, count: ${records.length}`, async () => {
    const { db, module, handlers, load } = await fixture(records)
    const before = await db.playlists.findAsync({})
    for (const method of ['create', 'upsert', 'delete']) handlers[method] = () => assert.fail(`Unexpected ${method} during cache refresh`)
    assert.equal(await load({ preserveRetained: true }), true)
    assert.deepEqual(await db.playlists.findAsync({}), before)
    assert.deepEqual(structuredClone(module.state.playlists), before)
    assert.equal(module.state.playlistsReady, true)
  })
}

for (const available of [false, true]) {
  test(`restore refresh repairs only the missing quick-bookmark target, available: ${available}`, async () => {
    const records = available ? [{ _id: 'restored', playlistName: 'Retained', videos: [], unknown: new Date(1) }] : []
    const { db, module, handlers, context, load } = await fixture(records)
    const before = await db.playlists.findAsync({}), dispatches = []
    context.rootState.settings.quickBookmarkTargetPlaylistId = 'deleted'
    context.dispatch = async (name, value, options) => {
      dispatches.push([name, value, options])
      if (name === 'updateQuickBookmarkTargetPlaylistId') context.rootState.settings.quickBookmarkTargetPlaylistId = value
    }
    handlers.upsert = () => assert.fail('Bookmark fallback must not rewrite playlists')
    assert.equal(await load({ preserveRetained: true }), true)
    assert.deepEqual(structuredClone(dispatches), [['updateQuickBookmarkTargetPlaylistId', available ? 'restored' : null, { root: true }]])
    assert.deepEqual(await db.playlists.findAsync({}), before)
    assert.deepEqual(structuredClone(module.state.playlists), before)
  })
}


for (const name of [undefined, null, false, 42, { retained: true }]) {
  test(`single-playlist database export uses a safe filename without changing retained name: ${JSON.stringify(name)}`, async () => {
    const original = { _id: 'retained', ...(name === undefined ? {} : { playlistName: name }), videos: [], unknown: new Date(1) }
    const { db, module, load } = await fixture([original])
    await load({ preserveRetained: true })
    const selected = module.state.playlists.find(entry => entry._id === original._id)
    assert.deepEqual(selected, original)
    const component = await readFile(new URL('../../src/renderer/components/PlaylistInfo/PlaylistInfo.vue', import.meta.url), 'utf8')
    const script = parse(component).descriptor.scriptSetup.content
    const ast = babelParse(script, { sourceType: 'module' })
    const functions = ['getExportFilename', 'exportAsFreeTubeDatabase'].map(name => {
      const declaration = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
      assert.ok(declaration, `Missing export function ${name}`)
      return script.slice(declaration.start, declaration.end)
    }).join('\n')
    let exported
    const context = vm.createContext({
      selectedUserPlaylist: { value: selected }, props: { id: original._id },
      getTodayDateStrLocalTimezone: () => '2026-10-13',
      DBLibraryHandlers: { query: async () => await db.playlists.findOneAsync({ _id: original._id }) },
      writeFileWithPicker: async (filename, data) => { exported = { filename, data: typeof data === 'function' ? await data() : data }; return true },
      showToast: () => {}, t: key => key,
    })
    await vm.runInContext(`(async () => { ${functions}; await exportAsFreeTubeDatabase() })()`, context)
    assert.ok(exported, 'file picker must open for a retained non-string name')
    assert.equal(exported.filename, 'freetube-playlist--2026-10-13.db')
    assert.equal(exported.data, JSON.stringify(original) + '\n')
    assert.deepEqual(await db.playlists.findOneAsync({ _id: original._id }), original)
  })
}


test('read-only restore keeps opaque membership fields while Save excludes unwritable records', async () => {
  const records = [undefined, null, false, 42, 'retained', {}, [], [{ videoId: 'A' }]].map((videos, index) => ({ _id: String(index), playlistName: 'Retained', ...(videos === undefined ? {} : { videos }), unknown: new Date(index) }))
  const { db, module, handlers, context, load } = await fixture(records)
  context.rootState.settings.quickBookmarkTargetPlaylistId = '6'
  for (const method of ['create', 'upsert', 'delete']) handlers[method] = () => assert.fail(`Unexpected ${method} during retained publication`)
  assert.equal(await load({ preserveRetained: true }), true)
  assert.deepEqual(structuredClone(module.state.playlists), records)
  const component = parse(await readFile(new URL('../../src/renderer/components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const ast = babelParse(component, { sourceType: 'module' })
  const init = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'allPlaylists').init
  const eligible = vm.runInNewContext(component.slice(init.start, init.end), { computed: fn => fn(), store: { getters: { getAllPlaylists: module.state.playlists } } })
  assert.deepEqual(Array.from(eligible, playlist => playlist._id), ['6', '7'])
  assert.deepEqual(await db.playlists.findAsync({}), records)
})

test('PlaylistInfo tolerates retained scalar membership fields without normalizing records', async () => {
  const component = parse(await readFile(new URL('../../src/renderer/components/PlaylistInfo/PlaylistInfo.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const ast = babelParse(component, { sourceType: 'module' })
  const names = ['userPlaylistAnyVideoWatched', 'userPlaylistUniqueVideosCount', 'userPlaylistDuplicateItemCount', 'userPlaylistWatchedVideoCount']
  const declarations = ast.program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(declaration => names.includes(declaration.id.name)))
  for (const videos of [undefined, null, false, 42, 'retained', {}]) {
    const record = { _id: 'retained', ...(videos === undefined ? {} : { videos }), unknown: new Date(1) }
    const before = structuredClone(record)
    const context = vm.createContext({ computed: fn => ({ get value() { return fn() } }), isUserPlaylist: { value: true }, selectedUserPlaylist: { value: record }, historyCacheById: { value: {} }, playlistStatistics: { value: { total: 0, uniqueCount: 0, watchedCount: 0 } }, isHistoryEntryWatched: () => false })
    vm.runInContext(declarations.map(node => component.slice(node.start, node.end)).join('\n'), context)
    assert.equal(vm.runInContext('userPlaylistAnyVideoWatched.value', context), false)
    if (declarations.some(node => node.declarations.some(declaration => declaration.id.name === 'userPlaylistUniqueVideosCount'))) assert.equal(vm.runInContext('userPlaylistUniqueVideosCount.value', context), 0)
    assert.equal(vm.runInContext('userPlaylistDuplicateItemCount.value', context), 0)
    assert.equal(Boolean(vm.runInContext('userPlaylistWatchedVideoCount.value', context)), false)
    assert.deepEqual(record, before)
  }
})
