import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { useThumbnailSwipe } from '../../src/renderer/composables/useThumbnailSwipe.js'

function gesture(actions = { left: { label: 'Left' }, right: { label: 'Right' } }, duration = 0) {
  const calls = []
  const swipe = useThumbnailSwipe({
    getAction: direction => actions[direction],
    cancelHold: () => calls.push('cancelHold'),
    suppressClick: () => calls.push('suppressClick'),
    onCommit: action => calls.push(action.label),
    getSettleDuration: () => duration,
  })
  const event = (x, y = 0, overrides = {}) => ({
    pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: x, clientY: y,
    target: { closest: () => false },
    currentTarget: { getBoundingClientRect: () => ({ width: 240 }), setPointerCapture() {} },
    stopPropagation() {}, ...overrides,
  })
  const run = (positions, finish = 'finishSwipe') => {
    swipe.startSwipe(event(0))
    for (const [x, y] of positions) swipe.moveSwipe(event(x, y))
    swipe[finish](event(...positions.at(-1)))
  }
  return { swipe, calls, event, run, actions }
}

for (const [direction, distance] of [['left', -80], ['right', 80]]) {
  test(`${direction} swipe commits once on release and suppresses navigation`, () => {
    const { swipe, calls, event } = gesture()
    swipe.startSwipe(event(0))
    swipe.moveSwipe(event(distance))
    assert.equal(swipe.swipe.value.direction, direction)
    assert.equal(swipe.swipe.value.progress, 1)
    assert.equal(swipe.swipe.value.offset, distance)
    assert.ok(!calls.includes(direction === 'left' ? 'Left' : 'Right'))
    swipe.finishSwipe(event(distance))
    swipe.finishSwipe(event(distance))
    assert.equal(calls.filter(call => call === (direction === 'left' ? 'Left' : 'Right')).length, 1)
    assert.ok(calls.includes('cancelHold'))
    assert.ok(calls.includes('suppressClick'))
    assert.equal(swipe.swipe.value, null)
  })
}

for (const [name, positions, finish] of [
  ['tap', [[0, 0]]], ['short swipe', [[20, 0]]],
  ['vertical scroll', [[5, 20], [100, 30]]],
  ['diagonal scroll', [[20, 20], [100, 25]]],
  ['reversal below threshold', [[100, 0], [5, 0]]],
  ['pointer cancellation', [[100, 0]], 'cancelSwipe'],
]) {
  test(`${name} does not run an action`, () => {
    const { calls, run } = gesture()
    run(positions, finish)
    assert.ok(!calls.includes('Left') && !calls.includes('Right'))
  })
}

test('disabled directions, buttons, and mouse drags keep their normal behavior', () => {
  const { swipe, calls, event, run } = gesture({ right: { label: 'Right' } })
  run([[-100, 0]])
  assert.deepEqual(calls, [])
  for (const overrides of [{ pointerType: 'mouse' }, { isPrimary: false }, { target: { closest: () => true } }]) {
    swipe.startSwipe(event(0, 0, overrides))
    swipe.moveSwipe(event(100))
    swipe.finishSwipe(event(100))
  }
  assert.deepEqual(calls, [])
})

test('multitouch and an action becoming unavailable cancel a pending gesture', () => {
  const { swipe, event, actions, calls } = gesture()
  swipe.startSwipe(event(0))
  swipe.moveSwipe(event(100))
  swipe.startSwipe(event(10, 0, { isPrimary: false, pointerId: 2 }))
  swipe.finishSwipe(event(100))
  assert.ok(!calls.includes('Right'))
  swipe.startSwipe(event(0))
  swipe.moveSwipe(event(100))
  delete actions.right
  swipe.finishSwipe(event(100))
  assert.ok(!calls.includes('Right'))
})

test('release position determines the action, including a direction reversal', () => {
  const { swipe, event, calls } = gesture()
  swipe.startSwipe(event(0))
  swipe.moveSwipe(event(100))
  swipe.finishSwipe(event(-100))
  assert.ok(calls.includes('Left'))
  assert.ok(!calls.includes('Right'))
})

test('release and cancellation settle the full card without repeating actions', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { swipe, event, calls } = gesture(undefined, 200)
  swipe.startSwipe(event(0))
  swipe.moveSwipe(event(-500))
  assert.equal(swipe.swipe.value.offset, -132)
  swipe.finishSwipe(event(-500))
  assert.equal(swipe.swipe.value.offset, 0)
  assert.equal(swipe.swipe.value.progress, 0)
  assert.equal(swipe.swipe.value.settling, true)
  swipe.abortSwipe(event(-500))
  assert.ok(swipe.swipe.value)
  t.mock.timers.tick(232)
  assert.equal(swipe.swipe.value, null)
  assert.equal(calls.filter(call => call === 'Left').length, 1)

  swipe.startSwipe(event(0))
  swipe.moveSwipe(event(100))
  swipe.abortSwipe(event(100))
  assert.equal(swipe.swipe.value.offset, 0)
  t.mock.timers.tick(232)
  assert.equal(swipe.swipe.value, null)
  assert.ok(!calls.includes('Right'))
})

// The card resolves gesture actions through the same menu rows as its buttons.
const card = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const resolver = card.slice(card.indexOf('function getThumbnailSwipeAction('), card.indexOf('\nconst {\n  enabled: thumbnailSwipeEnabled'))

test('thumbnail shortcuts preserve action availability and reuse the existing handlers', () => {
  const playlist = { actionId: 'addToPlaylist', run() {} }
  const history = { actionId: 'history', enabled: true, run() {} }
  const unavailableDownload = { actionId: 'download', enabled: false, run() {} }
  const context = {
    store: { getters: { getThumbnailLeftSwipeAction: 'history', getThumbnailRightSwipeAction: 'addToPlaylist' } },
    mobileThumbnailActions: { value: [playlist] },
    videoContextMenuItems: { value: [history, unavailableDownload] },
    inUserPlaylist: { value: false },
    props: { canRemoveFromPlaylist: false },
  }
  vm.runInNewContext(`${resolver}; globalThis.resolve = getThumbnailSwipeAction`, context)
  assert.equal(context.resolve('left'), history)
  assert.equal(context.resolve('right'), playlist)
  for (const action of ['disabled', 'download', 'notAnAction']) {
    context.store.getters.getThumbnailLeftSwipeAction = action
    assert.equal(context.resolve('left'), null)
  }
  context.mobileThumbnailActions.value = []
  assert.equal(context.resolve('right'), null)
})

test('adding to a playlist becomes removal only in an editable playlist context', () => {
  const add = { actionId: 'addToPlaylist', label: 'Add', run() {} }
  const remove = { actionId: 'removeFromPlaylist', label: 'Remove', icon: ['fas', 'trash'], run() {} }
  const context = {
    store: { getters: { getThumbnailLeftSwipeAction: 'addToPlaylist', getThumbnailRightSwipeAction: 'addToPlaylist' } },
    mobileThumbnailActions: { value: [add, remove] },
    videoContextMenuItems: { value: [] },
    inUserPlaylist: { value: true },
    props: { canRemoveFromPlaylist: true },
  }
  vm.runInNewContext(`${resolver}; globalThis.resolve = getThumbnailSwipeAction`, context)
  assert.equal(context.resolve('left'), remove)
  assert.equal(context.resolve('right'), remove)
  context.props.canRemoveFromPlaylist = false
  assert.equal(context.resolve('left'), add)
  context.props.canRemoveFromPlaylist = true
  context.inUserPlaylist.value = false
  assert.equal(context.resolve('right'), add)
  context.inUserPlaylist.value = true
  context.mobileThumbnailActions.value = [add]
  assert.equal(context.resolve('right'), null)
})

test('copy shortcuts resolve existing submenu actions for Invidious sharing and public playlists', () => {
  const copy = { actionId: 'copyYoutube', run() {} }
  const context = {
    store: { getters: { getThumbnailLeftSwipeAction: 'copyYoutube', getThumbnailRightSwipeAction: 'copyYoutube' } },
    mobileThumbnailActions: { value: [] },
    videoContextMenuItems: { value: [{ label: 'Copy Link', submenu: [copy, { actionId: 'copyYoutubeWithoutPlaylist', run() {} }] }] },
    inUserPlaylist: { value: false },
    props: { canRemoveFromPlaylist: false },
  }
  vm.runInNewContext(`${resolver}; globalThis.resolve = getThumbnailSwipeAction`, context)
  assert.equal(context.resolve('left'), copy)
  assert.equal(context.resolve('right'), copy)
  copy.enabled = false
  assert.equal(context.resolve('left'), null)
})
