import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { nextTick, ref, watch } from 'vue'
import { createAndroidBackGestureHandler, getAndroidBackPlayer, registerAndroidBackPlayer, settleAndroidBackAnimation } from '../../src/renderer/helpers/androidBackGesture.js'

const appSource = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('../../src/renderer/helpers/androidBackDialog.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, '')

/** Evaluates App.vue's preview selection, including its helpers, with test globals. */
function loadPreviewSelection(context) {
  const start = appSource.indexOf('function isSideNavShown()')
  const createAndroidBackDialogPreview = vm.runInNewContext(`${dialogSource}; createAndroidBackDialogPreview`, {
    nextTick, settleAndroidBackAnimation, applyAnimationSpeed: animation => animation,
    isReducedMotionEnabled: () => false, requestAnimationFrame: context.requestAnimationFrame,
    getComputedStyle: () => ({ inlineSize: '200px' }),
  })
  return vm.runInNewContext(`${appSource.slice(start, appSource.indexOf('\nfunction handleAndroidPictureInPictureChange', start))}\ngetAndroidBackPreview`, {
    mobileContextLink: { value: null }, mobileContextActions: { value: null }, createAndroidBackDialogPreview,
    getComputedStyle: () => ({ inlineSize: '200px' }), ...context,
  })
}

function drawerElement(animation) {
  return {
    isConnected: true, inert: false, querySelector: () => null, animate: () => animation,
    getBoundingClientRect: () => ({ width: 240 }),
    style: { getPropertyValue: () => '', getPropertyPriority: () => '', setProperty() {}, removeProperty() {} },
  }
}

function fixture(available = true) {
  const calls = []
  const preview = {
    begin: () => { calls.push('begin'); return available },
    update: progress => calls.push(progress),
    finish: async commit => { calls.push(commit ? 'dock' : 'restore') },
    cancel: () => calls.push('cancel'),
  }
  const handler = createAndroidBackGestureHandler({ getPreview: () => preview, back: async () => { calls.push('back') } })
  return { handler, calls, preview }
}

test('predictive cancellation restores the preview without navigating', async () => {
  const { handler, calls } = fixture()
  await handler.handle({ phase: 'start' })
  await handler.handle({ phase: 'progress', progress: 0.35 })
  await handler.handle({ phase: 'progress', progress: 0.1 })
  await handler.handle({ phase: 'cancel' })
  assert.deepEqual(calls, ['begin', 0.35, 0.1, 'restore'])
})

test('later Back presses wait for the current gesture to settle instead of disappearing', async () => {
  const { handler, calls, preview } = fixture()
  const settling = Promise.withResolvers()
  preview.finish = async () => { calls.push('dock'); await settling.promise }
  await handler.handle({ phase: 'start' })
  await handler.handle({ phase: 'progress', progress: 1.2 })
  const commit = handler.handle({ phase: 'commit' })
  const secondCommit = handler.handle({ phase: 'commit' })
  await handler.handle({ phase: 'progress', progress: 0.5 })
  settling.resolve()
  await commit
  await secondCommit
  assert.deepEqual(calls, ['begin', 1, 'dock', 'back'])
})

test('ordinary back handles buttons and unavailable predictive destinations', async () => {
  const { handler, calls } = fixture(false)
  await handler.handle({ phase: 'commit' })
  await handler.handle({ phase: 'start' })
  await handler.handle({ phase: 'cancel' })
  await handler.handle({ phase: 'start' })
  await handler.handle({ phase: 'commit' })
  assert.deepEqual(calls, ['back', 'begin', 'begin', 'back'])
})

test('Back pressed while cancellation restores a preview runs after restoration', async () => {
  const { handler, calls, preview } = fixture()
  const settling = Promise.withResolvers()
  preview.finish = async () => { calls.push('restore'); await settling.promise }
  await handler.handle({ phase: 'start' })
  const cancel = handler.handle({ phase: 'cancel' })
  await handler.handle({ phase: 'commit' })
  await handler.handle({ phase: 'commit' })
  assert.deepEqual(calls, ['begin', 'restore'])
  settling.resolve()
  await cancel
  assert.deepEqual(calls, ['begin', 'restore', 'back', 'back'])
})

test('teardown discards Back presses queued behind a settling preview', async () => {
  const { handler, calls, preview } = fixture()
  const settling = Promise.withResolvers()
  preview.finish = async () => { calls.push('dock'); await settling.promise }
  await handler.handle({ phase: 'start' })
  const commit = handler.handle({ phase: 'commit' })
  await handler.handle({ phase: 'commit' })
  handler.dispose()
  settling.resolve()
  await commit
  assert.deepEqual(calls, ['begin', 'dock', 'cancel'])
})

test('teardown cancels a held gesture and ignores late native events', async () => {
  const { handler, calls } = fixture()
  await handler.handle({ phase: 'start' })
  handler.dispose()
  await handler.handle({ phase: 'commit' })
  assert.deepEqual(calls, ['begin', 'cancel'])
})

test('a failed handoff does not leave subsequent gestures locked', async () => {
  const { handler, preview } = fixture()
  preview.finish = async () => { throw new Error('navigation failed') }
  await handler.handle({ phase: 'start' })
  await assert.rejects(handler.handle({ phase: 'commit' }), /navigation failed/)
  await handler.handle({ phase: 'commit' })
})

test('retained players are selected by tab and an old unmount cannot remove a replacement', () => {
  const first = fixture().preview
  const second = fixture().preview
  const removeFirst = registerAndroidBackPlayer('one', first)
  const removeSecond = registerAndroidBackPlayer('one', second)
  const removeOther = registerAndroidBackPlayer('two', first)
  removeFirst()
  assert.equal(getAndroidBackPlayer('one'), second)
  assert.equal(getAndroidBackPlayer('two'), first)
  removeSecond()
  removeOther()
  assert.equal(getAndroidBackPlayer('one'), null)
})

test('root allows the system preview only when no confirmation, history, fullscreen or layer consumes Back', () => {
  const source = appSource
  const start = source.indexOf('function shouldInterceptAndroidBack()')
  const getters = { getConfirmCloseApp: false, getTabHistoryState: () => ({ canGoBack: false }) }
  let wide = true
  const document = { fullscreenElement: null, querySelector: () => null }
  let layerVisible = false
  const refs = Object.fromEntries(['isSideNavOpen', 'settingsWindowOpen', 'isAnyPromptOpen', 'mobileContextLink', 'mobileContextActions']
    .map(name => [name, { value: null }]))
  const shouldIntercept = vm.runInNewContext(`${source.slice(start, source.indexOf('\n/** @param {Element} target */', start))}\nshouldInterceptAndroidBack`, {
    store: { getters }, presentedTabId: { value: 'one' }, document, window: { matchMedia: () => ({ matches: wide }) },
    hasVisibleGamepadLayer: () => layerVisible, ...refs
  })
  assert.equal(shouldIntercept(), false)
  getters.getConfirmCloseApp = true
  assert.equal(shouldIntercept(), true)
  getters.getConfirmCloseApp = false
  getters.getTabHistoryState = () => ({ canGoBack: true })
  assert.equal(shouldIntercept(), true)
  getters.getTabHistoryState = () => ({ canGoBack: false })
  for (const ref of Object.values(refs)) {
    ref.value = true
    assert.equal(shouldIntercept(), true)
    ref.value = null
  }
  document.fullscreenElement = {}
  assert.equal(shouldIntercept(), true)
  document.fullscreenElement = null
  layerVisible = true
  assert.equal(shouldIntercept(), true)
  layerVisible = false
  // Narrow layouts replace the drawer with the bottom bar, so it cannot consume Back.
  wide = false
  refs.isSideNavOpen.value = true
  assert.equal(shouldIntercept(), false)
})

test('a side drawer restored to zero progress cancels without replaying its animation', async () => {
  let reversed = false
  let closed = false
  let cancelled = false
  const animation = {
    currentTime: 0, effect: { getTiming: () => ({ duration: 180 }) }, finished: Promise.resolve(),
    pause() {}, reverse() { reversed = true }, cancel() { cancelled = true },
  }
  const getPreview = loadPreviewSelection({
    isSideNavOpen: { value: true }, useWatchSideNavOverlay: { value: true }, isLocaleRightToLeft: { value: false },
    window: { matchMedia: () => ({ matches: true }) },
    document: { querySelector: () => drawerElement(animation) },
    handleAndroidBack: async () => { closed = true },
  })
  const preview = getPreview()
  preview.begin()
  preview.update(0.6)
  preview.update(0)
  await preview.finish(false)
  assert.equal(reversed, false)
  assert.equal(cancelled, true)
  assert.equal(closed, false)
})

test('committing the side drawer keeps its finished frame until the closed state renders', async () => {
  const opened = ref(true)
  let renderedClosed = false
  const stop = watch(opened, value => { renderedClosed = !value }, { flush: 'post' })
  let cancelled = false
  let cancelledBeforeRender = false
  const frames = []
  const animation = {
    currentTime: 0, effect: { getTiming: () => ({ duration: 180 }) }, finished: Promise.resolve(),
    pause() {}, play() {},
    cancel() { cancelled = true; cancelledBeforeRender = !renderedClosed },
  }
  const getPreview = loadPreviewSelection({
    isSideNavOpen: opened, useWatchSideNavOverlay: { value: true }, isLocaleRightToLeft: { value: false },
    window: { matchMedia: () => ({ matches: true }) },
    document: { querySelector: () => drawerElement(animation) },
    handleAndroidBack: async () => { opened.value = false },
    requestAnimationFrame: callback => frames.push(callback),
  })
  try {
    const preview = getPreview()
    preview.begin()
    preview.update(0.65)
    const finished = preview.finish(true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(renderedClosed, true)
    assert.equal(cancelled, false, 'the finished effect must cover the handoff to the closed drawer')
    frames.shift()()
    assert.equal(cancelled, false)
    frames.shift()()
    await finished
    assert.equal(cancelled, true)
    assert.equal(cancelledBeforeRender, false)
  } finally {
    stop()
  }
})
