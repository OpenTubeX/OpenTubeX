import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { computed, effectScope, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { getRecentRecommendationHistory, recommendationSubscriptionIds } from '../../src/renderer/helpers/recommendations.js'
import { mergeRecommendationCandidates } from '../../src/renderer/helpers/recommendationCandidates.js'

const source = (await readFile(new URL('../../src/renderer/composables/useHomeRecommendations.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export function ', 'function ')

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
  const state = reactive({ recommendations: { recommendationRecords: Object.fromEntries(records.map(record => [record.videoId, record])) } })
  const getters = reactive({
    getEnableHomeRecommendations: true,
    getRememberHistory: true,
    getHistoryCacheSorted: [{ videoId: 'watched', title: 'Linux desktop', timeWatched: Date.now() }],
    getHistoryCacheById: {},
    getAllPlaylists: [],
    getPlaylist: () => null,
    getActiveProfile: { subscriptions: [] },
    getRecommendationEpoch: 'epoch',
    getRecommendationExploration: 0.2,
    getVideoCache: {},
    get getRecommendationRecords() { return Object.values(state.recommendations.recommendationRecords) },
  })
  const store = {
    state, getters,
    async dispatch(type, { video }) {
      assert.equal(type, 'recordRecommendationEvent')
      state.recommendations.recommendationRecords[video.videoId] = { ...video, impressions: [Date.now()] }
    },
  }
  const cleanups = []
  const dependencies = {
    computed, ref, shallowRef, toRaw, watch, store,
    onBeforeUnmount: callback => cleanups.push(callback),
    useTabContext: () => ({}),
    getRecentRecommendationHistory, recommendationSubscriptionIds, mergeRecommendationCandidates,
    isVideoHiddenByPreferences: () => false,
    shouldHideMembersOnlyContent: () => false,
    buildRecommendationProfileAsync: async () => ({ channels: [], channelWeights: new Map(), evidence: new Map() }),
    rankRecommendationCandidatesAsync: async videos => videos.map(video => ({ video, reason: { type: 'topic', text: 'Linux' } })),
    collectRecommendationCandidates: async () => ({ videos: candidates, failedSources: 0 }),
    requestAnimationFrame: callback => setTimeout(callback, 0),
  }
  const useHomeRecommendations = compileFunction(`${source}\nreturn useHomeRecommendations`, Object.keys(dependencies))(...Object.values(dependencies))
  const scope = effectScope()
  try {
    const feed = scope.run(() => useHomeRecommendations(computed(() => true)))
    for (let index = 0; index < 100 && feed.recommendations.value.length === 0; index++) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
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
    cleanups.forEach(callback => callback())
    scope.stop()
  }
})
