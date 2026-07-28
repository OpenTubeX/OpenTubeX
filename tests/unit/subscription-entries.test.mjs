import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ensureSubscriptionFeedEntryState,
  reconcileFetchedSubscriptionEntries
} from '../../src/renderer/helpers/subscription-entries.js'

const HOUR = 3_600_000
const now = Date.now()

function video(videoId, published, extra = {}) {
  return { videoId, published, type: 'video', ...extra }
}

test('keeps the cached publication date of entries that were already fetched', () => {
  const previousEntries = [
    video('a', now - 25 * HOUR),
    video('b', now - 49 * HOUR)
  ]
  // Scraped dates are recalculated against the current time on every fetch,
  // so the same videos come back with dates that moved forwards
  const entries = [
    video('a', now - 24 * HOUR),
    video('b', now - 48 * HOUR)
  ]

  const reconciled = reconcileFetchedSubscriptionEntries(entries, previousEntries, 'videoId', now - HOUR)

  assert.deepEqual(reconciled.map(entry => entry.published), [now - 25 * HOUR, now - 49 * HOUR])
})

test('does not reorder a feed when only some channels are refetched', () => {
  // Both channels were fetched an hour ago, channel b's video is the newer one
  const cachedChannelA = [video('a1', now - 25 * HOUR)]
  const cachedChannelB = [video('b1', now - 24.5 * HOUR)]

  // Refetching channel a returns the same video, with its relative date
  // ("1 day ago") resolved against the current time
  const refetchedChannelA = reconcileFetchedSubscriptionEntries(
    [video('a1', now - 24 * HOUR)],
    cachedChannelA,
    'videoId',
    now - HOUR
  )

  const feed = [...refetchedChannelA, ...cachedChannelB]
    .sort((a, b) => b.published - a.published)
    .map(entry => entry.videoId)

  assert.deepEqual(feed, ['b1', 'a1'])
})

test('takes the new publication date for premieres and live streams', () => {
  const previousEntries = [
    video('live', now - 5 * HOUR, { liveNow: true }),
    video('premiere', now + 5 * HOUR, { isUpcoming: true, premiereDate: new Date(now + 5 * HOUR) })
  ]
  const entries = [
    video('live', now, { liveNow: true }),
    video('premiere', now + HOUR, { isUpcoming: true, premiereDate: new Date(now + HOUR) })
  ]

  const reconciled = reconcileFetchedSubscriptionEntries(entries, previousEntries, 'videoId', now - HOUR)

  assert.deepEqual(reconciled.map(entry => entry.published), [now, now + HOUR])
})

test('prefers the exact date of an RSS entry over a cached estimate', () => {
  const reconciled = reconcileFetchedSubscriptionEntries(
    [video('a', now - 24 * HOUR, { isRSS: true })],
    [video('a', now - 25 * HOUR)],
    'videoId',
    now - HOUR
  )

  assert.equal(reconciled[0].published, now - 24 * HOUR)
})

test('keeps the cached publication time of posts', () => {
  const reconciled = reconcileFetchedSubscriptionEntries(
    [{ postId: 'p1', publishedTime: now - 24 * HOUR }],
    [{ postId: 'p1', publishedTime: now - 25 * HOUR }],
    'postId',
    now - HOUR
  )

  assert.equal(reconciled[0].publishedTime, now - 25 * HOUR)
})

test('marks entries published since the previous fetch as new', () => {
  const previousEntries = [video('a', now - 25 * HOUR)]
  const entries = [
    video('new', now - 30 * 60_000),
    video('a', now - 25 * HOUR)
  ]

  const reconciled = reconcileFetchedSubscriptionEntries(entries, previousEntries, 'videoId', now - HOUR)

  assert.deepEqual(reconciled.map(entry => entry.isNewInSubscriptionFeed), [true, false])
})

test('keeps entries that were already marked as new', () => {
  const previousEntries = [video('a', now - 2 * HOUR, { isNewInSubscriptionFeed: true })]
  const entries = [video('a', now - 2 * HOUR)]

  const reconciled = reconcileFetchedSubscriptionEntries(entries, previousEntries, 'videoId', now - HOUR)

  assert.equal(reconciled[0].isNewInSubscriptionFeed, true)
})

test('preserves New-feed state when a channel page updates raw cached entries', () => {
  const previousEntries = [
    video('new', now - HOUR, { isNewInSubscriptionFeed: true }),
    video('seen', now - 2 * HOUR, { isNewInSubscriptionFeed: false })
  ]
  const channelPageEntries = [
    video('new', now - HOUR),
    video('seen', now - 2 * HOUR)
  ]

  const reconciled = ensureSubscriptionFeedEntryState(
    channelPageEntries,
    previousEntries,
    'videoId',
    now - 3 * HOUR
  )

  assert.deepEqual(reconciled.map(entry => entry.isNewInSubscriptionFeed), [true, false])
})

test('does not mark watched videos as new', () => {
  const entries = [
    video('watched', now - 30 * 60_000),
    video('a', now - 25 * HOUR)
  ]
  const historyById = {
    watched: { videoId: 'watched', watchProgress: 120, lengthSeconds: 120, isWatched: true }
  }

  const reconciled = reconcileFetchedSubscriptionEntries(
    entries,
    [video('a', now - 25 * HOUR)],
    'videoId',
    now - HOUR,
    historyById
  )

  assert.equal(reconciled[0].isNewInSubscriptionFeed, false)
})
