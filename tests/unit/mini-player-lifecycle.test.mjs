import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as coordinator from '../../src/renderer/helpers/crossTabMiniPlayer.js'
import { computed, effectScope, reactive, ref, watch } from 'vue'
import { scrollMiniPlayerRectToStyle } from '../../src/renderer/helpers/scrollMiniPlayer.js'

// Execute the entire composable. Stub its platform/layout dependencies, while
// retaining Vue watchers, pointer events, and the real volume timeout behavior.
const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useScrollMiniPlayer.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export /gm, '')

function mountMiniPlayer(t, { detached = false, navigatedAway = detached, keepPlaying = true, android = false, inlineVisible = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const scope = effectScope()
  const mounted = []
  const unmounting = []
  const window = Object.assign(new EventTarget(), { innerWidth: 480, innerHeight: 800 })
  window.setTimeout = t.mock.fn(setTimeout)
  const isActiveTab = ref(true)
  const isPlayerSuspended = ref(false)
  const minimized = ref(false)
  const video = ref({ paused: false, ended: false, volume: 1, currentTime: 120, play() { this.paused = false; this.ended = false }, pause() { this.paused = true } })
  const rect = { left: 10, top: 10, width: 360, height: 202 }
  video.value.getBoundingClientRect = () => ({ ...rect })
  const classes = new Set()
  const create = vm.runInNewContext(`${source}; useScrollMiniPlayer`, {
    ...coordinator, computed, ref, watch, inject: () => ({ detached: ref(navigatedAway), tabPresented: ref(true), minimized, clearMinimizePreview() {} }), watchNavigationKey: Symbol(),
    nextTick() {}, onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounting.push(callback), window, clearTimeout, process: { env: { IS_CAPACITOR: android } },
    document: { body: { classList: { remove() {}, contains: name => classes.has(name) } } },
    store: { getters: reactive({ getAutoPictureInPictureTriggers: [], getKeepPlayingOnNavigation: keepPlaying, getScrollMiniPlayerOnAllTabs: true, getScrollMiniPlayerEnabled: inlineVisible }) },
    DEFAULT_ASPECT_RATIO: 16 / 9,
    getDefaultScrollMiniPlayerRect: () => ({ ...rect }),
    scrollMiniPlayerRectToStyle,
    getSavedScrollMiniPlayerRect: () => null,
    parseScrollMiniPlayerSavedRect: () => null,
    setSavedScrollMiniPlayerRect() {},
    getViewportInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    getViewportWidth: () => window.innerWidth, MARGIN: 16,
    clampScrollMiniPlayerRect: value => ({ ...value }),
    pickScrollMiniVerticalAnchor: () => null,
    getScrollMiniVerticalAnchor: () => ({}),
    getResizeHandleCorner: () => 'bottom-right',
    updateScrollMiniPlayerVolumeBarFill() {},
    getScrollMiniInlineLayoutHeight: () => 202,
    getAnchorVisibleRatio: () => 1, EXIT_MINI_RATIO: 0.5,
    SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT: 100,
    isReducedMotionEnabled: () => !inlineVisible,
    performance: { now: () => 0 }
  })
  const player = scope.run(() => create({
    container: ref(inlineVisible ? { style: { removeProperty() {} }, removeAttribute() {}, hasAttribute: () => false, getBoundingClientRect: () => ({ ...rect }) } : null),
    fullWindowEnabled: ref(false), getUi: () => null,
    isActiveTab, isPlayerSuspended, pictureInPictureActive: ref(false), props: reactive({ format: 'video', videoId: 'video' }),
    video
  }))
  for (const callback of mounted) callback()
  player.scrollMiniPlayerActive.value = true
  player.scrollMiniPlaceholderHeight.value = 202
  if (inlineVisible) player.scrollMiniAnchor.value = {}
  if (detached) {
    // Register ownership through the real tab-change coordinator without layout.
    isActiveTab.value = false
  }
  t.after(() => { for (const callback of unmounting) callback(); player.teardownScrollMiniPlayer(); scope.stop() })
  return { player, window, isActiveTab, isPlayerSuspended, minimized, video, classes }
}

for (const phase of ['androidPictureInPicture', 'androidPictureInPictureRestoring']) {
  test(`Android PiP viewport changes preserve the existing mini-player state during ${phase}`, t => {
    const { player, classes } = mountMiniPlayer(t, { android: true })
    classes.add(phase)
    const rect = player.scrollMiniPlayerStyle.value
    player.updateScrollMiniPlayer()
    assert.equal(player.scrollMiniPlayerActive.value, true, 'native PiP must not switch the underlying player layout')
    player.handleScrollMiniWindowResize()
    assert.deepEqual(player.scrollMiniPlayerStyle.value, rect, 'PiP dimensions must not overwrite the normal mini-player geometry')
  })
}

test('a suspended Short cannot own the mini player even when its watch view is minimized', t => {
  const { player, video, isActiveTab, isPlayerSuspended, minimized } = mountMiniPlayer(t)
  video.value.paused = true
  minimized.value = true
  isPlayerSuspended.value = true
  isActiveTab.value = false
  player.updateScrollMiniPlayer()
  assert.equal(coordinator.hasCrossTabMiniPlayerOwner(), false)
  assert.equal(player.scrollMiniPlayerActive.value, false)
})

test('a paused Watch tab does not acquire the cross-tab mini player before navigating away', t => {
  const { player, video, isActiveTab } = mountMiniPlayer(t, { keepPlaying: true, navigatedAway: false })
  video.value.paused = true
  player.scrollMiniPlayerActive.value = false
  isActiveTab.value = false
  player.updateScrollMiniPlayer()
  assert.equal(coordinator.hasCrossTabMiniPlayerOwner(), false)
  assert.equal(player.scrollMiniPlayerActive.value, false)
})

test('tab changes end held volume gestures and hide the expanded control', t => {
  const { player, window, isActiveTab } = mountMiniPlayer(t)
  player.handleScrollMiniVolumePointerDown({ clientX: 0, clientY: 0 })
  assert.equal(player.scrollMiniVolumeExpanded.value, true)
  isActiveTab.value = false
  t.mock.timers.tick(1000)
  assert.equal(player.scrollMiniVolumeExpanded.value, false)
  const scheduled = window.setTimeout.mock.callCount()
  window.dispatchEvent(new Event('pointerup'))
  window.dispatchEvent(new Event('pointercancel'))
  assert.equal(window.setTimeout.mock.callCount(), scheduled)
})

test('an existing detached mini player remains available after playback ends', t => {
  const { player, video } = mountMiniPlayer(t, { detached: true })
  video.value.paused = true
  video.value.ended = true
  player.updateScrollMiniPlayer()
  assert.equal(player.scrollMiniPlayerActive.value, true)
  assert.equal(player.scrollMiniPlayerDetached.value, true)
  player.scrollMiniTogglePlayPause()
  assert.equal(video.value.currentTime, 0)
  assert.equal(video.value.paused, false)
})

test('the ended event keeps an eligible detached mini player and reveals replay', t => {
  const { player, video } = mountMiniPlayer(t, { detached: true })
  video.value.ended = true
  video.value.paused = true
  player.scrollMiniPlayPauseVisible.value = false
  const playerSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
  const handler = playerSource.slice(playerSource.indexOf('    function handleEnded() {'), playerSource.indexOf('    function handleSeeking() {'))
  const noop = () => {}
  vm.runInNewContext(`${handler}; handleEnded()`, {
    ...player, clearSabrBackoffTimer: noop, abRepeatEnabled: ref(false), shortsNavigationSuspended: ref(false),
    setShowUiOnPaused: noop, shortsPaused: ref(false), playbackEnded: ref(false), autoplayCanceled: ref(false),
    syncPlayPauseControlIcons: noop, isCapacitorMobilePlayer: () => false,
    sleepTimer: { pauseCountdown: noop, consumeEndOfVideo: () => false },
    pauseSponsorBlockHighlightLabelCountdown: noop, cancelSponsorBlockSkipSchedule: noop,
    promptSponsorBlockSegments: ref([]), clearAbRepeatBoundarySchedule: noop,
    tabMediaCoordinator: { setPlaybackState: noop }, mediaTabId: 'tab',
    process: { env: { IS_ELECTRON: false } }, updateAutoPip: noop, emit: noop,
  })
  assert.equal(player.scrollMiniPlayerActive.value, true)
  assert.equal(player.scrollMiniPlayPauseVisible.value, true)
})

test('ending an inline scroll mini player still hides it', t => {
  const { player, video } = mountMiniPlayer(t)
  video.value.ended = true
  video.value.paused = true
  player.updateScrollMiniPlayer()
  assert.equal(player.scrollMiniPlayerActive.value, false)
})

test('leaving an already ended video does not open a mini player', t => {
  const { player, video, isActiveTab } = mountMiniPlayer(t)
  player.scrollMiniPlayerActive.value = false
  video.value.ended = true
  video.value.paused = true
  isActiveTab.value = false
  player.updateScrollMiniPlayer()
  assert.equal(player.scrollMiniPlayerActive.value, false)
  assert.equal(player.scrollMiniPlayerDetached.value, false)
})

for (const options of [{ navigatedAway: false }, { keepPlaying: false }]) {
  test(`cross-tab playback still hides on end with ${JSON.stringify(options)}`, t => {
    const { player, video } = mountMiniPlayer(t, { detached: true, ...options })
    video.value.ended = true
    video.value.paused = true
    player.updateScrollMiniPlayer()
    assert.equal(player.scrollMiniPlayerActive.value, false)
  })
}

test('a rejected replay remains retryable without an unhandled rejection', async t => {
  const { player, video } = mountMiniPlayer(t, { detached: true })
  video.value.ended = true
  video.value.paused = true
  const play = video.value.play
  video.value.play = () => Promise.reject(new Error('Playback was interrupted'))
  player.scrollMiniPlayPauseVisible.value = false
  await player.scrollMiniTogglePlayPause()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(player.scrollMiniPlayerActive.value, true)
  assert.equal(player.scrollMiniPlayPauseVisible.value, true)
  video.value.play = play
  await player.scrollMiniTogglePlayPause()
  assert.equal(video.value.currentTime, 0)
  assert.equal(video.value.paused, false)
})

test('Android restoration reanchors skipped viewport changes without animating the mini-player', t => {
  const { player, classes, window } = mountMiniPlayer(t, { android: true })
  classes.add('androidPictureInPictureRestoring')
  const previous = player.scrollMiniPlayerStyle.value
  window.innerWidth = 640
  window.innerHeight = 360
  player.handleScrollMiniWindowResize()
  assert.deepEqual(player.scrollMiniPlayerStyle.value, previous)
  window.dispatchEvent(new Event('opentubex:android-pip-restored'))
  assert.equal(player.scrollMiniPlayerStyle.value.width, '640px')
  assert.equal(player.scrollMiniPlayerStyle.value.top, '284px')
  assert.equal(player.scrollMiniPlayerAnimating.value, false)
})

test('Android restoration returns a visible mini-player inline without its slide animation', t => {
  const { player, classes, window } = mountMiniPlayer(t, { android: true, inlineVisible: true })
  classes.add('androidPictureInPictureRestoring')
  player.updateScrollMiniPlayer()
  assert.equal(player.scrollMiniPlayerActive.value, true)
  window.dispatchEvent(new Event('opentubex:android-pip-restored'))
  assert.equal(player.scrollMiniPlayerActive.value, false)
  assert.equal(player.scrollMiniPlayerAnimating.value, false)
})
