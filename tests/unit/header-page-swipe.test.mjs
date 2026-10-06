import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { findSwipeTab, shouldFinishPageSwipe } from '../../src/renderer/helpers/capacitorPageSwipe.js'

const source = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const handlers = source.slice(source.indexOf('const pageSwipe ='), source.indexOf('/** @type', source.indexOf('const pageSwipe =')))

function headerGesture(targetSelector = 'button') {
  const captures = []
  const context = vm.createContext({
    shallowRef: value => ({ value }), isCapacitor: true,
    isAnyPromptOpen: { value: false }, activeTabId: { value: 'first' }, presentedTabId: { value: 'first' },
    store: { getters: { getTabs: [{ id: 'first', loadState: 'loaded' }, { id: 'second', loadState: 'loaded' }] } },
    findSwipeTab, shouldFinishPageSwipe,
    document: { querySelector: () => ({ getBoundingClientRect: () => ({ width: 375 }) }) },
  })
  vm.runInContext(handlers, context)
  const event = {
    pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 250, clientY: 30, timeStamp: 0,
    target: { closest: selector => selector === '.topNavInner' || selector.split(',').some(part => part.trim() === targetSelector) ? {} : null },
    currentTarget: { setPointerCapture: id => captures.push(id) }, preventDefault() {},
  }
  return { context, event, captures, swipe: () => vm.runInContext('pageSwipe.value', context) }
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

test('icon button long presses are cancelled by dragging and pointer cancellation', () => {
  const iconSource = readFileSync(new URL('../../src/renderer/components/FtIconButton/FtIconButton.vue', import.meta.url), 'utf8')
  const handlerNames = ['handleIconPointerDown', 'clearLongPress', 'cancelMovedLongPress']
  const iconHandlers = handlerNames.map(name => iconSource.match(new RegExp(`function ${name}\\(.*?\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n')
  const timers = new Map()
  let sequence = 0
  const context = vm.createContext({
    props: { openOnRightOrLongClick: true }, LONG_CLICK_BOUNDARY_MS: 500,
    setTimeout: fn => { timers.set(++sequence, fn); return sequence }, clearTimeout: id => timers.delete(id),
  })
  vm.runInContext(`let longPressTimer = null; let longPressStart = null; ${iconHandlers}`, context)
  context.handleIconPointerDown({ button: 0, clientX: 20, clientY: 20 })
  assert.equal(timers.size, 1)
  context.cancelMovedLongPress({ clientX: 24, clientY: 20 })
  assert.equal(timers.size, 1, 'jitter retains a stationary long press')
  context.cancelMovedLongPress({ clientX: 31, clientY: 20 })
  assert.equal(timers.size, 0, 'dragging must not open history')
  context.handleIconPointerDown({ button: 0, clientX: 20, clientY: 20 })
  context.clearLongPress()
  assert.equal(timers.size, 0, 'pointer cancellation must not leave a pending hold')
})
