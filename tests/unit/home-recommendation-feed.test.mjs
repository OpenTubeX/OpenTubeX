import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { computed, effectScope, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { getRecommendationLearningEntries, recommendationSubscriptionIds } from '../../src/renderer/helpers/recommendations.js'
import { runCooperatively } from '../../src/renderer/helpers/cooperativeTask.js'
import { mergeRecommendationCandidates } from '../../src/renderer/helpers/recommendationCandidates.js'
import { shouldHideMembersOnlyContent } from '../../src/renderer/helpers/restricted-playback.js'

const subscriptionsSource = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
const visibilityStart = subscriptionsSource.indexOf('export function isVideoHiddenByPreferences(')
const visibilitySource = subscriptionsSource.slice(visibilityStart, subscriptionsSource.indexOf('\n}\n', visibilityStart) + 2)
const isVideoHiddenByPreferences = compileFunction(`${visibilitySource.replace('export ', '')}\nreturn isVideoHiddenByPreferences`,
  ['isUpcomingPremiere'])(() => false)

const source = (await readFile(new URL('../../src/renderer/composables/useHomeRecommendations.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export function ', 'function ')

function createFeed({ records = [], candidates = [], playlists = [], settings = {}, buildProfile = async () => ({ channels: [], channelWeights: new Map(), evidence: new Map() }) } = {}) {
  const state = reactive({ recommendations: { recommendationRecords: Object.fromEntries(records.map(record => [record.videoId, record])) } })
  const getters = reactive({
    getEnableHomeRecommendations: true,
    getRememberHistory: true,
    getHistoryCacheSorted: [{ videoId: 'watched', title: 'Linux desktop', timeWatched: Date.now() }],
    getHistoryCacheById: {},
    getAllPlaylists: playlists,
    getPlaylist: id => playlists.find(playlist => playlist._id === id),
    getActiveProfile: { subscriptions: [] },
    getRecommendationEpoch: 'epoch',
    getRecommendationExploration: 0.2,
    getVideoCache: {},
    ...settings,
    get getRecommendationRecords() { return Object.values(state.recommendations.recommendationRecords) },
  })
  const store = {
    state, getters,
    async dispatch(type, { video }) {
      assert.equal(type, 'recordRecommendationEvent')
      state.recommendations.recommendationRecords[video.videoId] = { ...video, impressions: [Date.now()] }
    },
  }
  let cleanups = []
  const work = { profiles: 0, rankings: 0, requests: 0 }
  const dependencies = {
    computed, ref, shallowRef, toRaw, watch, store, runCooperatively,
    onBeforeUnmount: callback => cleanups.push(callback),
    useTabContext: () => ({}),
    getRecommendationLearningEntries, recommendationSubscriptionIds, mergeRecommendationCandidates,
    isVideoHiddenByPreferences,
    shouldHideMembersOnlyContent: (membersOnly, getters) => shouldHideMembersOnlyContent(membersOnly, getters, true),
    buildRecommendationProfileAsync: async (...args) => { work.profiles++; return buildProfile(...args) },
    rankRecommendationCandidatesAsync: async (videos, profile, { limit }) => {
      work.rankings++
      return videos.slice(0, limit).map(video => ({ video, reason: { type: 'topic', text: 'Linux' } }))
    },
    collectRecommendationCandidates: async () => { work.requests++; return { videos: candidates, failedSources: 0 } },
    requestAnimationFrame: callback => setTimeout(callback, 0),
  }
  const useHomeRecommendations = compileFunction(`${source}\nreturn useHomeRecommendations`, Object.keys(dependencies))(...Object.values(dependencies))
  function mount() {
    cleanups = []
    const scope = effectScope()
    const feed = scope.run(() => useHomeRecommendations(computed(() => true)))
    const unmountCallbacks = cleanups
    return {
      feed, state, getters, work, mount,
      stop() { unmountCallbacks.forEach(callback => callback()); scope.stop() },
    }
  }
  return mount()
}

async function waitForFeed(feed) {
  for (let index = 0; index < 100 && feed.isLoading.value; index++) {
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  assert.equal(feed.isLoading.value, false)
}

test('revisiting Home restores the completed feed immediately without fetching or ranking again', async () => {
  const first = createFeed({ candidates: Array.from({ length: 60 }, (_, index) => ({ videoId: `candidate-${index}` })) })
  await waitForFeed(first.feed)
  await first.feed.loadMore()
  const original = first.feed.recommendations.value
  assert.equal(original.length, 48)
  const previousWork = { ...first.work }
  first.stop()

  const second = first.mount()
  try {
    assert.equal(second.feed.isLoading.value, false)
    assert.deepEqual(second.feed.recommendations.value, original)
    await waitForFeed(second.feed)
    assert.deepEqual(second.work, previousWork)
    await second.feed.refresh()
    assert.equal(second.work.requests, previousWork.requests + 1)
    assert.equal(second.feed.recommendations.value.length, 24)
  } finally {
    second.stop()
  }
})

for (const [setting, value] of [
  ['getRecommendationEpoch', 'changed'],
  ['getBackendPreference', 'invidious'],
]) {
  test(`revisiting Home refreshes instead of restoring an obsolete feed after ${setting} changes`, async () => {
    const first = createFeed({ candidates: [{ videoId: 'candidate' }] })
    await waitForFeed(first.feed)
    first.stop()
    first.getters[setting] = value
    const second = first.mount()
    try {
      assert.equal(second.feed.isLoading.value, true)
      await waitForFeed(second.feed)
      assert.equal(second.work.requests, 2)
    } finally {
      second.stop()
    }
  })
}

for (const { name, settings, updated, candidate } of [
  { name: 'live streams', settings: { getHideLiveStreams: true }, updated: { getHideLiveStreams: false }, candidate: { liveNow: true } },
  { name: 'hidden channels', settings: { getActiveChannelsHiddenNames: new Set(['hidden']) }, updated: { getActiveChannelsHiddenNames: new Set() }, candidate: { authorId: 'hidden' } },
  { name: 'forbidden titles', settings: { getActiveForbiddenTitles: ['hidden subject'] }, updated: { getActiveForbiddenTitles: [] }, candidate: { title: 'Hidden subject' } },
  { name: 'membership authentication', settings: { getYtDlpPlaybackAuthMode: 'none' }, updated: { getYtDlpPlaybackAuthMode: 'file', getYtDlpPlaybackCookiesPath: '/fixture/cookies.txt' }, candidate: { isMembersOnly: true } },
]) {
  test(`revisiting Home reranks cached candidates after changing ${name}`, async () => {
    const first = createFeed({ settings, candidates: [{ videoId: 'normal' }, { videoId: 'filtered', ...candidate }] })
    await waitForFeed(first.feed)
    assert.deepEqual(first.feed.recommendations.value.map(video => video.videoId), ['normal'])
    first.stop()
    Object.assign(first.getters, updated)
    const second = first.mount()
    try {
      await waitForFeed(second.feed)
      assert.deepEqual(second.feed.recommendations.value.map(video => video.videoId), ['normal', 'filtered'])
      assert.equal(second.work.requests, 1)
      assert.equal(second.work.rankings, 2)
    } finally {
      second.stop()
    }
  })
}

for (const [setting, value] of [['getRecommendationExploration', 0.5], ['getEnableBlockLists', true]]) {
  test(`revisiting Home reranks cached candidates after ${setting} changes`, async () => {
    const first = createFeed({ candidates: [{ videoId: 'candidate' }] })
    await waitForFeed(first.feed)
    first.stop()
    first.getters[setting] = value
    const second = first.mount()
    try {
      await waitForFeed(second.feed)
      assert.equal(second.work.requests, 1)
      assert.equal(second.work.rankings, 2)
    } finally {
      second.stop()
    }
  })
}

test('revisiting Home refreshes expired feeds', async t => {
  const first = createFeed({ candidates: [{ videoId: 'candidate' }] })
  await waitForFeed(first.feed)
  first.stop()
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 16 * 60 * 1000)
  const second = first.mount()
  try {
    assert.equal(second.feed.isLoading.value, true)
    await waitForFeed(second.feed)
    assert.equal(second.work.requests, 2)
  } finally {
    second.stop()
  }
})

// Exercise the composable's real computed feed and impression path. Candidate
// fetching/ranking is fixed so this isolates feedback lookup work, not timings.
test('impressions preserve the feed and check channel feedback once per record rather than once per card', async () => {
  let feedbackReads = 0
  const candidates = Array.from({ length: 24 }, (_, index) => ({ videoId: `candidate-${index}`, authorId: `channel-${index}` }))
  const records = Array.from({ length: 850 }, (_, index) => ({
    videoId: `feedback-${index}`,
    authorId: `old-channel-${index}`,
    get feedback() { feedbackReads++; return undefined },
  }))
  const { feed, state, stop } = createFeed({ records, candidates })
  try {
    await waitForFeed(feed)
    assert.equal(feed.recommendations.value.length, 24)
    const before = feed.recommendations.value
    feedbackReads = 0
    feed.recordImpression(before[0], true, { target: { closest: () => null } })
    const after = feed.recommendations.value
    assert.ok(feedbackReads <= 850, `expected one feedback pass, got ${feedbackReads} reads`)
    assert.equal(after, before)
    state.recommendations.recommendationRecords.blocked = {
      videoId: 'blocked', authorId: candidates[0].authorId, feedback: 'blockChannel',
    }
    assert.equal(feed.recommendations.value.length, 23)
    assert.ok(!feed.recommendations.value.some(video => video.authorId === candidates[0].authorId))
  } finally {
    stop()
  }
})

test('Home selects and snapshots only the existing saved and favorite learning budgets', async () => {
  const reads = { favorites: 0, saved: 0 }
  const videos = type => Array.from({ length: 45000 }, (_, index) => ({
    videoId: `${type}-${index}`, title: 'Linux desktop',
    get description() { reads[type]++; return 'KDE Plasma' },
  }))
  const playlists = [{ _id: 'favorites', videos: videos('favorites') }, { _id: 'saved', videos: videos('saved') }]
  let built = false
  const { feed, stop, mount, work } = createFeed({
    playlists,
    buildProfile: async (history, { favorites, saved }) => {
      built = true
      assert.equal(favorites.length, 500)
      assert.equal(saved.length, 500)
      assert.equal(favorites[499].videoId, 'favorites-499')
      assert.equal(saved[499].videoId, 'saved-499')
      return { channels: [], channelWeights: new Map(), evidence: new Map() }
    },
  })
  try {
    await waitForFeed(feed)
    assert.equal(built, true)
    assert.deepEqual(reads, { favorites: 500, saved: 500 })
  } finally {
    stop()
  }
  const previousWork = { ...work }
  const reopened = mount()
  try {
    assert.equal(reopened.feed.isLoading.value, false)
    assert.deepEqual(reopened.work, previousWork)
    assert.deepEqual(reads, { favorites: 500, saved: 500 })
  } finally {
    reopened.stop()
  }
})
