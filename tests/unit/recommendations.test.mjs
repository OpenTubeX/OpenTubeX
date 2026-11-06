import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRecommendationProfile, rankRecommendationCandidatesAsync, rankRecommendations, scoreRecommendationCandidates, recommendationTokens } from '../../src/renderer/helpers/recommendations.js'
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
test('duplicate history imports do not amplify preferences', () => {
  const first = watched('first')
  const second = watched('second', { title: 'Sourdough bread baking', authorId: 'food' })
  const once = profile([first, second])
  const repeated = profile([first, first, first, second])
  assert.deepEqual(repeated.channelWeights, once.channelWeights)
  assert.deepEqual(repeated.interests, once.interests)
})
test('recent engagement beats stale channel frequency', () => {
  const history = [watched('recent'), ...[1, 2, 3].map(i => watched(`old${i}`, { authorId: 'old', timeWatched: now - 90 * DAY }))]
  assert.ok(profile(history).channelWeights.get('linux') > profile(history).channelWeights.get('old'))
  const firstChannels = Array.from({ length: 100 }, (_, round) => profile(history, { round }).channels[0])
  assert.ok(firstChannels.filter(channel => channel === 'linux').length > 60)
})
test('watching more of a video strengthens its channel preference', () => {
  const p = profile([watched('strong'), watched('weak', { authorId: 'weak', watchProgress: 5 })])
  assert.ok(p.channelWeights.get('linux') > p.channelWeights.get('weak'))
})
test('actual playback observations override a seekable resume position', () => {
  const history = [watched('seeked'), watched('watched', { authorId: 'other' })]
  const p = profile(history, { records: [{ ...watched('seeked'), lastWatchSeconds: 3, watchedAt: now }] })
  assert.ok(p.channelWeights.get('linux') < p.channelWeights.get('other'))
  assert.ok(!p.seeds.some(seed => seed.videoId === 'seeked'))
})
test('related seeds require meaningful engagement and spread across interests', () => {
  const history = [watched('linux1'), watched('linux2'), watched('linux3'), watched('food', { title: 'Sourdough bread baking', authorId: 'food' }), watched('brief', { watchProgress: 1 })]
  const seeds = profile(history).seeds
  assert.equal(seeds.length, 4)
  assert.ok(seeds.slice(0, 2).some(seed => seed.videoId === 'food'))
  assert.ok(!seeds.some(seed => seed.videoId === 'brief'))
})
test('favorites and saved videos build interests without watch history', () => {
  for (const key of ['favorites', 'saved']) {
    const p = profile([], { [key]: [watched('saved')] })
    assert.ok(p.hasInterests)
    assert.equal(p.seeds[0].videoId, 'saved')
    assert.ok(rank([video('new')], [], { [key]: [watched('saved')] }).length > 0)
  }
})
test('saved videos remain eligible to watch, while every history entry is excluded', () => {
  assert.equal(rank([video('saved')], [], { saved: [watched('saved')] }).length, 1)
  assert.deepEqual(rank([video('partial'), video('complete'), video('new')], [watched('partial', { watchProgress: 1 }), watched('complete', { isWatched: true })]).map(v => v.videoId), ['new'])
})
test('related-video evidence discovers a new channel without any shared title words', () => {
  const history = [watched('seed')]
  const graph = video('graph', { title: 'A tour of KDE Plasma', recommendationSources: [{ type: 'related', id: 'seed' }] })
  const unrelated = video('unrelated', { title: 'Sourdough bread baking' })
  assert.deepEqual(ids(rank([unrelated, graph], history)), ['graph'])
  assert.equal(scoreRecommendationCandidates([graph], profile(history), options)[0].reason.type, 'related')
  assert.deepEqual(rank([{ ...graph, recommendationSources: [{ type: 'related', id: 'untrusted' }] }], history), [])
})
test('descriptions and keywords supply additional interest evidence', () => {
  const history = [watched('seed', { title: 'My daily workflow', description: 'Linux customization and desktop configuration', keywords: ['KDE', 'Plasma'] })]
  assert.equal(rank([video('result', { title: 'KDE Plasma widgets' })], history).length, 1)
})
test('Unicode segmentation supports CJK and avoids substring matches', () => {
  assert.ok(recommendationTokens('日本の料理').length > 0)
  assert.ok(recommendationTokens('한국 요리').length > 0)
  assert.deepEqual(rank([video('wrong', { title: 'Linuxlike desktops' })], [watched('seed', { title: 'Linux customization' })]), [])
  assert.equal(rank([video('right', { title: '料理の基本' })], [watched('seed', { title: '日本の料理' })]).length, 1)
})
test('English and German stopwords do not create discovery queries', () => {
  assert.deepEqual(profile([watched('seed', { title: 'the and oder und das die 1234' })]).queries, [])
  assert.ok(profile([watched('seed')]).queries.every(query => query.split(' ').length === 2))
})
test('discovery searches and topic reasons favor distinctive words over generic or channel words', () => {
  const generic = ['honest review', 'ultimate guide', 'beginners tutorial']
  const subjects = ['sourdough bread', 'sicilian najdorf', 'tubeless tires', 'lydian mode', 'server rack', 'smash burger', 'disc brakes', 'queens gambit']
  const history = Array.from({ length: 48 }, (_, i) => watched(`topic${i}`, {
    title: `${generic[i % 3]} ${subjects[i % 8]}${i % 2 ? ' | Topic Weekly' : ''}`, author: 'Topic Weekly', authorId: `channel${i % 8}`, timeWatched: now - i * DAY,
  }))
  const generalWords = new Set(['honest', 'review', 'ultimate', 'guide', 'beginners', 'tutorial', 'topic', 'weekly'])
  for (let round = 0; round < 10; round++) {
    const queries = profile(history, { round }).queries
    const words = queries.flatMap(query => query.split(' '))
    assert.equal(queries.length, 3)
    assert.ok(!words.some(word => generalWords.has(word)), queries.join(', '))
    assert.equal(new Set(words).size, words.length)
  }
  // A channel named after its topic still yields a search when no other words remain.
  assert.deepEqual(profile([watched('seed', { title: 'Linux desktop', author: 'Linux Desktop Channel' })]).queries, ['linux desktop'])
  for (const keywords of [[], ['review']]) {
    const [item] = scoreRecommendationCandidates([video('candidate', { title: 'Honest review: sourdough starter', keywords })], profile(history), options)
    assert.deepEqual(item.reason, { type: 'topic', text: 'sourdough' })
  }
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
test('repeated ignored impressions reduce rank and recover with time', () => {
  const candidate = video('seen')
  const history = [watched('seed')]
  const score = records => scoreRecommendationCandidates([candidate], profile(history, { records }), options)[0].score
  const fresh = score([])
  const recent = score([{ ...candidate, impressions: [now - 1000, now - 2000, now - 3000] }])
  const old = score([{ ...candidate, impressions: [now - 30 * DAY] }])
  assert.ok(recent < fresh / 3)
  assert.ok(old > recent)
})
test('short-term interests adapt without erasing long-term topics', () => {
  const p = profile([watched('old', { title: 'Sourdough bread baking', authorId: 'baker', timeWatched: now - 20 * DAY }), watched('new')])
  assert.ok(p.interests.get('sourdough') > 0)
  assert.ok(p.session.get('linux') > p.session.get('sourdough') * 100)
})
test('diversity caps channels and suppresses duplicate titles across channels', () => {
  const history = [watched('seed')]
  const duplicates = [video('a'), video('b', { authorId: 'second' })]
  assert.equal(rank(duplicates, history).length, 1)
  const candidates = Array.from({ length: 12 }, (_, i) => video(`candidate${i}`, { title: '', authorId: i < 8 ? 'linux' : 'second' }))
  const result = rank(candidates, [watched('seed'), watched('second-seed', { authorId: 'second' })])
  assert.equal(result.filter(video => video.authorId === 'linux').length, 3)
  assert.equal(result.filter(video => video.authorId === 'second').length, 3)
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
test('async ranking accepts omitted options', async () => {
  assert.deepEqual(await rankRecommendationCandidatesAsync([], profile([watched('seed')])), [])
})
test('exploration rewards relevant unfamiliar channels without admitting unrelated content', () => {
  const history = [watched('seed')]
  const candidate = video('discovery')
  const p = profile(history)
  const familiar = scoreRecommendationCandidates([candidate], p, { now, exploration: 0 })[0].score
  const explore = scoreRecommendationCandidates([candidate], p, { now, exploration: 0.5 })[0].score
  assert.ok(explore > familiar)
  assert.deepEqual(rank([video('random', { title: 'Celebrity gossip' })], history, { exploration: 0.5 }), [])
})
test('seed rotation opens additional discovery sources on later refreshes', () => {
  const history = Array.from({ length: 12 }, (_, i) => watched(`seed${i}`, { authorId: `channel${i}` }))
  assert.notDeepEqual(profile(history, { round: 0 }).channels, profile(history, { round: 3 }).channels)
  assert.notDeepEqual(profile(history, { round: 0 }).seeds, profile(history, { round: 4 }).seeds)
})
test('refreshes sample seeds and channels from the whole history instead of the most recent watches', () => {
  const history = Array.from({ length: 300 }, (_, i) => watched(`seed${i}`, { title: `Topic${i} explained`, authorId: `channel${i % 60}`, timeWatched: now - i * DAY / 2 }))
  const profiles = Array.from({ length: 30 }, (_, round) => profile(history, { round }))
  const seeds = profiles.flatMap(p => p.seeds.map(seed => Number(seed.videoId.slice(4))))
  assert.ok(new Set(seeds).size > seeds.length * 0.7)
  assert.ok(seeds.filter(index => index >= 24).length > seeds.length / 2)
  assert.ok(seeds.filter(index => index < 120).length > seeds.length / 2)
  assert.ok(new Set(profiles.flatMap(p => p.channels)).size > 30)
})
test('old favorites fade instead of monopolizing seeds and channels', () => {
  const history = Array.from({ length: 12 }, (_, i) => watched(`watched${i}`, { title: `Topic${i} explained`, authorId: `channel${i}`, timeWatched: now - i * DAY }))
  const favorites = Array.from({ length: 12 }, (_, i) => watched(`favorite${i}`, { title: `Clip${i} highlights`, authorId: `favorite${i % 6}`, timeAdded: now - 365 * DAY }))
  const profiles = Array.from({ length: 20 }, (_, round) => profile(history, { round, favorites }))
  const seeds = profiles.flatMap(p => p.seeds.map(seed => seed.videoId))
  const channels = profiles.flatMap(p => p.channels)
  assert.ok(seeds.filter(id => id.startsWith('favorite')).length < seeds.length / 2)
  assert.ok(channels.filter(id => id.startsWith('favorite')).length < channels.length / 2)
  const favoriteWeight = timeAdded => profile([watched('watched')], { favorites: [watched('favorite', { authorId: 'saved', timeAdded })] }).channelWeights.get('saved')
  assert.ok(favoriteWeight(now - 365 * DAY) < favoriteWeight(now) / 2)
  assert.ok(favoriteWeight(now - 365 * DAY) > 0)
  const liked = watched('liked', { authorId: 'liked', timeAdded: now - 365 * DAY })
  const likedWeight = profile([watched('watched')], { favorites: [liked], records: [{ ...liked, feedback: 'positive', feedbackAt: now - 365 * DAY }] }).channelWeights.get('liked')
  assert.ok(likedWeight >= favoriteWeight(now - 365 * DAY))
})
test('related videos keep graph evidence after their seed rotates out', () => {
  const history = Array.from({ length: 40 }, (_, i) => watched(`seed${i}`, { title: `Topic${i} explained`, authorId: `channel${i}` }))
  const p = profile(history)
  const earlier = history.find(entry => !p.seeds.some(seed => seed.videoId === entry.videoId))
  const candidate = video('graph', { title: 'Unrelated vocabulary', recommendationSources: [{ type: 'related', id: earlier.videoId }] })
  const [item] = scoreRecommendationCandidates([candidate], p, options)
  assert.ok(item.graphAffinity > 0)
  assert.deepEqual(item.reason, { type: 'related', text: earlier.title })
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

test('a brief played recommendation is weaker negative evidence than explicit rejection', () => {
  const history = [watched('seed')]
  const candidate = video('other')
  const skipped = { ...video('skipped'), clickedAt: now - 120000, watchedAt: now - 120000, lastWatchSeconds: 5, lengthSeconds: 600 }
  const rejected = { ...skipped, feedback: 'dismiss', feedbackAt: now - 120000 }
  const score = records => scoreRecommendationCandidates([candidate], profile(history, { records }), options)[0].score
  assert.ok(score([skipped]) > score([rejected]) * 2)
  assert.ok(score([skipped]) < score([]))
})


test('positive feedback makes a briefly watched older video a fresh strong seed', () => {
  const entry = watched('brief', { watchProgress: 2, timeWatched: now - 100 * DAY })
  const p = profile([entry], { records: [{ ...entry, feedback: 'positive', feedbackAt: now }] })
  assert.equal(p.seeds[0]?.videoId, 'brief')
  assert.equal(p.seeds[0]?.weight, 1)
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
