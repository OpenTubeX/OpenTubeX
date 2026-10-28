import assert from 'node:assert/strict'
import test from 'node:test'

import { createInvidiousFeedParsers } from '../../src/renderer/helpers/api/invidious-feed-parsers.js'
import {
  getSubscriptionVideoSortTimestamp,
  reconcileFetchedSubscriptionEntries
} from '../../src/renderer/helpers/subscription-entries.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
// A channel's first fetch has no previous fetch time and falls back to the clock
const firstFetch = Date.now()
const scheduledTime = firstFetch + 90 * DAY

const { normalizeInvidiousSubscriptionFeed } = createInvidiousFeedParsers(() => 'https://invidious.example')

/**
 * Invidious has no publication text for upcoming entries and reports the time
 * it parsed the channel page instead.
 * @param {number} fetchTime
 * @param {object[]} [newVideos]
 */
function fetchChannel(fetchTime, newVideos = []) {
  return normalizeInvidiousSubscriptionFeed('videos', {
    videos: [
      ...newVideos,
      {
        videoId: 'upcoming',
        authorId: CHANNEL_ID,
        isUpcoming: true,
        liveNow: false,
        published: Math.floor(fetchTime / 1000),
        premiereTimestamp: Math.floor(scheduledTime / 1000)
      },
      {
        videoId: 'older',
        authorId: CHANNEL_ID,
        isUpcoming: false,
        liveNow: false,
        published: Math.floor((firstFetch - 5 * DAY) / 1000),
        premiereTimestamp: 0
      }
    ]
  }, CHANNEL_ID)
}

test('keeps an upcoming Invidious entry at its first-seen position across refreshes', () => {
  let cache = reconcileFetchedSubscriptionEntries(fetchChannel(firstFetch), null, 'videoId', null)
  let cacheTimestamp = firstFetch
  const firstSeen = cache.find(video => video.videoId === 'upcoming').subscriptionFeedPublished

  for (const days of [1, 2, 7]) {
    const fetchTime = firstFetch + days * DAY
    const uploaded = {
      videoId: `uploaded-${days}`,
      authorId: CHANNEL_ID,
      isUpcoming: false,
      liveNow: false,
      published: Math.floor((fetchTime - 2 * HOUR) / 1000),
      premiereTimestamp: 0
    }
    cache = reconcileFetchedSubscriptionEntries(fetchChannel(fetchTime, [uploaded]), cache, 'videoId', cacheTimestamp)
    cacheTimestamp = fetchTime

    assert.equal(cache.find(video => video.videoId === 'upcoming').subscriptionFeedPublished, firstSeen)

    const order = cache
      .toSorted((a, b) => getSubscriptionVideoSortTimestamp(b, false, fetchTime) -
        getSubscriptionVideoSortTimestamp(a, false, fetchTime))
      .map(video => video.videoId)
    assert.deepEqual(order.slice(0, 2), [`uploaded-${days}`, 'upcoming'])
  }
})
