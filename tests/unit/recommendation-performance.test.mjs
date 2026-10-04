import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRecommendationProfile,
  buildRecommendationProfileAsync,
  diversifyRecommendations,
  getRecentRecommendationHistory,
  rankRecommendationCandidatesAsync,
  scoreRecommendationCandidates,
} from '../../src/renderer/helpers/recommendations.js'
import { runCooperatively } from '../../src/renderer/helpers/cooperativeTask.js'

const now = Date.UTC(2026, 9, 4)
const history = Array.from({ length: 1000 }, (_, index) => ({
  videoId: `video-${index}`,
  title: `Linux desktop configuration ${index}`,
  description: 'KDE Plasma widgets and keyboard shortcuts',
  authorId: `channel-${index % 20}`,
  watchProgress: 400,
  lengthSeconds: 600,
  timeWatched: now - index * 1000,
}))

test('cooperative learning and ranking preserve the synchronous algorithm', async () => {
  let timerRan = false
  const timer = setTimeout(() => { timerRan = true }, 0)
  const options = { now, round: 2, exploration: 0.3, limit: 24 }
  const asyncProfile = await buildRecommendationProfileAsync(history, options)
  assert.equal(timerRan, true, 'learning must give the event loop time to run')
  clearTimeout(timer)
  const profile = buildRecommendationProfile(history, options)
  const fields = Object.keys(profile).filter(key => key !== 'vectorFor')
  for (const key of fields) assert.deepEqual(asyncProfile[key], profile[key], key)
  const candidates = history.slice(0, 50).map((video, index) => ({
    ...video, videoId: `candidate-${index}`, title: `${video.title} shortcuts`,
  }))
  assert.deepEqual(
    await rankRecommendationCandidatesAsync(candidates, asyncProfile, options),
    diversifyRecommendations(scoreRecommendationCandidates(candidates, profile, options), options),
  )
})

test('cooperative work stops promptly when the page cancels it', async () => {
  let cancelled = false
  let processed = 0
  function * work() {
    while (processed < 1000000) {
      processed++
      yield
    }
    return processed
  }
  setTimeout(() => { cancelled = true }, 0)
  assert.equal(await runCooperatively(work(), () => cancelled), null)
  assert.ok(processed < 1000000)
})

test('recent learning stops at the existing 1000 eligible records rather than scanning the whole library', () => {
  let visits = 0
  const library = [...history, ...Array.from({ length: 44000 }, (_, index) => ({ videoId: `old-${index}` }))]
  const recent = getRecentRecommendationHistory(library, () => { visits++; return true })
  assert.deepEqual(recent, history)
  assert.equal(visits, 1000)
  assert.deepEqual(getRecentRecommendationHistory([null, {}, ...history], video => video.authorId !== 'channel-0', 2), [history[1], history[2]])
})
