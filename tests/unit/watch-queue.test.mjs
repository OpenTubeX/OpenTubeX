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
} from '../../src/renderer/store/modules/watch-queue.js'

function video (videoId) {
  return { videoId, title: `Video ${videoId}` }
}

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

test('reorders, removes, and clears queued videos', () => {
  const state = createWatchQueueState()
  for (const id of ['one', 'two', 'three']) {
    watchQueueMutations.addVideoToWatchQueue(state, { video: video(id) })
  }

  const secondId = state.items[1].queueItemId
  watchQueueMutations.moveVideoInWatchQueue(state, { queueItemId: secondId, offset: -1 })
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
