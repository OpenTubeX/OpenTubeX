import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applySubscriptionVideoLimit,
  filterMembersOnlySubscriptionVideos,
  formatSubscriptionDailyVideoLimit,
  getSubscriptionDailyVideoLimitOptions,
  getSubscriptionFeedTypeOptions,
  getSubscriptionsForFeed,
  getUpdatedSubscriptionFeedTypes,
  getValidSubscriptionChannels,
  isMembersOnlySubscriptionVideoVisible,
  isSubscriptionFeedTypeEnabled,
  normalizeSubscriptionChannelSettings,
  parseSubscriptionDailyVideoLimit
} from '../../src/renderer/helpers/subscription-channels.js'

test('removes empty and malformed subscription entries', () => {
  const subscriptions = new Array(6)
  subscriptions[0] = { id: 'channel-1', name: 'One' }
  subscriptions[2] = null
  subscriptions[3] = { name: 'Missing id' }
  subscriptions[4] = { id: '' }
  subscriptions[5] = { id: 'channel-2' }

  assert.deepEqual(getValidSubscriptionChannels(subscriptions), [
    { id: 'channel-1', name: 'One' },
    { id: 'channel-2' }
  ])
})

test('handles a missing subscriptions array', () => {
  assert.deepEqual(getValidSubscriptionChannels(undefined), [])
})

test('shares normalized channel-setting values between settings interfaces', () => {
  assert.deepEqual(normalizeSubscriptionChannelSettings({
    feedTypes: ['posts', 'invalid', 'videos'],
    dailyVideoLimit: 0,
    showMembersOnly: true
  }), {
    feedTypes: ['videos', 'posts'],
    dailyVideoLimit: undefined,
    showMembersOnly: true
  })
  assert.equal(formatSubscriptionDailyVideoLimit(undefined), 'global')
  assert.equal(formatSubscriptionDailyVideoLimit(null), 'unlimited')
  assert.equal(formatSubscriptionDailyVideoLimit(2), '2')
  assert.equal(parseSubscriptionDailyVideoLimit('global'), undefined)
  assert.equal(parseSubscriptionDailyVideoLimit('unlimited'), null)
  assert.equal(parseSubscriptionDailyVideoLimit('2'), 2)
  assert.equal(parseSubscriptionDailyVideoLimit('0'), undefined)
  assert.deepEqual(
    getUpdatedSubscriptionFeedTypes(['videos', 'posts'], 'shorts', true),
    ['videos', 'shorts', 'posts']
  )

  const translate = key => key
  assert.deepEqual(
    getSubscriptionFeedTypeOptions(translate).map(option => option.id),
    ['videos', 'shorts', 'live', 'posts']
  )
  assert.deepEqual(
    getSubscriptionDailyVideoLimitOptions(translate).map(option => option.value),
    ['global', 'unlimited', ...Array.from({ length: 30 }, (_, index) => String(index + 1))]
  )
})

test('keeps every feed enabled for existing subscriptions', () => {
  const subscription = { id: 'channel-1' }

  assert.equal(isSubscriptionFeedTypeEnabled(subscription, 'videos'), true)
  assert.equal(isSubscriptionFeedTypeEnabled(subscription, 'shorts'), true)
  assert.equal(isSubscriptionFeedTypeEnabled(subscription, 'live'), true)
  assert.equal(isSubscriptionFeedTypeEnabled(subscription, 'posts'), true)
})

test('filters every unselected feed type', () => {
  const subscriptions = [
    { id: 'videos-only', feedTypes: ['videos'] },
    { id: 'posts-only', feedTypes: ['posts'] },
    { id: 'no-feed-types', feedTypes: [] },
    { id: 'all-types' }
  ]

  assert.deepEqual(
    getSubscriptionsForFeed(subscriptions, 'videos').map(channel => channel.id),
    ['videos-only', 'all-types']
  )
  assert.deepEqual(
    getSubscriptionsForFeed(subscriptions, 'shorts').map(channel => channel.id),
    ['all-types']
  )
  assert.deepEqual(
    getSubscriptionsForFeed(subscriptions, 'live').map(channel => channel.id),
    ['all-types']
  )
  assert.deepEqual(
    getSubscriptionsForFeed(subscriptions, 'posts').map(channel => channel.id),
    ['posts-only', 'all-types']
  )
})

test('only shows opted-in members-only videos when restricted playback is configured', () => {
  const membersOnlyVideo = { videoId: 'members', authorId: 'channel-1', isMembersOnly: true }
  const publicVideo = { videoId: 'public', authorId: 'channel-1' }

  assert.equal(isMembersOnlySubscriptionVideoVisible(publicVideo, undefined, false), true)
  assert.equal(isMembersOnlySubscriptionVideoVisible(membersOnlyVideo, { showMembersOnly: true }, false), false)
  assert.equal(isMembersOnlySubscriptionVideoVisible(membersOnlyVideo, { showMembersOnly: false }, true), false)
  assert.equal(isMembersOnlySubscriptionVideoVisible(membersOnlyVideo, { showMembersOnly: true }, true), true)

  assert.deepEqual(filterMembersOnlySubscriptionVideos(
    [membersOnlyVideo, publicVideo],
    [{ id: 'channel-1', showMembersOnly: true }],
    true
  ), [membersOnlyVideo, publicVideo])
  assert.deepEqual(filterMembersOnlySubscriptionVideos(
    [membersOnlyVideo, publicVideo],
    [{ id: 'channel-1', showMembersOnly: false }],
    true
  ), [publicVideo])
})

test('reuses an unchanged list when there are no members-only videos', () => {
  const videos = [{ videoId: 'public', authorId: 'channel-1' }]

  assert.equal(filterMembersOnlySubscriptionVideos(
    videos,
    [{ id: 'channel-1', showMembersOnly: true }],
    true
  ), videos)
})

test('reuses an unchanged list when no video limit is active', () => {
  const videos = [{ videoId: 'public', authorId: 'channel-1' }]

  assert.equal(applySubscriptionVideoLimit(
    videos,
    [{ id: 'channel-1' }],
    null
  ), videos)
})

test('uses the global total limit when a channel has no override', () => {
  const videos = [
    { videoId: 'newest', authorId: 'channel-1', published: new Date(2026, 7, 31, 12).getTime() },
    { videoId: 'older', authorId: 'channel-1', published: new Date(2026, 7, 30, 12).getTime() }
  ]

  assert.deepEqual(
    applySubscriptionVideoLimit(videos, [{ id: 'channel-1' }], 1),
    [{ ...videos[0], subscriptionHiddenVideoCount: 1 }]
  )
})

test('allows a channel to opt out of the global limit', () => {
  const videos = [
    { videoId: 'newest', authorId: 'channel-1', published: new Date(2026, 7, 31, 12).getTime() },
    { videoId: 'older', authorId: 'channel-1', published: new Date(2026, 7, 30, 12).getTime() }
  ]

  assert.deepEqual(
    applySubscriptionVideoLimit(videos, [{ id: 'channel-1', dailyVideoLimit: null }], 1),
    videos
  )
})

test('applies a per-channel limit separately to each publication day', () => {
  const newest = { videoId: 'newest', authorId: 'channel-1', published: new Date(2026, 7, 31, 12).getTime() }
  const sameDay = { videoId: 'same-day', authorId: 'channel-1', published: new Date(2026, 7, 31, 8).getTime() }
  const previousDay = { videoId: 'previous-day', authorId: 'channel-1', published: new Date(2026, 7, 30, 12).getTime() }
  const otherChannel = { videoId: 'other-channel', authorId: 'channel-2', published: newest.published }

  const result = applySubscriptionVideoLimit(
    [newest, sameDay, previousDay, otherChannel],
    [
      { id: 'channel-1', dailyVideoLimit: 1 },
      { id: 'channel-2', dailyVideoLimit: null }
    ],
    null
  )

  assert.deepEqual(result, [
    { ...newest, subscriptionHiddenVideoCount: 1 },
    previousDay,
    otherChannel
  ])
  assert.equal(Object.hasOwn(newest, 'subscriptionHiddenVideoCount'), false)
})

test('treats an invalid zero channel limit as the global setting', () => {
  const videos = [
    { videoId: 'newest', authorId: 'channel-1', published: Date.now() },
    { videoId: 'older', authorId: 'channel-1', published: Date.now() - 1 }
  ]

  assert.deepEqual(
    applySubscriptionVideoLimit(videos, [{ id: 'channel-1', dailyVideoLimit: 0 }], 1),
    [{ ...videos[0], subscriptionHiddenVideoCount: 1 }]
  )
})
