import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const source = (await readFile(new URL('../../src/renderer/components/FtMobileSheet/FtMobileSheet.vue', import.meta.url), 'utf8'))
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*\n/gm, '')

function mountSheet(t, expandPanel = null) {
  const scope = effectScope()
  const cleanup = []
  const landscape = ref(false)
  const props = reactive({ enabled: true, open: false, belowPlayer: true })
  const player = Object.assign(new EventTarget(), {
    coversWindow: false,
    shorts: false,
    classList: { contains(name) { return name === 'shortsPlayer' && player.shorts } },
    matches() { return this.coversWindow },
    setAttribute() {}, removeAttribute() {},
    getBoundingClientRect: () => ({ top: 50, bottom: 300 })
  })
  const element = {
    open: false, style: {},
    getBoundingClientRect: () => ({ top: 300, height: 500 }),
    show() { this.open = true }, showModal() { this.open = true }, close() { this.open = false },
    animate: () => ({ cancel() {}, finished: Promise.resolve() }), querySelector: () => null
  }
  const dialog = shallowRef(element)
  const document = Object.assign(new EventTarget(), {
    fullscreenElement: null, activeElement: null, querySelector: () => null,
    body: { classList: { contains: () => false } }
  })
  const window = Object.assign(new EventTarget(), { scrollBy() {} })
  const events = []
  const context = {
    computed, ref, shallowRef, watch, nextTick, document, window, innerHeight: 800,
    isAppHidden: () => !!document.hidden,
    defineProps: () => props, defineEmits: () => (...args) => events.push(args),
    useTemplateRef: () => dialog, usePhoneLayout: () => landscape,
    inject: name => name === 'phonePanelPlayer' ? () => player : name === 'expandPhonePanel' ? expandPanel : null,
    performance,
    onBeforeUnmount: callback => cleanup.push(callback), onUpdated() {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    applyAnimationSpeed: animation => animation, lockBodyScroll() {}, unlockBodyScroll() {},
    matchMedia: () => ({ matches: true }), getComputedStyle: () => ({ transform: 'none', opacity: 1 })
  }
  scope.run(() => vm.runInNewContext(source + '\nglobalThis.state = { expanded, updatePresentation, sheetStyle, startDrag, moveDrag, endDrag };', context))
  const unmount = () => { cleanup.splice(0).forEach(callback => callback()); scope.stop() }
  t.after(unmount)
  return { ...context, element, player, props, landscape, events, unmount,
    async settle() { await nextTick(); await nextTick(); await nextTick() }
  }
}

test('a Shorts sheet opens at 70% height in portrait and cannot collapse below the player', async t => {
  const sheet = mountSheet(t)
  sheet.player.shorts = true
  sheet.props.open = true
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, true)
  assert.equal(sheet.state.sheetStyle.value.insetBlockStart, 'max(var(--app-safe-area-inset-top, 0px), calc(var(--phone-viewport-height, 100dvh) * 0.3 + 0px))')

  const event = {
    button: 0, pointerId: 1, clientY: 400,
    target: { closest: () => null },
    currentTarget: { setPointerCapture() {} }
  }
  sheet.state.startDrag(event)
  sheet.state.moveDrag({ ...event, clientY: 500 })
  sheet.state.endDrag(event)
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, true)
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

test('rotating an open Shorts sheet to landscape leaves playback alone', async t => {
  let pauses = 0
  let resumes = 0
  const sheet = mountSheet(t, () => {
    pauses++
    return () => { resumes++ }
  })
  sheet.player.shorts = true
  sheet.props.open = true
  await sheet.settle()
  sheet.landscape.value = true
  await sheet.settle()
  sheet.props.open = false
  await sheet.settle()
  assert.equal(pauses, 0)
  assert.equal(resumes, 0)
})

test('opening a Shorts sheet in landscape keeps playback running', async t => {
  let pauses = 0
  let resumes = 0
  const sheet = mountSheet(t, () => {
    pauses++
    return () => { resumes++ }
  })
  sheet.player.shorts = true
  sheet.landscape.value = true
  sheet.props.open = true
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, true)
  assert.equal(pauses, 0)
  sheet.props.open = false
  await sheet.settle()
  assert.equal(resumes, 0)
})

test('opening a regular video sheet in landscape keeps playback running', async t => {
  let pauses = 0
  const sheet = mountSheet(t, () => { pauses++ })
  sheet.landscape.value = true
  sheet.props.open = true
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, true)
  assert.equal(pauses, 0)
})

for (const mode of ['native', 'browser', 'fullwindow']) {
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

test('a transient landscape viewport while hidden does not maximize the returning panel', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  sheet.document.hidden = true
  sheet.document.dispatchEvent(new Event('visibilitychange'))
  sheet.landscape.value = true
  await sheet.settle()
  sheet.landscape.value = false
  sheet.document.hidden = false
  sheet.document.dispatchEvent(new Event('visibilitychange'))
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, false, 'PiP must not change the panel expansion')
})

for (const expanded of [false, true]) {
  test(`PiP retains ${expanded ? 'expanded' : 'docked'} presentation while Chromium stays visible`, async t => {
    const sheet = mountSheet(t)
    sheet.props.open = true
    await sheet.settle()
    sheet.state.expanded.value = expanded
    sheet.document.body.classList.contains = () => true
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, false)
    sheet.landscape.value = true
    await sheet.settle()
    sheet.landscape.value = false
    sheet.document.body.classList.contains = () => false
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, true)
    assert.equal(sheet.state.expanded.value, expanded)
    assert.deepEqual(sheet.events.map(([event]) => event), ['suspend', 'resume'])
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
    button: 0, pointerId: 1, clientY: 400,
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
