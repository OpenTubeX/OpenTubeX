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
  const video = { value: { ended: false } }
  const noop = () => {}
  const context = {
    video, props: { manifestMimeType: 'sabr' }, MANIFEST_TYPE_SABR: 'sabr', ignoreErrors: false,
    shortsNavigationSuspended: { value: false },
    sabrBackoffIntervalId: null, sabrBackoffRemainingMs: remaining, sabrBackoffDurationMs: duration,
    setInterval: callback => { intervals.add(callback); return callback }, clearInterval: id => intervals.delete(id),
    requestTabPreviewRefresh: noop, abRepeatEnabled: { value: false }, setShowUiOnPaused: noop,
    shortsPaused: {}, playbackEnded: {}, autoplayCanceled: {}, syncPlayPauseControlIcons: noop, isCapacitorMobilePlayer: () => false,
    sleepTimer: { pauseCountdown: noop, consumeEndOfVideo: noop }, pauseSponsorBlockHighlightLabelCountdown: noop,
    cancelSponsorBlockSkipSchedule: noop, promptSponsorBlockSegments: {}, clearAbRepeatBoundarySchedule: noop,
    tabMediaCoordinator: { setPlaybackState: noop }, mediaTabId: 'test', process: { env: {} }, updateAutoPip: noop,
    scrollMiniPlayerActive: { value: false }, updateScrollMiniPlayer: noop, emit: noop,
  }
  const methods = vm.runInNewContext(['clearSabrBackoffTimer', 'startSabrBackoffTimer', 'handleEnded'].map(extract).join('\n') + '\n({ startSabrBackoffTimer, handleEnded })', context)
  return { ...methods, props: context.props, video, remaining, duration, intervals }
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
