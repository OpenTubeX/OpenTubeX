import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'

import { feedEntryInScope, isNewInFeedScope, preserveSubscriptionSeenEntries, seenFeedEntryMark, toCachedFeedEntry } from '../../src/subscriptionFeedState.js'
import { reconcileFetchedSubscriptionEntries } from '../../src/renderer/helpers/subscription-entries.js'
import { applySubscriptionSeenVideosToCache } from '../../src/renderer/helpers/subscription-seen-videos.js'

const states = entry => [isNewInFeedScope(entry, null), isNewInFeedScope(entry, 'first'), isNewInFeedScope(entry, 'second')]
const mark = (entry, scope) => preserveSubscriptionSeenEntries([entry], [seenFeedEntryMark({ videoId: entry.videoId, isMembersOnly: false }, scope)])[0]

test('a video seen in one profile stays new in the others, also one cached before separate profiles', () => {
  for (const cached of [
    { videoId: 'video', isNewInSubscriptionFeed: true, arrivedNewInSubscriptionFeed: true },
    { videoId: 'video', isNewInSubscriptionFeed: true },
  ]) {
    assert.deepEqual(states(mark(cached, null)), [false, true, true])
    assert.deepEqual(states(mark(cached, 'first')), [true, false, true])
    assert.deepEqual(states(mark(mark(cached, 'first'), null)), [false, false, true])
  }
})

test('a refresh in a separate profile keeps the others’ states and stores its own', () => {
  const previous = [
    { videoId: 'seenHere', isNewInSubscriptionFeed: true, arrivedNewInSubscriptionFeed: true },
    { videoId: 'watchedHere', isNewInSubscriptionFeed: true, arrivedNewInSubscriptionFeed: true },
    { videoId: 'seenShared', isNewInSubscriptionFeed: false, arrivedNewInSubscriptionFeed: true },
  ]
  const shown = previous.map(entry => feedEntryInScope(entry, 'first'))
  shown[0] = { ...shown[0], isNewInSubscriptionFeed: false }
  const fetched = [{ videoId: 'arrived', published: 5000 }, ...previous.map(({ videoId }) => ({ videoId, published: 1000 }))]
  const reconciled = reconcileFetchedSubscriptionEntries(fetched, shown, 'videoId', 4000, { watchedHere: { isWatched: true } })
  const cached = reconciled.map(toCachedFeedEntry)
  assert.deepEqual(cached.map(entry => [entry.videoId, ...states(entry)]), [
    ['arrived', true, true, true],
    ['seenHere', true, false, true],
    ['watchedHere', true, false, true],
    ['seenShared', false, true, true],
  ])
  assert.ok(cached.every(entry => !('sharedNewInSubscriptionFeed' in entry) && !('subscriptionFeedScope' in entry)))
})

test('a separate profile’s feeds show its own state and seen marks', () => {
  const cache = reactive({
    channel: {
      videos: [
        { videoId: 'seenShared', isNewInSubscriptionFeed: false, arrivedNewInSubscriptionFeed: true },
        { videoId: 'markedHere', isNewInSubscriptionFeed: true, arrivedNewInSubscriptionFeed: true },
      ],
    },
  })
  const marks = JSON.stringify([{ videoId: 'markedHere', seenAt: 10, isMembersOnly: false }])
  const shown = applySubscriptionSeenVideosToCache(cache, marks, 'first').channel.videos
  assert.deepEqual(shown.map(entry => entry.isNewInSubscriptionFeed), [true, false])
  assert.deepEqual(applySubscriptionSeenVideosToCache(cache, '[]', null).channel.videos.map(entry => entry.isNewInSubscriptionFeed), [false, true])
})
