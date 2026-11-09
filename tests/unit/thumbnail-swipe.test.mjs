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
    currentTarget: { contains: () => true, getBoundingClientRect: () => ({ width: 240 }), setPointerCapture() {} },
    stopPropagation() {}, ...overrides,
  })
  const run = (positions, finish = 'finishSwipe') => {
    swipe.startSwipe(event(0))
    for (const [x, y] of positions) swipe.moveSwipe(event(x, y))
    swipe[finish](event(...positions.at(-1)))
  }
  return { swipe, calls, event, run, actions }
}

test('left swipe commits once on release and suppresses navigation', () => {
  const { swipe, calls, event } = gesture()
  swipe.startSwipe(event(0))
  swipe.moveSwipe(event(-80))
  assert.equal(swipe.swipe.value.direction, 'left')
  assert.equal(swipe.swipe.value.progress, 1)
  assert.equal(swipe.swipe.value.offset, -80)
  assert.ok(!calls.includes('Left'))
  swipe.finishSwipe(event(-80))
  swipe.finishSwipe(event(-80))
  assert.equal(calls.filter(call => call === 'Left').length, 1)
  assert.ok(calls.includes('cancelHold'))
  assert.ok(calls.includes('suppressClick'))
  assert.equal(swipe.swipe.value, null)
})

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

// The card resolves gesture actions through the same menu rows as its buttons.
const card = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const resolver = card.slice(card.indexOf('function getThumbnailSwipeAction('), card.indexOf('\nconst {\n  enabled: thumbnailSwipeEnabled'))

test('adding to a playlist becomes removal only in an editable playlist context', () => {
  const add = { actionId: 'addToPlaylist', label: 'Add', run() {} }
  const remove = { actionId: 'removeFromPlaylist', label: 'Remove', icon: ['fas', 'trash'], run() {} }
  const context = {
    supportsYtDlp: false,
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

test('bookmarking becomes removal only in the bookmark playlist', () => {
  const bookmark = { actionId: 'quickBookmark', label: 'Bookmark', run() {} }
  const remove = { actionId: 'removeFromPlaylist', label: 'Remove', run() {} }
  const bookmarks = { _id: 'bookmarks' }
  const context = {
    supportsYtDlp: false,
    store: { getters: { getThumbnailLeftSwipeAction: 'quickBookmark', getThumbnailRightSwipeAction: 'quickBookmark' } },
    mobileThumbnailActions: { value: [bookmark, remove] },
    videoContextMenuItems: { value: [] },
    inUserPlaylist: { value: true },
    props: { canRemoveFromPlaylist: true },
    selectedUserPlaylist: { value: bookmarks },
    quickBookmarkPlaylist: { value: bookmarks },
  }
  vm.runInNewContext(`${resolver}; globalThis.resolve = getThumbnailSwipeAction`, context)
  assert.equal(context.resolve('left'), remove)
  context.selectedUserPlaylist.value = { _id: 'other' }
  assert.equal(context.resolve('left'), bookmark)
  context.selectedUserPlaylist.value = null
  context.quickBookmarkPlaylist.value = undefined
  assert.equal(context.resolve('left'), bookmark)
  context.selectedUserPlaylist.value = bookmarks
  context.quickBookmarkPlaylist.value = bookmarks
  context.props.canRemoveFromPlaylist = false
  assert.equal(context.resolve('left'), bookmark)
})
