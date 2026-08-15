import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyRssPremiereVerdict,
  collectResolvedNonPremiereVideoIds,
  ensureUpcomingSubscriptionFeedPublished,
  ensureSubscriptionFeedEntryState,
  getSubscriptionVideoSortTimestamp,
  getUpcomingPremiereTimestamp,
  mergeSubscriptionShortThumbnails,
  mergeUpcomingSubscriptionFeedPublished,
  reconcileFetchedSubscriptionEntries,
  updateUpcomingPremiereState
} from '../../src/renderer/helpers/subscription-entries.js'

const HOUR = 3_600_000
const now = Date.now()

function video(videoId, published, extra = {}) {
  return { videoId, published, type: 'video', ...extra }
}

test('reads premiere times from Local API dates and Invidious timestamps', () => {
  assert.equal(
    getUpcomingPremiereTimestamp({ premiereDate: '2026-08-03T12:00:00.000Z' }),
    Date.parse('2026-08-03T12:00:00.000Z')
  )
  assert.equal(getUpcomingPremiereTimestamp({ premiereTimestamp: 1_785_758_400 }), 1_785_758_400_000)
  assert.equal(getUpcomingPremiereTimestamp({ premiereDate: 'invalid' }), null)
})

test('marks an upcoming premiere as running when its scheduled time arrives', () => {
  const scheduledTime = now + HOUR
  const upcoming = video('premiere', scheduledTime, {
    isUpcoming: true,
    isPremiere: false,
    premiere: true,
    premiereDate: new Date(scheduledTime)
  })

  assert.equal(updateUpcomingPremiereState(upcoming, scheduledTime - 1), upcoming)
  assert.deepEqual(updateUpcomingPremiereState(upcoming, scheduledTime), {
    ...upcoming,
    isUpcoming: false,
    isPremiere: true,
    premiere: false,
    liveNow: true
  })

  assert.deepEqual(updateUpcomingPremiereState({
    ...upcoming,
    isUpcoming: undefined,
    premiere: undefined
  }, scheduledTime), {
    ...upcoming,
    isUpcoming: false,
    isPremiere: true,
    premiere: false,
    liveNow: true
  })

  const completed = {
    ...upcoming,
    isUpcoming: false,
    premiere: false,
    liveNow: false
  }
  assert.equal(updateUpcomingPremiereState(completed, scheduledTime), completed)
})

test('sorts scheduled entries by announcement time until they start', () => {
  const scheduledTime = now + HOUR
  const announcementTime = now - HOUR
  const upcoming = video('premiere', scheduledTime, {
    isUpcoming: true,
    premiereDate: new Date(scheduledTime),
    subscriptionFeedPublished: announcementTime
  })

  assert.equal(getSubscriptionVideoSortTimestamp(upcoming, true, now), scheduledTime)
  assert.equal(getSubscriptionVideoSortTimestamp(upcoming, false, now), announcementTime)
  assert.equal(getSubscriptionVideoSortTimestamp(upcoming, false, scheduledTime), scheduledTime)
})

test('backfills and keeps the first-seen feed position for scraper and legacy entries', () => {
  const scheduledTime = now + HOUR
  const firstSeenTime = now - HOUR
  const entry = video('premiere', scheduledTime, {
    isUpcoming: true,
    premiereDate: new Date(scheduledTime)
  })

  const backfilled = ensureUpcomingSubscriptionFeedPublished(entry, firstSeenTime, now)
  assert.equal(backfilled.subscriptionFeedPublished, firstSeenTime)
  assert.equal(getSubscriptionVideoSortTimestamp(backfilled, false, now), firstSeenTime)

  const reconciled = reconcileFetchedSubscriptionEntries(
    [{ ...entry, subscriptionFeedPublished: scheduledTime }],
    [backfilled],
    'videoId',
    now - HOUR
  )

  assert.equal(reconciled[0].subscriptionFeedPublished, firstSeenTime)

  const refreshedLegacyEntry = reconcileFetchedSubscriptionEntries(
    [{ ...entry, subscriptionFeedPublished: scheduledTime }],
    [entry],
    'videoId',
    firstSeenTime
  )

  assert.equal(refreshedLegacyEntry[0].subscriptionFeedPublished, firstSeenTime)
})

test('adds selected Shorts thumbnails without replacing RSS metadata', () => {
  const entries = [
    video('matched', 10, { viewCount: 1234, isRSS: true }),
    video('unmatched', 20, { isRSS: true })
  ]
  const merged = mergeSubscriptionShortThumbnails(entries, [
    video('matched', 999, {
      thumbnailUrl: 'https://i.ytimg.com/vi/matched/frame0.jpg',
      viewCount: 1200
    })
  ])

  assert.deepEqual(merged, [
    video('matched', 10, {
      thumbnailUrl: 'https://i.ytimg.com/vi/matched/frame0.jpg',
      viewCount: 1234,
      isRSS: true
    }),
    entries[1]
  ])
})

test('adds RSS announcement dates only to scraped upcoming entries', () => {
  const scheduledTime = now + HOUR
  const announcementTime = now - 4 * HOUR
  const upcoming = video('upcoming', scheduledTime, {
    isUpcoming: true,
    premiereDate: new Date(scheduledTime)
  })
  const ordinary = video('ordinary', now - HOUR)

  const merged = mergeUpcomingSubscriptionFeedPublished(
    [upcoming, ordinary],
    [
      video('upcoming', announcementTime, { isRSS: true }),
      video('ordinary', now, { isRSS: true })
    ]
  )

  assert.deepEqual(merged, [
    { ...upcoming, subscriptionFeedPublished: announcementTime },
    ordinary
  ])
  assert.equal(getSubscriptionVideoSortTimestamp(merged[0], false, now), announcementTime)
})

test('replaces a cached first-seen fallback with an exact RSS announcement date', () => {
  const scheduledTime = now + HOUR
  const announcementTime = now - 4 * HOUR
  const firstSeenTime = now - HOUR
  const upcoming = video('upcoming', scheduledTime, {
    isUpcoming: true,
    premiereDate: new Date(scheduledTime)
  })
  const [enriched] = mergeUpcomingSubscriptionFeedPublished(
    [upcoming],
    [video('upcoming', announcementTime, { isRSS: true })]
  )

  const [reconciled] = reconcileFetchedSubscriptionEntries(
    [enriched],
    [{ ...upcoming, subscriptionFeedPublished: firstSeenTime }],
    'videoId',
    firstSeenTime
  )

  assert.equal(reconciled.subscriptionFeedPublished, announcementTime)
})

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

test('prefers enriched Invidious metadata over a cached fallback date', () => {
  const exactPublished = Date.parse('2025-12-30T21:00:06Z')
  const reconciled = reconcileFetchedSubscriptionEntries(
    [video('a', exactPublished, { isInvidiousPublicationDateEnriched: true })],
    [video('a', now - 2 * 60_000)],
    'videoId',
    now - HOUR
  )

  assert.equal(reconciled[0].published, exactPublished)
})

test('keeps enriched Invidious metadata after a later detail request fails', () => {
  const exactPublished = Date.parse('2025-12-30T21:00:06Z')
  const reconciled = reconcileFetchedSubscriptionEntries(
    [video('a', now, {
      publishedText: '0 seconds ago',
      viewCount: 0,
      viewCountText: '0 views',
      isInvidiousPublicationDateFallback: true
    })],
    [video('a', exactPublished, {
      publishedText: '7 months ago',
      viewCount: 620_420,
      viewCountText: '620K views',
      isInvidiousPublicationDateEnriched: true
    })],
    'videoId',
    now - HOUR
  )

  assert.deepEqual(reconciled[0], video('a', exactPublished, {
    publishedText: '7 months ago',
    viewCount: 620_420,
    viewCountText: '620K views',
    isInvidiousPublicationDateEnriched: true,
    isNewInSubscriptionFeed: false
  }))
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

test('recovers resolved non-premiere verdicts from the persisted caches', () => {
  const videoIds = collectResolvedNonPremiereVideoIds([
    {
      channelA: { videos: [{ videoId: 'settled', isUpcoming: false }] },
      channelB: { videos: [{ videoId: 'premiere', isUpcoming: true }] },
    },
    { channelC: { videos: [{ videoId: 'shortSettled', isUpcoming: false }] } },
    { channelD: { videos: [{ videoId: 'liveSettled', isUpcoming: false }] } },
  ])

  assert.deepEqual([...videoIds].sort(), ['liveSettled', 'settled', 'shortSettled'])
})

test('entries that were never premiere candidates carry no reusable verdict', () => {
  // No `isUpcoming` at all: enrichment skipped them, so nothing is known.
  const videoIds = collectResolvedNonPremiereVideoIds([
    { channelA: { videos: [{ videoId: 'popular', viewCount: 5000 }] } },
  ])

  assert.equal(videoIds.size, 0)
})

test('empty, missing and malformed caches are tolerated', () => {
  const videoIds = collectResolvedNonPremiereVideoIds([
    null,
    undefined,
    {},
    { channelA: null },
    { channelB: { videos: null } },
    { channelC: { videos: [{ isUpcoming: false }] } },
    { channelD: { posts: [{ postId: 'p1' }] } },
  ])

  assert.equal(videoIds.size, 0)
})

test('a failed premiere lookup leaves no verdict to cache', () => {
  const entry = { videoId: 'a', viewCount: 0 }

  const result = applyRssPremiereVerdict(entry, { isUpcoming: false, failed: true })

  assert.equal('isUpcoming' in result, false, 'a failure must not look like a resolved verdict')
  // The whole point: what gets cached must not seed the non-premiere set,
  // otherwise a premiere that failed once is never looked up again.
  assert.equal(collectResolvedNonPremiereVideoIds([{ ch: { videos: [result] } }]).size, 0)
})

test('a settled lookup records the verdict both ways', () => {
  const notPremiere = applyRssPremiereVerdict({ videoId: 'a' }, { isUpcoming: false })
  assert.equal(notPremiere.isUpcoming, false)
  assert.deepEqual([...collectResolvedNonPremiereVideoIds([{ ch: { videos: [notPremiere] } }])], ['a'])

  const premiereDate = new Date('2026-01-02T03:04:05Z')
  const premiere = applyRssPremiereVerdict(
    { videoId: 'b', published: 1234 },
    { isUpcoming: true, premiereDate }
  )
  assert.equal(premiere.isUpcoming, true)
  assert.equal(premiere.premiereDate, premiereDate)
  assert.equal(premiere.published, premiereDate.getTime())
  assert.equal(premiere.subscriptionFeedPublished, 1234)
  // An upcoming premiere goes live eventually, so it is never a durable negative.
  assert.equal(collectResolvedNonPremiereVideoIds([{ ch: { videos: [premiere] } }]).size, 0)
})

test('an upcoming premiere without a scheduled time keeps its original date', () => {
  const entry = { videoId: 'a', published: 1234 }

  const result = applyRssPremiereVerdict(entry, { isUpcoming: true })

  assert.equal(result.isUpcoming, true)
  assert.equal(result.published, 1234)
  assert.equal('premiereDate' in result, false)
})
