import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { getScrollMiniInlineLayoutHeight } from '../../src/renderer/helpers/scrollMiniPlayer.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useScrollMiniPlayer.js', import.meta.url), 'utf8')
const dragSource = source.slice(source.indexOf('  let inlineDrag ='), source.indexOf('  function updateScrollMiniVideoAspectRatio'))

test('mobile morph keeps player and video layout fixed between animation frames', () => {
  const writes = []
  const style = {
    setProperty(name, value) { writes.push([name, value]) },
    removeProperty() {},
  }
  const videoStyle = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name]; if (name === 'clip-path') delete this.clipPath } }
  const posterStyle = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name]; if (name === 'clip-path') delete this.clipPath } }
  const overlayStyle = { removeProperty() { delete this.opacity } }
  const surfaces = [{ style: videoStyle, classList: { contains: () => false } }]
  const attributes = new Set()
  const video = { style: videoStyle }
  const methods = vm.runInNewContext(`${source.slice(source.indexOf('  function renderMobileMiniMorph('), source.indexOf('  function releaseMobileMiniBarTransition('))}\n({ renderMobileMiniMorph, clearMobileMiniMorph })`, {
    container: { value: {
      style,
      hasAttribute: name => attributes.has(name),
      setAttribute: name => attributes.add(name),
      removeAttribute: name => attributes.delete(name),
      querySelector: () => null,
      querySelectorAll: selector => selector === '.musicAudioMetadata' ? [] : surfaces,
    } },
    video: { value: video },
    mobileMiniBarOverlay: { value: { style: overlayStyle } },
    mobileMiniMorphBase: null,
  })
  const render = methods.renderMobileMiniMorph
  const from = { left: 8, top: 80, width: 400, height: 225 }
  const to = { left: 0, top: 700, width: 400, height: 76 }
  const videoFrom = { left: 0, top: 0, width: 400, height: 225 }
  const videoTo = { left: 8, top: 6, width: 112, height: 63 }
  // Like DOMRect, these coordinates are inherited rather than own fields.
  const domRect = Object.create(from)
  render(domRect, to, videoFrom, videoTo, 0, false)
  assert.ok(writes.some(([name, value]) => name === '--mobile-mini-left' && value === '8px'))
  assert.ok(writes.some(([name, value]) => name === '--mobile-mini-height' && value === '225px'))
  assert.ok(writes.every(([, value]) => !/undefined|NaN/.test(value)))
  writes.length = 0
  render(from, to, videoFrom, videoTo, 0.5, false)
  assert.deepEqual(writes.map(([name]) => name).sort(), [
    'transform'
  ])
  assert.equal(videoStyle.clipPath, 'none', 'matching aspect ratios do not need a clipping layer')
  assert.ok(Math.abs(Number(overlayStyle.opacity) - 0.75) < 0.001)
  // Nonmatching aspect ratios still crop both playback and countdown surfaces.
  const posterImage = { naturalWidth: 0, naturalHeight: 0 }
  surfaces.push({ style: posterStyle, classList: { contains: name => name === 'countdownPoster' }, querySelector: () => posterImage })
  render(from, to, videoFrom, { ...videoTo, height: 112 }, 0.5, false)
  const crop = videoStyle.clipPath.match(/^inset\((.+)px (.+)px\)$/)
  assert.ok(Math.abs(Number(crop[1])) < 0.001)
  assert.ok(Number(crop[2]) > 0)
  assert.notEqual(videoStyle.clipPath, 'inset(0px 0px)')
  assert.equal(posterStyle.clipPath, videoStyle.clipPath)
  methods.clearMobileMiniMorph()
  assert.equal(videoStyle.clipPath, undefined)
  assert.equal(posterStyle.clipPath, undefined)
  assert.equal(overlayStyle.opacity, undefined)
  writes.length = 0
  render(to, { ...from, height: 300 }, videoTo, { ...videoFrom, height: 300 }, 0.5, true)
  assert.ok(writes.some(([name, value]) => name === '--mobile-mini-video-base-width' && value === '400px'))
  assert.ok(writes.some(([name, value]) => name === '--mobile-mini-video-base-height' && value === '300px'),
    'restoration uses the 4:3 inline surface instead of the 16:9 thumbnail')
  assert.equal(posterStyle.clipPath, videoStyle.clipPath)
  writes.length = 0
  render(to, { ...from, width: 500, height: 375 }, videoTo, { ...videoFrom, width: 500, height: 375 }, 1, true)
  assert.deepEqual(writes.map(([name]) => name), ['transform'], 'resizing keeps the decode surface fixed')
  assert.match(writes[0][1], /scale\(1\.25\)/)
  assert.equal(videoStyle.clipPath, 'none')
  methods.clearMobileMiniMorph()

  // A 4:3 picture inside a forced 16:9 inline player must lose its side bars
  // continuously, reaching the same cover crop as the settled thumbnail.
  video.videoWidth = 320
  video.videoHeight = 240
  render(from, to, videoFrom, videoTo, 0, false)
  assert.equal(videoStyle['--mobile-mini-media-scale'], '1')
  render(from, to, videoFrom, videoTo, 1, false)
  assert.ok(Math.abs(Number(videoStyle['--mobile-mini-media-scale']) - 4 / 3) < 0.001)
  // A wide thumbnail over that 4:3 video already fills the 16:9 slot and
  // must not inherit the video's extra zoom before the settled cover crop.
  posterImage.naturalWidth = 480
  posterImage.naturalHeight = 270
  render(from, to, videoFrom, videoTo, 1, false)
  assert.equal(posterStyle['--mobile-mini-media-scale'], '1')
  assert.equal(posterStyle.clipPath, 'none')
  methods.clearMobileMiniMorph()
  assert.equal(videoStyle['--mobile-mini-media-scale'], undefined)
  render(to, from, videoTo, videoFrom, 1, true)
  assert.equal(videoStyle['--mobile-mini-media-scale'], '1')
  assert.equal(videoStyle.clipPath, 'none')
  methods.clearMobileMiniMorph()
})

for (const hidden of [false, true]) {
  test(`music morph animates the visible fallback when artwork is ${hidden ? 'failed' : 'loading'}`, () => {
    const attributes = new Set()
    const style = () => ({ setProperty() {}, removeProperty(name) { delete this[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] } })
    const rect = { left: 0, top: 0, width: 400, height: 225 }
    const placeholder = {
      style: style(), naturalWidth: 480, naturalHeight: 270,
      getBoundingClientRect: () => ({ left: 40, top: 20, width: 100, height: 100 }),
      closest: () => ({ getBoundingClientRect: () => rect })
    }
    const loadingImage = {
      ...placeholder, hidden, style: style(), naturalWidth: 0, naturalHeight: 0,
      getBoundingClientRect: () => ({ left: 40, top: 20, width: 1, height: 1 })
    }
    const methods = vm.runInNewContext(`${source.slice(source.indexOf('  function renderMobileMiniMorph('), source.indexOf('  function releaseMobileMiniBarTransition('))}\n({ renderMobileMiniMorph, clearMobileMiniMorph })`, {
      container: { value: {
        style: style(), hasAttribute: name => attributes.has(name),
        setAttribute: name => attributes.add(name), removeAttribute: name => attributes.delete(name),
        querySelector: selector => selector === '.musicAudioArtwork.retryImagePlaceholder' ? placeholder : loadingImage,
        querySelectorAll: () => []
      } },
      video: { value: { videoWidth: 400, videoHeight: 225 } },
      mobileMiniBarOverlay: { value: null }, mobileMiniMorphBase: null,
      getComputedStyle: () => ({ borderTopLeftRadius: '12px' })
    })
    methods.renderMobileMiniMorph(rect, { ...rect, top: 700 }, rect, { left: 8, top: 6, width: 80, height: 45 }, 1, false)
    assert.equal(placeholder.style.transform, 'translate(110px, 42.5px) scale(4)')
    assert.equal(placeholder.style.borderRadius, '0px')
    assert.equal(loadingImage.style.transform, undefined)
    methods.clearMobileMiniMorph()
    assert.equal(placeholder.style.transform, undefined)
    assert.equal(placeholder.style.borderRadius, undefined)
  })
}

function fixture({ reducedMotion = false, available = true, phonePanel = false, restoring = false, finishRejects = false, activationSucceeds = true, format = 'dash', mobile = false } = {}) {
  let reads = 0
  let navigations = 0
  let previewProgress = 0
  let activated = false
  let deactivated = false
  let haptics = 0
  let updates = 0
  const stash = { value: 'left' }
  const scrollMiniPlayerActive = { value: restoring }
  let destination = null
  const frames = new Map()
  const animations = []
  const style = { removeProperty(key) { delete this[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] } }
  const from = restoring
    ? { x: 172.25, y: 570.75, width: 210.5, height: 118.40625 }
    : { x: 10.25, y: 80.5, width: 390.5, height: 219.65625 }
  const to = { left: 172.25, top: 570.75, width: 210.5, height: 118.40625 }
  const container = { value: {
    style, offsetHeight: 219.65625,
    hasAttribute: name => phonePanel && name === 'data-phone-panel-video',
    setAttribute() {}, removeAttribute() {},
    querySelectorAll: () => [],
    getBoundingClientRect() { reads++; return from },
  } }
  const eligibility = source.slice(source.indexOf('  function canUseScrollMiniPlayerBase('), source.indexOf('  function canShowCrossTabMiniPlayer('))
  const methods = vm.runInNewContext(`${eligibility}\n${dragSource}\n({ beginScrollMiniPlayerDrag, moveScrollMiniPlayerDrag, updateScrollMiniPlayerBackProgress, finishScrollMiniPlayerDrag, cancelScrollMiniPlayerDrag, canUseScrollMiniPlayerBase })`, {
    process: { env: { IS_CAPACITOR: false } },
    container,
    video: { value: { getBoundingClientRect: () => from, style: { removeProperty() {} } } },
    mobileMiniMorphBase: null,
    usesMobileMiniBar: () => mobile,
    performance: { now: () => 0 },
    SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS: 300,
    getAnimationSpeedMultiplier: () => 1,
    store: { getters: { getAnimationSpeed: 1 } },
    watchNavigation: {
      detached: { value: true }, minimize() {},
      beginMinimizePreview() { navigations++ },
      beginRestorePreview() { return true },
      updateMinimizePreview(progress) { previewProgress = progress },
      async finishMinimizePreview(commit) {
        if (finishRejects) throw new Error('handoff failed')
        if (!commit) navigations--
        if (restoring && commit) this.detached.value = false
      },
      clearMinimizePreview() {},
    },
    nextTick: async callback => callback(),
    scrollMiniPlaceholder: { value: { getBoundingClientRect: () => ({ left: 0, top: 80, width: 390, height: 219.375 }) } },
    scrollMiniPlaceholderHeight: { value: 0 },
    scrollMiniPlayerDragStyle: { value: null },
    mobileMiniBarOverlayStyle: { value: null },
    mobileMiniBarOverlay: { value: null },
    scrollMiniPlayerActive,
    scrollMiniVideoAspectRatio: { value: 16 / 9 },
    playerSuspended: { value: !available },
    props: { format },
    fullWindowEnabled: { value: false },
    isNativeFullscreenActive: () => false,
    isNativePipActive: () => false,
    cancelScrollMiniPlayerLayoutAnimation() {},
    updateScrollMiniVideoAspectRatio() {},
    clampScrollMiniPlayerRect: rect => rect,
    scrollMiniPlayerStashedSide: stash,
    scrollMiniPlayerRestoreRect: null,
    applyScrollMiniPlayerRect(rect) { destination = rect },
    getSavedScrollMiniPlayerRect: () => to,
    reanchorScrollMiniPlayerRect: rect => rect,
    requestAnimationFrame(callback) { frames.set(1, callback); return 1 },
    cancelAnimationFrame(id) { frames.delete(id) },
    activateScrollMiniPlayer() { activated = true; scrollMiniPlayerActive.value = activationSucceeds },
    deactivateScrollMiniPlayer() { deactivated = true; scrollMiniPlayerActive.value = false },
    lightHaptic() { haptics++ },
    updateScrollMiniPlayer() { updates++ },
    isReducedMotionEnabled: () => reducedMotion,
    scrollMiniPlayerAnimating: { value: false },
    scrollMiniLayoutAnimationSequence: 0,
    animateScrollMiniPlayerLayout: (...args) => { animations.push(args) },
    console,
  })
  return { methods, style, frames, animations, stash, progress: () => previewProgress, destination: () => destination, reads: () => reads, navigations: () => navigations, activated: () => activated, deactivated: () => deactivated, haptics: () => haptics, updates: () => updates }
}

test('drag batches pointer samples into one transform without reading layout per move', () => {
  const f = fixture()
  assert.equal(f.methods.beginScrollMiniPlayerDrag(), true)
  for (let y = 1; y <= 100; y++) f.methods.moveScrollMiniPlayerDrag(12.5, y)
  assert.equal(f.frames.size, 1)
  assert.equal(f.reads(), 1)
  f.frames.get(1)()
  assert.match(f.style.transform, /^translate\([\d.]+px, [\d.]+px\) scale\(0\.\d+, 0\.\d+\)$/)
  assert.equal(f.reads(), 1)
  assert.equal(f.progress(), 1)
})

test('Android back progress follows the full dock path with fractional player geometry', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.updateScrollMiniPlayerBackProgress(0.5)
  f.frames.get(1)()
  const halfway = Number(f.style.transform.match(/translate\([^,]+, ([\d.]+)px/)[1])
  assert.equal(halfway, (570.75 - 80.5) / 2)
  f.methods.updateScrollMiniPlayerBackProgress(1)
  f.frames.get(1)()
  assert.equal(Number(f.style.transform.match(/translate\([^,]+, ([\d.]+)px/)[1]), 570.75 - 80.5)
  assert.equal(f.reads(), 1)
})

test('cancellation removes pending frames and restores the original player without navigation', async () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 30)
  const finished = f.methods.finishScrollMiniPlayerDrag(false)
  await Promise.resolve()
  const frame = f.frames.get(1)
  f.frames.delete(1)
  frame(300)
  await finished
  assert.equal(f.frames.size, 0)
  assert.equal(f.style.transform, undefined)
  assert.equal(f.style.willChange, undefined)
  assert.equal(f.navigations(), 0)
  assert.equal(f.animations.length, 0)
  assert.equal(f.haptics(), 0)
})

test('committing minimizes once and reduced motion skips the release animation', async () => {
  const f = fixture({ reducedMotion: true })
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 200)
  await f.methods.finishScrollMiniPlayerDrag(true)
  await f.methods.finishScrollMiniPlayerDrag(true)
  assert.equal(f.navigations(), 1)
  assert.equal(f.activated(), true)
  assert.equal(f.haptics(), 1)
  assert.equal(f.stash.value, null)
  assert.equal(f.destination().left, 172.25)
  assert.equal(f.animations.length, 0)
  assert.equal(f.style.transform, undefined)
})

test('failed preview handoff still clears inline drag state', async () => {
  const f = fixture({ reducedMotion: true, finishRejects: true })
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 200)
  await assert.rejects(f.methods.finishScrollMiniPlayerDrag(true), /handoff failed/)
  assert.equal(f.style.transform, undefined)
  assert.equal(f.style.willChange, undefined)
  assert.equal(f.methods.beginScrollMiniPlayerDrag(), true)
})

test('failed Watch restore keeps the retained mini player active', async () => {
  const f = fixture({ restoring: true, reducedMotion: true, finishRejects: true })
  f.methods.beginScrollMiniPlayerDrag(true)
  await assert.rejects(f.methods.finishScrollMiniPlayerDrag(true), /handoff failed/)
  assert.equal(f.deactivated(), false)
  assert.equal(f.activated(), false)
  assert.equal(f.stash.value, 'left')
  assert.equal(f.updates(), 1)
})

test('a dock attempt that cannot activate the mini player has no haptic', async () => {
  const f = fixture({ reducedMotion: true, activationSucceeds: false })
  f.methods.beginScrollMiniPlayerDrag()
  await f.methods.finishScrollMiniPlayerDrag(true)
  assert.equal(f.haptics(), 0)
})

test('unavailable playback does not capture a drag', () => {
  const f = fixture({ available: false })
  assert.equal(f.methods.beginScrollMiniPlayerDrag(), false)
  assert.equal(f.reads(), 0)
})

test('an open phone panel allows explicit minimization while blocking automatic docking', async () => {
  const f = fixture({ phonePanel: true, reducedMotion: true })
  assert.equal(f.methods.canUseScrollMiniPlayerBase(), false, 'the panel keeps its inline player while scrolling')
  assert.equal(f.methods.beginScrollMiniPlayerDrag(), true, 'swiping the video must still begin minimization')
  await f.methods.finishScrollMiniPlayerDrag(true)
  assert.equal(f.activated(), true)
  assert.equal(f.haptics(), 1)
})

test('navigation can hide the watch view without losing the drag handoff dimensions', () => {
  const measure = source.match(/function getScrollMiniPlaceholderLayoutHeight\(\) \{[\s\S]*?\n  \}/)[0]
  const height = vm.runInNewContext(`(${measure})()`, {
    inlineDrag: { from: { width: 412.19049, height: 231.857147 } },
    container: { value: { offsetWidth: 0, offsetHeight: 0 } },
    lastKnownInlinePlayerHeight: 232,
    getScrollMiniInlineLayoutHeight,
  })
  assert.ok(height > 231 && height < 233)
})


test('Watch starts fading immediately, independently of the mini-player destination', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 24)
  f.frames.get(1)()
  assert.equal(f.progress(), 0.25)
})


for (const commit of [true, false]) {
  test(`upward drag expands toward Watch and ${commit ? 'restores' : 'keeps'} the mini player`, async () => {
    const f = fixture({ restoring: true, reducedMotion: true })
    assert.equal(f.methods.beginScrollMiniPlayerDrag(true), true)
    f.methods.moveScrollMiniPlayerDrag(0, -24)
    f.frames.get(1)()
    assert.equal(f.progress(), 1 - 24 / 490.75)
    await f.methods.finishScrollMiniPlayerDrag(commit)
    assert.equal(f.deactivated(), commit)
    assert.equal(f.haptics(), Number(commit))
    assert.equal(f.style.transform, undefined)
    assert.equal(f.updates(), Number(!commit))
  })
}

test('drag follows the same fixed path regardless of sideways finger movement', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 100)
  f.frames.get(1)()
  const path = f.style.transform
  f.methods.moveScrollMiniPlayerDrag(95, 100)
  f.frames.get(1)()
  assert.equal(f.style.transform, path)
})

test('drag cannot overshoot the saved mini-player endpoint', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 1000)
  f.frames.get(1)()
  const endpoint = f.style.transform
  f.methods.moveScrollMiniPlayerDrag(0, 1500)
  f.frames.get(1)()
  assert.equal(f.style.transform, endpoint)
})

test('return keeps the preview in place until the player reaches the inline endpoint', async () => {
  const f = fixture({ restoring: true })
  f.methods.beginScrollMiniPlayerDrag(true)
  f.methods.moveScrollMiniPlayerDrag(0, -24)
  const finished = f.methods.finishScrollMiniPlayerDrag(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.deactivated(), false)
  const before = f.style.transform
  let frame = f.frames.get(1)
  f.frames.delete(1)
  frame(-1)
  assert.equal(f.style.transform, before, 'A frame timestamp before pointerup cannot move backward')
  frame = f.frames.get(1)
  f.frames.delete(1)
  frame(150)
  assert.equal(f.deactivated(), false)
  frame = f.frames.get(1)
  f.frames.delete(1)
  frame(300)
  await finished
  assert.equal(f.deactivated(), true)
  assert.equal(f.style.transform, undefined)
  assert.equal(f.style.borderRadius, undefined)
})

test('vertical player displacement matches the finger before reaching its endpoint', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(80, 100)
  f.frames.get(1)()
  const y = Number(f.style.transform.match(/translate\([^,]+, ([\d.]+)px/)[1])
  assert.ok(Math.abs(y - 100) < 0.001, `Player moved ${y}px for a 100px swipe`)
})

test('return button uses the same preview and continuous path as an upward swipe', () => {
  const returnSource = source.slice(source.indexOf('  function scrollMiniScrollToTop('), source.indexOf('  function dismissCrossTabMiniPlayer('))
  const calls = []
  vm.runInNewContext(`${returnSource}\nscrollMiniScrollToTop()`, {
    scrollMiniPlayerDetached: { value: true }, tabId: 'tab',
    watchNavigation: { detached: { value: true }, tabPresented: { value: true }, returnToVideo: () => calls.push('navigate') },
    beginScrollMiniPlayerDrag: restoring => { calls.push(['begin', restoring]); return true },
    finishScrollMiniPlayerDrag: commit => calls.push(['finish', commit]),
    process: { env: { IS_CAPACITOR: true } },
    getCapacitorTabService: () => ({ activateTab: () => calls.push('activate') })
  })
  assert.equal(JSON.stringify(calls), JSON.stringify([['begin', true], ['finish', true]]))
})

test('Watch return resets browsing scroll before revealing the Watch route', async () => {
  const watchSource = readFileSync(new URL('../../src/renderer/components/TabContent/TabWatchContent.vue', import.meta.url), 'utf8')
  const finishSource = watchSource.slice(watchSource.indexOf('async function finishMinimizePreview('), watchSource.indexOf('function clearMinimizePreview('))
  const window = {
    scrollY: 420,
    scrollTo() { this.scrollY = 0 }
  }
  let scrollAtNavigation = null
  const browsingEntry = { scroll: { left: 0, top: 420 } }
  const tab = { historyIndex: 0, history: [browsingEntry] }
  const isWatchRoute = { value: false }
  await vm.runInNewContext(`${finishSource}\nfinishMinimizePreview(true)`, {
    previewRestoring: true,
    previewScroll: { left: 0, top: 420 },
    disposed: false,
    navigation: { push: async () => {
      scrollAtNavigation = window.scrollY
      browsingEntry.scroll = { left: 0, top: window.scrollY }
      tab.history.push({ scroll: { left: 0, top: 0 } })
      tab.historyIndex = 1
      isWatchRoute.value = true
    } },
    props: { tabId: 'watch' },
    watchRoute: { value: { fullPath: '/watch/demo' } },
    isWatchRoute,
    store: {
      getters: { getTabById: () => tab },
      commit: (_mutation, { historyIndex, scroll }) => { tab.history[historyIndex].scroll = scroll }
    },
    window
  })
  assert.equal(scrollAtNavigation, 0)
  assert.equal(browsingEntry.scroll.top, 420)
})

test('failed Watch return keeps the browsing scroll position', async () => {
  const watchSource = readFileSync(new URL('../../src/renderer/components/TabContent/TabWatchContent.vue', import.meta.url), 'utf8')
  const finishSource = watchSource.slice(watchSource.indexOf('async function finishMinimizePreview('), watchSource.indexOf('function clearMinimizePreview('))
  const window = {
    scrollY: 420,
    scrollTo({ top }) { this.scrollY = top }
  }
  await assert.rejects(vm.runInNewContext(`${finishSource}\nfinishMinimizePreview(true)`, {
    previewRestoring: true,
    previewScroll: { left: 0, top: 420 },
    disposed: false,
    navigation: { push: async () => { throw new Error('Navigation failed') } },
    props: { tabId: 'watch' },
    watchRoute: { value: { fullPath: '/watch/demo' } },
    isWatchRoute: { value: false },
    window
  }))
  assert.equal(window.scrollY, 420)
})

test('mobile Watch return preview stays at the final viewport position while browsing is scrolled', () => {
  const watchSource = readFileSync(new URL('../../src/renderer/components/TabContent/TabWatchContent.vue', import.meta.url), 'utf8')
  const beginSource = watchSource.slice(watchSource.indexOf('function beginRestorePreview('), watchSource.indexOf('function updatePreviewPosition('))
  const previewStyle = { value: null }
  const previewHost = { value: {
    getBoundingClientRect: () => ({ left: 0, top: -240, width: 390 }),
    closest: () => ({ getBoundingClientRect: () => ({ left: 0, top: -240, width: 390 }) })
  } }
  const started = vm.runInNewContext(`${beginSource}\nbeginRestorePreview()`, {
    previewActive: { value: false },
    detached: { value: true },
    previewHost,
    previewStyle,
    watchRoot: { value: { style: {}, firstElementChild: { style: {} } } },
    updatePreviewPosition() {},
    document: { querySelector: () => ({}) },
    window: { scrollX: 0, scrollY: 300, innerHeight: 800, addEventListener() {} }
  })
  assert.equal(started, true)
  assert.equal(-240 + Number.parseFloat(previewStyle.value.top), 60)
  assert.equal(previewStyle.value.height, '740px')
})

for (const right of [false, true]) {
  for (const hiddenOnWatch of [false, true]) {
    test(`landscape restore previews the final width with the ${right ? 'right' : 'left'} sidebar ${hiddenOnWatch ? 'hidden' : 'visible'} on Watch`, () => {
      const watchSource = readFileSync(new URL('../../src/renderer/components/TabContent/TabWatchContent.vue', import.meta.url), 'utf8')
      const beginSource = watchSource.slice(watchSource.indexOf('function beginRestorePreview('), watchSource.indexOf('function updatePreviewPosition('))
      const previewStyle = { value: null }
      const bounds = { left: right ? 10 : 210, top: 78, width: 780 }
      const previewHost = { value: {
        getBoundingClientRect: () => bounds,
        closest: () => ({ getBoundingClientRect: () => bounds })
      } }
      const started = vm.runInNewContext(`${beginSource}\nbeginRestorePreview()`, {
        previewActive: { value: false }, detached: { value: true }, previewHost, previewStyle,
        watchRoot: { value: { style: {}, firstElementChild: { style: {} } } },
        store: { getters: { getHideSideBarOnWatchPages: hiddenOnWatch } },
        updatePreviewPosition() {},
        document: { querySelector: selector => selector === '.app > .sideNav'
          ? { getBoundingClientRect: () => ({ left: right ? 800 : 0, width: 200 }) } : null },
        window: { scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 450, addEventListener() {} }
      })
      assert.equal(started, true)
      assert.equal(previewStyle.value.width, hiddenOnWatch ? '980px' : '780px')
      assert.equal(bounds.left + Number.parseFloat(previewStyle.value.left), hiddenOnWatch || right ? 10 : 210)
    })
  }
}

for (const navigatedAway of [false, true]) {
  test(`close ${navigatedAway ? 'disposes a retained page' : 'only hides a player from another tab'}`, () => {
    const handler = source.slice(source.indexOf('  function dismissCrossTabMiniPlayer('), source.indexOf('  async function scrollMiniTogglePlayPause('))
    const dismissed = { value: false }
    let disposals = 0
    vm.runInNewContext(`${handler}\ndismissCrossTabMiniPlayer()`, {
      scrollMiniPlayerDetached: { value: true },
      scrollMiniPlayerDismissed: dismissed,
      watchNavigation: { detached: { value: navigatedAway }, dismiss: () => { disposals++ } }
    })
    assert.equal(disposals, navigatedAway ? 1 : 0)
    assert.equal(dismissed.value, !navigatedAway)
  })
}

for (const hidden of [false, true]) {
  test(`mobile minimize measures the settled endpoint with navigation ${hidden ? 'hidden' : 'visible'}`, () => {
    const styles = new Map()
    const element = {
      classList: { add() {} }, removeAttribute() {}, append() {}, remove() {},
      style: { setProperty: (key, value) => styles.set(key, value) },
      getBoundingClientRect: () => ({
        left: 0, top: 600 + (hidden && styles.get('translate') !== 'none' ? 60 : 0), width: 400, height: 108
      })
    }
    const video = { removeAttribute() {}, getBoundingClientRect: () => ({ left: 8, top: element.getBoundingClientRect().top + 6, width: 112, height: 63 }) }
    const measure = vm.runInNewContext(`${source.slice(source.indexOf('  function measureMobileMiniBar('), source.indexOf('  function measureInlinePlayer('))}\nmeasureMobileMiniBar`, {
      document: { getElementById: () => ({ append() {} }) },
      container: { value: { cloneNode: () => element } },
      video: { value: { cloneNode: () => video } },
      getMobileMiniBarRect: () => ({ top: 600, width: 400, height: 108 })
    })
    assert.equal(measure().rect.top, hidden ? 660 : 600)
  })
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} audio mini-player eligibility covers explicit minimization`, () => {
    const f = fixture({ format: 'audio', mobile })
    assert.equal(f.methods.canUseScrollMiniPlayerBase(true), mobile)
  })
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} audio observes inline visibility for scroll docking`, () => {
    let observed = false
    const setup = source.slice(source.indexOf('  function setupScrollMiniIntersectionObserver()'), source.indexOf('  /** @param {boolean} [animate] */', source.indexOf('  function setupScrollMiniIntersectionObserver()')))
    const initialize = vm.runInNewContext(`${setup}\nsetupScrollMiniIntersectionObserver`, {
      scrollMiniIntersectionObserver: null, props: { format: 'audio' }, usesMobileMiniBar: () => mobile,
      getScrollMiniAnchor: () => ({}), updateScrollMiniPlayer() {}, ENTER_MINI_RATIO: 0.1, EXIT_MINI_RATIO: 0.5,
      IntersectionObserver: class { observe() { observed = true } },
    })
    initialize()
    assert.equal(observed, mobile)
  })
}
