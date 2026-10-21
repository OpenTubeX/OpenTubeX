import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createStore } from 'vuex'
import { computed, ref } from 'vue'

const playerSource = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const autoplayStart = playerSource.indexOf('    const autoplayVideos = computed(')
const autoplayEnd = playerSource.indexOf('\n    })', autoplayStart) + '\n    })'.length
const autoplaySource = playerSource.slice(autoplayStart, autoplayEnd)
import downloads from '../../src/renderer/store/modules/downloads.js'

import {
  default as watchQueue,
  createWatchQueueState,
  watchQueueGetters,
  watchQueueMutations,
  persistWatchQueue,
} from '../../src/renderer/store/modules/watch-queue.js'

function video (videoId) {
  return { videoId, title: `Video ${videoId}` }
}

function queueStorage(initialItems = []) {
  let saved = JSON.stringify(initialItems)
  return {
    getItem: () => saved,
    setItem: (_key, value) => { saved = value },
  }
}

function persistentQueue(storage) {
  return createStore({ modules: { watchQueue }, plugins: [store => persistWatchQueue(store, storage)] })
}

test('restores pending videos in order with metadata, download routes, and distinct duplicate IDs', () => {
  const storage = queueStorage()
  let store = persistentQueue(storage)
  const downloadedVideo = { ...video('download'), author: 'Channel', route: { path: '/watch/download', query: { downloadId: '42' } } }
  store.commit('addVideoToWatchQueue', { video: video('one') })
  store.commit('addVideoToWatchQueue', { video: downloadedVideo })
  store.commit('addVideoToWatchQueue', { video: downloadedVideo, playNext: true })
  store.commit('moveVideoInWatchQueue', { queueItemId: store.getters.getWatchQueue[1].queueItemId, targetQueueItemId: store.getters.getWatchQueue[2].queueItemId, after: true })

  store = persistentQueue(storage)
  assert.deepEqual(store.getters.getWatchQueue.map(({ queueItemId, ...item }) => item), [downloadedVideo, downloadedVideo, video('one')])
  const ids = store.getters.getWatchQueue.map(item => item.queueItemId)
  store.commit('addVideoToWatchQueue', { video: video('new') })
  assert.equal(new Set([...ids, store.getters.getWatchQueue.at(-1).queueItemId]).size, 4)
})

test('played, removed, deleted-download, and cleared entries stay absent after restart', () => {
  const storage = queueStorage()
  let store = persistentQueue(storage)
  for (const id of ['played', 'removed', 'download', 'remaining']) {
    store.commit('addVideoToWatchQueue', { video: { ...video(id), route: id === 'download' ? { query: { downloadId: '42' } } : undefined } })
  }
  store.commit('removeVideoFromWatchQueue', store.getters.getNextQueuedVideo.queueItemId)
  store.commit('removeVideoFromWatchQueue', store.getters.getWatchQueue[0].queueItemId)
  store.commit('removeYtDlpDownload', 42)
  store = persistentQueue(storage)
  assert.deepEqual(store.getters.getWatchQueue.map(item => item.videoId), ['remaining'])
  store.commit('clearWatchQueue')
  assert.deepEqual(persistentQueue(storage).getters.getWatchQueue, [])
})

test('ignores malformed stored queues and invalid entries', () => {
  for (const saved of ['{', '{}', 'null']) {
    assert.deepEqual(persistentQueue({ getItem: () => saved }).getters.getWatchQueue, [])
  }
  const store = persistentQueue(queueStorage([null, {}, { videoId: 42 }, { videoId: '' }, video('valid')]))
  assert.deepEqual(store.getters.getWatchQueue.map(item => item.videoId), ['valid'])
})

test('storage failures leave the in-memory queue usable', () => {
  const store = persistentQueue({
    getItem() { throw new Error('Storage unavailable') },
    setItem() { throw new Error('Storage full') },
  })
  store.commit('addVideoToWatchQueue', { video: video('one') })
  assert.equal(store.getters.getNextQueuedVideo.videoId, 'one')
  store.commit('clearWatchQueue')
  assert.equal(store.getters.getWatchQueueLength, 0)
})

test('removing a download also removes its queued copies without affecting other sources', () => {
  const store = createStore({ modules: {
    downloads: { ...downloads, state: () => ({ ytDlpDownloads: { 1: { id: 1 }, 2: { id: 2 } } }) },
    watchQueue,
  } })
  for (const downloadId of ['1', '2', '1', undefined]) {
    store.commit('addVideoToWatchQueue', {
      video: { videoId: 'same-video', route: downloadId ? { query: { downloadId } } : undefined },
    })
  }
  store.commit('removeYtDlpDownload', 1)
  assert.equal(store.getters.getYtDlpDownloads[1], undefined)
  assert.equal(store.getters.getYtDlpDownloads[2].id, 2)
  assert.deepEqual(store.getters.getWatchQueue.map(item => item.route?.query.downloadId), ['2', undefined])
})

test('adds videos to the end or front of the watch queue', () => {
  const state = createWatchQueueState()

  watchQueueMutations.addVideoToWatchQueue(state, { video: video('one') })
  watchQueueMutations.addVideoToWatchQueue(state, { video: video('two') })
  watchQueueMutations.addVideoToWatchQueue(state, { video: video('next'), playNext: true })

  assert.deepEqual(state.items.map(item => item.videoId), ['next', 'one', 'two'])
  assert.equal(watchQueueGetters.getNextQueuedVideo(state).videoId, 'next')
  assert.equal(watchQueueGetters.getWatchQueueLength(state), 3)
})

test('appends a batch of videos in order and ignores a replayed batch', () => {
  const state = createWatchQueueState()
  watchQueueMutations.addVideoToWatchQueue(state, { video: video('queued') })
  const payload = { videos: [video('one'), video('two'), video('one')], queueItemIds: ['a', 'b', 'c'] }

  watchQueueMutations.addVideosToWatchQueue(state, payload)
  watchQueueMutations.addVideosToWatchQueue(state, payload)

  assert.deepEqual(state.items.map(item => item.videoId), ['queued', 'one', 'two', 'one'])
  assert.deepEqual(state.items.slice(1).map(item => item.queueItemId), ['a', 'b', 'c'])
  watchQueueMutations.addVideosToWatchQueue(state, { videos: [video('three')] })
  assert.equal(new Set(state.items.map(item => item.queueItemId)).size, 5)
})

test('a queued batch is restored in order after restart', () => {
  const storage = queueStorage()
  persistentQueue(storage).commit('addVideosToWatchQueue', { videos: [video('one'), video('two')] })
  assert.deepEqual(persistentQueue(storage).getters.getWatchQueue.map(item => item.videoId), ['one', 'two'])
})

test('reorders, removes, and clears queued videos', () => {
  const state = createWatchQueueState()
  for (const id of ['one', 'two', 'three']) {
    watchQueueMutations.addVideoToWatchQueue(state, { video: video(id) })
  }

  const secondId = state.items[1].queueItemId
  watchQueueMutations.moveVideoInWatchQueue(state, { queueItemId: secondId, targetQueueItemId: state.items[0].queueItemId })
  assert.deepEqual(state.items.map(item => item.videoId), ['two', 'one', 'three'])

  watchQueueMutations.removeVideoFromWatchQueue(state, secondId)
  assert.deepEqual(state.items.map(item => item.videoId), ['one', 'three'])

  watchQueueMutations.clearWatchQueue(state)
  assert.deepEqual(state.items, [])
})

for (const route of [undefined, { path: '/watch/saved', query: { downloadId: '42' } }]) {
  test(`queue advancement ${route ? 'preserves the downloaded file route' : 'opens online videos normally'}`, async () => {
    const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
    const { playNextQueuedVideo: playNext, watchRouteWithoutTimestamp } = watchMethods(source, ['playNextQueuedVideo', 'watchRouteWithoutTimestamp'])
    const navigations = []
    const removed = []
    const watch = {
      watchRouteWithoutTimestamp,
      nextQueuedVideo: { videoId: 'saved', queueItemId: 1, route },
      $store: { commit: (name, id) => removed.push([name, id]) },
      tabRoute: { fullPath: '/watch/previous' },
      tabRouter: { resolve: route => ({ fullPath: route.path }), push: route => navigations.push(route) },
      t: key => key,
    }
    assert.equal(playNext.call(watch), true)
    assert.deepEqual(JSON.parse(JSON.stringify(navigations)), [route ?? { path: '/watch/saved' }])
    assert.deepEqual(removed, [['removeVideoFromWatchQueue', 1]])
  })
}

function watchMethods(source, names) {
  return runInNewContext(`({ ${names.map(name => {
    const start = source.indexOf(`    ${name}:`)
    const end = source.indexOf('\n    },', start)
    return source.slice(start, end) + '\n}'
  }).join(',')} })`, { showToast() {}, process: { env: {} }, URL })
}

test('queued downloads explicitly start after loading even when general autoplay is disabled', async () => {
  const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
  const methods = watchMethods(source, ['playNextQueuedVideo', 'handleVideoLoaded', 'watchRouteWithoutTimestamp'])
  const watch = {
    ...methods,
    nextQueuedVideo: { videoId: 'saved', queueItemId: 1, route: { path: '/watch/saved', query: { downloadId: '42' } } },
    $store: { commit() {}, getters: { getAutoplayVideos: false } },
    tabRouter: { resolve: route => ({ fullPath: route.path }), push() {} },
    t: key => key,
    isLoading: false, preparingVideoLoadGeneration: null,
    localFilePlayback: true, videoPlayerLoaded: true,
    videoId: 'previous', tabRoute: { fullPath: '/watch/previous', query: { downloadId: '42' } },
    isCurrentlyPresented: () => true,
  }
  watch.playNextQueuedVideo()
  watch.videoId = 'saved'
  const autoplay = active => runInNewContext(autoplaySource + '\nautoplayVideos.value', {
    computed, suppressInitialAutoplay: false,
    autoplayRequested: { value: watch.queuedPlaybackVideoId === watch.videoId },
    store: watch.$store, isActiveTab: { value: active },
  })
  assert.equal(autoplay(true), true, 'the next queued file starts without enabling general autoplay')
  assert.equal(autoplay(false), false, 'a hidden tab must not start playing')
  await watch.handleVideoLoaded({ duration: 4 })
  assert.equal(watch.queuedPlaybackVideoId, null, 'the start request is consumed for later visits')
})


for (const timestamp of ['', '&timestamp=0.25']) test(`a queued duplicate of the current download replays${timestamp ? ' from a timestamped route' : ' without a route change'}`, async () => {
  const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
  const methods = watchMethods(source, ['playNextQueuedVideo', 'watchRouteWithoutTimestamp'])
  const route = { path: '/watch/saved', query: { downloadId: '42' } }
  const actions = []
  const watch = {
    ...methods, nextQueuedVideo: { videoId: 'saved', queueItemId: 1, route },
    tabRoute: { fullPath: '/watch/saved?downloadId=42' + timestamp },
    tabRouter: { resolve: () => ({ fullPath: '/watch/saved?downloadId=42' }), push() { assert.fail('duplicate must not navigate') } },
    $store: { commit: (name, id) => actions.push([name, id]) }, t: key => key,
    $refs: { player: { setCurrentTime: time => actions.push(['seek', time]), play: () => actions.push(['play']) } },
  }
  assert.equal(watch.playNextQueuedVideo(), true)
  assert.deepEqual(actions, [['removeVideoFromWatchQueue', 1], ['seek', 0], ['play']])
})

test('queued autoplay ends after playback starts so later source loads obey the preference', async () => {
  const playing = playerSource.slice(playerSource.indexOf('    function handlePlaying() {'), playerSource.indexOf('    function handleWaiting() {'))
  const autoplayRequested = ref(true)
  const autoplay = runInNewContext(`${autoplaySource}\n${playing}\nautoplayVideos.value; handlePlaying(); autoplayVideos.value`, {
    autoplayRequested, computed, suppressInitialAutoplay: false,
    store: { getters: { getAutoplayVideos: false } }, isActiveTab: { value: true },
    shortsNavigationSuspended: { value: false }, hasPlaybackPosition: { value: false }, showPoster: { value: true },
    startPaidPromotionTimer() {}, emit() {}, process: { env: {} },
  })
  assert.equal(autoplay, false, 'a consumed queue request must not leave autoplay enabled for later source loads')
})

test('an explicit queue request starts a SABR replacement without re-enabling preference autoplay', () => {
  const autoplayRequested = ref(false)
  const isActiveTab = ref(true)
  const autoplay = runInNewContext(autoplaySource + '\nautoplayVideos', {
    autoplayRequested, isActiveTab, computed, suppressInitialAutoplay: true,
    store: { getters: { getAutoplayVideos: true } },
  })
  assert.equal(autoplay.value, false, 'a paused SABR replacement must stay paused')
  autoplayRequested.value = true
  assert.equal(autoplay.value, true, 'a later explicit queue request must start')
  isActiveTab.value = false
  assert.equal(autoplay.value, false, 'queue requests must still respect the active tab')
  isActiveTab.value = true
  autoplayRequested.value = false
  assert.equal(autoplay.value, false, 'consuming the queue request must retain the original suppression')
})

for (const format of ['audio', 'dash', 'legacy']) {
  for (const queued of [true, false]) {
    for (const switching of queued ? [true, false] : [true]) {
      test(`${queued ? 'queued' : 'manual'} ${format} ${switching ? 'source switches during initial loading' : 'fresh loads'} ${queued && switching ? 'start at zero' : 'preserve the requested start'}`, async () => {
        const firstLoad = playerSource.slice(playerSource.indexOf('    async function performFirstLoad('), playerSource.indexOf('\n    /**', playerSource.indexOf('    async function performFirstLoad(')))
        const switchStart = playerSource.indexOf('      async ([newFormat], [oldFormat]) => {')
        const initialSwitch = playerSource.slice(switchStart, playerSource.indexOf('        const video_ = video.value', switchStart)) + '\n}'
        const starts = []
        const context = {
          props: { format, startTime: 2, autoplayRequested: queued, localFilePlayback: true, manifestSrc: 'queued-file', manifestMimeType: 'audio/mpeg' },
          autoplayRequested: ref(queued), formatSwitchGeneration: 0, pendingFormatSwitchState: null,
          hasLoaded: ref(false), preferAutoQuality: ref(true), hasMultipleAudioTracks: ref(false),
          player: { configure() {}, getVariantTracks: () => [] }, ui: {}, ignoreErrors: false,
          foregroundLoadAbortController: null, clearSabrBackoffTimer() {}, clearPreRollTimer() {},
          unloadForFormatSwitch: async () => {}, ensureSabrStream() {}, getPlayerConfig: () => ({}),
          loadPlaybackSource: async (url, start) => starts.push(start), setLegacyQuality: async start => starts.push(start),
          process: { env: {} }, Date,
        }
        await runInNewContext(`${firstLoad}\nconst initialSwitch = ${initialSwitch}; ${switching ? 'initialSwitch([props.format], [props.format])' : 'performFirstLoad()'}`, context)
        assert.deepEqual(starts, [queued && switching ? 0 : 2])
      })
    }
  }
}
