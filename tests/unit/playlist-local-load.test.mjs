import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, reactive, ref, shallowRef } from 'vue'

import { getPlaylistSkipAvailability } from '../../src/renderer/helpers/playlists.js'

const playlistSource = readFileSync(new URL('../../src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', import.meta.url), 'utf8')

function extractSourceBetweenMarkers(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Update the harness after changing the boundaries around ${start}`)
  return source.slice(from, to)
}

function deferred() {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject })
  return { promise, resolve, reject }
}

function harness() {
  const firstPage = deferred()
  const continuation = deferred()
  const props = reactive({ playlistId: 'youtube-playlist', videoId: 'second' })
  const playlistItems = shallowRef([])
  const randomizedPlaylistItems = shallowRef([])
  const shuffleEnabled = ref(false)
  const isFetchingPlaylistContinuation = ref(false)
  const hasUnloadedPlaylistVideos = ref(false)
  const isLoading = ref(true)
  const backendFallback = ref(false)
  const errors = []
  const context = {
    playlistLoadGeneration: 0,
    props, playlistItems, isLoading, isFetchingPlaylistContinuation, hasUnloadedPlaylistVideos,
    randomizedPlaylistItems, shuffleEnabled, loopEnabled: ref(false), computed,
    shufflePlaylistItems: () => { randomizedPlaylistItems.value = playlistItems.value.slice().reverse() },
    shuffleItems: items => items,
    playlistTitle: ref(''), playlistTotalVideoCount: ref(0), channelName: ref(''), channelId: ref(''),
    backendPreference: ref('local'), backendFallback, prevVideoBeforeDeletion: ref(null), getPlaylistSkipAvailability,
    applyReversePlaylistState: videos => videos.slice(),
    findIndexOfCurrentVideoInPlaylist: videos => videos.findIndex(item => item.videoId === props.videoId),
    parseLocalPlaylistVideos: videos => videos,
    extractNumberFromString: value => Number(value),
    getLocalPlaylist: () => firstPage.promise,
    untilEndOfLocalPlayList: async (_page, callback, options) => {
      assert.equal(options?.runCallbackOnceFirst, false)
      callback(await continuation.promise)
    },
    getPlaylistInformationInvidious: () => { throw new Error('unexpected fallback') },
    showApiErrorToast: (_message, error) => errors.push(error), showToast() {}, t: key => key,
    console: { error: error => errors.push(error) },
  }
  const load = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'async function getPlaylistInformationLocal() {', '\nasync function getPlaylistInformationInvidious(')}\ngetPlaylistInformationLocal`, context)
  const state = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'const currentVideoIndexZeroBased =', '\nwatch(')}\n;({ nextVideo, isWaitingForNextVideo })`, context)
  Object.assign(context, state)
  const skips = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'const previousVideoSourceIndex =', '\nwatch(')}\n;({ canPlayNextVideo, canPlayPreviousVideo })`, context)
  Object.assign(state, skips)
  return {
    props, playlistItems, isLoading, isFetchingPlaylistContinuation, hasUnloadedPlaylistVideos, errors, state,
    load, backendFallback,
    randomizedPlaylistItems, shuffleEnabled,
    changePlaylist: playlistId => { props.playlistId = playlistId; context.playlistLoadGeneration += 1 },
    resolveFirstPage: () => firstPage.resolve({
      info: { title: 'YouTube playlist', total_items: '100', author: { name: 'Test', id: 'channel' } },
      items: [{ videoId: 'first' }, { videoId: 'second' }],
      has_continuation: true,
    }),
    finishContinuation: items => continuation.resolve({ items }),
    failContinuation: error => continuation.reject(error),
    title: context.playlistTitle,
  }
}

test('an uncached YouTube playlist shows its first page before later pages load and autoplay waits for them', async () => {
  const state = harness()
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['first', 'second'])
  assert.equal(state.isLoading.value, false)
  assert.equal(state.isFetchingPlaylistContinuation.value, true)
  assert.equal(state.state.isWaitingForNextVideo.value, true)
  assert.equal(state.state.nextVideo.value, null)

  state.finishContinuation([{ videoId: 'third' }])
  await loading

  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['first', 'second', 'third'])
  assert.equal(state.isFetchingPlaylistContinuation.value, false)
  assert.equal(state.hasUnloadedPlaylistVideos.value, false)
  assert.equal(state.state.nextVideo.value.videoId, 'third')
})

test('a failed later page keeps the first page and clears the loading state', async () => {
  const state = harness()
  state.backendFallback.value = true
  const loading = state.load()
  state.resolveFirstPage()
  const failure = new Error('Continuation failed')
  state.failContinuation(failure)
  await loading

  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['first', 'second'])
  assert.equal(state.isLoading.value, false)
  assert.equal(state.isFetchingPlaylistContinuation.value, false)
  assert.ok(state.errors.includes(failure))
})

test('a slow playlist fetch cannot replace a different playlist opened afterwards', async () => {
  const state = harness()
  const loading = state.load()
  state.changePlaylist('different-playlist')
  state.playlistItems.value = [{ videoId: 'different' }]
  state.title.value = 'Different playlist'
  state.isLoading.value = false
  state.resolveFirstPage()
  state.finishContinuation([{ videoId: 'third' }])
  await loading

  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['different'])
  assert.equal(state.title.value, 'Different playlist')
  assert.equal(state.isFetchingPlaylistContinuation.value, false)
  assert.equal(state.errors.length, 0)
})

test('a slow playlist fetch cannot replace a later visit of the same playlist', async () => {
  const state = harness()
  const loading = state.load()
  state.changePlaylist('different-playlist')
  state.changePlaylist('youtube-playlist')
  state.playlistItems.value = [{ videoId: 'newer' }]
  state.title.value = 'Newer load'
  state.isLoading.value = false
  state.resolveFirstPage()
  state.finishContinuation([{ videoId: 'third' }])
  await loading

  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['newer'])
  assert.equal(state.title.value, 'Newer load')
  assert.equal(state.isFetchingPlaylistContinuation.value, false)
})

test('a new playlist rebuilds the shuffled order instead of extending the previous one', async () => {
  const state = harness()
  state.shuffleEnabled.value = true
  state.randomizedPlaylistItems.value = [{ videoId: 'previous-playlist' }]
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(state.randomizedPlaylistItems.value.map(video => video.videoId), ['second', 'first'])

  state.finishContinuation([{ videoId: 'third' }])
  await loading

  assert.deepEqual(state.randomizedPlaylistItems.value.map(video => video.videoId), ['second', 'first', 'third'])
})

test('autoplay waits for the page containing the current video instead of restarting the playlist', async () => {
  const state = harness()
  state.props.videoId = 'third'
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(state.state.isWaitingForNextVideo.value, true)
  assert.equal(state.state.nextVideo.value, null)

  state.finishContinuation([{ videoId: 'third' }, { videoId: 'fourth' }])
  await loading

  assert.equal(state.state.isWaitingForNextVideo.value, false)
  assert.equal(state.state.nextVideo.value.videoId, 'fourth')
})

test('a failed later page does not restart the playlist when the current video is not loaded', async () => {
  const state = harness()
  state.props.videoId = 'third'
  const loading = state.load()
  state.resolveFirstPage()
  state.failContinuation(new Error('Continuation failed'))
  await loading

  assert.equal(state.isFetchingPlaylistContinuation.value, false)
  assert.equal(state.hasUnloadedPlaylistVideos.value, true)
  assert.equal(state.state.isWaitingForNextVideo.value, false)
  assert.equal(state.state.nextVideo.value, null)
})

test('previous and next navigation stay unavailable while the current video may be on an unloaded page', async () => {
  const state = harness()
  state.props.videoId = 'third'
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(state.state.canPlayPreviousVideo.value, false)
  assert.equal(state.state.canPlayNextVideo.value, false)

  state.failContinuation(new Error('Continuation failed'))
  await loading

  assert.equal(state.state.canPlayPreviousVideo.value, false)
  assert.equal(state.state.canPlayNextVideo.value, false)

  state.props.videoId = 'second'
  assert.equal(state.state.canPlayPreviousVideo.value, true)
})
