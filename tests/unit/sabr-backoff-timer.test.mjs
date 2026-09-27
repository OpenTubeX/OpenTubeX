import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
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
  return { ...methods, video, remaining, duration, intervals }
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
    screenWakeBinding: null, iosFullscreenCleanup: null, ignoreErrors: false,
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
