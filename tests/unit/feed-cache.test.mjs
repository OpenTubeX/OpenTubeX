import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffFeedCacheDocuments, isFeedCacheChange } from '../../src/feedCache.js'

test('writes only the feed cache documents whose items or history changed', () => {
  const kept = { id: 'kept' }
  const replaced = { id: 'replaced' }
  const seen = ['kept']
  const stored = new Map([
    ['rss:https://a.example.test/feed', { items: [kept], seen }],
    ['rss:https://b.example.test/feed', { items: [replaced] }],
    ['rss:https://removed.example.test/feed', { items: [] }],
  ])
  const changed = { ...replaced, isNew: true }
  const current = new Map([
    // Rebuilt arrays with the same items and IDs are unchanged
    ['rss:https://a.example.test/feed', { items: [kept], seen: [...seen] }],
    ['rss:https://b.example.test/feed', { items: [changed] }],
    ['rss:https://added.example.test/feed', { items: [], seen: [] }],
  ])

  assert.deepEqual(diffFeedCacheDocuments(stored, current), {
    docs: [
      { _id: 'rss:https://b.example.test/feed', items: [changed] },
      { _id: 'rss:https://added.example.test/feed', items: [], seen: [] },
    ],
    removed: ['rss:https://removed.example.test/feed'],
  })
})

test('accepts only writes of feed cache documents from windows', () => {
  assert.equal(isFeedCacheChange({ docs: [{ _id: 'platform:twitch:1', live: [] }], removed: ['rss:https://a.example.test/feed'] }), true)
  assert.equal(isFeedCacheChange({ docs: [{ _id: 'settings', value: true }], removed: [] }), false)
  assert.equal(isFeedCacheChange({ docs: [], removed: [{ $ne: '' }] }), false)
  assert.equal(isFeedCacheChange({ docs: [] }), false)
})
