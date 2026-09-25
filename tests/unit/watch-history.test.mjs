import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { isHistoryEntryWatched } from '../../src/history.js'
import { buildWatchHistoryEntry, planWatchProgressSave, planWatchedCompletion, shouldKeepHistoryEntryAlive } from '../../src/renderer/views/Watch/watchHistoryPersistence.js'

const source = await readFile(new URL('../../src/renderer/views/Watch/watchHistory.js', import.meta.url), 'utf8')
const methodsSource = source.slice(source.indexOf('export const watchHistoryMethods = ') + 'export const watchHistoryMethods = '.length)
const methods = runInNewContext(`(${methodsSource})`, {
  isHistoryEntryWatched,
  buildWatchHistoryEntry, planWatchProgressSave, planWatchedCompletion, shouldKeepHistoryEntryAlive,
})

test('history retention refreshes an entry without writing disabled progress', () => {
  const entries = []
  const watch = {
    ...methods,
    rememberHistory: true,
    historyRetentionEnabled: true,
    videoPlayerLoaded: true,
    isUpcoming: false,
    isLive: false,
    $refs: { player: { isPaused: () => false } },
    historyLastTouchedAt: 0,
    watchedProgressSavingEnabled: false,
    historyEntry: { watchProgress: 27 },
    videoId: 'video', videoTitle: 'Title', videoLengthSeconds: 60,
    channelName: 'Channel', channelId: 'channel',
    updateHistory: entry => entries.push(entry),
  }

  watch.keepHistoryEntryAlive(48)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].watchProgress, 27)
  assert.equal(entries[0].timeWatched, watch.historyLastTouchedAt)
})

test('finishing marks history watched while preserving progress when saving is disabled', () => {
  const entries = []
  const watch = {
    ...methods,
    rememberHistory: true,
    isUpcoming: false,
    isLive: false,
    $refs: { player: { isPaused: () => true } },
    historyEntry: { watchProgress: 12 },
    watchedProgressSavingEnabled: false,
    videoId: 'video', videoTitle: 'Title', videoLengthSeconds: 60,
    channelName: 'Channel', channelId: 'channel',
    updateHistory: entry => entries.push(entry),
  }

  watch.markAsWatchedIfFinished(60, true)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].isWatched, true)
  assert.equal(entries[0].watchProgress, 12)
})
