import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, reactive, ref } from 'vue'
import { getPlaybackRatePresets, normalizePlaybackRate, usePlaybackRate } from '../../src/renderer/components/ft-shaka-video-player/opentubex/usePlaybackRate.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const barSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/player-components/QuickPlaybackRateBar.js', import.meta.url), 'utf8')

/**
 * @param {boolean} music whether the video is detected as music
 * @param {boolean} controllerReady whether Shaka's rate controller already exists
 * @param {{ musicMode?: boolean, sabrReloadState?: object, queueInitialRate?: boolean }} [options]
 */
function fixture(music, controllerReady = false, { musicMode = false, sabrReloadState, queueInitialRate = true } = {}) {
  const video = { playbackRate: 1, defaultPlaybackRate: 1 }
  const props = reactive({ currentPlaybackRate: 1, videoIsMusic: music, sabrReloadState })
  const hasLoaded = ref(false)
  const calls = []
  let context
  const player = {
    getPlaybackRate: () => hasLoaded.value ? video.playbackRate : 1,
    trickPlay(rate) {
      assert.ok(controllerReady || hasLoaded.value, 'Shaka cannot apply a speed before its rate controller exists')
      video.playbackRate = rate
      calls.push(rate)
    },
    cancelTrickPlay() {
      assert.equal(hasLoaded.value, true)
      video.playbackRate = video.defaultPlaybackRate
      calls.push(video.playbackRate)
    },
  }
  const api = usePlaybackRate({
    video: ref(video),
    getPlayer: () => player,
    hasLoaded,
    isLive: ref(false),
    musicMode: ref(musicMode),
    hasSponsorBlockMusicOfftopicSegment: ref(false),
    shortsNavigationSuspended: ref(false),
    props,
    defaultPlaybackRate: ref(1),
    maxVideoPlaybackRate: ref(4),
    videoPlaybackRateInterval: ref(0.25),
    savedChannelPlaybackRate: ref(null),
    holdToDoublePlaybackSpeed: ref(true),
    onPlaybackRateUpdated: rate => { props.currentPlaybackRate = rate },
    onPlaybackRateUserSet() {},
    updatePendingPlaybackRateMenu() {},
    showValueChange() {},
    showToast() {},
    t: key => key,
  })
  // The player queues the initial rate when it attaches to the video element.
  if (queueInitialRate) api.queuePlaybackRateRestore(api.getInitialPlaybackRate())

  const state = {
    ...api,
    normalizePlaybackRate,
    showValueChange() {},
    events: new EventTarget(),
    CustomEvent,
    player,
    ui: { getControls: () => ({}) },
    removeQuickPlaybackRateBarContext: null,
    setQuickPlaybackRateBarContext(controls, value) { context = value },
    quickPlaybackSpeedBarOptions: { value: [] },
    savedChannelPlaybackRate: { value: null },
    canManuallySaveChannelPlaybackRate: { value: false },
    registerOwnElement() {},
    shakaControls: {},
  }
  // These player functions route control events to the playback rate controller.
  const names = ['handleControlsContainerClick', 'registerQuickPlaybackRateBar']
  const functions = names.map(name => {
    const match = source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const playerFunctions = vm.runInNewContext(`${functions}\n;({ ${names.join(', ')} })`, state)
  playerFunctions.registerQuickPlaybackRateBar()

  const select = vm.runInNewContext(
    `(${barSource.match(/  setPlaybackRate_\(rate\) \{[^]*?\n  }/)[0].replace('setPlaybackRate_(rate)', 'function (rate)')})`,
    { quickPlaybackRateBarContexts: new Map([[state.ui.getControls, { events: state.events }]]), CustomEvent },
  )
  const bar = { controls: state.ui.getControls, player, updateButtonStates_() {} }
  return {
    props,
    hasLoaded,
    player,
    api: { ...api, ...playerFunctions },
    video,
    calls,
    selected: () => context.getDisplayedPlaybackRate(),
    select: rate => select.call(bar, rate),
  }
}

test('a music default does not overwrite an explicit quick speed during loading', async () => {
  const { select, selected } = fixture(true, true)
  select(1.5)
  await nextTick()
  assert.equal(selected(), 1.5)
})

test('music mode starts unclassified videos at normal speed despite saved defaults or recovery state', () => {
  const { props, hasLoaded, api, video } = fixture(false, false, { musicMode: true, queueInitialRate: false })
  props.currentPlaybackRate = 2
  props.sabrReloadState = { playbackRate: 2 }
  assert.equal(api.getInitialPlaybackRate(), 1)
  hasLoaded.value = true
  api.restorePendingPlaybackRate()
  assert.equal(video.playbackRate, 1)
})

test('music mode preserves a manual speed selected while loading', async () => {
  const { hasLoaded, api, select, selected, video } = fixture(false, false, { musicMode: true })
  select(1.5)
  await nextTick()
  assert.equal(selected(), 1.5)
  hasLoaded.value = true
  api.restorePendingPlaybackRate()
  assert.equal(video.playbackRate, 1.5)
})

test('a speed restored after SABR recovery does not overwrite a newer selection', async () => {
  const { api, select, selected } = fixture(false, false, { sabrReloadState: { playbackRate: 1.25 } })
  assert.equal(api.getPlaybackRateToRestore(), 1.25, 'SABR recovery queues its speed as a user choice')
  select(1.5)
  await nextTick()
  assert.equal(selected(), 1.5)
})

test('Ctrl-click resets a speed selected before loading', async () => {
  const { hasLoaded, api, select, selected, video } = fixture(false)
  select(1.5)
  api.handleControlsContainerClick({ ctrlKey: true, stopPropagation() {} })
  await nextTick()
  assert.equal(selected(), 1)
  hasLoaded.value = true
  api.restorePendingPlaybackRate()
  assert.equal(video.playbackRate, 1)
})

test('quick presets keep their configured speed above the shortcut maximum', async () => {
  const { hasLoaded, api, select, selected, video } = fixture(false)
  select(5)
  await nextTick()
  assert.equal(selected(), 5)
  hasLoaded.value = true
  api.restorePendingPlaybackRate()
  assert.equal(video.playbackRate, 5)
})

test('quick presets below the native playback range are preserved until Shaka loads', async () => {
  const { hasLoaded, player, api, select, selected, video } = fixture(false)
  let nativeRate = 1
  Object.defineProperty(video, 'playbackRate', {
    get: () => nativeRate,
    set(rate) {
      if (rate === 0.05) throw new DOMException('Unsupported playback rate', 'NotSupportedError')
      nativeRate = rate
    },
  })
  select(0.05)
  await nextTick()
  assert.equal(selected(), 0.05)
  hasLoaded.value = true
  player.trickPlay = rate => { assert.equal(rate, 0.05) }
  api.restorePendingPlaybackRate()
})

test('quick presets below the native range still apply after loading', async () => {
  const { hasLoaded, select, video } = fixture(false)
  hasLoaded.value = true
  select(0.05)
  await nextTick()
  assert.equal(video.playbackRate, 0.05)
})

for (const music of [false, true]) {
  for (const control of ['quick bar', 'shortcut']) {
    test(`${control} preserves the latest speed before a ${music ? 'music ' : ''}video loads`, async () => {
      const { hasLoaded, api, video, calls, selected, select } = fixture(music)
      for (const rate of [1.25, 1.5]) {
        if (control === 'quick bar') select(rate)
        else api.changePlayBackRate(0.25)
        await nextTick()
        assert.equal(selected(), rate, 'the selected speed must stay highlighted')
      }
      assert.deepEqual(calls, [], 'defer Shaka speed changes until loading completes')
      hasLoaded.value = true
      video.playbackRate = 1
      api.restorePendingPlaybackRate()
      assert.equal(video.playbackRate, 1.5, 'start playback at the selected speed')
    })
  }
}

for (const control of ['quick bar', 'shortcut']) {
  test(`${control} replaces a queued restore while the current source is still loaded`, async () => {
    const { hasLoaded, api, select, video } = fixture(false)
    hasLoaded.value = true
    api.queuePlaybackRateRestore(1)
    if (control === 'quick bar') select(1.5)
    else api.changePlayBackRate(0.5)
    await nextTick()
    assert.equal(video.playbackRate, 1.5)
    assert.equal(api.isPlaybackRateRestoreQueued(), true)
    assert.equal(api.getPlaybackRateToRestore(), 1.5)
    api.restorePendingPlaybackRate()
    assert.equal(video.playbackRate, 1.5)
  })
}

test('steps along the playback rate interval without skipping a step or leaving the range', () => {
  const { api: { getSteppedPlaybackRate } } = fixture(false)
  assert.equal(getSteppedPlaybackRate(1, 0.25), 1.25)
  assert.equal(getSteppedPlaybackRate(1, -0.25), 0.75)
  // A rate just past a step moves to the next step in the direction of the change.
  assert.equal(getSteppedPlaybackRate(1.05, 0.25), 1.25)
  assert.equal(getSteppedPlaybackRate(1.2, -0.25), 1)
  assert.equal(getSteppedPlaybackRate(3.9, 0.25), 4)
  assert.equal(getSteppedPlaybackRate(0.25, -0.25), 0.25)
})

test('playback speed presets list every interval step up to the maximum', () => {
  assert.deepEqual(getPlaybackRatePresets(0.25, 2), [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
  assert.deepEqual(getPlaybackRatePresets(0.1, 1), [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
  assert.equal(getPlaybackRatePresets(0.1, 10).length, 100)
  assert.equal(getPlaybackRatePresets(0.1, 10).at(-1), 10)
})
