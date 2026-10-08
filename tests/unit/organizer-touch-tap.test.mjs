import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const functions = ['startTabGesture', 'moveTabGesture', 'finishTabGesture', 'cancelTabGesture', 'activateTab']
  .map(name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\n}', source.indexOf(`function ${name}(`)) + 2))
  .map(fn => fn.includes('await ') ? `async ${fn}` : fn).join('\n')

function harness() {
  let now = 0
  const activated = []
  const target = { dataset: { tabId: 'tab' }, setPointerCapture() {} }
  const context = vm.createContext({
    selecting: { value: false }, dragSettling: { value: false },
    drag: {}, swipe: {}, tabs: { value: [{ id: 'tab' }] },
    holdTimer: null, activatedTouchPointerId: null,
    window: { setTimeout: () => 1 }, performance: { now: () => now },
    resetTabDrag() { Object.assign(context.drag, { tabId: null, pointerId: null, ready: false, moved: false }); context.holdTimer = null },
    resetTabSwipe() { Object.assign(context.swipe, { suppressClick: false, dragging: false }) },
    moveTabSwipe() {}, finishTabSwipe() {}, cancelTabSwipe() {}, scheduleSwipeReset() {},
    activateTabAction: async id => { activated.push(id) },
  })
  const thresholds = source.match(/const TAB_HOLD_DELAY = .*\nconst TAB_MOVE_THRESHOLD = .*/)[0]
  vm.runInContext(`${thresholds}\n${functions}`, context)
  const event = (overrides = {}) => ({
    pointerId: 41, pointerType: 'touch', button: 0, clientX: 124, clientY: 280,
    timeStamp: now, detail: 1,
    target: { closest: selector => selector === '.capacitorPhoneTabTarget' ? target : null },
    currentTarget: { getBoundingClientRect: () => ({ width: 200 }) },
    ...overrides,
  })
  return { context, activated, event, advance: value => { now += value } }
}

test('a short card touch activates once even when Android omits its click after a header swipe', async () => {
  const { context, activated, event, advance } = harness()
  context.startTabGesture(event(), 'tab')
  advance(85)
  context.finishTabGesture(event())
  assert.deepEqual(activated, ['tab'], 'the captured Pixel press/release must not need another tap')
  await context.activateTab('tab', event())
  assert.deepEqual(activated, ['tab'], 'a WebView that also emits click must not activate twice')
  await context.activateTab('tab', event({ pointerId: -1, detail: 0 }))
  assert.deepEqual(activated, ['tab', 'tab'], 'keyboard activation remains available')
})

for (const kind of ['move', 'cancel', 'hold', 'mouse', 'release outside']) {
  test(`${kind} is not a short touch activation`, () => {
    const { context, activated, event, advance } = harness()
    context.startTabGesture(event(), 'tab')
    if (kind === 'move') context.moveTabGesture(event({ clientX: 150 }))
    if (kind === 'cancel') context.cancelTabGesture()
    advance(kind === 'hold' ? 450 : 70)
    context.finishTabGesture(event({
      pointerType: kind === 'mouse' ? 'mouse' : 'touch',
      clientY: kind === 'release outside' ? 400 : 280,
    }))
    assert.deepEqual(activated, [])
  })
}
