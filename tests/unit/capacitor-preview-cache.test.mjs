import assert from 'node:assert/strict'
import test from 'node:test'
import { createCapacitorPreviewCache } from '../../src/renderer/tabs/capacitorPreviewCache.js'

const tab = (id, fullPath = '/home') => ({ id, route: { fullPath } })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('last-seen previews are bounded and closed/navigated tabs are pruned', async () => {
  const cache = createCapacitorPreviewCache(async () => 'image', new Map(), 2)
  await cache.capture(tab('a'))
  await cache.capture(tab('b'))
  await cache.capture(tab('a', '/history'))
  await cache.capture(tab('c'))
  assert.deepEqual([...cache.entries.keys()], ['a', 'c'])
  cache.prune([tab('a', '/home'), tab('c')])
  assert.deepEqual([...cache.entries.keys()], ['c'])
  cache.prune([])
  assert.equal(cache.entries.size, 0)
})

test('switching away and back during capture cannot publish a stale frame', async () => {
  const frame = deferred()
  const cache = createCapacitorPreviewCache(() => frame.promise)
  const capture = cache.capture(tab('a'))
  cache.invalidate() // A -> B
  cache.invalidate() // B -> A
  frame.resolve('stale image')
  await capture
  assert.equal(cache.entries.size, 0)
  await cache.capture(tab('a'))
  assert.equal(cache.entries.get('a').image, 'stale image')
})

test('disabling previews clears images and discards an in-flight capture', async () => {
  const frame = deferred()
  const cache = createCapacitorPreviewCache(() => frame.promise)
  const capture = cache.capture(tab('a'))
  cache.clear()
  frame.resolve('image')
  await capture
  assert.equal(cache.entries.size, 0)
})

test('overlapping requests share one native capture and never assign it to another tab', async () => {
  const frame = deferred()
  let calls = 0
  const cache = createCapacitorPreviewCache(() => { calls += 1; return frame.promise })
  const first = cache.capture(tab('a'))
  const second = cache.capture(tab('b'))
  frame.resolve('image')
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.deepEqual([...cache.entries.keys()], ['a'])
})

test('missing frames preserve the last successful preview', async () => {
  let image = 'previous'
  const cache = createCapacitorPreviewCache(async () => image)
  await cache.capture(tab('a'))
  image = null
  await cache.capture(tab('a'))
  assert.equal(cache.entries.get('a').image, 'previous')
})

test('a queued recapture is discarded when its page changes again', async () => {
  const frame = deferred()
  let calls = 0
  const cache = createCapacitorPreviewCache(() => { calls += 1; return frame.promise })
  const first = cache.capture(tab('a'))
  cache.invalidate()
  const queued = cache.capture(tab('b'))
  cache.invalidate()
  frame.resolve('stale image')
  await Promise.all([first, queued])
  assert.equal(calls, 1)
  assert.equal(cache.entries.size, 0)
})

test('capture eligibility excludes settings, prompts, background and loading tabs', async () => {
  const { canCaptureCapacitorTab } = await import('../../src/renderer/tabs/capacitorPreviewCache.js')
  const presented = { ...tab('a'), loadState: 'loaded', isLoading: false }
  const getters = { getShowTabPreviews: true, getPresentedTab: presented, getActiveTabId: 'a' }
  assert.equal(canCaptureCapacitorTab(getters, true), true)
  for (const field of ['isAnyPromptOpen', 'getSettingsWindowOpen', 'getSettingsWindowMorphing']) {
    assert.equal(canCaptureCapacitorTab({ ...getters, [field]: true }, true), false)
  }
  assert.equal(canCaptureCapacitorTab(getters, false), false)
  assert.equal(canCaptureCapacitorTab({ ...getters, getActiveTabId: 'b' }, true), false)
  assert.equal(canCaptureCapacitorTab({ ...getters, getShowTabPreviews: false }, true), false)
  assert.equal(canCaptureCapacitorTab({ ...getters, getPresentedTab: { ...presented, isLoading: true } }, true), false)
})

test('synced tabs fall back without a local preview, even when their IDs collide', async () => {
  const cache = createCapacitorPreviewCache(async () => 'local image')
  const synced = { id: 'a', route: { path: '/home' } }
  assert.equal(cache.get(synced), null)
  assert.equal(cache.get(tab('a')), null)
  await cache.capture(tab('a'))
  assert.equal(cache.get(synced), null)
  assert.equal(cache.get(tab('a', '/history')), null)
  assert.equal(cache.get(tab('a')), 'local image')
})

test('stored previews are mirrored and restored as the least recently seen', async () => {
  const written = []
  const removed = []
  const storage = { write: (id, entry) => written.push([id, entry.route]), remove: id => removed.push(id) }
  const cache = createCapacitorPreviewCache(async () => 'fresh', new Map(), 3, storage)
  await cache.capture(tab('a'))
  assert.deepEqual(written, [['a', '/home']])

  cache.restore(new Map([
    ['c', { route: '/c', image: 'c', capturedAt: 2 }],
    ['a', { route: '/home', image: 'stale', capturedAt: 3 }],
    ['b', { route: '/b', image: 'b', capturedAt: 1 }],
    ['invalid', { image: 'no route' }],
  ]), [tab('a'), tab('b', '/b'), tab('c', '/c')])
  assert.deepEqual([...cache.entries.keys()], ['b', 'c', 'a'])
  assert.equal(cache.get(tab('a')), 'fresh')
  assert.deepEqual(removed, ['invalid'])
  removed.length = 0

  await cache.capture(tab('d'))
  assert.deepEqual([...cache.entries.keys()], ['c', 'a', 'd'])
  cache.prune([tab('a'), tab('d')])
  assert.deepEqual(removed, ['b', 'c'])
})

test('previews of closed tabs do not push open tabs out of a restore', () => {
  const removed = []
  const cache = createCapacitorPreviewCache(async () => null, new Map([['a', { route: '/home', image: 'a' }]]), 2, {
    write () {}, remove: id => removed.push(id),
  })
  cache.restore(new Map([
    ['b', { route: '/b', image: 'b', capturedAt: 1 }],
    ['closed', { route: '/closed', image: 'closed', capturedAt: 2 }],
  ]), [tab('a'), tab('b', '/b')])
  assert.deepEqual([...cache.entries.keys()], ['b', 'a'])
  assert.deepEqual(removed, ['closed'])
})
