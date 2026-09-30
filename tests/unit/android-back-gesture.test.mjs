import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createAndroidBackGestureHandler, getAndroidBackPlayer, registerAndroidBackPlayer, settleAndroidBackAnimation } from '../../src/renderer/helpers/androidBackGesture.js'

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
  const source = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function shouldInterceptAndroidBack()')
  const getters = { getConfirmCloseApp: false, getTabHistoryState: () => ({ canGoBack: false }) }
  const document = { fullscreenElement: null, querySelector: () => null }
  let layerVisible = false
  const refs = Object.fromEntries(['isSideNavOpen', 'settingsWindowOpen', 'isAnyPromptOpen', 'mobileContextLink', 'mobileContextActions']
    .map(name => [name, { value: null }]))
  const shouldIntercept = vm.runInNewContext(`${source.slice(start, source.indexOf('\nfunction getAndroidBackPreview()', start))}\nshouldInterceptAndroidBack`, {
    store: { getters }, presentedTabId: { value: 'one' }, document,
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
})

test('a side drawer restored to zero progress cancels without replaying its animation', async () => {
  const source = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function getAndroidBackPreview()')
  let reversed = false
  let closed = false
  let cancelled = false
  const animation = {
    currentTime: 0, effect: { getTiming: () => ({ duration: 200 }) }, finished: Promise.resolve(),
    pause() {}, reverse() { reversed = true }, cancel() { cancelled = true },
  }
  const getPreview = vm.runInNewContext(`${source.slice(start, source.indexOf('\nfunction handleAndroidPictureInPictureChange', start))}\ngetAndroidBackPreview`, {
    mobileContextLink: { value: null }, mobileContextActions: { value: null },
    isSideNavOpen: { value: true }, useWatchSideNavOverlay: { value: true }, isLocaleRightToLeft: { value: false },
    window: { matchMedia: () => ({ matches: true }) },
    document: { querySelector: () => ({ animate: () => animation, getBoundingClientRect: () => ({ width: 240 }) }) },
    isReducedMotionEnabled: () => false, applyAnimationSpeed: animation => animation, settleAndroidBackAnimation,
    closeSideNav: () => { closed = true },
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
