import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWatchHistoryEntry,
  planWatchProgressSave,
  planShortCompletion,
  persistWatchTime,
  sampleWatchTime,
} from '../../src/renderer/views/Watch/watchHistoryPersistence.js'

test('history entry keeps offline metadata until channel data resolves', () => {
  const previous = { title: 'Saved title', author: 'Saved author', authorId: 'saved-channel', published: 1234, watchProgress: 5 }
  const entry = buildWatchHistoryEntry({
    historyEntry: previous,
    localFilePlayback: true,
    videoId: 'video',
    videoTitle: 'downloaded-file',
    channelName: '',
    channelId: '',
    videoPublished: 0,
    videoDescription: '',
    videoViewCount: 0,
    videoLengthSeconds: 42,
    isLive: false,
    isUpcoming: false,
  }, 20, true, 1000)
  assert.equal(entry.title, 'Saved title')
  assert.equal(entry.authorId, 'saved-channel')
  assert.equal(entry.watchProgress, 20)
  assert.equal(entry.isWatched, true)
  assert.equal(entry.timeWatched, 1000)
})

test('Short completion requires played content and preserves disabled progress', () => {
  const state = {
    rememberHistory: true,
    customShortsPlayerActive: true,
    shortsPlaybackCompleted: false,
    isUpcoming: false,
    isLive: false,
    videoLengthSeconds: 30,
    playerLoaded: true,
    playerPaused: false,
    reachedEnd: true,
    watchedProgressSavingEnabled: false,
    historyEntry: { watchProgress: 5 },
  }
  assert.equal(planShortCompletion(state), 5)
  assert.equal(planShortCompletion({ ...state, playerPaused: true }), null)
  assert.equal(planShortCompletion({ ...state, reachedEnd: false }), null)
  assert.equal(planShortCompletion({ ...state, watchedProgressSavingEnabled: true }), 30)
})

test('progress plan saves an established seek but ignores an unpresented tab', () => {
  const state = {
    canSaveWatchProgress: true,
    presented: true,
    hasBeenPresented: true,
    playerTeardownInProgress: false,
    hasPlaybackPosition: true,
    watchedProgressSavingEnabled: true,
    shortsPlaybackCompleted: false,
    videoLengthSeconds: 40,
    currentTime: 12,
    historyEntryExists: true,
    videoId: 'video',
  }
  assert.deepEqual(planWatchProgressSave(state), { type: 'progress', videoId: 'video', watchProgress: 12 })
  assert.equal(planWatchProgressSave({ ...state, presented: false }), null)
  assert.equal(planWatchProgressSave({ ...state, hasPlaybackPosition: false }), null)
  assert.deepEqual(planWatchProgressSave({ ...state, historyEntryExists: false }), { type: 'history', watchProgress: 12 })
  assert.deepEqual(planWatchProgressSave({ ...state, shortsPlaybackCompleted: true }), { type: 'progress', videoId: 'video', watchProgress: 40 })
  assert.equal(planWatchProgressSave({ ...state, presented: false, currentTime: () => assert.fail('must not read player') }), null)
})

test('watch-time sampling rejects suspended ticks and flushes after ten seconds', () => {
  const first = sampleWatchTime({ lastTick: null, pendingByDate: {} }, 1000, '2026-09-26')
  assert.equal(first.lastTick, 1000)
  assert.deepEqual(first.pendingByDate, {})
  const second = sampleWatchTime(first, 5000, '2026-09-26')
  assert.equal(second.pendingByDate['2026-09-26'], 4000)
  assert.equal(second.shouldFlush, false)
  const suspended = sampleWatchTime(second, 15001, '2026-09-26')
  assert.equal(suspended.pendingByDate['2026-09-26'], 4000)
  const next = sampleWatchTime(suspended, 20000, '2026-09-26')
  assert.equal(next.pendingByDate['2026-09-26'], 8999)
  const flush = sampleWatchTime(next, 22000, '2026-09-26')
  assert.equal(flush.pendingByDate['2026-09-26'], 10999)
  assert.equal(flush.shouldFlush, true)
})

test('watch-time persistence writes seconds per local calendar day', async () => {
  const records = []
  await persistWatchTime({ '2026-09-25': 1500, '2026-09-26': 12500 }, async record => {
    records.push(record)
  })
  assert.deepEqual(records, [
    { date: '2026-09-25', seconds: 1.5 },
    { date: '2026-09-26', seconds: 12.5 },
  ])
})
