import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, reactive, watch } from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const barSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/player-components/QuickPlaybackRateBar.js', import.meta.url), 'utf8')

function fixture(music, controllerReady = false) {
  const video = { playbackRate: 1, defaultPlaybackRate: 1 }
  const props = reactive({ currentPlaybackRate: 1 })
  const hasLoaded = { value: false }
  const calls = []
  let context
  const state = {
    props,
    video: { value: video },
    hasLoaded,
    pendingPlaybackRateRestore: 1,
    playbackRateUserSet: false,
    temporaryPlaybackRateActive: false,
    shouldUseNormalPlaybackRateByDefault: { value: music },
    defaultPlaybackRate: { value: 1 },
    NORMAL_PLAYBACK_RATE: 1,
    maxVideoPlaybackRate: { value: 4 },
    events: new EventTarget(),
    CustomEvent,
    DOMException,
    watch,
    emit(name, rate) {
      if (name === 'playback-rate-updated') props.currentPlaybackRate = rate
    },
    player: {
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
    },
    showValueChange() {},
    updatePendingPlaybackRateMenu() {},
    ui: { getControls: () => ({}) },
    removeQuickPlaybackRateBarContext: null,
    setQuickPlaybackRateBarContext(controls, value) { context = value },
    quickPlaybackSpeedBarOptions: { value: [] },
    savedChannelPlaybackRate: { value: null },
    canManuallySaveChannelPlaybackRate: { value: false },
    registerOwnElement() {},
    shakaControls: {},
  }
  const names = [
    'normalizePlaybackRate', 'getDefaultPlaybackRateForVideo', 'getInitialPlaybackRate',
    'getCurrentPlaybackRate', 'queuePlaybackRateRestore', 'restorePendingPlaybackRate',
    'setVideoPlaybackRate', 'setPlaybackRate', 'applyPlaybackRate', 'changePlayBackRate', 'handleControlsContainerClick', 'registerQuickPlaybackRateBar',
  ]
  const functions = names.map(name => {
    const match = source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const watcher = source.slice(source.indexOf('    watch(\n      () => props.currentPlaybackRate,'), source.indexOf('    watch(shouldUseNormalPlaybackRateByDefault,'))
  const api = vm.runInNewContext(`${functions}\n${watcher}\n;({ ${names.join(', ')} })`, state)
  api.registerQuickPlaybackRateBar()

  const select = vm.runInNewContext(
    `(${barSource.match(/  setPlaybackRate_\(rate\) \{[^]*?\n  }/)[0].replace('setPlaybackRate_(rate)', 'function (rate)')})`,
    { quickPlaybackRateBarContexts: new Map([[state.ui.getControls, { events: state.events }]]), CustomEvent },
  )
  const bar = { controls: state.ui.getControls, player: state.player, updateButtonStates_() {} }
  return { state, api, video, calls, selected: () => context.getDisplayedPlaybackRate(), select: rate => select.call(bar, rate) }
}

test('a music default does not overwrite an explicit quick speed during loading', async () => {
  const { select, selected } = fixture(true, true)
  select(1.5)
  await nextTick()
  assert.equal(selected(), 1.5)
})

test('a speed restored after SABR recovery does not overwrite a newer selection', async () => {
  const { state, select, selected } = fixture(false)
  state.props.sabrReloadState = { playbackRate: 1.25 }
  state.playbackRateUserSet = true
  state.pendingPlaybackRateRestore = 1.25
  select(1.5)
  await nextTick()
  assert.equal(selected(), 1.5)
})

test('Ctrl-click resets a speed selected before loading', async () => {
  const { state, api, select, selected, video } = fixture(false)
  select(1.5)
  api.handleControlsContainerClick({ ctrlKey: true, stopPropagation() {} })
  await nextTick()
  assert.equal(selected(), 1)
  state.hasLoaded.value = true
  api.restorePendingPlaybackRate()
  assert.equal(video.playbackRate, 1)
})

test('quick presets keep their configured speed above the shortcut maximum', async () => {
  const { state, api, select, selected, video } = fixture(false)
  select(5)
  await nextTick()
  assert.equal(selected(), 5)
  state.hasLoaded.value = true
  api.restorePendingPlaybackRate()
  assert.equal(video.playbackRate, 5)
})

test('quick presets below the native playback range are preserved until Shaka loads', async () => {
  const { state, api, select, selected, video } = fixture(false)
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
  state.hasLoaded.value = true
  state.player.trickPlay = rate => { assert.equal(rate, 0.05) }
  api.restorePendingPlaybackRate()
})

test('quick presets below the native range still apply after loading', async () => {
  const { state, select, video } = fixture(false)
  state.hasLoaded.value = true
  select(0.05)
  await nextTick()
  assert.equal(video.playbackRate, 0.05)
})

for (const music of [false, true]) {
  for (const control of ['quick bar', 'shortcut']) {
    test(`${control} preserves the latest speed before a ${music ? 'music ' : ''}video loads`, async () => {
      const { state, api, video, calls, selected, select } = fixture(music)
      for (const rate of [1.25, 1.5]) {
        if (control === 'quick bar') select(rate)
        else api.changePlayBackRate(0.25)
        await nextTick()
        assert.equal(selected(), rate, 'the selected speed must stay highlighted')
      }
      assert.deepEqual(calls, [], 'defer Shaka speed changes until loading completes')
      state.hasLoaded.value = true
      video.playbackRate = 1
      api.restorePendingPlaybackRate()
      assert.equal(video.playbackRate, 1.5, 'start playback at the selected speed')
    })
  }
}
