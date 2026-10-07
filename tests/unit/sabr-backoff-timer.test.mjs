import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const loadSource = source.slice(source.indexOf('    async function performFirstLoad('), source.indexOf('    /**', source.indexOf('    async function performFirstLoad(')))
function extract(name) {
  const start = source.indexOf(`    function ${name}(`)
  return source.slice(start, source.indexOf('\n    function ', start + 1))
}
function fixture() {
  const intervals = new Set()
  const remaining = { value: 0 }
  const duration = { value: 0 }
  const video = { value: { ended: false, played: { length: 0 }, pause() {} } }
  const playbackStates = []
  const noop = () => {}
  const context = {
    video, props: { manifestMimeType: 'sabr' }, MANIFEST_TYPE_SABR: 'sabr', ignoreErrors: false,
    initialAutoplayCanceled: false, hasPlaybackPosition: { value: false }, isActiveTab: { value: true },
    isAppHidden: () => false, store: { getters: { getContinuePlaybackWhenScreenIsLocked: true } },
    shortsNavigationSuspended: { value: false },
    sabrBackoffIntervalId: null, sabrBackoffRemainingMs: remaining, sabrBackoffDurationMs: duration,
    setInterval: callback => { intervals.add(callback); return callback }, clearInterval: id => intervals.delete(id),
    requestTabPreviewRefresh: noop, abRepeatEnabled: { value: false }, setShowUiOnPaused: noop,
    shortsPaused: {}, playbackEnded: {}, autoplayCanceled: {}, syncPlayPauseControlIcons: noop, isCapacitorMobilePlayer: () => false,
    sleepTimer: { pauseCountdown: noop, consumeEndOfVideo: noop }, pauseSponsorBlockHighlightLabelCountdown: noop,
    cancelSponsorBlockSkipSchedule: noop, promptSponsorBlockSegments: {}, clearAbRepeatBoundarySchedule: noop,
    tabMediaCoordinator: {
      setPlaybackState: (_id, state) => playbackStates.push(state),
      setActionHandlers: (_id, _source, handlers) => { context.handlers = handlers },
    }, mediaTabId: 'test', process: { env: {} }, updateAutoPip: noop,
    mediaSessionStopped: false, seekingIsPossible: { value: false },
    handlePause: () => playbackStates.push('paused'),
    scrollMiniPlayerActive: { value: false }, updateScrollMiniPlayer: noop, emit: noop,
  }
  const methods = vm.runInNewContext(['clearSabrBackoffTimer', 'startSabrBackoffTimer', 'handleEnded', 'pause', 'registerMediaSessionHandlers'].map(extract).join('\n') + '\n({ startSabrBackoffTimer, handleEnded, pause, registerMediaSessionHandlers })', context)
  return { ...methods, context, playbackStates, props: context.props, video, remaining, duration, intervals }
}

for (const sought of [false, true]) test(`Android starts its playback service while autoplay waits for SABR${sought ? ' after a startup seek' : ''}`, () => {
  const f = fixture()
  f.context.process.env.IS_CAPACITOR = true
  f.video.value.autoplay = true
  f.video.value.paused = true
  f.context.hasPlaybackPosition.value = sought
  f.startSabrBackoffTimer(20000)
  assert.deepEqual(f.playbackStates, ['playing'], 'background support must start before Android leaves the foreground')
})

for (const continuePlayback of [true, false]) test(`a late Android backoff respects hidden activity with background playback ${continuePlayback ? 'enabled' : 'disabled'}`, () => {
  const f = fixture()
  f.context.process.env.IS_CAPACITOR = true
  f.context.isAppHidden = () => true
  f.context.store.getters.getContinuePlaybackWhenScreenIsLocked = continuePlayback
  f.video.value.autoplay = true
  f.video.value.paused = true
  f.startSabrBackoffTimer(20000)
  assert.deepEqual(f.playbackStates, [], 'a hidden activity must keep the pending media session idle')
  assert.equal(f.video.value.autoplay, continuePlayback, 'disabled background playback must cancel pending native autoplay')
  assert.equal(f.context.initialAutoplayCanceled, !continuePlayback)
})

for (const sought of [false, true]) test(`pausing pending SABR autoplay${sought ? ' after a startup seek' : ''} updates the session even without a native pause event`, () => {
  const f = fixture()
  f.context.process.env.IS_CAPACITOR = true
  f.video.value.autoplay = true
  f.video.value.paused = true
  f.startSabrBackoffTimer(20000)
  f.context.hasPlaybackPosition.value = sought
  f.pause()
  assert.equal(f.video.value.autoplay, false, 'loading must not undo the pause through native autoplay')
  f.startSabrBackoffTimer(10000)
  assert.deepEqual(f.playbackStates, ['playing', 'paused'], 'a later backoff must not reactivate the canceled session')
})

for (const sought of [false, true]) test(`stopping pending SABR autoplay${sought ? ' after a startup seek' : ''} clears the session and prevents a later backoff from restarting it`, () => {
  const f = fixture()
  f.context.process.env.IS_CAPACITOR = true
  f.video.value.autoplay = true
  f.video.value.paused = true
  f.startSabrBackoffTimer(20000)
  f.context.hasPlaybackPosition.value = sought
  f.registerMediaSessionHandlers()
  f.context.handlers.stop()
  assert.equal(f.video.value.autoplay, false)
  f.startSabrBackoffTimer(10000)
  assert.deepEqual(f.playbackStates, ['playing', 'none'])
})

for (const reason of ['autoplay disabled', 'autoplay canceled', 'background tab', 'iOS', 'desktop', 'already playing']) {
  test(`SABR countdown preserves playback state with ${reason}`, () => {
    const f = fixture()
    f.context.process.env.IS_CAPACITOR = reason !== 'desktop'
    f.context.process.env.IS_IOS = reason === 'iOS'
    f.context.initialAutoplayCanceled = reason === 'autoplay canceled'
    f.context.isActiveTab.value = reason !== 'background tab'
    f.context.hasPlaybackPosition.value = reason === 'already playing'
    f.video.value.played.length = reason === 'already playing' ? 1 : 0
    f.video.value.autoplay = reason !== 'autoplay disabled'
    f.startSabrBackoffTimer(20000)
    assert.deepEqual(f.playbackStates, [])
  })
}

test('ending playback clears an active SABR countdown and its interval', () => {
  const f = fixture()
  f.startSabrBackoffTimer(10000)
  assert.equal(f.intervals.size, 1)
  f.video.value.ended = true
  f.handleEnded()
  assert.equal(f.remaining.value, 0)
  assert.equal(f.duration.value, 0)
  assert.equal(f.intervals.size, 0)
})

test('late SABR callbacks cannot start a countdown after playback ends', () => {
  const f = fixture()
  f.video.value.ended = true
  f.startSabrBackoffTimer(10000)
  assert.equal(f.remaining.value, 0)
  assert.equal(f.intervals.size, 0)
})

test('destroying the player aborts SABR backoff before waiting for Shaka', async () => {
  const start = source.indexOf('    async function destroyPlayer() {')
  const destroySource = source.slice(start, source.indexOf('\n    expose({', start))
  const calls = []
  const noop = () => {}
  const context = {
    clearSabrBackoffTimer: noop, repeatStatsTracker: null, repeatStatsLoopObserver: null,
    screenWakeBinding: null, iosFullscreenCleanup: null, iosCaptionsCleanup: null, ignoreErrors: false,
    cancelPendingVolumeUserSet: noop, cancelSponsorBlockSkipSchedule: noop,
    hasLoaded: { value: true }, hasPlaybackPosition: { value: true },
    video: { value: null }, showPoster: { value: false }, nextTick: async () => {},
    ui: {
      getControls: () => null,
      async destroy() {
        calls.push('shaka')
        assert.deepEqual(calls, ['sabr', 'abort', 'shaka'])
      },
    },
    player: null, process: { env: { SUPPORTS_LOCAL_API: true } },
    sabrStream: { cleanup: () => calls.push('sabr') },
    sabrAbortController: { abort: () => calls.push('abort') },
    container: { value: null },
  }
  const destroyPlayer = vm.runInNewContext(`${destroySource}\ndestroyPlayer`, context)
  await destroyPlayer()
  assert.deepEqual(calls, ['sabr', 'abort', 'shaka'])
})

for (const format of ['legacy', 'audio']) {
  for (const localFilePlayback of [false, true]) {
    test(`${localFilePlayback ? 'downloaded' : 'online'} ${format} ${localFilePlayback ? 'skips' : 'honors'} the metadata preroll delay`, async () => {
      const delays = []
      const loads = []
      const load = vm.runInNewContext(`${loadSource}\nperformFirstLoad`, {
        props: { format, localFilePlayback, delayLoadUntilUnix: Date.now() + 10000, manifestMimeType: 'audio/mp4', manifestSrc: 'local-file', startTime: 0 },
        MANIFEST_TYPE_SABR: 'sabr', process: { env: { SUPPORTS_LOCAL_API: true } }, sabrStream: null,
        clearSabrBackoffTimer() {}, startPreRollTimer: delay => delays.push(delay), clearPreRollTimer() {},
        setTimeout: resolve => resolve(), ui: {}, player: { configure() {}, getVariantTracks: () => [] },
        hasMultipleAudioTracks: { value: false }, loadPlaybackSource: url => loads.push(url),
        setLegacyQuality: () => loads.push('local-file'),
        formatSwitchGeneration: 0,
      })
      await load()
      assert.equal(loads.length, 1)
      assert.equal(delays.length, localFilePlayback ? 0 : 1, 'a downloaded file must not display or wait for an online preroll countdown')
    })
  }
}

test('downloaded playback rejects late SABR backoff callbacks', () => {
  const f = fixture()
  f.props.localFilePlayback = true
  f.startSabrBackoffTimer(10000)
  assert.equal(f.remaining.value, 0)
  assert.equal(f.intervals.size, 0)
})

function prerollLoadFixture() {
  const waiters = []
  const intervals = new Set()
  const loads = []
  const context = {
    props: { format: 'audio', localFilePlayback: false, delayLoadUntilUnix: 10000, manifestMimeType: 'audio/mp4', manifestSrc: 'file', startTime: 0 },
    MANIFEST_TYPE_SABR: 'sabr', process: { env: {} }, sabrStream: null, formatSwitchGeneration: 0,
    clearSabrBackoffTimer() {}, preRollIntervalId: null, preRollRemainingMs: { value: 0 }, preRollDurationMs: { value: 0 },
    Date: { now: () => 0 }, setTimeout: resolve => waiters.push(resolve),
    setInterval: callback => { intervals.add(callback); return callback }, clearInterval: id => intervals.delete(id),
    ui: {}, player: { configure() {}, getVariantTracks: () => [] },
    hasMultipleAudioTracks: { value: false }, loadPlaybackSource: url => loads.push(url),
  }
  const load = vm.runInNewContext(`${extract('clearPreRollTimer')}\n${extract('startPreRollTimer')}\n${loadSource}\nperformFirstLoad`, context)
  return { context, load, loads, waiters, intervals }
}

test('switching to a download clears a waiting online preroll and prevents its stale load', async () => {
  const f = prerollLoadFixture()
  const onlineLoad = f.load()
  assert.equal(f.context.preRollRemainingMs.value, 10000)
  f.context.formatSwitchGeneration++
  f.context.props.localFilePlayback = true
  await f.load()
  assert.equal(f.context.preRollRemainingMs.value, 0)
  assert.equal(f.intervals.size, 0)
  assert.equal(f.loads.length, 1)
  f.waiters[0]()
  await onlineLoad
  assert.equal(f.loads.length, 1, 'the superseded waiter must not reload the download')
})

test('a superseded preroll waiter cannot clear a newer countdown', async () => {
  const f = prerollLoadFixture()
  const oldLoad = f.load()
  f.context.formatSwitchGeneration++
  f.context.props.delayLoadUntilUnix = 20000
  const currentLoad = f.load()
  f.waiters[0]()
  await oldLoad
  assert.equal(f.context.preRollRemainingMs.value, 20000)
  assert.equal(f.intervals.size, 1)
  assert.equal(f.loads.length, 0)
  f.waiters[1]()
  await currentLoad
  assert.equal(f.context.preRollRemainingMs.value, 0)
  assert.equal(f.intervals.size, 0)
  assert.equal(f.loads.length, 1)
})
