import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, reactive, ref, shallowRef } from 'vue'

const playlistSource = readFileSync(new URL('../../src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', import.meta.url), 'utf8')
const watchSource = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
function extractSourceBetweenMarkers(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return source.slice(from, to)
}

function harness({ laterPageError = null } = {}) {
  const items = [{ videoId: 'first', title: 'First video' }, { videoId: 'second', title: 'Second video' }]
  const playlistItems = shallowRef([])
  const randomizedPlaylistItems = shallowRef([])
  const shuffleEnabled = ref(false)
  const props = reactive({ playlistId: 'youtube-playlist', videoId: 'first' })
  const isFetchingPlaylistContinuation = ref(false)
  const hasUnloadedPlaylistVideos = ref(false)
  const loopEnabled = ref(false)
  const isLoading = ref(false)
  const errors = []
  let finishContinuation
  let failContinuation
  const continuation = new Promise((resolve, reject) => { finishContinuation = resolve; failContinuation = reject })
  const context = {
    props, randomizedPlaylistItems, shuffleEnabled, loopEnabled,
    isFetchingPlaylistContinuation, hasUnloadedPlaylistVideos, computed,
    isLoading, playlistItems, getPlaylistInfoRun: false,
    playlistTitle: ref(''), playlistTotalVideoCount: ref(0), channelName: ref(''), channelId: ref(''),
    store: { commit() {} }, playlistCacheTabId: 'android-tab',
    process: { env: { SUPPORTS_LOCAL_API: true } }, backendPreference: ref('local'),
    applyReversePlaylistState: videos => videos.slice(),
    findIndexOfCurrentVideoInPlaylist: videos => videos.findIndex(item => item.videoId === props.videoId),
    getLocalCachedFeedContinuation: () => continuation,
    parseLocalPlaylistVideos: videos => videos,
    untilEndOfLocalPlayList: async (page, callback) => {
      callback(page)
      if (laterPageError) throw laterPageError
    },
    showApiErrorToast: (_message, error) => errors.push(error), t: key => key,
    console: { error: error => errors.push(error) },
  }
  const load = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'async function loadCachedPlaylistInformation(', '\nasync function getPlaylistInformationLocal(')}\nloadCachedPlaylistInformation`, context)
  const shuffle = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'function shuffleItems(', '\nconst playlistItemsWrapper =')}\nshufflePlaylistItems`, context)
  const state = vm.runInNewContext(`${extractSourceBetweenMarkers(playlistSource, 'const currentVideoIndexZeroBased =', '\nwatch(upcomingVideos,')}\n;({ nextVideo, upcomingVideos, playlistUnavailableVideoCount, isWaitingForNextVideo })`, context)

  const watch = {
    isCurrentlyPresented: () => true, handleWatchProgressAutoSaveWhenProgressEnabled() {},
    customShortsPlayerActive: false, isStandaloneShort: false, playNextQueuedVideo: () => false,
    autoplayEnabled: true, blockVideoAutoplay: false, watchingPlaylist: true,
    $refs: { watchVideoPlaylist: {
      get nextVideo() { return state.nextVideo.value },
      get isWaitingForNextVideo() { return state.isWaitingForNextVideo.value },
      shouldStopDueToPlaylistEnd: false, resetUnavailableSkipChain() {},
    } },
    defaultInterval: 5, $store: { getters: { getAvoidTranslation: 'never' } },
  }
  const ended = vm.runInNewContext(`({${extractSourceBetweenMarkers(watchSource, '    handleVideoEnded: function () {', '\n    playNextVideoNow:')} })`, {
    setTimeout: () => 1, setInterval: () => 1, Date,
  }).handleVideoEnded
  watch.handleVideoEnded = () => ended.call(watch)
  Object.assign(watch, vm.runInNewContext(`({${extractSourceBetweenMarkers(watchSource, '    handleUpcomingPlaylistVideosChange(videos) {', '\n    preloadUpcomingYtDlpPlaybackSources(')} })`))
  const cancel = vm.runInNewContext(`({${extractSourceBetweenMarkers(watchSource, '    abortAutoplayCountdown: function (', '\n    handleRouteChange:')} })`, {
    clearTimeout() {}, clearInterval() {},
  }).abortAutoplayCountdown
  const replay = vm.runInNewContext(`({${extractSourceBetweenMarkers(watchSource, '    handleVideoPlay() {', '\n    handlePlayerSeeking()')} })`).handleVideoPlay
  return {
    notifyUpcoming: () => watch.handleUpcomingPlaylistVideosChange(state.upcomingVideos.value),
    cancelAutoplay: () => cancel.call(watch, true),
    replayVideo: () => replay.call(watch),
    items, playlistItems, isLoading, errors, watch, loopEnabled,
    nextVideo: state.nextVideo, unavailableCount: state.playlistUnavailableVideoCount,
    props, randomizedPlaylistItems,
    enableShuffle: () => { shuffleEnabled.value = true; shuffle() },
    load: () => load({ id: 'youtube-playlist', title: 'YouTube playlist', totalVideoCount: 100,
      channelName: 'Test', channelId: 'channel', items, continuationData: 'continuation' }),
    finishContinuation, failContinuation,
    endVideo: () => ended.call(watch),
  }
}

test('YouTube playlist autoplay uses cached next videos while a later page is loading', async () => {
  const state = harness()
  const loading = state.load()
  state.endVideo()
  assert.equal(state.watch.autoplayCountdown?.video.videoId, 'second')
  state.finishContinuation({ items: [{ videoId: 'third' }] })
  await loading
  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['first', 'second', 'third'])
  assert.deepEqual(state.items.map(video => video.videoId), ['first', 'second'])
})

test('a later continuation failure preserves pages already loaded for autoplay', async () => {
  const failure = new Error('Later page failed')
  const state = harness({ laterPageError: failure })
  const loading = state.load()
  state.finishContinuation({ items: [{ videoId: 'third' }] })
  await loading
  state.endVideo()
  assert.equal(state.watch.autoplayCountdown?.video.videoId, 'second')
  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['first', 'second', 'third'])
  assert.equal(state.isLoading.value, false)
  assert.ok(state.errors.includes(failure))
})

test('a cached continuation cannot replace a different playlist after navigation', async () => {
  const state = harness()
  const loading = state.load()
  state.props.playlistId = 'different-playlist'
  state.playlistItems.value = [{ videoId: 'different' }]
  state.finishContinuation({ items: [{ videoId: 'third' }] })
  await loading
  assert.deepEqual(state.playlistItems.value.map(video => video.videoId), ['different'])
})

test('a failed YouTube playlist continuation preserves autoplay and clears the loading state', async () => {
  const state = harness()
  const loading = state.load()
  const failure = new Error('Continuation failed')
  state.failContinuation(failure)
  await loading
  state.endVideo()
  assert.equal(state.watch.autoplayCountdown?.video.videoId, 'second')
  assert.equal(state.isLoading.value, false)
  assert.ok(state.errors.includes(failure))
})


test('pages arriving during shuffle extend the existing playback order', async () => {
  const state = harness()
  const loading = state.load()
  state.enableShuffle()
  state.props.videoId = 'second'
  state.finishContinuation({ items: [{ videoId: 'third' }, { videoId: 'fourth' }] })
  await loading
  const shuffledIds = state.randomizedPlaylistItems.value.map(video => video.videoId)
  assert.deepEqual(shuffledIds.slice(0, 2), ['first', 'second'])
  assert.deepEqual(shuffledIds.slice(2).sort(), ['fourth', 'third'])
  state.endVideo()
  assert.ok(['third', 'fourth'].includes(state.watch.autoplayCountdown?.video.videoId))
})


for (const loop of [false, true]) {
  test(`pending pages do not wrap at the last cached video with loop ${loop}`, async () => {
    const state = harness()
    const loading = state.load()
    state.loopEnabled.value = loop
    state.props.videoId = 'second'
    assert.equal(state.nextVideo.value, null)
    state.endVideo()
    assert.equal(state.watch.autoplayCountdown, undefined)
    assert.equal(state.watch.waitingForPlaylistContinuation, true)
    state.finishContinuation({ items: [{ videoId: 'third' }] })
    await loading
    assert.equal(state.nextVideo.value.videoId, 'third')
    state.notifyUpcoming()
    assert.equal(state.watch.autoplayCountdown.video.videoId, 'third')
    const countdown = state.watch.autoplayCountdown
    state.notifyUpcoming()
    assert.equal(state.watch.autoplayCountdown, countdown)
  })
}

test('unloaded entries are not reported as unavailable during or after failed pagination', async () => {
  const state = harness()
  const loading = state.load()
  assert.equal(state.unavailableCount.value, 0)
  state.failContinuation(new Error('Continuation failed'))
  await loading
  assert.equal(state.unavailableCount.value, 0)
})

test('unavailable entries are counted after pagination succeeds', async () => {
  const state = harness()
  const loading = state.load()
  assert.equal(state.unavailableCount.value, 0)
  state.finishContinuation({ items: [{ videoId: 'third' }] })
  await loading
  assert.equal(state.unavailableCount.value, 97)
})


for (const action of ['cancelAutoplay', 'replayVideo']) {
  test(`${action} prevents delayed pages from restarting autoplay`, async () => {
    const state = harness()
    const loading = state.load()
    state.props.videoId = 'second'
    state.endVideo()
    assert.equal(state.watch.waitingForPlaylistContinuation, true)
    state[action]()
    state.finishContinuation({ items: [{ videoId: 'third' }] })
    await loading
    state.notifyUpcoming()
    assert.equal(state.watch.waitingForPlaylistContinuation, false)
    assert.ok(state.watch.autoplayCountdown == null)
  })
}
