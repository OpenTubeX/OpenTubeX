import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as coordinator from '../../src/renderer/helpers/crossTabMiniPlayer.js'
import { computed, effectScope, reactive, ref, watch } from 'vue'

// Execute the entire composable. Stub its platform/layout dependencies, while
// retaining Vue watchers, pointer events, and the real volume timeout behavior.
const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useScrollMiniPlayer.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export /gm, '')

function mountMiniPlayer(t, { detached = false, navigatedAway = detached, keepPlaying = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const scope = effectScope()
  const window = new EventTarget()
  window.setTimeout = t.mock.fn(setTimeout)
  const isActiveTab = ref(true)
  const video = ref({ paused: false, ended: false, volume: 1, currentTime: 120, play() { this.paused = false; this.ended = false }, pause() { this.paused = true } })
  const rect = { left: 10, top: 10, width: 360, height: 202 }
  const create = vm.runInNewContext(`${source}; useScrollMiniPlayer`, {
    ...coordinator, computed, ref, watch, inject: () => ({ detached: ref(navigatedAway), tabPresented: ref(true), minimized: ref(false), clearMinimizePreview() {} }), watchNavigationKey: Symbol(),
    nextTick() {}, window, clearTimeout,
    document: { body: { classList: { remove() {} } } },
    store: { getters: reactive({ getAutoPictureInPictureTriggers: [], getKeepPlayingOnNavigation: keepPlaying, getScrollMiniPlayerOnAllTabs: true }) },
    DEFAULT_ASPECT_RATIO: 16 / 9,
    getDefaultScrollMiniPlayerRect: () => ({ ...rect }),
    getSavedScrollMiniPlayerRect: () => null,
    parseScrollMiniPlayerSavedRect: () => null,
    setSavedScrollMiniPlayerRect() {},
    getViewportInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    clampScrollMiniPlayerRect: value => ({ ...value }),
    pickScrollMiniVerticalAnchor: () => null,
    getScrollMiniVerticalAnchor: () => ({}),
    getResizeHandleCorner: () => 'bottom-right',
    updateScrollMiniPlayerVolumeBarFill() {},
    getScrollMiniInlineLayoutHeight: () => 202,
    SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT: 100,
    isReducedMotionEnabled: () => true,
    performance: { now: () => 0 }
  })
  const player = scope.run(() => create({
    container: ref(null), fullWindowEnabled: ref(false), getUi: () => null,
    isActiveTab, pictureInPictureActive: ref(false), props: reactive({ format: 'video', videoId: 'video' }),
    video
  }))
  player.scrollMiniPlayerActive.value = true
  player.scrollMiniPlaceholderHeight.value = 202
  if (detached) {
    // Register ownership through the real tab-change coordinator without layout.
    isActiveTab.value = false
  }
  t.after(() => { player.teardownScrollMiniPlayer(); scope.stop() })
  return { player, window, isActiveTab, video }
}

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
    ...player, clearSabrBackoffTimer: noop, abRepeatEnabled: ref(false),
    setShowUiOnPaused: noop, shortsPaused: ref(false), playbackEnded: ref(false),
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
