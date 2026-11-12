import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref } from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    let playerDestruction = null')
const destruction = source.slice(start, source.indexOf('\n    expose({', start))
const castSource = readFileSync(new URL('../../node_modules/shaka-player/lib/cast/cast_proxy.js', import.meta.url), 'utf8')
const shaka = { cast: {}, util: { FakeEventTarget: class { release() {} } }, ads: { AbstractAd: class {} } }
vm.runInNewContext(castSource, { shaka, goog: { provide() {}, require() {} } })

function createPlayer() {
  let finishPlayer
  let beganDestroy
  const destroying = new Promise(resolve => { beganDestroy = resolve })
  const calls = []
  const cast = Object.assign(Object.create(shaka.cast.CastProxy.prototype), {
    sender_: { isCasting: () => false, destroy: async () => {} },
    localPlayer_: {
      destroy() {
        calls.push('destroy player')
        return new Promise(resolve => { finishPlayer = resolve })
      }
    },
    playerCompiledToExternNames_: new Map(),
    playerEventTarget_: { removeEventListener() {} },
  })
  const player = new Proxy(cast.localPlayer_, { get: (target, name) => cast.playerProxyGet_(name) })
  const video = ref({ remote: { cancelWatchAvailability: async () => { calls.push('cancel availability') } } })
  const container = ref({ ui: {} })
  const controls = { isFullScreenEnabled: () => true }
  const ui = {
    getControls: () => controls,
    async destroy() {
      calls.push('destroy UI')
      const pending = cast.destroy()
      beganDestroy()
      await pending
    }
  }
  const context = vm.createContext({
    player,
    ui,
    video,
    container,
    nextTick,
    foregroundLoadAbortController: null,
    repeatStatsTracker: null,
    repeatStatsLoopObserver: null,
    screenWakeBinding: null,
    androidFullscreenCleanup: null,
    iosFullscreenCleanup: null,
    iosCaptionsCleanup: null,
    captionCueLayoutCleanup: null,
    nativeCaptionTiming: null,
    captionTextDisplayer: null,
    process: { env: {} },
    document: { pictureInPictureElement: null },
    hasLoaded: ref(true),
    hasPlaybackPosition: ref(true),
    showPoster: ref(false),
    fullWindowEnabled: ref(false),
    DOCKED_PANEL_RESTORE_ORDER: [],
    clearSabrBackoffTimer() {},
    applyCaptionTiming() {},
    cancelPendingVolumeUserSet() {},
    cancelSponsorBlockSkipSchedule() {},
  })
  const destroy = vm.runInContext(`${destruction}\ndestroyPlayer`, context)
  return { destroy, destroying, finish: () => finishPlayer(), calls, context, video, container }
}

for (const overlap of ['before rendering', 'during Shaka destruction']) {
  test(`overlapping player cleanup ${overlap} waits for one teardown`, async () => {
    const player = createPlayer()
    const first = player.destroy()
    if (overlap === 'during Shaka destruction') await player.destroying
    let secondFinished = false
    const second = player.destroy().then(state => { secondFinished = true; return state })
    // Attach a rejection handler before advancing the asynchronous teardown.
    const result = Promise.all([first, second])
    result.catch(() => {})
    await player.destroying
    await nextTick()
    assert.equal(secondFinished, false, 'every caller must wait for Shaka to release its resources')
    player.finish()
    const [firstState, secondState] = await result
    assert.equal(firstState.startNextVideoInFullscreen, true)
    assert.deepEqual(secondState, firstState, 'every caller receives the original presentation state')
    assert.deepEqual(player.calls, ['destroy UI', 'destroy player', 'cancel availability'])
    assert.equal(player.context.player, null)
    assert.equal(player.video.value.ui, null)
    assert.equal(player.container.value.ui, null)
    assert.deepEqual(await player.destroy(), firstState, 'late cleanup preserves the saved state')
  })
}
