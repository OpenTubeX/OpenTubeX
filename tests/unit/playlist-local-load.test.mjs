import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, reactive, ref, shallowRef, triggerRef, watch } from 'vue'

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

function harness({ random } = {}) {
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
  let continuationRequests = 0
  const unmountCallbacks = []
  const reversePlaylist = ref(false)
  const loopEnabled = ref(false)
  const context = {
    ...(random ? { Math: Object.create(Math, { random: { value: random } }) } : {}),
    onBeforeUnmount: callback => unmountCallbacks.push(callback),
    playlistLoadGeneration: 0,
    props, playlistItems, isLoading, isFetchingPlaylistContinuation, hasUnloadedPlaylistVideos,
    playlistContinuationFailed: ref(false), playlistPanelNearEnd: ref(false), requestedPlaylistVideoCount: ref(0),
    randomizedPlaylistItems, shuffleEnabled, loopEnabled, reversePlaylist, computed, watch, nextTick, triggerRef,
    updatePlaylistPanelNearEnd() {},
    shufflePlaylistItems: () => { randomizedPlaylistItems.value = playlistItems.value.slice().reverse() },
    shuffleItems: items => items,
    playlistTitle: ref(''), playlistTotalVideoCount: ref(0), channelName: ref(''), channelId: ref(''),
    backendPreference: ref('local'), backendFallback, prevVideoBeforeDeletion: ref(null), getPlaylistSkipAvailability,
    applyReversePlaylistState: videos => videos.slice(),
    findIndexOfCurrentVideoInPlaylist: videos => videos.findIndex(item => item.videoId === props.videoId),
    parseLocalPlaylistVideos: videos => videos,
    parseVisibleLocalPlaylistVideos: videos => videos,
    extractNumberFromString: value => Number(value),
    getLocalPlaylist: () => firstPage.promise,
    getLocalPlaylistContinuation: () => {
      continuationRequests++
      return continuation.promise
    },
    getPlaylistInformationInvidious: () => { throw new Error('unexpected fallback') },
    showApiErrorToast: (_message, error) => errors.push(error), showToast() {}, t: key => key,
    console: { error: error => errors.push(error) },
  }
  vm.runInNewContext(extractSourceBetweenMarkers(playlistSource, '// Unmounting stops the playlist watcher', '\nlet previewAnimationFrame'), context)
  const load = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'function appendPlaylistVideos(', '\nfunction parseUserPlaylist(')}\ngetPlaylistInformationLocal`, context)
  const state = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'const currentVideoIndexZeroBased =', '\nwatch(')}\n;({ nextVideo, isWaitingForNextVideo, upcomingVideos, canLoadMorePlaylistVideos, needsMorePlaylistVideos })`, context)
  Object.assign(context, state)
  const stopLoadingOnDemand = vm.runInNewContext(extractSourceBetweenMarkers(playlistSource, 'watch(needsMorePlaylistVideos,', '\nwatch(storedReversePlaylist'), context)
  const skips = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'const previousVideoSourceIndex =', '\nwatch(')}\n;({ canPlayNextVideo, canPlayPreviousVideo })`, context)
  Object.assign(state, skips)
  return {
    props, playlistItems, isLoading, isFetchingPlaylistContinuation, hasUnloadedPlaylistVideos, errors, state,
    load, backendFallback, reversePlaylist, loopEnabled,
    get continuationRequests() { return continuationRequests },
    randomizedPlaylistItems, shuffleEnabled,
    unmount: () => { stopLoadingOnDemand(); unmountCallbacks.forEach(callback => callback()) },
    changePlaylist: playlistId => { props.playlistId = playlistId; context.playlistLoadGeneration += 1 },
    resolveFirstPage: (items = [{ videoId: 'first' }, { videoId: 'second' }]) => firstPage.resolve({
      info: { title: 'YouTube playlist', total_items: '100', author: { name: 'Test', id: 'channel' } },
      items,
      has_continuation: true,
    }),
    finishContinuation: (items, hasMore = false) => continuation.resolve({ items, has_continuation: hasMore }),
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

  const order = state.randomizedPlaylistItems.value.map(video => video.videoId)
  assert.equal(order[0], 'second')
  assert.deepEqual(order.slice(1).sort(), ['first', 'third'])
})

test('later pages are mixed into the unplayed part of the shuffled order', async () => {
  const state = harness({ random: () => 0 })
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))
  state.shuffleEnabled.value = true
  state.randomizedPlaylistItems.value = [{ videoId: 'second' }, { videoId: 'first' }]
  state.finishContinuation([{ videoId: 'third' }, { videoId: 'fourth' }])
  await loading

  assert.deepEqual(state.randomizedPlaylistItems.value.map(video => video.videoId), ['second', 'fourth', 'first', 'third'])
})

test('a page containing the not yet loaded current video restarts the shuffled order from it', async () => {
  const state = harness()
  state.props.videoId = 'fourth'
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))
  state.shuffleEnabled.value = true
  state.randomizedPlaylistItems.value = [{ videoId: 'second' }, { videoId: 'first' }]
  state.finishContinuation([{ videoId: 'third' }, { videoId: 'fourth' }])
  await loading

  assert.equal(state.randomizedPlaylistItems.value[0].videoId, 'fourth')
  assert.equal(state.randomizedPlaylistItems.value.length, 4)
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

test('switching playlists stops requesting the remaining pages of the previous one', async () => {
  const state = harness()
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))
  state.changePlaylist('different-playlist')
  state.finishContinuation([{ videoId: 'third' }], true)
  await loading

  assert.equal(state.continuationRequests, 1)
})

test('leaving the watch view stops requesting pages and reporting their errors', async () => {
  const state = harness()
  const loading = state.load()
  state.resolveFirstPage()
  await new Promise(resolve => setImmediate(resolve))
  state.unmount()
  state.failContinuation(new Error('Continuation failed'))
  await loading

  assert.equal(state.errors.length, 0)
})

const longFirstPage = Array.from({ length: 60 }, (_, index) => ({ videoId: `video${index}` }))
const settle = () => new Promise(resolve => setImmediate(resolve))

test('later pages load only once playback comes within 50 videos of the loaded end', async () => {
  const state = harness()
  state.props.videoId = 'video0'
  await (state.load(), state.resolveFirstPage(longFirstPage), settle())

  assert.equal(state.continuationRequests, 0)
  assert.equal(state.isFetchingPlaylistContinuation.value, false)
  assert.equal(state.hasUnloadedPlaylistVideos.value, true)
  assert.equal(state.state.nextVideo.value.videoId, 'video1')
  assert.equal(state.state.canPlayNextVideo.value, true)
  // Loop cannot wrap past videos that have not loaded
  assert.deepEqual(state.state.upcomingVideos.value.length, 59)

  state.props.videoId = 'video9'
  await settle()
  assert.equal(state.continuationRequests, 0)

  state.props.videoId = 'video10'
  await settle()
  assert.equal(state.continuationRequests, 1)
  assert.equal(state.isFetchingPlaylistContinuation.value, true)
  state.finishContinuation([{ videoId: 'video60' }], true)
  await settle()
  // With 61 videos loaded, video10 is 51 from the end
  assert.equal(state.continuationRequests, 1)
  assert.equal(state.isFetchingPlaylistContinuation.value, false)
  assert.equal(state.state.canPlayNextVideo.value, true)
})

for (const [mode, enable] of [
  ['reversed', state => { state.reversePlaylist.value = true }],
  ['shuffled', state => { state.shuffleEnabled.value = true }],
  ['looped from its first video', state => { state.loopEnabled.value = true }],
]) {
  test(`a ${mode} playlist loads its remaining pages`, async () => {
    const state = harness()
    state.props.videoId = 'video0'
    await (state.load(), state.resolveFirstPage(longFirstPage), settle())
    assert.equal(state.continuationRequests, 0)

    enable(state)
    await settle()
    assert.equal(state.continuationRequests, 1)
    state.finishContinuation([{ videoId: 'video60' }])
    await settle()
    assert.equal(state.hasUnloadedPlaylistVideos.value, false)
    assert.equal(state.isFetchingPlaylistContinuation.value, false)
    assert.equal(state.playlistItems.value.length, 61)
  })
}

test('a failed page stops loading on demand and lets loop wrap around the loaded videos', async () => {
  const state = harness()
  state.loopEnabled.value = true
  const loading = state.load()
  state.resolveFirstPage()
  state.failContinuation(new Error('Continuation failed'))
  await loading

  state.props.videoId = 'first'
  await settle()
  assert.equal(state.continuationRequests, 1)
  assert.equal(state.state.canPlayPreviousVideo.value, true)
  assert.deepEqual(state.state.upcomingVideos.value.map(video => video.videoId), ['second', 'first'])
})
