import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeSubscriptionCollaborations, selectSubscriptionCollaborationChecks } from '../../src/renderer/helpers/subscriptionCollaborationChecks.js'

const now = Date.UTC(2026, 10, 20, 12)
const hour = 60 * 60 * 1000
const day = 24 * hour
const collaboration = { videoId: 'collaboration', isCollaboration: true }

test('collaboration checks take never checked channels first, then the most overdue, up to the cap', () => {
  const cache = {
    found23h: { videos: [collaboration], collaborationsCheckedAt: now - 23 * hour },
    found25h: { videos: [collaboration], collaborationsCheckedAt: now - 25 * hour },
    none6d: { videos: [], collaborationsCheckedAt: now - 6 * day },
    none8d: { videos: [], collaborationsCheckedAt: now - 8 * day },
    neverA: { videos: [] },
    futureClock: { videos: [], collaborationsCheckedAt: now + day },
    neverB: { videos: [{ videoId: 'upload' }] },
  }
  const channels = [...Object.keys(cache), 'uncached'].map(id => ({ id }))

  assert.deepEqual(selectSubscriptionCollaborationChecks(channels, cache, now).map(channel => channel.id),
    ['neverA', 'futureClock', 'neverB', 'none8d', 'found25h'],
    'daily after finding collaborations, weekly after finding none, and channels without cached uploads wait')
  assert.deepEqual(selectSubscriptionCollaborationChecks(channels, cache, now, new Map([['neverA', now - hour / 2], ['none8d', now - 2 * hour]]))
    .map(channel => channel.id),
  ['futureClock', 'neverB', 'none8d', 'found25h', 'neverA'],
  'a failed check stays due behind the channels that were due before it failed')

  const many = Array.from({ length: 30 }, (_, i) => ({ id: `UC${i}` }))
  const manyCache = Object.fromEntries(many.map(({ id }, i) => [id, { videos: [], collaborationsCheckedAt: i < 20 ? now - 8 * day - i : undefined }]))
  assert.deepEqual(selectSubscriptionCollaborationChecks(many, manyCache, now).map(channel => channel.id),
    ['UC20', 'UC21', 'UC22', 'UC23', 'UC24', 'UC25', 'UC26', 'UC27', 'UC28', 'UC29', 'UC19', 'UC18'])
})

test('found collaborations replace the cached ones after the uploads and are new only when published since the last check', () => {
  const cacheEntry = {
    timestamp: new Date(now - hour),
    collaborationsCheckedAt: now - 2 * day,
    videos: [
      { videoId: 'upload', isNewInSubscriptionFeed: false },
      { videoId: 'kept', isCollaboration: true, isNewInSubscriptionFeed: false },
      { videoId: 'removed', isCollaboration: true, isNewInSubscriptionFeed: false },
    ],
  }
  const videos = mergeSubscriptionCollaborations(cacheEntry, [
    { videoId: 'fresh', isCollaboration: true, published: now - day },
    { videoId: 'upload', isCollaboration: true, published: now - day },
    { videoId: 'kept', isCollaboration: true, published: now - 3 * day },
  ])
  assert.deepEqual(videos.map(video => [video.videoId, video.isNewInSubscriptionFeed]),
    [['upload', false], ['fresh', true], ['kept', false]])

  const found = [
    { videoId: 'fresh', isCollaboration: true, published: now - day },
    { videoId: 'watched', isCollaboration: true, published: now - day },
    { videoId: 'old', isCollaboration: true, published: now - 3 * day },
  ]
  const history = { watched: { isWatched: true } }
  const afterFindingNone = { timestamp: new Date(now - hour), collaborationsCheckedAt: now - 2 * day, videos: [{ videoId: 'upload' }] }
  assert.deepEqual(mergeSubscriptionCollaborations(afterFindingNone, found, history).map(video => [video.videoId, video.isNewInSubscriptionFeed]),
    [['upload', undefined], ['fresh', true], ['watched', false], ['old', false]],
    'without cached collaborations to compare with, the last check tells which are new')
  assert.deepEqual(mergeSubscriptionCollaborations({ ...afterFindingNone, collaborationsCheckedAt: undefined }, found, history)
    .map(video => video.isNewInSubscriptionFeed), [undefined, false, false, false], 'nothing is new on the first check')
})
