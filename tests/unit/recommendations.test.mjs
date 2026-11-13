import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRecommendationProfile, rankRecommendations, scoreRecommendationCandidates } from '../../src/renderer/helpers/recommendations.js'
const DAY = 86400000
const now = Date.UTC(2026, 8, 6)
const watched = (videoId, extra = {}) => ({ videoId, title: 'Linux desktop customization', authorId: 'linux', author: 'Linux channel', lengthSeconds: 600, watchProgress: 500, timeWatched: now, type: 'video', ...extra })
const video = (videoId, extra = {}) => ({ videoId, title: 'Linux desktop shortcuts', authorId: 'new-channel', type: 'video', ...extra })
const options = { now }
const profile = (history, extra = {}) => buildRecommendationProfile(history, { ...options, ...extra })
const rank = (candidates, history, extra = {}) => rankRecommendations(candidates, history, { ...options, ...extra })
const ids = list => list.map(video => video.videoId)

test('empty or malformed history does not invent interests', () => {
  for (const history of [null, [], [null, {}, false], 'invalid']) {
    assert.deepEqual(profile(history).channels, [])
    assert.deepEqual(rank([video('candidate')], history), [])
  }
})
test('uses at most 1000 recent history videos but excludes every history ID', () => {
  const history = [watched('old', { authorId: 'old', timeWatched: now - DAY }), ...Array.from({ length: 1000 }, (_, i) => watched(`recent${i}`))]
  assert.deepEqual(profile(history).channels, ['linux'])
  assert.deepEqual(rank([video('old'), video('unseen')], history).map(v => v.videoId), ['unseen'])
})
test('saved videos remain eligible to watch, while every history entry is excluded', () => {
  assert.equal(rank([video('saved')], [], { saved: [watched('saved')] }).length, 1)
  assert.deepEqual(rank([video('partial'), video('complete'), video('new')], [watched('partial', { watchProgress: 1 }), watched('complete', { isWatched: true })]).map(v => v.videoId), ['new'])
})
test('dismissal excludes the video and penalizes similar topics without blocking unrelated interests', () => {
  const history = [watched('linux'), watched('food', { title: 'Sourdough bread baking', authorId: 'food' })]
  const linux = video('linux-new')
  const food = video('food-new', { title: 'Sourdough bread starter', authorId: 'baker' })
  const records = [{ ...video('dismissed'), feedback: 'dismiss', feedbackAt: now }]
  const before = scoreRecommendationCandidates([linux], profile(history), options)[0].score
  const after = scoreRecommendationCandidates([linux], profile(history, { records }), options)[0].score
  assert.ok(after < before / 2)
  assert.equal(rank([linux, food, video('dismissed')], history, { records })[0].videoId, 'food-new')
})
test('more-like-this feedback creates a persistent interest and a related seed', () => {
  const records = [{ ...video('liked', { title: 'Sourdough bread baking' }), feedback: 'positive', feedbackAt: now }]
  const p = profile([], { records })
  assert.ok(p.hasInterests)
  assert.equal(p.seeds[0].videoId, 'liked')
  assert.equal(rank([video('bread', { title: 'Sourdough starter maintenance' })], [], { records }).length, 1)
})
test('hide-channel feedback excludes all of that channel, including related candidates', () => {
  const records = [{ ...video('blocked'), feedback: 'blockChannel', feedbackAt: now }]
  assert.deepEqual(rank([video('other', { recommendationSources: [{ type: 'related', id: 'seed' }] })], [watched('seed')], { records }), [])
})
test('appended recommendations count the shown feed toward channel caps and duplicate titles', () => {
  const history = [watched('seed'), watched('second-seed', { authorId: 'second' })]
  const kept = [...Array.from({ length: 3 }, (_, i) => video(`shown${i}`, { title: '', authorId: 'linux' })), video('shown-title'), video('shown-short', { title: 'Linux', authorId: 'third' })]
  const candidates = [
    kept[4],
    ...Array.from({ length: 4 }, (_, i) => video(`linux${i}`, { title: '', authorId: 'linux' })),
    ...Array.from({ length: 2 }, (_, i) => video(`second${i}`, { title: '', authorId: 'second' })),
    video('duplicate', { authorId: 'second' }),
  ]
  assert.deepEqual(ids(rank(candidates, history, { kept, limit: 24 })).sort(), ['second0', 'second1'])
  assert.equal(rank(candidates, history, { kept, limit: kept.length + 1 }).length, 1)
})
test('subscriptions provide a cold-start feed without inventing unrelated interests', () => {
  assert.deepEqual(ids(rank([video('sub', { authorId: 'subscribed' }), video('other')], [], { subscriptions: [{ id: 'subscribed' }] })), ['sub'])
})
test('invalid candidates and future dates cannot poison ranking; inputs are not mutated', () => {
  const history = [watched('seed')]
  const candidate = video('result')
  const before = structuredClone({ history, candidate })
  assert.equal(rank([null, {}, { videoId: 7 }, { ...candidate, type: 'playlist' }, candidate], history)[0], candidate)
  assert.deepEqual(rank([candidate], history, { limit: 0 }), [])
  assert.deepEqual({ history, candidate }, before)
  assert.deepEqual(profile([watched('seed', { timeWatched: now + DAY })]).channelWeights, profile(history).channelWeights)
})

test('handles a diverse thousand-video vocabulary without exceeding argument limits', () => {
  const word = n => `topic${n.toString(36).replace(/\d/g, digit => String.fromCharCode(103 + Number(digit)))}`
  const history = Array.from({ length: 1000 }, (_, i) => watched(`seed${i}`, {
    title: Array.from({ length: 80 }, (_, j) => word(i * 240 + j)).join(' '),
    description: Array.from({ length: 80 }, (_, j) => word(i * 240 + 80 + j)).join(' '),
    keywords: Array.from({ length: 80 }, (_, j) => word(i * 240 + 160 + j)),
  }))
  assert.ok(profile(history).interests.size > 100000)
})

test('ignores malformed subscriptions while retaining channel strings and objects', () => {
  for (const subscriptions of [null, {}, 'channel']) {
    assert.deepEqual([...profile([], { subscriptions }).subscriptions], [])
  }
  const subscriptions = [null, undefined, {}, false, 42, { id: null }, '', 'string-channel', { id: 'object-channel' }]
  assert.deepEqual([...profile([], { subscriptions }).subscriptions], ['string-channel', 'object-channel'])
})
