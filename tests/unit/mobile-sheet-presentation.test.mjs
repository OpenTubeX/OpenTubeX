import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { getAndroidBackSheet, registerAndroidBackSheet, settleAndroidBackAnimation } from '../../src/renderer/helpers/androidBackGesture.js'

const source = (await readFile(new URL('../../src/renderer/components/FtMobileSheet/FtMobileSheet.vue', import.meta.url), 'utf8'))
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*\n/gm, '')

function mountSheet(t, expandPanel = null, { reducedMotion = false } = {}) {
  const scope = effectScope()
  const cleanup = []
  const landscape = ref(false)
  const attributes = new Set()
  const observed = []
  const activeObservers = new Set()
  let resizeCallback = null
  const props = reactive({ enabled: true, open: false, belowPlayer: true })
  const player = Object.assign(new EventTarget(), {
    coversWindow: false,
    shorts: false,
    classList: {
      contains(name) {
        return (name === 'shortsPlayer' && player.shorts) ||
        (name === 'fullWindow' && player.coversWindow)
      }
    },
    setAttribute: name => attributes.add(name),
    removeAttribute: name => attributes.delete(name),
    hasAttribute: name => attributes.has(name),
    getBoundingClientRect: () => ({ top: 50, bottom: 300 })
  })
  const inlinePlayer = { getBoundingClientRect: () => ({ top: 50, bottom: 300 }) }
  const inlineElement = shallowRef(inlinePlayer)
  const animations = []
  const element = {
    open: false,
    style: {},
    getBoundingClientRect: () => ({ top: 300, height: 500 }),
    show() { this.open = true },
    showModal() { this.open = true },
    close() { this.open = false },
    animate: (frames, options) => {
      const animation = {
        frames,
        effect: { getTiming: () => options },
        currentTime: 0,
        playState: 'running',
        pause() { this.playState = 'paused' },
        play() { this.playState = 'running' },
        reverse() { this.playState = 'running' },
        cancel() { this.playState = 'idle' },
        finished: Promise.resolve()
      }
      animations.push(animation)
      return animation
    },
    querySelector: () => null
  }
  const dialog = shallowRef(element)
  const document = Object.assign(new EventTarget(), {
    fullscreenElement: null,
    activeElement: null,
    querySelector: () => null,
    body: { classList: { contains: () => false } }
  })
  const window = Object.assign(new EventTarget(), { innerHeight: 800, scrollBy() {} })
  const events = []
  const context = {
    computed,
    ref,
    shallowRef,
    watch,
    nextTick,
    document,
    window,
    innerHeight: 800,
    isAppHidden: () => !!document.hidden,
    isReducedMotionEnabled: () => reducedMotion,
    process: { env: { IS_CAPACITOR: true } },
    registerAndroidBackSheet,
    settleAndroidBackAnimation,
    defineProps: () => props,
    defineEmits: () => (...args) => events.push(args),
    defineOptions() {},
    useTemplateRef: () => dialog,
    usePhoneLayout: () => landscape,
    inject: name => name === 'phonePanelPlayer'
      ? () => player
      : name === 'phonePanelInlinePlayer'
        ? () => inlineElement.value
        : name === 'expandPhonePanel' ? expandPanel : null,
    performance,
    onBeforeUnmount: callback => cleanup.push(callback),
    onUpdated() {},
    onActivated() {},
    onDeactivated() {},
    updateMobileSheetRootClass() {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class {
      constructor(callback) { resizeCallback = callback }
      observe(element) { observed.push(element); activeObservers.add(element) }
      unobserve(element) { activeObservers.delete(element) }
      disconnect() { activeObservers.clear() }
    },
    applyAnimationSpeed: animation => animation,
    lockBodyScroll() {},
    unlockBodyScroll() {},
    motionTiming: (_token, duration, easing) => reducedMotion ? { duration: 0, easing: 'linear' } : { duration, easing },
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ transform: 'none', opacity: 1, getPropertyValue: () => '' })
  }
  scope.run(() => vm.runInNewContext(source + '\nglobalThis.state = { expanded, updatePresentation, sheetStyle, startDrag, moveDrag, endDrag, cancelDrag, handleHeaderClick };', context))
  const unmount = () => { cleanup.splice(0).forEach(callback => callback()); scope.stop() }
  t.after(unmount)
  return {
    ...context,
    element,
    player,
    inlinePlayer,
    inlineElement,
    props,
    landscape,
    observed,
    activeObservers,
    events,
    animations,
    unmount,
    resize() { resizeCallback?.() },
    async settle() { await nextTick(); await nextTick(); await nextTick() }
  }
}

for (const commit of [false, true]) {
  test(`a video minimize drag suspends its panel and ${commit ? 'closes it when Watch leaves' : 'restores it on cancellation'}`, async t => {
    const sheet = mountSheet(t)
    sheet.props.open = true
    await sheet.settle()
    assert.equal(sheet.player.hasAttribute('data-phone-panel-video'), true)
    sheet.player.setAttribute('data-inline-mini-drag', '')
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, false)
    assert.equal(sheet.player.hasAttribute('data-phone-panel-video'), false)
    // Watch clears mobilePanel when navigation leaves the watch page.
    if (commit) sheet.props.open = false
    sheet.player.removeAttribute('data-inline-mini-drag')
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, !commit)
    assert.deepEqual(sheet.events.map(([event]) => event), ['suspend', commit ? 'closed' : 'resume'])
  })
}

for (const commit of [false, true]) {
  test(`predictive back ${commit ? 'dismisses' : 'restores'} a bottom sheet without changing its reading state`, async t => {
    const sheet = mountSheet(t)
    sheet.props.open = true
    await sheet.settle()
    const preview = getAndroidBackSheet(sheet.element)
    assert.equal(preview.begin(), true)
    preview.update(0.6)
    const animation = sheet.animations.at(-1)
    assert.equal(animation.playState, 'paused')
    assert.equal(animation.currentTime, 108)
    assert.equal(sheet.element.open, true)
    assert.deepEqual(sheet.events, [])
    await preview.finish(commit)
    assert.equal(sheet.element.open, !commit)
    assert.equal(animation.playState, 'idle')
    assert.deepEqual(sheet.events.map(([event]) => event), commit ? ['close', 'closed'] : [])
    if (!commit) assert.equal(preview.begin(), true, 'cancelled sheet can be previewed again')
  })
}

test('nested Back and compact modal sheets keep their ordinary Back behavior', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  const preview = getAndroidBackSheet(sheet.element)
  sheet.props.back = true
  assert.equal(preview.begin(), false)
  sheet.props.back = false
  sheet.props.compact = true
  assert.equal(preview.begin(), false)
  assert.deepEqual(sheet.events, [])
})

test('suspending or unmounting a held sheet cancels its preview without dismissing it', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  const preview = getAndroidBackSheet(sheet.element)
  preview.begin()
  const animation = sheet.animations.at(-1)
  sheet.player.coversWindow = true
  sheet.state.updatePresentation()
  await sheet.settle()
  assert.equal(animation.playState, 'idle')
  await preview.finish(true)
  assert.deepEqual(sheet.events.map(([event]) => event), ['suspend'])
  sheet.unmount()
  assert.equal(getAndroidBackSheet(sheet.element), null)
})

test('a Shorts sheet keeps playback running while it opens and closes', async t => {
  let pauses = 0
  let resumes = 0
  const sheet = mountSheet(t, () => {
    pauses++
    return () => { resumes++ }
  })
  sheet.player.shorts = true
  sheet.props.open = true
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, true)
  assert.equal(pauses, 0)
  sheet.props.open = false
  await sheet.settle()
  assert.equal(resumes, 0)
})

test('sheet header controls allow dragging without capturing ordinary taps', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  const captures = []
  const event = {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 400,
    target: { closest: selector => selector.includes('button') ? {} : null },
    currentTarget: { setPointerCapture: id => captures.push(id) }
  }
  sheet.state.startDrag(event)
  sheet.state.moveDrag({ ...event, clientY: 403 })
  sheet.state.endDrag(event)
  assert.deepEqual(captures, [], 'tap jitter must leave the control as the click target')
  assert.deepEqual(sheet.events, [])

  sheet.state.startDrag(event)
  sheet.state.moveDrag({ ...event, clientY: 430 })
  assert.equal(sheet.element.style.transform, 'translateY(30px)')
  assert.deepEqual(captures, [1], 'a vertical drag on a button must capture on the header')
  sheet.state.moveDrag({ ...event, clientY: 500 })
  sheet.state.endDrag(event)
  assert.deepEqual(sheet.events.map(([name]) => name), ['close'])
})

test('sheet drags suppress control clicks while horizontal gestures and keyboard activation still work', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  const event = {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 400,
    currentTarget: { setPointerCapture() {} }
  }
  let clicksBlocked = 0
  const click = { detail: 1, preventDefault() { clicksBlocked++ }, stopPropagation() {} }
  sheet.state.startDrag(event)
  sheet.state.moveDrag({ ...event, clientX: 150, clientY: 402 })
  sheet.state.endDrag(event)
  sheet.state.handleHeaderClick(click)
  assert.equal(clicksBlocked, 0, 'horizontal movements must not become sheet drags')

  sheet.state.startDrag(event)
  sheet.state.moveDrag({ ...event, clientY: 430 })
  sheet.state.endDrag(event)
  sheet.state.handleHeaderClick({ ...click, detail: 0 })
  assert.equal(clicksBlocked, 0, 'keyboard activation must remain available')
  sheet.state.handleHeaderClick(click)
  assert.equal(clicksBlocked, 1, 'a completed drag must not activate its control')

  sheet.state.startDrag(event)
  sheet.state.moveDrag({ ...event, clientY: 430 })
  sheet.state.cancelDrag()
  assert.equal(sheet.element.style.transform, '')
  sheet.state.startDrag(event)
  sheet.state.endDrag(event)
  sheet.state.handleHeaderClick(click)
  assert.equal(clicksBlocked, 1, 'the next tap must work after a cancelled drag')
})

for (const mode of ['browser', 'fullwindow']) {
  test(`a fullscreen dock sheet stays open in ${mode} fullscreen`, async t => {
    const sheet = mountSheet(t)
    sheet.props.fullscreen = true
    if (mode === 'browser') sheet.document.fullscreenElement = sheet.player
    else sheet.player.coversWindow = true
    sheet.state.updatePresentation()
    sheet.props.open = true
    await sheet.settle()
    assert.equal(sheet.element.open, true)
    assert.equal(sheet.state.sheetStyle.value.insetBlockStart, 'max(var(--app-safe-area-inset-top, 0px), 240px)')
    assert.equal(sheet.events.some(([event]) => event === 'suspend'), false)
    const back = getAndroidBackSheet(sheet.element)
    assert.equal(back.begin(), true)
    await back.finish(true)
    assert.equal(sheet.element.open, false)
    assert.ok(sheet.events.some(([event]) => event === 'close'))
  })

  test(`an open below-player sheet hides during ${mode} fullscreen and returns below the player`, async t => {
    const sheet = mountSheet(t)
    sheet.props.open = true
    await sheet.settle()
    assert.equal(sheet.element.open, true)
    if (mode === 'browser') sheet.document.fullscreenElement = sheet.player
    else sheet.player.coversWindow = true
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, false, 'the panel must not cover fullscreen video')
    assert.equal(sheet.props.open, true, 'fullscreen must retain the selected panel')
    assert.equal(sheet.events.some(([event]) => event === 'closed'), false)
    sheet.document.fullscreenElement = null
    sheet.player.coversWindow = false
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, true)
    assert.equal(sheet.state.expanded.value, false)
  })
}

test('closing a suspended panel does not reopen it on return', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  sheet.player.coversWindow = true
  sheet.state.updatePresentation()
  await sheet.settle()
  sheet.props.open = false
  await sheet.settle()
  sheet.player.coversWindow = false
  sheet.state.updatePresentation()
  await sheet.settle()
  assert.equal(sheet.element.open, false)
  assert.deepEqual(sheet.events.map(([event]) => event), ['suspend', 'closed'])
})

test('ordinary modal sheets remain available while the player is fullscreen', async t => {
  const sheet = mountSheet(t)
  sheet.props.belowPlayer = false
  sheet.player.coversWindow = true
  sheet.state.updatePresentation()
  sheet.props.open = true
  await sheet.settle()
  assert.equal(sheet.element.open, true)
  assert.deepEqual(sheet.events, [])
})

test('unmounting a suspended expanded sheet restores playback', async t => {
  let restorations = 0
  const sheet = mountSheet(t, () => () => { restorations++ })
  sheet.props.open = true
  await sheet.settle()
  const event = {
    button: 0,
    pointerId: 1,
    clientY: 400,
    target: { closest: () => null },
    currentTarget: { setPointerCapture() {} }
  }
  sheet.state.startDrag(event)
  sheet.state.moveDrag({ ...event, clientY: 300 })
  sheet.state.endDrag(event)
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, true)
  sheet.player.coversWindow = true
  sheet.state.updatePresentation()
  await sheet.settle()
  assert.equal(sheet.element.open, false)
  assert.equal(restorations, 0, 'suspension must preserve the playback callback')
  sheet.unmount()
  assert.equal(restorations, 1, 'unmount must restore retained playback')
  assert.equal(sheet.state.expanded.value, false)
})
