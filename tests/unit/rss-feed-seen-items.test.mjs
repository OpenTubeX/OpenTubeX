import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  MAX_RSS_FEED_SEEN_ITEMS,
  RSS_FEED_SEEN_ITEMS_STORAGE_KEY,
  loadRssFeedSeenMarks,
  mergeRssFeedSeenItems,
  onRssFeedSeenItemsSynced,
  parseRssFeedSeenItems,
  recordRssFeedSeenItems,
  syncRssFeedSeenItems,
} from '../../src/renderer/helpers/rssFeedSeenItems.js'

const storage = new Map()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
} })

beforeEach(() => storage.clear())

test('parsing drops malformed marks and extra fields', () => {
  assert.deepEqual(parseRssFeedSeenItems(JSON.stringify([
    { key: 'feed\na', seenAt: 1, extra: true },
    { key: 'feed\nb', unseenAt: 2, seenAt: 0 },
    { key: '', seenAt: 1 },
    { key: 'feed\nc', seenAt: 0 },
    { key: 'feed\nd', seenAt: 'soon' },
    null,
  ])), [{ key: 'feed\na', seenAt: 1 }, { key: 'feed\nb', unseenAt: 2 }])
  assert.deepEqual(parseRssFeedSeenItems('not json'), [])
  assert.deepEqual(parseRssFeedSeenItems({ key: 'feed\na', seenAt: 1 }), [])
})

test('merging keeps the latest seen and unseen times of each item and the most recent marks', () => {
  assert.deepEqual(mergeRssFeedSeenItems(
    [{ key: 'feed\nb', seenAt: 3 }, { key: 'feed\na', seenAt: 1 }],
    [{ key: 'feed\na', seenAt: 2, unseenAt: 4 }]
  ), [{ key: 'feed\na', seenAt: 2, unseenAt: 4 }, { key: 'feed\nb', seenAt: 3 }])

  const marks = Array.from({ length: MAX_RSS_FEED_SEEN_ITEMS + 1 }, (_, index) => ({ key: `feed\n${index}`, seenAt: index + 1 }))
  // Marking an old item as unseen keeps its mark
  marks[1] = { key: 'feed\n1', seenAt: 2, unseenAt: MAX_RSS_FEED_SEEN_ITEMS + 2 }
  const merged = mergeRssFeedSeenItems(marks, [])
  assert.equal(merged.length, MAX_RSS_FEED_SEEN_ITEMS)
  assert.equal(merged.some(entry => entry.key === 'feed\n0'), false)
  assert.equal(merged.some(entry => entry.key === 'feed\n1'), true)
})

test('the later of the seen and unseen marks decides', () => {
  recordRssFeedSeenItems(['feed\na', 'feed\nb'], true, 1)
  recordRssFeedSeenItems(['feed\nb', 'feed\nc'], false, 2)
  recordRssFeedSeenItems([], true, 3)
  assert.deepEqual(JSON.parse(storage.get(RSS_FEED_SEEN_ITEMS_STORAGE_KEY)), [
    { key: 'feed\na', seenAt: 1 },
    { key: 'feed\nb', seenAt: 1, unseenAt: 2 },
    { key: 'feed\nc', unseenAt: 2 },
  ])
  assert.deepEqual(loadRssFeedSeenMarks(), new Map([['feed\na', true], ['feed\nb', false], ['feed\nc', false]]))

  recordRssFeedSeenItems(['feed\nb'], true, 3)
  assert.equal(loadRssFeedSeenMarks().get('feed\nb'), true)
})

test('syncing merges both sides, applies the marks and uploads them', async () => {
  recordRssFeedSeenItems(['feed\nlocal'], true, 2)
  const applied = []
  onRssFeedSeenItemsSynced(marks => applied.push([...marks]))
  let uploaded
  const count = await syncRssFeedSeenItems({
    getSeenRssItems: async () => {
      // A mark recorded while the download runs is kept
      recordRssFeedSeenItems(['feed\nduring'], true, 3)
      return [{ key: 'feed\nremote', seenAt: 1 }, { key: 'feed\nlocal', unseenAt: 4 }]
    },
    putSeenRssItems: async entries => { uploaded = entries },
  })
  const expected = [
    { key: 'feed\nduring', seenAt: 3 },
    { key: 'feed\nlocal', seenAt: 2, unseenAt: 4 },
    { key: 'feed\nremote', seenAt: 1 },
  ]
  assert.equal(count, 3)
  assert.deepEqual(uploaded, expected)
  assert.deepEqual(JSON.parse(storage.get(RSS_FEED_SEEN_ITEMS_STORAGE_KEY)), expected)
  assert.deepEqual(applied, [[['feed\nduring', true], ['feed\nlocal', false], ['feed\nremote', true]]])
})

test('a new mark stays ahead of earlier marks from a device whose clock is ahead', () => {
  storage.set(RSS_FEED_SEEN_ITEMS_STORAGE_KEY, JSON.stringify([{ key: 'feed\na', unseenAt: 5000 }]))
  recordRssFeedSeenItems(['feed\na', 'feed\nb'], true, 1000)
  assert.deepEqual(JSON.parse(storage.get(RSS_FEED_SEEN_ITEMS_STORAGE_KEY)), [
    { key: 'feed\na', seenAt: 5001, unseenAt: 5000 },
    { key: 'feed\nb', seenAt: 1000 },
  ])
  assert.equal(loadRssFeedSeenMarks().get('feed\na'), true)

  // Marks in the same millisecond keep their order
  recordRssFeedSeenItems(['feed\nb'], false, 1000)
  assert.equal(loadRssFeedSeenMarks().get('feed\nb'), false)
})
