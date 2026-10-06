import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { findSwipeTab, shouldFinishPageSwipe } from '../../src/renderer/helpers/capacitorPageSwipe.js'

const source = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const handlers = source.slice(source.indexOf('const pageSwipe ='), source.indexOf('/** @type', source.indexOf('const pageSwipe =')))

function headerGesture(targetSelector = 'button') {
  const captures = []
  const timers = new Map()
  let sequence = 0
  const context = vm.createContext({
    shallowRef: value => ({ value }), isCapacitor: true,
    isAnyPromptOpen: { value: false }, activeTabId: { value: 'first' }, presentedTabId: { value: 'first' },
    store: { getters: { getTabs: [{ id: 'first', loadState: 'loaded' }, { id: 'second', loadState: 'loaded' }] } },
    findSwipeTab, shouldFinishPageSwipe,
    window: { setTimeout: fn => { timers.set(++sequence, fn); return sequence }, clearTimeout: id => timers.delete(id) },
    document: { querySelector: () => ({ getBoundingClientRect: () => ({ width: 375 }) }) },
  })
  vm.runInContext(handlers, context)
  const event = {
    pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 250, clientY: 30, timeStamp: 0,
    target: { closest: selector => selector === '.topNavInner' || selector.split(',').some(part => part.trim() === targetSelector) ? {} : null },
    currentTarget: { setPointerCapture: id => captures.push(id) }, preventDefault() {},
  }
  return { context, event, captures, timers, swipe: () => vm.runInContext('pageSwipe.value', context) }
}

for (const target of ['button', 'a', '[role="button"]']) {
  test(`header swipes can start on ${target} without capturing taps`, () => {
    const { context, event, captures, swipe } = headerGesture(target)
    context.startPageSwipe(event)
    assert.deepEqual(captures, [], 'a tap must remain on the original control')
    context.movePageSwipe({ ...event, clientX: 150, timeStamp: 200 })
    assert.equal(swipe()?.toId, 'second')
    assert.deepEqual(captures, [1], 'capture only after horizontal dragging')
  })
}

for (const target of ['input', 'textarea', 'select', '[contenteditable]', '[role="dialog"]', '[role="menu"]', '.dropdownLayer', '.ft-input-component .options']) {
  test(`header swipes leave ${target} interactions alone`, () => {
    const { context, event, captures, swipe } = headerGesture(target)
    context.startPageSwipe(event)
    context.movePageSwipe({ ...event, clientX: 150, timeStamp: 200 })
    assert.equal(swipe(), null)
    assert.deepEqual(captures, [])
  })
}

test('vertical movement abandons a pending header swipe', () => {
  const { context, event, captures, swipe } = headerGesture()
  context.startPageSwipe(event)
  context.movePageSwipe({ ...event, clientY: 70 })
  context.movePageSwipe({ ...event, clientX: 150, clientY: 70 })
  assert.equal(swipe(), null)
  assert.deepEqual(captures, [])
})

test('only a deliberate drag suppresses the resulting touch click', () => {
  const { context, event } = headerGesture()
  let suppressed = false
  const click = { pointerId: 1, detail: 1, preventDefault() { suppressed = true }, stopPropagation() {} }
  context.startPageSwipe(event)
  context.movePageSwipe({ ...event, clientX: 246 })
  context.suppressPageSwipeClick(click)
  assert.equal(suppressed, false, 'small tap movement remains tappable')
  context.movePageSwipe({ ...event, clientX: 150 })
  context.suppressPageSwipeClick({ ...click, detail: 0 })
  assert.equal(suppressed, false, 'keyboard activation remains available')
  context.suppressPageSwipeClick(click)
  assert.equal(suppressed, true)
  suppressed = false
  context.startPageSwipe(event)
  context.suppressPageSwipeClick(click)
  assert.equal(suppressed, false, 'the next touch remains tappable')
})

test('a swipe beyond the end still cancels the control click', () => {
  const { context, event, captures, swipe } = headerGesture()
  context.startPageSwipe(event)
  context.movePageSwipe({ ...event, clientX: 300 })
  assert.equal(swipe(), null)
  assert.deepEqual(captures, [1])
  let suppressed = false
  context.suppressPageSwipeClick({ pointerId: 1, detail: 1, preventDefault() { suppressed = true }, stopPropagation() {} })
  assert.equal(suppressed, true)
})

for (const cancelled of [false, true]) {
  test(`swipe click suppression expires after ${cancelled ? 'cancellation' : 'release'} without a click`, async () => {
    const { context, event, timers } = headerGesture()
    context.startPageSwipe(event)
    context.movePageSwipe({ ...event, clientX: 300 }) // No neighboring tab, so no animation.
    await context.finishPageSwipe(event, cancelled)
    for (const timer of [...timers.values()]) timer()
    let suppressed = false
    context.suppressPageSwipeClick({ pointerId: 1, detail: 1, preventDefault() { suppressed = true }, stopPropagation() {} })
    assert.equal(suppressed, false, 'a later click with a reused pointer ID remains available')
  })
}

test('release keeps immediate click suppression and does not expire a newer drag', async () => {
  const { context, event, timers } = headerGesture()
  const drag = () => {
    context.startPageSwipe(event)
    context.movePageSwipe({ ...event, clientX: 300 })
  }
  drag()
  await context.finishPageSwipe(event)
  let suppressed = false
  context.suppressPageSwipeClick({ pointerId: 1, detail: 1, preventDefault() { suppressed = true }, stopPropagation() {} })
  assert.equal(suppressed, true, 'the click dispatched with pointerup must still be suppressed')
  drag()
  await context.finishPageSwipe(event)
  drag()
  for (const timer of [...timers.values()]) timer()
  suppressed = false
  context.suppressPageSwipeClick({ pointerId: 1, detail: 1, preventDefault() { suppressed = true }, stopPropagation() {} })
  assert.equal(suppressed, true, 'cleanup from an earlier release must not affect a new drag')
})

function iconGesture() {
  const iconSource = readFileSync(new URL('../../src/renderer/components/FtIconButton/FtIconButton.vue', import.meta.url), 'utf8')
  const handlerNames = ['handleIconPointerDown', 'clearLongPress', 'cancelMovedLongPress', 'finishLongPress', 'clearLongPressClick', 'cancelLongPressClick', 'suppressLongPressClick']
  const iconHandlers = handlerNames.map(name => iconSource.match(new RegExp(`function ${name}\\(.*?\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n')
  const timers = new Map()
  const listeners = new Map()
  let sequence = 0
  let opened = 0
  const context = vm.createContext({
    props: { openOnRightOrLongClick: true }, LONG_CLICK_BOUNDARY_MS: 500,
    setTimeout: fn => { timers.set(++sequence, fn); return sequence }, clearTimeout: id => timers.delete(id),
    handleIconClick: () => opened++,
    window: {
      addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
      removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    },
  })
  vm.runInContext(`let longPressTimer = null; let longPressStart = null; let longPressClickPointerId = null; ${iconHandlers}`, context)
  const event = { button: 0, pointerId: 1, clientX: 20, clientY: 20 }
  return {
    context, event, timers, opened: () => opened,
    dispatch: (type, event) => { for (const listener of [...listeners.get(type) ?? []]) listener(event) },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  }
}

test('icon button long presses are cancelled by dragging and pointer cancellation', () => {
  const { context, event, timers } = iconGesture()
  context.handleIconPointerDown(event)
  assert.equal(timers.size, 1)
  context.cancelMovedLongPress({ ...event, clientX: 24 })
  assert.equal(timers.size, 1, 'jitter retains a stationary long press')
  context.cancelMovedLongPress({ ...event, clientX: 31 })
  assert.equal(timers.size, 0, 'dragging must not open history')
  context.handleIconPointerDown(event)
  context.clearLongPress()
  assert.equal(timers.size, 0, 'pointer cancellation must not leave a pending hold')
})

for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
  test(`icon hold ends on ${type} outside the button and ignores other pointers`, () => {
    const { context, event, timers, dispatch, listenerCount } = iconGesture()
    context.handleIconPointerDown(event)
    dispatch(type, { ...event, pointerId: 2, clientX: 80 })
    assert.equal(timers.size, 1, 'another pointer must not cancel the hold')
    dispatch(type, { ...event, clientX: 80 })
    assert.equal(timers.size, 0, 'events outside the button must cancel the hold')
    assert.equal(listenerCount(), 0, 'tracking listeners must be removed')
  })
}

test('a stationary icon hold still opens the dropdown and removes tracking listeners', () => {
  const { context, event, timers, opened, listenerCount } = iconGesture()
  context.handleIconPointerDown(event)
  assert.equal(listenerCount(), 3)
  for (const timer of [...timers.values()]) timer()
  assert.equal(opened(), 1)
  assert.equal(timers.size, 0)
  assert.equal(listenerCount(), 2, 'only release-click cleanup remains')
})

test('a long hold suppresses a delayed release click and preserves keyboard and subsequent taps', () => {
  const { context, event, timers, dispatch, listenerCount } = iconGesture()
  const hold = () => {
    context.handleIconPointerDown(event)
    for (const timer of [...timers.values()]) timer()
    dispatch('pointerup', event)
    for (const timer of [...timers.values()]) timer()
  }
  const click = { pointerId: event.pointerId, detail: 1 }
  hold()
  assert.equal(context.suppressLongPressClick({ ...click, detail: 0 }), false)
  assert.equal(context.suppressLongPressClick(click), true, 'release click remains suppressed after timers run')
  assert.equal(context.suppressLongPressClick(click), false, 'suppression is consumed once')
  assert.equal(listenerCount(), 0)
  hold()
  dispatch('pointerdown', { ...event, pointerId: 2 })
  assert.equal(context.suppressLongPressClick(click), false, 'a new gesture anywhere clears suppression')
  assert.equal(listenerCount(), 0)
  hold()
  dispatch('pointercancel', { ...event, pointerId: 2 })
  assert.equal(listenerCount(), 2, 'unrelated cancellation must not affect the held pointer')
  dispatch('pointercancel', event)
  assert.equal(context.suppressLongPressClick(click), false)
  assert.equal(listenerCount(), 0)
})
