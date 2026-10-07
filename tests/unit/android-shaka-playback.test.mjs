import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const template = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.vue', import.meta.url), 'utf8')

test('Android shows a thumbnail over the video while waiting for playback', () => {
  const poster = template.match(/<div\s+v-if="thumbnail"\s+v-show=[\s\S]*?<\/div>/)?.[0]
  assert.ok(poster)
  const render = Vue.compile(poster.replace('v-show=', ':data-visible='))
  const context = {
    showCountdownOverlay: false,
    showPoster: true,
    showEndedScreen: false,
    audioPlayerMode: false,
    mobileMiniBar: false,
    scrollMiniPlayerActive: false,
    scrollMiniPlayerDragStyle: null,
    scrollMiniPlayerAnimating: false,
    thumbnail: 'poster.jpg',
  }
  assert.equal(render(context).type, 'div')
  context.showPoster = false
  const hidden = render(context)
  assert.equal(hidden.type, 'div')
  assert.equal(hidden.props['data-visible'], false)
  context.audioPlayerMode = true
  context.showPoster = true
  assert.equal(render(context).props['data-visible'], false)
  context.mobileMiniBar = true
  for (const state of ['scrollMiniPlayerActive', 'scrollMiniPlayerDragStyle', 'scrollMiniPlayerAnimating']) {
    context[state] = true
    const mini = render(context)
    assert.equal(mini.props['data-visible'], true)
    assert.equal(mini.props.class, 'countdownPoster')
    context[state] = false
  }
})

test('Android registers the SABR scheme before Shaka loads its manifest', () => {
  const start = source.indexOf('    function ensureSabrStream() {')
  const end = source.indexOf('\n    ensureSabrStream()', start)
  assert.ok(start !== -1 && end !== -1)

  let registrations = 0
  const setupSabrScheme = () => {
    registrations++
    return { onBackoffRequested() {}, onReloadOnce() {} }
  }
  vm.runInNewContext(`${source.slice(start, end)}\nensureSabrStream()`, {
    process: { env: { IS_CAPACITOR: true, SUPPORTS_LOCAL_API: true } },
    sabrStream: null,
    props: { sabrData: { scheme: 'sabr1' } },
    setupSabrScheme,
    player: null,
    sabrManifest: null,
    playerWidth: { value: 0 },
    playerHeight: { value: 0 },
    AbortController,
  })
  assert.equal(registrations, 1)
})

test('Android phone uses the central Shaka play button without a duplicate in the bottom row', () => {
  const start = source.indexOf('      const controlPanelElements = [')
  const end = source.indexOf('\n      ]', start)
  assert.ok(start !== -1 && end !== -1)
  const expression = `${source.slice(start, end + '\n      ]'.length)}\ncontrolPanelElements`
  const controls = mobile => vm.runInNewContext(expression, {
    mobile,
    onlyUseOverFlowMenu: { value: true },
    props: { shortsPlayer: false, chapters: [] },
  })
  assert.equal(controls(true).includes('play_pause'), false)
  assert.equal(controls(true).includes('ft_skip_previous'), false)
  assert.equal(controls(true).includes('ft_skip_next'), false)
  assert.equal(controls(false).includes('play_pause'), true)
})

test('Android fullscreen button delegates orientation sequencing to the adapter', () => {
  const start = source.indexOf('    function handleFullscreenButtonClick(event) {')
  const end = source.indexOf('\n    const mobileFullscreenBrightnessActive', start)
  const calls = []
  vm.runInNewContext(`${source.slice(start, end)}\nhandleFullscreenButtonClick({})`, {
    androidRotationFullscreen: false,
    finishAndroidFullscreenExit: () => calls.push('finish-exit'),
    handleScrollMiniFullscreenButtonClick: () => calls.push('fullscreen'),
    setFullscreenOrientation: () => calls.push('rotate'),
  })
  assert.deepEqual(calls, ['finish-exit', 'fullscreen'], 'Clear a pending exit before delegating to the fullscreen adapter')
})

function androidRotationHarness(overrides = {}) {
  const start = source.indexOf('    let androidRotationFullscreen = false')
  const end = source.indexOf('\n    let stopAndroidRotation', start)
  assert.ok(start !== -1 && end !== -1, 'Android must handle display rotation without requiring a fullscreen user gesture')

  const calls = []
  let popoverOpen = false
  const fullWindowEnabled = { value: false }
  const context = {
    fullWindowEnabled,
    isActiveTab: { value: true },
    video: { value: { readyState: 4 } },
    ui: { getControls: () => ({}) },
    fullWindowListenerReady: true,
    androidFullscreenHost: {
      setAttribute: () => {},
      removeAttribute: () => {},
      showPopover: () => { popoverOpen = true },
      hidePopover: () => { popoverOpen = false },
      matches: () => popoverOpen,
    },
    events: { dispatchEvent: event => {
      fullWindowEnabled.value = event.detail
      calls.push(event.detail)
    } },
    CustomEvent: class { constructor(_name, options) { this.detail = options.detail } },
    setLandscapeOrientation: async landscape => { calls.push(`orientation:${landscape}`) },
    setAndroidNavigationBarVisible: async visible => { calls.push(`navigation:${visible}`) },
    syncAndroidStatusBarVisibility: () => {},
    isNativeFullscreenActive: () => false,
    pictureInPictureActive: { value: false },
    androidFullscreenEntering: false,
    mobileAdjustmentsVisible: { value: true },
    enterFullscreenOnDisplayRotate: { value: true },
    fullscreenRotationIgnoresSystemLock: { value: false },
    scrollMiniPlayerActive: { value: false },
    props: { format: 'legacy', shortsPlayer: false },
    ...overrides,
  }
  const handlers = vm.runInNewContext(`${source.slice(start, end)}\n({ handleAndroidRotation, exitAndroidRotationFullscreen })`, context)
  return { calls, context, handlers, isPopoverOpen: () => popoverOpen }
}

test('Android opens fullscreen after manual display rotation without overriding the system orientation', () => {
  const { calls, context, handlers, isPopoverOpen } = androidRotationHarness()
  handlers.handleAndroidRotation(true)
  context.video.value.readyState = 0
  handlers.handleAndroidRotation(false)
  assert.deepEqual(calls, [true, 'navigation:false', false, 'navigation:true'])
  assert.equal(isPopoverOpen(), false)
})

test('Android can rotate to fullscreen with the system rotation lock when explicitly enabled', () => {
  const { calls, handlers, isPopoverOpen } = androidRotationHarness({
    fullscreenRotationIgnoresSystemLock: { value: true },
  })
  handlers.handleAndroidRotation(true)
  assert.equal(isPopoverOpen(), true)
  assert.ok(calls.includes('orientation:true'))
  handlers.handleAndroidRotation(false)
  assert.equal(isPopoverOpen(), false)
  assert.ok(calls.includes('orientation:false'))
})

test('Android restores the system orientation policy when rotation fullscreen is dismissed', () => {
  const { calls, handlers } = androidRotationHarness({
    fullscreenRotationIgnoresSystemLock: { value: true },
  })
  handlers.handleAndroidRotation(true)
  handlers.exitAndroidRotationFullscreen()
  assert.deepEqual(calls.filter(call => typeof call === 'string' && call.startsWith('orientation:')), [
    'orientation:true', 'orientation:false',
  ])
})

test('Android ignores a rejected orientation lock from an earlier fullscreen session', async () => {
  const rejections = []
  const { handlers, isPopoverOpen } = androidRotationHarness({
    fullscreenRotationIgnoresSystemLock: { value: true },
    setLandscapeOrientation: landscape => landscape
      ? new Promise((_resolve, reject) => rejections.push(reject))
      : Promise.resolve(),
  })
  handlers.handleAndroidRotation(true)
  handlers.handleAndroidRotation(false)
  handlers.handleAndroidRotation(true)
  rejections[0](new Error('Old orientation request failed'))
  await Promise.resolve()
  assert.equal(isPopoverOpen(), true)
  rejections[1](new Error('Current orientation request failed'))
  await Promise.resolve()
  assert.equal(isPopoverOpen(), false)
})

test('Android exits physical rotation fullscreen when portrait arrives before resume visibility', () => {
  const { calls, context, handlers, isPopoverOpen } = androidRotationHarness({
    fullscreenRotationIgnoresSystemLock: { value: true },
  })
  handlers.handleAndroidRotation(true)
  context.mobileAdjustmentsVisible.value = false
  handlers.handleAndroidRotation(false)
  assert.equal(isPopoverOpen(), false)
  assert.ok(calls.includes('orientation:false'))
})

for (const [state, overrides] of [
  ['manual fullscreen entry pending', { androidFullscreenEntering: true }],
  ['fullscreen-on-rotate disabled', { enterFullscreenOnDisplayRotate: { value: false } }],
  ['minimized player', { scrollMiniPlayerActive: { value: true } }],
  ['audio playback', { props: { format: 'audio', shortsPlayer: false } }],
  ['Shorts player', { props: { format: 'legacy', shortsPlayer: true } }],
  ['Picture-in-Picture', { pictureInPictureActive: { value: true } }],
  ['background app', { mobileAdjustmentsVisible: { value: false } }],
]) {
  test(`Android preserves the system rotation lock for ${state}`, () => {
    const { calls, handlers, isPopoverOpen } = androidRotationHarness(overrides)
    handlers.handleAndroidRotation(true)
    assert.deepEqual(calls, [])
    assert.equal(isPopoverOpen(), false)
  })
}

test('Android still exits rotation fullscreen after the player becomes minimized', () => {
  const { calls, context, handlers, isPopoverOpen } = androidRotationHarness()
  handlers.handleAndroidRotation(true)
  context.scrollMiniPlayerActive.value = true
  handlers.handleAndroidRotation(false)
  assert.deepEqual(calls.slice(-2), [false, 'navigation:true'])
  assert.equal(isPopoverOpen(), false)
})

test('Android does not force landscape when the fullscreen view fails to open', () => {
  const { calls, handlers, isPopoverOpen } = androidRotationHarness({
    fullscreenRotationIgnoresSystemLock: { value: true },
    events: { dispatchEvent: () => {} },
  })
  handlers.handleAndroidRotation(true)
  assert.equal(calls.includes('orientation:true'), false)
  assert.equal(calls.includes('navigation:false'), false)
  assert.equal(isPopoverOpen(), false)
})

test('Android selects physical sensing only for the opt-in and releases subscriptions on preference or tab changes', () => {
  const start = source.indexOf('    let stopAndroidRotation')
  const end = source.indexOf('\n    onBeforeUnmount(', start)
  assert.ok(start !== -1 && end !== -1)
  let change
  const calls = []
  const subscribe = name => () => {
    calls.push(name)
    return () => calls.push(`stop:${name}`)
  }
  vm.runInNewContext(source.slice(start, end), {
    watch: (_sources, callback) => { change = callback },
    enterFullscreenOnDisplayRotate: {},
    isActiveTab: {},
    fullscreenRotationIgnoresSystemLock: {},
    exitAndroidRotationFullscreen: () => calls.push('exit'),
    handleAndroidRotation: () => {},
    observeAndroidDisplayRotation: subscribe('display'),
    observeAndroidDeviceRotation: subscribe('device'),
    process: { env: { IS_CAPACITOR: true, IS_IOS: false } },
  })
  change([true, true, false])
  change([true, true, true])
  change([true, false, true])
  change([false, true, true])
  assert.deepEqual(calls, ['exit', 'display', 'stop:display', 'exit', 'device', 'stop:device', 'exit', 'exit'])
})

test('Android holds the exit presentation until the WebView matches the unlocked display', async () => {
  const start = source.indexOf('    let androidFullscreenPortrait = null')
  const end = source.indexOf('    function fullscreenChangeHandler()', start)
  const listeners = new Map()
  const timers = new Map()
  const frames = new Map()
  let open = false
  let cleanup
  let exitTimeout
  const host = {
    setAttribute() {}, removeAttribute() {},
    showPopover() { open = true }, hidePopover() { open = false }, matches() { return open },
  }
  const context = {
    androidFullscreenHost: host, androidFullscreenHostActive: { value: false },
    document: { fullscreenElement: null },
    getAndroidDisplayOrientation: async () => 'landscape-primary',
    onBeforeUnmount: callback => { cleanup = callback },
    watch() {}, isActiveTab: {},
    suppressPanelTransitions() {},
    requestAnimationFrame: callback => { frames.set(1, callback); return 1 },
    cancelAnimationFrame: id => frames.delete(id),
    clearTimeout: id => timers.delete(id),
    window: {
      innerWidth: 800, innerHeight: 400,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
      setTimeout: (callback, delay) => { exitTimeout = delay; timers.set(1, callback); return 1 },
    },
  }
  const retain = vm.runInNewContext(`${source.slice(start, end)}
    (updated) => { androidFullscreenPortrait = true; retainAndroidFullscreenDuringRotation(updated) }`, context)
  retain()
  assert.equal(open, true)
  context.window.innerHeight = 380 // System bars resize before rotation finishes.
  listeners.get('resize')()
  assert.equal(open, true)
  context.window.innerWidth = 400
  context.window.innerHeight = 800
  listeners.get('resize')()
  assert.equal(open, true, 'Keep the surface until the restored viewport paints')
  frames.get(1)()
  assert.equal(open, true)
  frames.get(1)()
  assert.equal(open, false)
  assert.equal(context.androidFullscreenHostActive.value, false)
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)

  // Exiting while already in the original orientation needs no temporary layer.
  retain()
  assert.equal(open, false)
  context.window.innerWidth = 900
  retain()
  timers.get(1)() // A user/device policy can keep the display landscape.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(open, false)
  assert.equal(listeners.size, 0)
  retain(Promise.resolve())
  await new Promise(resolve => setImmediate(resolve))
  frames.get(1)?.()
  frames.get(1)?.()
  assert.equal(open, true, 'A stale landscape read after unlock must not discard the expected portrait rotation')
  assert.equal(exitTimeout, 500, 'Bound a genuine no-rotation exit without a five-second hold')
  timers.get(1)()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(open, false)
  assert.equal(timers.size, 0)
  // Native rotation may complete before the WebView's resized frame arrives.
  context.getAndroidDisplayOrientation = async () => 'portrait-primary'
  retain()
  timers.get(1)()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(open, true, 'Keep the overlay while the WebView still has the old landscape viewport')
  context.window.innerWidth = 400
  context.window.innerHeight = 900
  listeners.get('resize')()
  frames.get(1)()
  frames.get(1)()
  assert.equal(open, false)
  context.window.innerWidth = 1000
  retain()
  cleanup() // Navigating away must cancel the pending exit.
  assert.equal(open, false)
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
})

test('Android fullscreen events do not repeat an entry rotation already in flight', () => {
  const start = source.indexOf('    function updateFullscreenOrientation(fullscreen)')
  const end = source.indexOf('    /** @type {(preserveOrientation?', start)
  const calls = []
  const context = {
    androidFullscreenEntering: true,
    isActiveTab: { value: true },
    isNativeFullscreenActive: () => true,
    video: { value: {} }, rotateFullscreenToLandscape: { value: true }, fullscreenAspectRatio: { value: 16 / 9 },
    setFullscreenOrientation: async active => { calls.push(active) },
  }
  const update = vm.runInNewContext(`${source.slice(start, end)}\nupdateFullscreenOrientation`, context)
  update(true)
  assert.deepEqual(calls, [])
  context.androidFullscreenEntering = false
  update(true)
  assert.deepEqual(calls, [true])
  context.isNativeFullscreenActive = () => false
  update(false)
  assert.deepEqual(calls, [true, false])
})

test('Android rechecks fullscreen orientation when metadata aspect ratio arrives', async () => {
  const start = source.indexOf('    watch([rotateFullscreenToLandscape, fullscreenAspectRatio],')
  const end = source.indexOf('\n    /** @type', start)
  assert.ok(start !== -1 && end !== -1)
  const calls = []
  let onChange
  vm.runInNewContext(source.slice(start, end), {
    watch: (_sources, callback) => { onChange = callback },
    rotateFullscreenToLandscape: { value: true },
    fullscreenAspectRatio: { value: 16 / 9 },
    isNativeFullscreenActive: () => true,
    video: { value: { videoWidth: 0, videoHeight: 0 } },
    setFullscreenOrientation: async (_fullscreen, _video, _enabled, ratio) => { calls.push(ratio) },
  })
  await onChange([true, 16 / 9])
  assert.deepEqual(calls, [16 / 9])
})

test('Android leaves fullscreen orientation to its native preference', () => {
  const expression = source.match(/forceLandscapeOnFullscreen: ([^\n]+),/)?.[1]
  assert.ok(expression)
  const configured = env => vm.runInNewContext(expression, { process: { env } })
  assert.equal(configured({ IS_CAPACITOR: true, IS_IOS: false }), false)
  assert.equal(configured({ IS_CAPACITOR: true, IS_IOS: true }), true)
  assert.equal(configured({ IS_ELECTRON: true }), true)
})

test('fullscreen gesture completion restarts controls while the real post-hold touch is suppressed', () => {
  const start = source.indexOf('    function handlePlayerTouchEnd(event) {')
  const end = source.indexOf('\n    /**', start)
  const calls = []
  const handler = vm.runInNewContext(`${source.slice(start, end)}\nhandlePlayerTouchEnd`, {
    suppressTemporaryPlaybackRateClick: true,
    handleMobilePlayerTouchEnd: () => calls.push('restart-idle'),
  })
  const event = trusted => ({
    isTrusted: trusted,
    preventDefault: () => calls.push('prevent'),
    stopImmediatePropagation: () => calls.push('stop'),
  })
  handler(event(true))
  assert.deepEqual(calls, ['prevent', 'stop'])
  calls.length = 0
  handler(event(false))
  assert.deepEqual(calls, ['restart-idle'])
})
