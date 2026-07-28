import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canMarkHistoryEntryAsWatched,
  DEFAULT_WATCHED_PERCENTAGE_THRESHOLD,
  hasReachedWatchedThreshold,
  isHistoryEntryWatched,
} from '../../src/history.js'

test('uses the hybrid threshold by default', () => {
  assert.equal(DEFAULT_WATCHED_PERCENTAGE_THRESHOLD, 90)
  assert.equal(hasReachedWatchedThreshold(9 * 60, 10 * 60), true)
  assert.equal(hasReachedWatchedThreshold(54 * 60, 60 * 60), false)
  assert.equal(hasReachedWatchedThreshold(58 * 60, 60 * 60), true)
})

test('uses a configurable watched percentage threshold', () => {
  assert.equal(hasReachedWatchedThreshold(0, 10 * 60, 0), true)
  assert.equal(hasReachedWatchedThreshold(6, 10 * 60, 1), false)
  assert.equal(hasReachedWatchedThreshold(8 * 60, 10 * 60, 50), true)
  assert.equal(hasReachedWatchedThreshold(10 * 60, 10 * 60, 100), true)
})

test('only bypasses the hybrid rule at zero and one hundred percent', () => {
  assert.equal(hasReachedWatchedThreshold(0, 60 * 60, 0), true)
  assert.equal(hasReachedWatchedThreshold(54 * 60, 60 * 60, 90), false)
  assert.equal(hasReachedWatchedThreshold(60 * 60 - 1, 60 * 60, 100), false)
})

test('rejects invalid video progress and falls back from invalid thresholds', () => {
  assert.equal(hasReachedWatchedThreshold(Number.NaN, 60, 50), false)
  assert.equal(hasReachedWatchedThreshold(30, 0, 50), false)
  assert.equal(hasReachedWatchedThreshold(0, 60, -1), false)
  assert.equal(hasReachedWatchedThreshold(54 * 60, 60 * 60, 101), false)
})

test('active live content cannot be marked as watched', () => {
  assert.equal(canMarkHistoryEntryAsWatched({ isLive: true }), false)
  assert.equal(isHistoryEntryWatched({ isLive: true, isWatched: true }), false)
  assert.equal(canMarkHistoryEntryAsWatched({ isLive: false }), true)
  assert.equal(isHistoryEntryWatched({ isLive: false, isWatched: true }), true)
  assert.equal(isHistoryEntryWatched({
    isLive: false,
    watchProgress: 9 * 60,
    lengthSeconds: 10 * 60,
  }), true)
})
