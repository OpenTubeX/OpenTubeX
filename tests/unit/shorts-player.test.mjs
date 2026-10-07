import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { compile, createRenderer, defineComponent, h, onBeforeUnmount, onDeactivated, ref, nextTick } from 'vue'

import {
  buildSubscriptionShortsFeed,
  getChannelShortsNavigationContext,
  getPreferredShortThumbnailUrl,
  getShortsCompletionState,
  getShortsPlaybackWindow,
  getVideoAspectRatio,
  isYouTubeShort,
  parseLocalShortLinkedVideo,
  setChannelShortsNavigationContext,
  ShortsPlaybackCache,
} from '../../src/renderer/helpers/player/shorts.js'

test('Shorts extraction window follows the current video and stays bounded', () => {
  const feed = Array.from({ length: 9 }, (_, index) => ({ videoId: String(index) }))
  assert.deepEqual(getShortsPlaybackWindow(feed, '4'), {
    previous: ['1', '2', '3'],
    next: ['5', '6', '7'],
  })
  assert.deepEqual(getShortsPlaybackWindow(feed, '0'), {
    previous: [],
    next: ['1', '2', '3'],
  })
  assert.deepEqual(getShortsPlaybackWindow(feed, 'missing'), { previous: [], next: [] })
})

test('Shorts extraction cache shares pending loads and expires old sources', async () => {
  let now = 100
  let calls = 0
  const cache = new ShortsPlaybackCache({ now: () => now, ttlMs: 50 })
  const load = async () => ({ call: ++calls })

  const first = cache.get('local:one', load)
  assert.equal(cache.get('local:one', load), first)
  assert.deepEqual(await first, { call: 1 })
  now = 149
  assert.deepEqual(await cache.get('local:one', load), { call: 1 })
  now = 150
  assert.deepEqual(await cache.get('local:one', load), { call: 2 })
  cache.set('local:one', { call: 'active' })
  assert.deepEqual(await cache.get('local:one', load), { call: 'active' })

  cache.savePosition('one', 12.75)
  cache.savePosition('two', 4)
  cache.retain(['local:one'], ['one'])
  assert.equal(cache.getPosition('one'), 12.75)
  assert.equal(cache.getPosition('two'), 0)
  assert.equal(cache.hasPosition('one'), true)
  assert.equal(cache.hasPosition('two'), false)
})

test('failed Shorts extraction is retried on the next request', async () => {
  const cache = new ShortsPlaybackCache()
  await assert.rejects(cache.get('local:one', () => Promise.reject(new Error('offline'))))
  assert.equal(await cache.get('local:one', () => Promise.resolve('ready')), 'ready')
})

const watchSource = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const extractionSource = watchSource.slice(
  watchSource.indexOf('    getShortsExtractionKey('),
  watchSource.indexOf('    async preloadShortsPlaybackWindow()')
)

for (const failure of [
  { status: 'OK', watchPageIpBlocked: true },
  { status: 'LOGIN_REQUIRED' },
  { status: 'UNPLAYABLE' },
]) {
  test(`resolved local Shorts failure ${JSON.stringify(failure)} is not reused during recovery`, async () => {
    let calls = 0
    const methods = vm.runInNewContext(`({${extractionSource}})`, {
      process: { env: { IS_CAPACITOR: false } },
      getLocalVideoInfo: async () => {
        calls++
        return calls === 1
          ? { info: { playability_status: { status: failure.status } }, watchPageIpBlocked: failure.watchPageIpBlocked }
          : { info: { playability_status: { status: 'OK' } } }
      },
    })
    const watch = {
      ...methods, backendPreference: 'local', isYtDlpPlaybackRequested: () => false,
      shortsPlaybackCache: new ShortsPlaybackCache(),
    }
    await watch.getShortsVideoInformation('short')
    const recovered = await watch.getShortsVideoInformation('short')
    assert.equal(calls, 2, 'opening or recovering a preloaded failure must fetch fresh metadata')
    assert.equal(recovered.info.playability_status.status, 'OK')
    assert.equal(await watch.getShortsVideoInformation('short'), recovered)
    assert.equal(calls, 2, 'successful metadata should still be cached')
  })
}

const watchTemplate = await readFile(new URL('../../src/renderer/views/Watch/Watch.vue', import.meta.url), 'utf8')
const keepAliveStart = watchTemplate.indexOf('<KeepAlive')
const keepAliveOpening = watchTemplate.slice(keepAliveStart, watchTemplate.indexOf('>', keepAliveStart) + 1)

for (const shorts of [false, true]) {
  test(`${shorts ? 'Shorts retain' : 'regular videos release'} the player when playback cannot render`, async t => {
    let unmounted = 0
    let deactivated = 0
    const Player = defineComponent({
      name: 'FtShakaVideoPlayer',
      setup() {
        onBeforeUnmount(() => unmounted++)
        onDeactivated(() => deactivated++)
        return () => h('video')
      },
    })
    const node = tag => ({ tag, children: [], parent: null })
    const renderer = createRenderer({
      createElement: node, createComment: () => node('comment'), createText: () => node('text'),
      setElementText() {}, setText() {}, patchProp() {},
      insert(element, parent, anchor) {
        if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1)
        element.parent = parent
        const index = anchor ? parent.children.indexOf(anchor) : -1
        if (index < 0) parent.children.push(element)
        else parent.children.splice(index, 0, element)
      },
      remove(element) { element.parent.children.splice(element.parent.children.indexOf(element), 1) },
      parentNode: element => element.parent,
      nextSibling: element => element.parent.children[element.parent.children.indexOf(element) + 1] ?? null,
    })
    const ready = ref(true)
    const app = renderer.createApp({
      components: { FtShakaVideoPlayer: Player },
      setup: () => ({ customShortsPlayerActive: shorts, shortsPlayerCacheGeneration: 0, playerReady: ready }),
      render: compile(`${keepAliveOpening}<ft-shaka-video-player v-if="playerReady" /></KeepAlive>`),
    })
    app.mount(node('root'))
    t.after(() => app.unmount())
    ready.value = false
    await nextTick()
    assert.equal(unmounted, shorts ? 0 : 1, 'regular playback must release its listeners and media ownership')
    assert.equal(deactivated, shorts ? 1 : 0)
  })
}

for (const backend of ['local', 'invidious']) {
  test(`Shorts ${backend} extraction shares requests and uses the matching backend`, async () => {
    const calls = []
    const methods = vm.runInNewContext(`({${extractionSource}})`, {
      process: { env: { IS_CAPACITOR: false } },
      getLocalVideoInfo: async (id, options) => {
        calls.push(['local', id, options.shouldGeneratePoToken()])
        return { id }
      },
      invidiousGetVideoInformation: async id => {
        calls.push(['invidious', id])
        return { id }
      },
    })
    const watch = {
      ...methods, backendPreference: backend, currentInvidiousInstanceUrl: 'https://first.example',
      isYtDlpPlaybackRequested: () => false, shortsPlaybackCache: new ShortsPlaybackCache(),
    }
    const first = watch.getShortsVideoInformation('short')
    assert.equal(watch.getShortsVideoInformation('short'), first)
    assert.deepEqual(await first, { id: 'short' })
    assert.deepEqual(calls, backend === 'local' ? [['local', 'short', true]] : [['invidious', 'short']])

    if (backend === 'invidious') {
      watch.currentInvidiousInstanceUrl = 'https://second.example'
      await watch.getShortsVideoInformation('short')
      assert.equal(calls.length, 2, 'changing instance requires fresh stream URLs')
    }
  })
}

test('an Invidious preload error is retried when the Short is opened', async () => {
  let calls = 0
  const methods = vm.runInNewContext(`({${extractionSource}})`, {
    process: { env: { IS_CAPACITOR: false } },
    invidiousGetVideoInformation: async () => ++calls === 1 ? { error: 'unavailable' } : { ready: true },
  })
  const watch = {
    ...methods, backendPreference: 'invidious', currentInvidiousInstanceUrl: 'https://first.example',
    isYtDlpPlaybackRequested: () => false, shortsPlaybackCache: new ShortsPlaybackCache(),
  }
  await assert.rejects(watch.getShortsVideoInformation('short'), /unavailable/)
  assert.deepEqual(await watch.getShortsVideoInformation('short'), { ready: true })
})

const preloadSource = watchSource.slice(
  watchSource.indexOf('    async preloadShortsPlaybackWindow()'),
  watchSource.indexOf('    updateUpcomingTimestamp: function')
)

for (const engine of ['built-in', 'yt-dlp']) {
  test(`Shorts preload nearby metadata with ${engine} extraction`, async () => {
    const metadata = []
    const ytDlp = []
    const retained = []
    const { preloadShortsPlaybackWindow } = vm.runInNewContext(`({${preloadSource}})`, {
      initializeNetworkRecovery: () => ({ ready: Promise.resolve() }),
      getConnectionState: () => 'online',
      supportsYtDlp: true,
      console,
    })
    const watch = {
      shortsPreloadGeneration: 0,
      shortsPlaybackWindow: { previous: ['p2', 'p1'], next: ['n1', 'n2', 'n3'] },
      videoId: 'current',
      customShortsPlayerActive: true,
      videoPlaybackEngine: engine,
      shortsPlaybackCache: {
        retain(_keys, ids) { retained.push(...ids) },
        hasPosition: () => true,
      },
      getShortsExtractionKey: id => id,
      async getShortsVideoInformation(id) { metadata.push(id) },
      preloadUpcomingYtDlpPlaybackSources(ids) { ytDlp.push(...ids) },
    }

    await preloadShortsPlaybackWindow.call(watch)
    assert.deepEqual(retained, ['p2', 'p1', 'current', 'n1', 'n2', 'n3'])
    assert.deepEqual(metadata, ['n1', 'n2', 'n3', 'p1', 'p2'])
    assert.deepEqual(ytDlp, engine === 'yt-dlp' ? metadata : [])
  })
}

test('Shorts navigation resumes a previous position and saves the current one', () => {
  const navigationSource = watchSource.slice(
    watchSource.indexOf('    navigateSubscriptionShort: function'),
    watchSource.indexOf('    handleShortsWindowScroll: function')
  )
  const methods = vm.runInNewContext(`({${navigationSource}})`, {
    getShortThumbnailUrl: () => '',
  })
  const cache = new ShortsPlaybackCache()
  cache.savePosition('previous', 4.25)
  let destination
  const watch = {
    ...methods,
    subscriptionShortsFeedActive: true,
    customShortsPlayerActive: true,
    shortsNavigationLockedUntil: 0,
    subscriptionShortsFeedIndex: 1,
    subscriptionShortsFeed: [
      { videoId: 'previous' }, { videoId: 'current' }, { videoId: 'next' }
    ],
    videoId: 'current',
    shortsPlaybackCache: cache,
    $store: { getters: { getThumbnailDataSaver: false } },
    $refs: { player: { hasPlaybackPosition: true, getCurrentTime: () => 12.5 } },
    tabRoute: { query: { shortSource: 'subscriptions' } },
    tabRouter: { push(route) { destination = route } },
  }

  watch.navigateSubscriptionShort(-1)
  assert.equal(cache.getPosition('current'), 12.5)
  assert.equal(destination.path, '/watch/previous')
  assert.equal(destination.query.oneTimeTimestamp, '4.25')
})

const playerSource = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

for (const wasPlaying of [false, true]) {
  test(`an inactive Short defers SABR reload and preserves ${wasPlaying ? 'playing' : 'paused'} intent`, () => {
    const sabrStart = playerSource.indexOf('    function ensureSabrStream() {')
    const sabrSource = playerSource.slice(sabrStart, playerSource.indexOf('    // #endregion SABR', sabrStart))
    const lifecycleStart = playerSource.indexOf('    let resumeShortsAfterActivation = false')
    const lifecycle = playerSource.slice(lifecycleStart, playerSource.indexOf('    function isPaused()', lifecycleStart))
    let requestReload
    let activate
    let aborted = false
    const emitted = []
    const media = { paused: !wasPlaying, pause() { this.paused = true } }
    const context = {
      process: { env: { SUPPORTS_LOCAL_API: true } }, props: { shortsPlayer: true, sabrData: {} },
      video: ref(media), shortsNavigationSuspended: ref(false), musicMode: ref(false),
      suspendedShortsSabrReload: false, suspendedShortsError: null,
      sabrStream: null, sabrAbortController: null, playerWidth: 100, playerHeight: 200,
      AbortController: class { abort() { aborted = true } },
      setupSabrScheme: () => ({
        onBackoffRequested() {}, onReloadOnce(callback) { requestReload = callback },
      }),
      clearSabrBackoffTimer() {},
      getSabrReloadState: () => ({ wasPlaying: !media.paused, playbackRate: 2, videoQuality: '144' }),
      emit: (...args) => emitted.push(args), registerMediaSessionHandlers() {},
      sleepTimer: { pauseCountdown() {} }, cancelSponsorBlockSkipSchedule() {}, clearAbRepeatBoundarySchedule() {},
      tabMediaCoordinator: { setActionHandlers() {}, setPlaybackState() {} }, mediaTabId: 'shorts-tab',
      onDeactivated() {}, onActivated: callback => { activate = callback },
    }
    const suspend = vm.runInNewContext(`${sabrSource}\n${lifecycle}\nsuspendForShortsNavigation`, context)
    suspend()
    requestReload()
    assert.equal(aborted, true, 'the failed SABR transport must still be aborted')
    assert.deepEqual(emitted, [], 'inactive recovery must not reload the current Short')
    context.suspendedShortsError = { error: new Error('same aborted SABR request') }
    activate()
    assert.equal(context.shortsNavigationSuspended.value, false)
    assert.equal(context.suspendedShortsSabrReload, false)
    assert.equal(context.suspendedShortsError, null, 'the SABR reload owns recovery of the aborted request')
    assert.equal(emitted.length, 1)
    assert.equal(emitted[0][0], 'player-reload-requested')
    assert.deepEqual({ ...emitted[0][1] }, { wasPlaying, playbackRate: 2, videoQuality: '144' })
  })
}

test('an inactive Short ignores fullscreen events and synchronizes when activated', () => {
  const start = playerSource.indexOf('    function fullscreenChangeHandler() {')
  const source = playerSource.slice(start, playerSource.indexOf('    async function exitPresentationModes()', start))
  const closed = []
  let fullscreen = true
  let activate
  const context = {
    shortsNavigationSuspended: ref(true), musicMode: ref(false), isActiveTab: ref(false), isFullscreen: ref(false),
    suspendedShortsSabrReload: false, suspendedShortsError: null,
    isNativeFullscreenActive: () => fullscreen,
    androidFullscreenHostActive: ref(false), androidFullscreenHost: null,
    finishAndroidFullscreenExit() {},
    videoZoomPinchStart: null, selectedVideoZoom: ref(1), VIDEO_ZOOM_LEVELS: [1],
    props: { shortsPlayer: true }, resetShortsOverflowMenu() {}, suppressPanelTransitions() {}, syncChapterOverlayButton() {},
    process: { env: {} }, fullWindowEnabled: ref(false),
    rememberAndCloseDockedPanels: () => closed.push('current player panels'),
    video: ref({}), rotateFullscreenToLandscape: ref(false), fullscreenAspectRatio: ref(1),
    updateFullscreenOrientation() {}, syncAndroidStatusBarVisibility() {},
    updateScrollMiniPlayer() {}, nextTick() {}, showOverlayControls() {},
    onDeactivated() {}, onActivated: callback => { activate = callback },
    registerMediaSessionHandlers() {}, emit() {}, handleTimeupdate() {}, handlePause() {},
  }
  const handler = vm.runInNewContext(`${source}\nfullscreenChangeHandler`, context)
  handler()
  assert.equal(context.isFullscreen.value, false, 'another player entering fullscreen must not update a retained Short')
  context.isFullscreen.value = true
  fullscreen = false
  handler()
  assert.deepEqual(closed, [], 'a retained Short must not close the current fullwindow player panels')
  context.isActiveTab.value = true
  const lifecycleStart = playerSource.indexOf('    let resumeShortsAfterActivation = false')
  const lifecycle = playerSource.slice(lifecycleStart, playerSource.indexOf('    function isPaused()', lifecycleStart))
  vm.runInNewContext(lifecycle, { ...context, fullscreenChangeHandler: handler })
  activate()
  assert.equal(context.isFullscreen.value, false)
  assert.equal(closed.length, 1, 'the returning player must synchronize its own presentation state')
})

test('an inactive Short defers player errors without changing current playback', () => {
  const start = playerSource.indexOf('    function handleError(')
  const source = playerSource.slice(start, playerSource.indexOf('    // #region seek bar markers', start))
  const emitted = []
  const playbackStates = []
  const context = {
    ignoreErrors: false, shortsNavigationSuspended: ref(true), suspendedShortsError: null, suspendedShortsSabrReload: false,
    ErrorCode: {}, ErrorSeverity: { RECOVERABLE: 1 }, ErrorCategory: { NETWORK: 2 },
    navigator: { onLine: true }, logShakaError() {}, props: { videoId: 'old-short' },
    shaka: { util: { Error: { Category: { TEXT: 3 }, Code: {} } } },
    emit: (...args) => emitted.push(args), mediaTabId: 'shorts-tab',
    tabMediaCoordinator: { setPlaybackState: (...args) => playbackStates.push(args) },
    process: { env: { IS_ELECTRON: false } },
  }
  const handleError = vm.runInNewContext(`${source}; handleError`, context)
  const error = { code: 9000, severity: 2, category: 1, data: [] }
  handleError(error, 'shaka error handler')
  assert.deepEqual(emitted, [])
  assert.deepEqual(playbackStates, [])
  assert.equal(context.suspendedShortsError.error, error)

  let activate
  const lifecycleStart = playerSource.indexOf('    let resumeShortsAfterActivation = false')
  const lifecycle = playerSource.slice(lifecycleStart, playerSource.indexOf('    function isPaused()', lifecycleStart))
  vm.runInNewContext(lifecycle, {
    ...context, musicMode: ref(false), handleError, registerMediaSessionHandlers() {},
    onDeactivated() {}, onActivated: callback => { activate = callback },
  })
  activate()
  assert.equal(context.shortsNavigationSuspended.value, false)
  assert.deepEqual(emitted, [['error', error]])
  assert.deepEqual(playbackStates, [['shorts-tab', 'none']])

  context.ignoreErrors = false
  context.shortsNavigationSuspended.value = true
  context.suspendedShortsError = null
  handleError(error, 'addTextTrackAsync')
  assert.equal(context.suspendedShortsError, null, 'caption failures must not block reactivation')
})

test('evicting an inactive Short does not close the current player panels', () => {
  const start = playerSource.indexOf('    onBeforeUnmount(() => {', playerSource.indexOf('    // #region tear down'))
  const source = playerSource.slice(start, playerSource.indexOf("      document.removeEventListener('keydown'", start))
  const closed = []
  const context = {
    onBeforeUnmount: callback => callback(), sponsorBlockRequestGeneration: 0,
    screenWakeBinding: null, androidFullscreenCleanup: null, iosFullscreenCleanup: null, iosCaptionsCleanup: null,
    clearTimeout() {}, paidPromotionTimer: null, disableTwitchTsVideoGap: null,
    fullscreenDockLayoutFrame: null, cancelFullscreenDockVideoAnimation() {},
    cancelPendingVolumeUserSet() {}, fullWindowAnimation: null,
    hasLoaded: ref(true), hasPlaybackPosition: ref(true), shortsNavigationSuspended: ref(true),
    mediaTabId: 'shorts-tab',
    document: { body: { dataset: { playerFullWindowOwner: 'shorts-tab' }, classList: { remove: () => closed.push('fullwindow') } } },
  }
  for (const panel of ['Metadata', 'Transcript', 'SponsorBlock', 'LiveChat', 'Comments', 'Playlist']) {
    context[`closeFullscreen${panel}`] = () => closed.push(panel)
  }
  vm.runInNewContext(`${source}    })`, context)
  assert.deepEqual(closed, [])
})

const handleLoadedSource = playerSource.slice(
  playerSource.indexOf('    async function handleLoaded() {'),
  playerSource.indexOf('    async function unloadForFormatSwitch() {')
)
const syncPlayPauseSource = playerSource.slice(
  playerSource.indexOf('    function syncPlayPauseControlIcons() {'),
  playerSource.indexOf('    /**\n     * @param {boolean} muted', playerSource.indexOf('    function syncPlayPauseControlIcons() {'))
)
const toggleFullscreenSource = playerSource.slice(
  playerSource.indexOf('    function toggleShortsFullscreen() {'),
  playerSource.indexOf('    function registerCaptionToggleButton()', playerSource.indexOf('    function toggleShortsFullscreen() {'))
)

test('the Shaka play control shows replay when playback ends', () => {
  const attributes = new Map()
  let iconPath
  const button = {
    querySelector(selector) {
      if (selector === '.ft-play-pause-morph-icon') return {}
      return { setAttribute(name, value) { iconPath = value } }
    },
    setAttribute(name, value) { attributes.set(name, value) },
  }
  const sync = vm.runInNewContext(`${syncPlayPauseSource}\nsyncPlayPauseControlIcons`, {
    video: ref({ ended: false, paused: true, duration: 30 }),
    playbackEnded: ref(true),
    container: ref({ querySelectorAll: () => [button] }),
    window: { requestAnimationFrame: callback => callback() },
    shaka: { ui: { Enums: { MaterialDesignSVGIcons: { REPLAY: 'replay-path' } } } },
  })
  sync()
  assert.equal(attributes.get('data-ft-play-pause-state'), 'replay')
  assert.equal(iconPath, 'replay-path')
})

test('Shorts fullscreen uses player controls when Shaka hides its button', () => {
  let toggles = 0
  const toggle = vm.runInNewContext(`${toggleFullscreenSource}\ntoggleShortsFullscreen`, {
    container: ref({ querySelector: () => null }),
    togglePlayerFullScreen: () => { toggles++ },
  })
  toggle()
  assert.equal(toggles, 1)
})

for (const paused of [true, false]) {
  test(`Shorts controls reflect media paused=${paused} after loading without a playback event`, async () => {
    const shortsPaused = ref(false)
    const video = ref({ paused, duration: 30, videoWidth: 1080, videoHeight: 1920 })
    const handleLoaded = vm.runInNewContext(`${handleLoadedSource}\nhandleLoaded`, {
      shortsPaused,
      video,
      hasLoaded: ref(false),
      videoLayoutReady: ref(false),
      pendingMetadataSeek: null,
      isLive: ref(false),
      hasMultipleAudioTracks: ref(false),
      togglePlaybackRate: null,
      restoreCaptionIndex: null,
      suppressInitialAutoplay: false,
      props: { shortsPlayer: true, format: 'dash', captions: [], chapters: [] },
      player: { isLive: () => false, getAudioTracks: () => [], getTextTracks: () => [] },
      process: { env: { SUPPORTS_LOCAL_API: false } },
      deduplicateAudioTracks: tracks => new Set(tracks),
      nextTick,
      emit() {},
      restorePendingPlaybackRate() {},
      rememberInlinePlayerLayoutHeight() {},
      loadChapterThumbnails() {},
      syncShortsCaptionsEnabled() {},
      refreshAbRepeatMarkers() {},
      applyPendingPresentationModes() {},
    })

    await handleLoaded()
    assert.equal(shortsPaused.value, paused, 'the play/pause control must match the loaded media')
    assert.equal(video.value.paused, paused, 'synchronizing the control must not start playback')
  })
}

test('only completes Shorts after continuous playback following a seek', () => {
  const seekToEnd = getShortsCompletionState({
    blockedBySeek: true,
    playbackAfterSeekSeconds: 0,
    elapsedSeconds: 59.75,
    currentSeconds: 59.75,
    durationSeconds: 60,
  })
  assert.deepEqual(seekToEnd, {
    blockedBySeek: true,
    playbackAfterSeekSeconds: 0,
    reachedEnd: false
  })

  const seekBackToStart = getShortsCompletionState({
    ...seekToEnd,
    elapsedSeconds: -59.75,
    currentSeconds: 0,
    durationSeconds: 60,
  })
  assert.equal(seekBackToStart.reachedEnd, false)

  const firstPlaybackTick = getShortsCompletionState({
    ...seekBackToStart,
    elapsedSeconds: 0.5,
    currentSeconds: 59,
    durationSeconds: 60,
  })
  const completed = getShortsCompletionState({
    ...firstPlaybackTick,
    elapsedSeconds: 0.5,
    currentSeconds: 59.5,
    durationSeconds: 60,
  })

  assert.deepEqual(completed, {
    blockedBySeek: false,
    playbackAfterSeekSeconds: 1,
    reachedEnd: true
  })
})

test('prefers YouTube selected Shorts thumbnails only for the default preference', () => {
  const video = {
    thumbnailUrl: 'https://i.ytimg.com/vi/short/frame0.jpg'
  }

  assert.equal(
    getPreferredShortThumbnailUrl(video, '', 'https://i.ytimg.com/vi/short/oardefault.jpg'),
    video.thumbnailUrl
  )
  assert.equal(
    getPreferredShortThumbnailUrl(video, 'middle', 'https://i.ytimg.com/vi/short/oar2.jpg'),
    'https://i.ytimg.com/vi/short/oar2.jpg'
  )
  assert.equal(getPreferredShortThumbnailUrl(video, 'hidden', null), null)
})

test('reads aspect ratios from local and Invidious formats', () => {
  assert.equal(getVideoAspectRatio([{ width: 1080, height: 1920 }]), 9 / 16)
  assert.equal(getVideoAspectRatio([{ size: '1080x1920' }]), 9 / 16)
  assert.equal(getVideoAspectRatio([{ audioQuality: 'AUDIO_QUALITY_MEDIUM' }]), null)
})

test('detects portrait Shorts up to three minutes long', () => {
  assert.equal(isYouTubeShort({
    duration: 180,
    formats: [{ width: 1080, height: 1920 }],
  }), true)
})

test('does not mistake landscape or long portrait videos for Shorts', () => {
  assert.equal(isYouTubeShort({
    duration: 60,
    formats: [{ width: 1920, height: 1080 }],
  }), false)
  assert.equal(isYouTubeShort({
    duration: 181,
    formats: [{ width: 1080, height: 1920 }],
  }), false)
})

test('does not infer a Short from ambiguous square watch-page media', () => {
  assert.equal(isYouTubeShort({
    duration: 120,
    formats: [{ width: 1080, height: 1080 }],
  }), false)
})

test('trusts an explicit non-Short classification over portrait dimensions', () => {
  assert.equal(isYouTubeShort({
    explicit: false,
    duration: 120,
    formats: [{ width: 1080, height: 1920 }],
  }), false)
})

test('trusts an explicit Shorts route without stream dimensions', () => {
  assert.equal(isYouTubeShort({ explicit: true }), true)
})

test('extracts a linked full video from Reel metadata', () => {
  const response = {
    data: {
      overlay: {
        reelPlayerOverlayRenderer: {
          playerOverlay: {
            reelPlayerOverlayViewModel: {
              metapanel: {
                reelMetapanelViewModel: {
                  metadataItems: [{
                    reelCarouselViewModel: {
                      buttonViewModels: [{
                        reelCarouselButtonViewModel: {
                          buttonViewModel: {
                            buttonViewModel: {
                              titleFormatted: { content: 'Related full video' },
                              onTap: {
                                innertubeCommand: {
                                  watchEndpoint: { videoId: 'linked-video' }
                                }
                              }
                            }
                          }
                        }
                      }]
                    }
                  }]
                }
              }
            }
          }
        }
      }
    }
  }

  assert.deepEqual(parseLocalShortLinkedVideo(response), {
    videoId: 'linked-video',
    title: 'Related full video',
  })
  assert.equal(parseLocalShortLinkedVideo({}), null)
})

test('builds a newest-first, filtered subscription Shorts feed', () => {
  const feed = buildSubscriptionShortsFeed({
    subscriptions: [
      { id: 'channel-a' },
      { id: 'channel-b' },
      { id: 'channel-c', feedTypes: ['videos'] }
    ],
    cache: {
      'channel-a': {
        videos: [
          { videoId: 'a-new', authorId: 'channel-a', published: 30 },
          { videoId: 'a-old', authorId: 'channel-a', published: 10 },
        ]
      },
      'channel-b': {
        videos: [
          { videoId: 'hidden', authorId: 'channel-b', published: 40 },
          { videoId: 'b', authorId: 'channel-b', published: 20 },
        ]
      },
      'channel-c': {
        videos: [
          { videoId: 'disabled-short', authorId: 'channel-c', published: 50 }
        ]
      }
    },
    isHidden: video => video.videoId === 'hidden',
    maxPerChannel: 1,
  })

  assert.deepEqual(feed.map(video => video.videoId), ['a-new', 'b'])
})

test('keeps an isolated Shorts navigation sequence for each channel', () => {
  setChannelShortsNavigationContext('channel-a', [
    { videoId: 'a-1' },
    { videoId: 'a-2' },
  ])
  setChannelShortsNavigationContext('channel-b', [{ videoId: 'b-1' }])

  assert.deepEqual(
    getChannelShortsNavigationContext('channel-a').map(video => video.videoId),
    ['a-1', 'a-2']
  )
  assert.deepEqual(
    getChannelShortsNavigationContext('channel-b').map(video => video.videoId),
    ['b-1']
  )
})
