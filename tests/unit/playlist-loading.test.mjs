import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { babelParse, parse } from 'vue/compiler-sfc'
import * as videoCounts from '../../src/renderer/helpers/playlist-video-counts.js'
import { babelParse, parse } from 'vue/compiler-sfc'
import { ref } from 'vue'

const source = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
const handlers = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

function playlist(_id, playlistName, protectedValue = false) {
  return {
    _id, playlistName, protected: protectedValue, createdAt: 1, lastUpdatedAt: 1,
    videos: [{ videoId: `${_id}-video`, playlistItemId: `${_id}-item`, timeAdded: 1, type: 'video' }],
  }
}

async function fixture(records, quickBookmarkTargetPlaylistId = records[0]?._id) {
  const db = { playlists: new Datastore({ inMemoryOnly: true }) }
  await db.playlists.insertAsync(records)
  const DBPlaylistHandlers = vm.runInNewContext(
    handlers.slice(handlers.indexOf('class Playlists {'), handlers.indexOf('class SearchHistory {')) + '\nPlaylists', { db }
  )
  const errors = []
  const dispatched = []
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
    { process: { env: { IS_ELECTRON: false } }, DBPlaylistHandlers, ...videoCounts, processToBeAddedPlaylistVideo: () => {}, console: { error: error => errors.push(error) } }
  )
  const context = {
    state: module.state,
    rootState: { settings: { quickBookmarkTargetPlaylistId } },
    commit: (name, value) => module.mutations[name](module.state, value),
    dispatch: (name, value) => { dispatched.push([name, value]); return module.actions[name]?.(context, value) },
  }
  return {
    db, module, errors, handlers: DBPlaylistHandlers, dispatched, context,
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
for (const videos of [undefined, null, false, 'retained', { unknown: true }, [null, false, 'retained'], [{}, { videoId: null }, { videoId: 42 }, { videoId: '' }, new Date(1)]]) {
  test(`portable startup retains opaque playlist members ${JSON.stringify(videos)}`, async () => {
    const record = { ...playlist('legacy', 'Retained'), ...(videos === undefined ? {} : { videos }) }
    if (videos === undefined) delete record.videos
    const { db, module, errors, load } = await fixture([record], null)
    await load()
    assert.deepEqual(await db.playlists.findOneAsync({ _id: record._id }), record)
    assert.equal(module.state.playlistsReady, true)
    assert.deepEqual(errors, [])
    assert.equal(module.state.playlists[0]._id, record._id)
    assert.deepEqual([...module.getters.getQuickBookmarkVideoIds(module.state, { getQuickBookmarkPlaylist: module.state.playlists[0] })], [])
  })
}

test('playlist card metadata tolerates retained scalar fields without changing the playlist', async () => {
  const component = await readFile(new URL('../../src/renderer/components/FtListPlaylist/FtListPlaylist.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const initializer = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'playlistMetadata').init
  for (const videos of [undefined, null, false, 42, 'retained', {}, [null], [{ videoId: 42 }]]) {
    const data = { _id: 'legacy', playlistName: 'Retained', ...(videos === undefined ? {} : { videos }) }, before = structuredClone(data)
    const metadata = vm.runInNewContext(script.slice(initializer.start, initializer.end), {
      computed: callback => callback(), isUserPlaylist: { value: true }, props: { data }, thumbnailPlaceholder: 'placeholder', store: { state: { playlists: { libraryPaged: false } } },
      backendPreference: { value: 'local' }, currentInvidiousInstanceUrl: { value: 'instance' },
    })
    assert.equal(metadata.thumbnailUrl, 'placeholder')
    assert.equal(metadata.videoCount, Array.isArray(videos) ? videos.length : 0)
    assert.deepEqual(data, before)
  }
})

for (const hasEditable of [false, true]) {
  test(`automatic bookmarks skip opaque playlists, array-backed present: ${hasEditable}`, async () => {
    const opaque = { ...playlist('a-opaque', 'Opaque'), videos: 'retained', unknown: new Date(1) }
    const protectedPlaylist = { ...playlist('b-protected', 'Protected', true), videos: { retained: true } }
    const editable = playlist('z-editable', 'Writable protected list', true)
    const records = [opaque, protectedPlaylist, ...(hasEditable ? [editable] : [])]
    const { db, module, errors, dispatched, load } = await fixture(records, null)
    await load()
    assert.deepEqual(dispatched.filter(([name]) => name === 'updateQuickBookmarkTargetPlaylistId'), hasEditable ? [['updateQuickBookmarkTargetPlaylistId', editable._id]] : [])
    assert.equal(module.state.playlistsReady, true)
    assert.deepEqual(errors, [])
    for (const record of records) assert.deepEqual(await db.playlists.findOneAsync({ _id: record._id }), record)
  })
}

for (const hasEditable of [false, true]) {
  test(`an existing opaque bookmark target is replaced or disabled, editable present: ${hasEditable}`, async () => {
    const opaque = { ...playlist('opaque', 'Opaque'), videos: null, unknown: new Date(1) }
    const records = [opaque, ...(hasEditable ? [playlist('editable', 'Editable')] : [])]
    const { db, module, errors, dispatched, load } = await fixture(records, opaque._id)
    await load()
    assert.deepEqual(dispatched.filter(([name]) => name === 'updateQuickBookmarkTargetPlaylistId'), [
      ['updateQuickBookmarkTargetPlaylistId', hasEditable ? 'editable' : null],
    ])
    assert.equal(module.getters.getQuickBookmarkPlaylist(module.state, { getQuickBookmarkTargetPlaylistId: 'opaque' }), undefined)
    assert.deepEqual(errors, [])
    for (const record of records) assert.deepEqual(await db.playlists.findOneAsync({ _id: record._id }), record)
  })
}

test('removing a known portable playlist member keeps opaque members and refreshes the index', async () => {
  const valid = { videoId: 'valid', playlistItemId: 'item', unknown: new Date(3) }
  const record = { ...playlist('p', 'Retained'), videos: [null, false, {}, valid] }
  const { db, module, errors, load, context } = await fixture([record])
  await load()
  assert.equal(await module.actions.removeVideo(context, { _id: 'p', videoId: 'valid', playlistItemId: 'item' }), true)
  assert.deepEqual(Array.from(module.state.playlists[0].videos), record.videos.slice(0, -1))
  assert.equal(module.state.playlistVideoCounts.has('valid'), false)
  assert.deepEqual((await db.playlists.findOneAsync({ _id: 'p' })).videos, record.videos.slice(0, -1))
  assert.deepEqual(errors, [])
})

test('portable playback skips opaque members without rewriting their stored playlist', async () => {
  const component = await readFile(new URL('../../src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const valid = { videoId: 'valid', playlistItemId: 'item', title: 'Valid' }
  for (const videos of [null, false, 'retained', [null, false, {}, { videoId: 42 }, valid]]) {
    const playlist = { _id: 'p', playlistName: 'Retained', videos }, before = structuredClone(playlist)
    const context = vm.createContext({
      computed: getter => ({ get value() { return getter() } }),
      isUserPlaylist: { value: true }, isPagedPlaylist: { value: false }, selectedUserPlaylist: { value: playlist },
      store: { getters: { getHistoryCacheById: { valid: { isWatched: true } } } },
      isHistoryEntryWatched: history => history?.isWatched === true,
      props: { playlistItemId: 'item', videoId: 'valid' }, prevVideoBeforeDeletion: { value: null },
      playlistTitle: ref(''), channelName: ref(''), channelId: ref(''), playlistItems: ref([]),
      currentVideoIndexZeroBased: ref(-1), sortOrder: ref('custom'), locale: ref('en-US'), reversePlaylist: ref(false), isLoading: ref(true),
      getSortedPlaylistItems: items => items,
    })
    for (const node of ast.program.body.filter(node => node.type === 'FunctionDeclaration' && ['getPlayableUserPlaylistVideos', 'findIndexOfCurrentVideoInPlaylist', 'parseUserPlaylist'].includes(node.id.name))) {
      vm.runInContext(script.slice(node.start, node.end), context)
    }
    const initializer = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'userPlaylistWatchedVideoCount').init
    assert.equal(vm.runInContext(script.slice(initializer.start, initializer.end), context).value, Array.isArray(videos) ? 1 : 0)
    context.parseUserPlaylist(playlist)
    assert.deepEqual(Array.from(context.playlistItems.value), Array.isArray(videos) ? [valid] : [])
    assert.deepEqual(playlist, before)
  }
})


test('portable Watch reorders playable slots without deleting opaque members or metadata', async () => {
  const component = await readFile(new URL('../../src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const a = { videoId: 'A', unknown: new Date(1) }, b = { videoId: 'B', unknown: new Date(2) }
  for (const reverse of [false, true]) {
    const playlist = { _id: 'p', playlistName: 'Retained', unknown: new Date(3), videos: [a, null, 'opaque', new Date(4), b] }
    const before = structuredClone(playlist)
    let written
    const context = vm.createContext({ selectedUserPlaylist: { value: playlist }, reversePlaylist: ref(reverse), isPagedPlaylist: ref(false),
      deepCopy: value => structuredClone(value),
      store: { dispatch: async (_method, data) => { written = data; return true } }, console, showToast() {}, t: key => key,
    })
    for (const node of ast.program.body.filter(node => node.type === 'FunctionDeclaration' && ['getPlayableUserPlaylistVideos', 'persistPlaylistOrder'].includes(node.id.name))) vm.runInContext(script.slice(node.start, node.end), context)
    await context.persistPlaylistOrder(reverse ? [a, b] : [b, a])
    assert.deepEqual(structuredClone(written), { ...playlist, videos: [b, null, 'opaque', new Date(4), a] })
    assert.deepEqual(playlist, before)
  }
})

test('playlist selector thumbnails and counts tolerate every retained membership shape', async () => {
  const component = await readFile(new URL('../../src/renderer/components/FtPlaylistSelector/FtPlaylistSelector.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const declarations = ast.program.body.flatMap(node => node.declarations ?? [])
  for (const videos of [undefined, null, false, 42, 'opaque', [null], [{ videoId: 42 }], [{ videoId: 'A' }]]) {
    const playlist = { videos }, before = structuredClone(playlist)
    const context = vm.createContext({ computed: getter => ({ get value() { return getter() } }), props: { playlist }, store: { state: { playlists: { libraryPaged: false } } },
      thumbnailPlaceholder: 'placeholder', backendPreference: ref('local'), currentInvidiousInstanceUrl: ref('instance'), getVideoThumbnailUrl: () => 'valid',
    })
    for (const name of ['videoCount', 'thumbnail']) {
      const init = declarations.find(node => node.id.name === name).init
      const result = vm.runInContext(script.slice(init.start, init.end), context).value
      assert.equal(result, name === 'videoCount' ? (Array.isArray(videos) ? videos.length : 0) : videos?.[0]?.videoId === 'A' ? 'valid' : 'placeholder')
    }
    assert.deepEqual(playlist, before)
  }
})


test('portable Home and Save readers preserve opaque playlist records', async () => {
  const playlists = [{ _id: 'opaque', playlistName: 'Opaque', videos: null, unknown: new Date(1) }, { _id: 'retained', playlistName: 'Retained', videos: [null, 'opaque', { videoId: 'A' }] }]
  const before = structuredClone(playlists)
  const home = parse(await readFile(new URL('../../src/renderer/views/Home/Home.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const homeAst = babelParse(home, { sourceType: 'module' })
  const homeInit = homeAst.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'recentPlaylists').init
  const countInit = homeAst.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'playlistVideoCount')?.init
  const playlistVideoCount = countInit ? vm.runInNewContext(home.slice(countInit.start, countInit.end), { store: { state: { playlists: { libraryPaged: false } } } }) : null
  const recent = vm.runInNewContext(home.slice(homeInit.start, homeInit.end), { playlistVideoCount, computed: getter => getter(), store: { getters: { getAllPlaylists: playlists } } })
  assert.deepEqual(Array.from(recent, playlist => playlist._id), ['opaque', 'retained'])
  const prompt = parse(await readFile(new URL('../../src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const promptAst = babelParse(prompt, { sourceType: 'module' })
  const filter = promptAst.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'getPlaylistIdsFiltered').init
  const ids = vm.runInNewContext(prompt.slice(filter.start, filter.end), { allPlaylists: ref(playlists), toBeAddedToPlaylistVideoIdList: ref(['A']) })( (incoming, members) => incoming.some(id => members.has(id)) )
  assert.deepEqual([...ids], ['retained'])
  assert.deepEqual(playlists, before)
})


test('Home renders retained opaque memberships with counts and safe thumbnail placeholders', async () => {
  const component = await readFile(new URL('../../src/renderer/views/Home/Home.vue', import.meta.url), 'utf8')
  const parsed = parse(component).descriptor, script = parsed.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const count = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'playlistVideoCount')
  assert.ok(count, 'the template and thumbnail helper share the retained membership count')
  assert.doesNotMatch(parsed.template.content, /playlist\.videos\.length/)
  const thumbnail = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'playlistThumbnail')
  const context = vm.createContext({ thumbnailPlaceholder: 'placeholder', videoThumbnail: () => 'video', store: { state: { playlists: { libraryPaged: false } } } })
  vm.runInContext(script.slice(count.start, count.end), context)
  vm.runInContext(script.slice(thumbnail.start, thumbnail.end), context)
  for (const videos of [undefined, null, false, 42, 'retained', [], [null], [{ videoId: 42 }]]) {
    assert.equal(context.playlistThumbnail({ videos }), 'placeholder')
  }
  assert.equal(context.playlistThumbnail({ videos: [{ videoId: 'A' }] }), 'video')
})

test('portable matching-video search ignores opaque playlist members without altering them', async () => {
  const component = await readFile(new URL('../../src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const init = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'activePlaylists').init
  const playlists = [
    { _id: 'scalar', playlistName: 'Scalar', videos: 42 },
    { _id: 'opaque', playlistName: 'Opaque', videos: [null, 42, false, {}, { title: 42, author: 42 }] },
    { _id: 'matching', playlistName: 'Matching', videos: [{ title: 'Needle', author: null }] },
  ]
  const before = structuredClone(playlists)
  const context = { process: { env: { IS_ELECTRON: false } }, computed: getter => getter(), processedQuery: ref('needle'), doSearchPlaylistsWithMatchingVideos: ref(true), allPlaylists: ref(playlists) }
  const results = vm.runInNewContext(script.slice(init.start, init.end), context)
  assert.deepEqual(Array.from(results, playlist => playlist._id), ['matching'])
  assert.deepEqual(playlists, before)
})

test('portable Save preserves hidden members and distinct incoming occurrences', async () => {
  const component = await readFile(new URL('../../src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const action = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'addSelectedToPlaylists')
  for (const allowDuplicates of [false, true]) {
    const playlists = [{ _id: 'p', videos: [null, false, { unknown: true }, { videoId: 'old' }] }]
    const before = structuredClone(playlists)
    const incoming = [{ videoId: 'old' }, { videoId: 'new', title: 'First' }, { videoId: 'new', title: 'Second' }]
    const calls = []
    const context = vm.createContext({
      process: { env: { IS_ELECTRON: false } }, addInProgress: false,
      allPlaylists: ref(playlists), selectedPlaylistIdList: ref(['p']), addingDuplicateVideosEnabled: ref(allowDuplicates),
      toBeAddedToPlaylistVideoList: ref(incoming), store: { dispatch: (action, payload) => calls.push({ action, payload }) },
      showToast() {}, t: key => key, hide() {},
    })
    vm.runInContext(script.slice(action.start, action.end), context)
    await context.addSelectedToPlaylists()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].action, 'addVideos')
    assert.deepEqual(Array.from(calls[0].payload.videos), allowDuplicates ? incoming : incoming.slice(1))
    assert.deepEqual(playlists, before)
  }
})


test('portable overview search tolerates retained memberships and names without rewriting records', async () => {
  const component = await readFile(new URL('../../src/renderer/views/UserPlaylists/UserPlaylists.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const init = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'filteredPlaylists').init
  const playlists = [
    ...[undefined, null, false, 42, 'retained', {}].map((videos, index) => ({ _id: `scalar-${index}`, playlistName: 'Scalar', videos })),
    { _id: 'opaque', playlistName: 'Opaque', videos: [null, false, {}, { title: 42, author: 42 }] },
    { _id: 'by-title', playlistName: 'Title', videos: [null, { title: 'Needle', author: null }] },
    { _id: 'by-author', playlistName: 'Author', videos: [{ author: 'Needle', title: null }] },
    { _id: 'unnamed', playlistName: null, videos: [{ title: 'Needle' }], unknown: new Date(1) },
  ]
  const before = structuredClone(playlists)
  const results = vm.runInNewContext(script.slice(init.start, init.end), {
    process: { env: { IS_ELECTRON: false } }, computed: getter => getter(),
    appliedQuery: ref('needle'), doSearchPlaylistsWithMatchingVideos: ref(true), allPlaylists: ref(playlists),
  })
  assert.deepEqual(Array.from(results, playlist => playlist._id), ['by-title', 'by-author', 'unnamed'])
  assert.deepEqual(playlists, before)
})


test('Save displays and searches retained missing or non-string names without rewriting them', async () => {
  const component = await readFile(new URL('../../src/renderer/components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue', import.meta.url), 'utf8')
  const script = parse(component).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const init = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'filteredPlaylists').init
  const labels = [undefined, null, false, 42, [], {}, 'Named']
  const playlists = labels.map((playlistName, index) => ({ _id: String(index), ...(playlistName === undefined ? {} : { playlistName }), unknown: new Date(index) }))
  const before = structuredClone(playlists)
  const context = vm.createContext({ computed: getter => getter(), playlists: ref(playlists), search: ref(''), t: key => key })
  const helper = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'playlistDisplayName')
  if (helper) vm.runInContext(script.slice(helper.start, helper.end), context)
  assert.deepEqual(Array.from(vm.runInContext(script.slice(init.start, init.end), context), playlist => playlist._id), playlists.map(playlist => playlist._id))
  context.search.value = 'playlists'
  assert.deepEqual(Array.from(vm.runInContext(script.slice(init.start, init.end), context), playlist => playlist._id), playlists.slice(0, -1).map(playlist => playlist._id))
  assert.deepEqual(playlists, before)
})


test('Save handles retained scalar and opaque memberships without changing records', async () => {
  const parsed = parse(await readFile(new URL('../../src/renderer/components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue', import.meta.url), 'utf8')).descriptor
  const script = parsed.scriptSetup.content, ast = babelParse(script, { sourceType: 'module' })
  const init = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'containedIds').init
  const playlists = [null, false, 42, 'retained', [null, false], [null, { videoId: 'A' }]].map((videos, index) => ({ _id: String(index), videos, unknown: new Date(index) }))
  const before = structuredClone(playlists)
  const context = vm.createContext({ computed: getter => getter(), allPlaylists: ref(playlists), props: { videoData: { videoId: 'A' } }, store: { state: { playlists: { libraryPaged: false } } }, thumbnailPlaceholder: 'placeholder', getVideoThumbnailUrl: () => 'video' })
  const ids = vm.runInContext(script.slice(init.start, init.end), context)
  assert.deepEqual([...ids], ['5'])
  for (const name of ['playlistVideoCount', 'playlistThumbnail']) {
    const declaration = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
    vm.runInContext(script.slice(declaration.start, declaration.end), context)
  }
  for (const playlist of playlists) {
    assert.equal(context.playlistVideoCount(playlist), Array.isArray(playlist.videos) ? playlist.videos.length : 0)
    assert.equal(context.playlistThumbnail(playlist), 'placeholder')
  }
  assert.doesNotMatch(parsed.template.content, /playlist\.videos\.length/)
  assert.deepEqual(playlists, before)
})


test('paged playlist repair refreshes summaries after durable metadata changes', async () => {
  const ast = babelParse(source, { sourceType: 'module' })
  const actions = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'actions').init
  const method = actions.properties.find(property => property.key.name === 'repairPlaylistMetadata')
  let updates = [{ _id: 'p', changes: [{ videoId: 'A', fields: { title: 'Repaired' } }] }]
  const repair = vm.runInNewContext('({' + source.slice(method.start, method.end) + '}).repairPlaylistMetadata', {
    DBPlaylistHandlers: { repairMetadata: async () => ({ updates, repaired: updates.length, failed: 0 }) },
  })
  const calls = []
  const context = { state: { libraryPaged: true }, commit: () => assert.fail('paged summaries must not receive whole-member patches'), dispatch: async action => { calls.push(action) } }
  assert.deepEqual(structuredClone(await repair(context, {})), { repaired: 1, failed: 0 })
  assert.deepEqual(calls, ['grabAllPlaylists'])
  updates = []
  assert.deepEqual(structuredClone(await repair(context, {})), { repaired: 0, failed: 0 })
  assert.deepEqual(calls, ['grabAllPlaylists'])
})


test('cross-window playlist repairs invalidate paged summaries and patch portable entries', async () => {
  const { SyncEvents } = await import('../../src/constants.js')
  const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const listener = source.slice(source.indexOf('window.ftElectron.handleSyncPlaylists('), source.indexOf('window.ftElectron.handleSyncSubscriptionCache('))
  for (const libraryPaged of [false, true]) {
    let receive
    const calls = []
    vm.runInNewContext(listener, { SyncEvents, rootState: { playlists: { libraryPaged } }, console,
      window: { ftElectron: { handleSyncPlaylists: callback => { receive = callback } } },
      dispatch: async action => { calls.push(['dispatch', action]) }, commit: (...args) => calls.push(['commit', ...args]),
    })
    const update = { _id: 'p', changes: [] }
    receive(SyncEvents.PLAYLISTS.REPAIR_METADATA, update)
    assert.deepEqual(calls, libraryPaged ? [['dispatch', 'grabAllPlaylists']] : [['commit', 'applyPlaylistMetadataRepairs', update]])
  }
})

for (const paged of [false, true]) {
  test(`playlist cards, selectors and Save counts distinguish full records from paged summaries: ${paged}`, async () => {
    const files = ['FtListPlaylist', 'FtPlaylistSelector', 'FtAddToPlaylistDropdown']
    const scripts = await Promise.all(files.map(async name => {
      const content = parse(await readFile(new URL(`../../src/renderer/components/${name}/${name}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content
      return { name, content, ast: babelParse(content, { sourceType: 'module' }) }
    }))
    for (const videos of [undefined, null, 42, [], [{ videoId: 'real' }, { videoId: 'real' }]]) {
      for (const staleCount of [0, 42]) {
        const data = { _id: 'retained', playlistName: 'Retained', videoCount: paged ? 20000 : staleCount, videos, unknown: new Date(1) }
        if (paged) data.firstVideo = { videoId: 'real' }
        const before = structuredClone(data), expectedCount = paged ? 20000 : Array.isArray(videos) ? videos.length : 0
        for (const { name, content, ast } of scripts) {
          const context = vm.createContext({ computed: callback => callback(), isUserPlaylist: { value: true }, props: { data, playlist: data },
            store: { state: { playlists: { libraryPaged: paged } }, getters: { getBackendPreference: 'local', getCurrentInvidiousInstanceUrl: 'instance' } },
            thumbnailPlaceholder: 'placeholder', getVideoThumbnailUrl: videoId => `thumbnail:${videoId}`, backendPreference: ref('local'), currentInvidiousInstanceUrl: ref('instance'),
          })
          if (name === 'FtAddToPlaylistDropdown') {
            for (const method of ['playlistVideoCount', 'playlistThumbnail']) {
              const declaration = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === method)
              vm.runInContext(content.slice(declaration.start, declaration.end), context)
            }
            assert.equal(context.playlistVideoCount(data), expectedCount)
            assert.equal(context.playlistThumbnail(data), expectedCount && (paged || videos?.[0]?.videoId === 'real') ? 'thumbnail:real' : 'placeholder')
          } else {
            const key = name === 'FtListPlaylist' ? 'playlistMetadata' : 'videoCount'
            const declaration = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === key)
            const result = vm.runInContext(content.slice(declaration.init.start, declaration.init.end), context)
            assert.equal(name === 'FtListPlaylist' ? result.videoCount : result, expectedCount)
          }
        }
        assert.deepEqual(data, before)
      }
    }
  })
}
