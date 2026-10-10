import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, ref, watch } from 'vue'
import { createStore } from 'vuex'
import * as videoCounts from '../../src/renderer/helpers/playlist-video-counts.js'

function source(path) {
  return readFileSync(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
}

function withoutImports(code) {
  return code.replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
}

function playlistStore(playlists) {
  const module = vm.runInNewContext(
    withoutImports(source('store/modules/playlists.js')).replace('export default', 'const module =') + '\nmodule',
    { process: { env: { IS_ELECTRON: false } }, ...videoCounts }
  )
  module.state.targetId = 'favorites'
  module.getters.getQuickBookmarkTargetPlaylistId = state => state.targetId
  module.getters.getPlaylistBookmarks = () => []
  module.getters.getUserPlaylistsSortBy = () => 'name_ascending'
  const store = createStore(module)
  store.commit('setAllPlaylists', playlists)
  return store
}

function overview(store, { desktop = false, query = async () => ({ matches: [] }) } = {}) {
  const code = withoutImports(source('views/UserPlaylists/UserPlaylists.vue').split('<script setup>')[1].split('</script>')[0])
  const pending = new Set()
  const cleanups = []
  const scope = effectScope()
  const api = scope.run(() => vm.runInNewContext(`${code}\n;({ activeData, query, handleQueryChange, filterPlaylist, doSearchPlaylistsWithMatchingVideos })`, {
    computed, ref, watch, store, console,
    process: { env: { IS_ELECTRON: desktop } }, DBLibraryHandlers: { query },
    onMounted() {}, onBeforeUnmount: callback => cleanups.push(callback),
    useTemplateRef: () => ref(null),
    useI18n: () => ({ locale: ref('en-US'), t: key => key }),
    useTabContext: () => ({ tabId: 'test' }),
    useRouter: () => ({ replace: async () => {} }), useRoute: () => ({ query: {} }),
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { removeEventListener() {} },
    getIconForSortPreference() {},
    isValidPlaylistBookmark: () => true, playlistBookmarkToListData: value => value,
    debounce(callback) {
      const wrapped = () => pending.add(callback)
      wrapped.cancel = () => pending.delete(callback)
      return wrapped
    },
  }))
  return {
    api,
    flushSearch() { for (const callback of pending) callback(); pending.clear() },
    stop() { for (const cleanup of cleanups) cleanup(); scope.stop() },
  }
}

test('desktop playlist overview finds saved video metadata using worker matches and discards stale responses', async () => {
  const store = playlistStore([
    { _id: 'first', playlistName: 'First', videoCount: 20000, videos: [] },
    { _id: 'second', playlistName: 'Second', videoCount: 20000, videos: [] },
  ])
  let finishFirst
  const harness = overview(store, { desktop: true, query: async (method, options) => {
    assert.equal(method, 'playlistSelection')
    assert.deepEqual([...options.ids], [])
    if (options.query === 'tail author') return new Promise(resolve => { finishFirst = resolve })
    return { matches: ['second'] }
  } })
  try {
    harness.api.handleQueryChange('Tail author', undefined, true, true)
    await nextTick()
    harness.api.handleQueryChange('Other author', undefined, true, true)
    await new Promise(resolve => setImmediate(resolve))
    await nextTick()
    assert.deepEqual(Array.from(harness.api.activeData.value, playlist => playlist._id), ['second'])
    finishFirst({ matches: ['first'] })
    await new Promise(resolve => setImmediate(resolve))
    await nextTick()
    assert.deepEqual(Array.from(harness.api.activeData.value, playlist => playlist._id), ['second'])
  } finally { harness.stop() }
})

test('100 quick-bookmark controls share one scan of a 10,000-video playlist', () => {
  let reads = 0
  const videos = Array.from({ length: 10_000 }, (_, index) => ({
    get videoId() { reads++; return `video-${index}` },
  }))
  const store = playlistStore([{ _id: 'favorites', videos }])
  const code = source('components/FtListVideo/FtListVideo.vue')
  const membership = code.slice(code.indexOf('const isInQuickBookmarkPlaylist ='), code.indexOf('const quickBookmarkIconText ='))
  reads = 0
  for (let index = 0; index < 100; index++) {
    const control = vm.runInNewContext(`${membership}\nisInQuickBookmarkPlaylist`, {
      computed, store, id: ref(`missing-${index}`),
      quickBookmarkPlaylist: computed(() => store.getters.getQuickBookmarkPlaylist),
      isQuickBookmarkEnabled: ref(true),
    })
    assert.equal(control.value, false)
  }
  console.log('Quick-bookmark video ID reads:', reads)
  assert.ok(reads <= 10_000, `100 controls should scan the target once, read ${reads} IDs`)
})

test('idle playlist overview never traverses the saved video metadata', async () => {
  let reads = 0
  const videos = Array.from({ length: 10_000 }, () => ({
    videoId: 'video',
    get title() { reads++; return 'Video title' },
    description: 'Unused metadata',
  }))
  const store = playlistStore([{ _id: 'favorites', playlistName: 'Favorites', videos }])
  const harness = overview(store)
  try {
    const mountReads = reads
    reads = 0
    store.state.playlists[0].videos[0].description = 'Changed elsewhere'
    await nextTick()
    console.log('Idle playlist title reads:', { mount: mountReads, metadataUpdate: reads })
    assert.equal(mountReads, 0)
    assert.equal(reads, 0)
    assert.equal(harness.api.activeData.value[0]._id, 'favorites')
  } finally {
    harness.stop()
  }
})

test('bookmark membership follows duplicate removal, replacement and target changes', () => {
  const store = playlistStore([
    { _id: 'favorites', videos: [
      { videoId: 'saved', playlistItemId: 'first' },
      { videoId: 'saved', playlistItemId: 'second' },
    ] },
    { _id: 'other', videos: [{ videoId: 'other-video' }] },
  ])
  const initial = store.getters.getQuickBookmarkVideoIds
  assert.ok(initial.has('saved'))
  store.commit('addVideo', { _id: 'other', videoData: { videoId: 'unrelated' } })
  assert.equal(store.getters.getQuickBookmarkVideoIds, initial, 'unrelated playlist edits preserve the index')
  store.commit('removeVideo', { _id: 'favorites', playlistItemId: 'first' })
  assert.ok(store.getters.getQuickBookmarkVideoIds.has('saved'))
  store.commit('removeVideo', { _id: 'favorites', playlistItemId: 'second' })
  assert.ok(!store.getters.getQuickBookmarkVideoIds.has('saved'))
  store.commit('upsertPlaylistToList', { _id: 'favorites', videos: [{ videoId: 'replacement' }] })
  assert.ok(store.getters.getQuickBookmarkVideoIds.has('replacement'))
  store.state.targetId = 'other'
  assert.ok(store.getters.getQuickBookmarkVideoIds.has('other-video'))
  assert.ok(!store.getters.getQuickBookmarkVideoIds.has('replacement'))
  store.commit('removePlaylist', 'other')
  assert.equal(store.getters.getQuickBookmarkVideoIds.size, 0)
})

test('bulk playlist removal indexes selected entries once', () => {
  const store = playlistStore([{ _id: 'favorites', videos: Array.from({ length: 1000 }, (_, index) => ({
    videoId: `video-${index}`, playlistItemId: `item-${index}`,
  })) }])
  let reads = 0
  const playlistItemIds = new Proxy(Array.from({ length: 500 }, (_, index) => `item-${index}`), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  store.commit('removeVideos', { _id: 'favorites', playlistItemIds, lastUpdatedAt: 2 })
  assert.equal(store.getters.getPlaylist('favorites').videos.length, 500)
  assert.equal(store.getters.getPlaylist('favorites').videos[0].videoId, 'video-500')
  assert.ok(!store.getters.getPlaylistVideoCounts.has('video-0'))
  assert.ok(store.getters.getPlaylistVideoCounts.has('video-500'))
  console.log('Bulk removal selection ID reads:', reads)
  assert.ok(reads <= 500, `expected one pass over the selection, got ${reads} reads`)
})

test('playlist search stays debounced and reacts to matching video edits outside the first page', async () => {
  const playlists = Array.from({ length: 105 }, (_, index) => ({
    _id: `playlist-${index}`, playlistName: `Playlist ${String(index).padStart(3, '0')}`,
    videos: [{ videoId: `video-${index}`, title: 'Original title', author: 'Creator' }],
  }))
  const store = playlistStore(playlists)
  const harness = overview(store)
  try {
    harness.api.handleQueryChange('needle', undefined, true)
    await nextTick()
    assert.equal(harness.api.activeData.value.length, 100, 'typing retains results until debounce fires')
    harness.flushSearch()
    await nextTick()
    assert.equal(harness.api.activeData.value.length, 0)
    store.state.playlists[104].videos[0].title = 'Contains needle'
    await nextTick()
    harness.flushSearch()
    await nextTick()
    assert.deepEqual(Array.from(harness.api.activeData.value, playlist => playlist._id), ['playlist-104'])
    store.state.playlists[104].videos[0].title = 'No match'
    await nextTick()
    harness.flushSearch()
    await nextTick()
    assert.equal(harness.api.activeData.value.length, 0)
  } finally {
    harness.stop()
  }
})
