import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { isHistoryEntryWatched } from '../../src/history.js'
import { createWatchTimeTracker } from '../../src/renderer/helpers/watchTimeTracker.js'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const { _saveWatchProgress, addToHistory } = runInNewContext(`({
  ${source.slice(source.indexOf('    _saveWatchProgress()'), source.indexOf('    fetchVideoDislikes:'))}
  ${source.slice(source.indexOf('    addToHistory:'), source.indexOf('    keepHistoryEntryAlive('))}
})`, { isHistoryEntryWatched })

const timestampMethods = runInNewContext(`({
  ${source.slice(source.indexOf('    getWatchedProgress:'), source.indexOf('    getPlaylistState:'))}
})`)

test('receiver buffering resets watched-time accounting without changing pause state', () => {
  let now = Date.now()
  const { isPlaybackPaused } = runInNewContext(`({
    ${source.slice(source.indexOf('    isPlaybackPaused()'), source.indexOf('    handleChromecastState('))}
  })`)
  const view = { isPlaybackPaused, chromecastStatus: { paused: false, buffering: false } }
  const tracker = createWatchTimeTracker(
    () => !view.isPlaybackPaused() && !view.chromecastStatus?.buffering,
    async () => {},
    () => now
  )
  tracker.track()
  now += 1000
  tracker.track()
  assert.equal(tracker.pendingMilliseconds, 1000)
  view.chromecastStatus.buffering = true
  assert.equal(view.isPlaybackPaused(), false)
  for (let i = 0; i < 6; i++) {
    now += 1000
    tracker.track()
    assert.equal(tracker.lastTick, null)
    assert.equal(tracker.pendingMilliseconds, 1000)
  }
  view.chromecastStatus.buffering = false
  now += 1000
  tracker.track()
  assert.equal(tracker.pendingMilliseconds, 1000, 'Resuming does not count the stalled interval')
  now += 1000
  tracker.track()
  assert.equal(tracker.pendingMilliseconds, 2000)
  view.chromecastStatus.paused = true
  now += 1000
  tracker.track()
  assert.equal(tracker.pendingMilliseconds, 2000)
  assert.equal(tracker.lastTick, null)
})

test('watch time ignores delayed ticks and records pending seconds per day', async () => {
  let now = new Date(2026, 9, 20, 12).getTime()
  const recorded = []
  const tracker = createWatchTimeTracker(() => true, async (date, seconds) => { recorded.push([date, seconds]) }, () => now)
  tracker.track()
  now += 6000
  tracker.track()
  assert.equal(tracker.pendingMilliseconds, 0, 'A suspended timer does not count as playback')
  for (let i = 0; i < 9; i++) {
    now += 1000
    tracker.track()
  }
  assert.deepEqual(recorded, [])
  now += 1000
  tracker.track()
  assert.deepEqual(recorded, [['2026-10-20', 10]], 'Ten seconds of playback flush automatically')
  now += 2500
  tracker.track()
  await tracker.flush()
  assert.deepEqual(recorded, [['2026-10-20', 10], ['2026-10-20', 2.5]])
  assert.equal(tracker.pendingMilliseconds, 0)
  assert.equal(tracker.lastTick, null)
})

test('failed watch-time writes stay pending and retry without counting the time again', async () => {
  let now = new Date(2026, 9, 20, 12).getTime()
  let fails = true
  const calls = []
  const tracker = createWatchTimeTracker(() => true, async (date, seconds, retry) => {
    calls.push([date, seconds, retry])
    return !fails
  }, () => now)
  tracker.track()
  now += 3000
  tracker.track()
  await tracker.flush()
  assert.deepEqual(calls, [['2026-10-20', 3, false]])
  assert.equal(tracker.pendingMilliseconds, 3000, 'A failed write keeps its seconds')

  fails = false
  tracker.track()
  now += 2000
  tracker.track()
  await tracker.flush()
  assert.deepEqual(calls.slice(1), [['2026-10-20', 2, false], ['2026-10-20', 3, true]],
    'New time counts once and the failed batch is only written again')
  assert.equal(tracker.pendingMilliseconds, 0)

  fails = true
  tracker.track()
  now += 1000
  tracker.track()
  const write = tracker.flush()
  tracker.clear()
  await write
  assert.equal(tracker.pendingMilliseconds, 0, 'Time cleared during a failed write is not restored')
})

test('timestamp actions use the active receiver position and return to local playback', () => {
  const view = {
    ...timestampMethods,
    isLoading: false,
    chromecastActive: true,
    chromecastStatus: { currentTime: 28.75 },
    $refs: { player: { hasLoaded: true, getCurrentTime: () => 5.5 } },
  }
  assert.equal(view.getWatchedProgress(), 28.75)
  assert.equal(view.getTimestamp(), 28)
  view.chromecastStatus = { currentTime: 0 }
  assert.equal(view.getTimestamp(), 0)
  view.chromecastActive = false
  view.chromecastStatus = null
  assert.equal(view.getWatchedProgress(), 5.5)
  assert.equal(view.getTimestamp(), 5)
  view.isLoading = true
  assert.equal(view.getTimestamp(), 0)
})

const playerSource = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const seekingHandler = playerSource.slice(playerSource.indexOf('    function isEndSeekPosition()'), playerSource.indexOf('    function handleSeeked()'))

function fixture(existing = true) {
  const element = Object.assign(new EventTarget(), {
    currentTime: 11 * 3600,
  })
  const hasPlaybackPosition = { value: false }
  const handleSeeking = runInNewContext(`${seekingHandler}; handleSeeking`, {
    hasPlaybackPosition,
    playbackEnded: { value: false },
    shortsNavigationSuspended: { value: false },
    endSeekTarget: null,
    video: { value: element },
    cancelSponsorBlockSkipSchedule() {},
    handleAbRepeatSeeking() {},
    sleepTimer: { checkChapterBoundary() {} },
    syncPlayPauseControlIcons() {},
    emit() {},
  })
  const player = {
    hasLoaded: false,
    get hasPlaybackPosition() { return hasPlaybackPosition.value },
    getCurrentTime: () => element.currentTime,
  }
  element.addEventListener('seeking', handleSeeking)
  const history = existing ? { watchProgress: 11 * 3600 } : {}
  const view = {
    canSaveWatchProgress: true,
    isCurrentlyPresented: () => true,
    hasBeenPresented: true,
    $refs: { player },
    isLoading: false,
    videoId: 'D8P-16SMdlg',
    historyEntryExists: existing,
    historyEntry: existing ? history : undefined,
    videoTitle: 'Long video',
    channelName: 'Channel',
    channelId: 'channel',
    videoLengthSeconds: 52991,
    addToHistory,
    updateHistory: payload => Object.assign(history, payload),
    updateWatchProgress: payload => Object.assign(history, payload),
  }
  return { element, player, history, view, save: () => _saveWatchProgress.call(view) }
}

test('saves a seek to 0 before the player finishes loading', () => {
  const f = fixture()
  f.element.currentTime = 0
  f.element.dispatchEvent(new Event('seeking'))
  assert.equal(f.element.currentTime, 0)
  assert.equal(f.player.hasLoaded, false)
  f.save()
  assert.equal(f.history.watchProgress, 0)
})

test('leaving before any playback position is established preserves saved progress', () => {
  const f = fixture()
  f.save()
  assert.equal(f.history.watchProgress, 11 * 3600)
  f.player.hasLoaded = true
  f.save()
  assert.equal(f.history.watchProgress, 11 * 3600)
})

for (const reason of ['teardown', 'background', 'never presented', 'not ready']) {
  test(`does not save a pending seek during ${reason}`, () => {
    const f = fixture()
    f.element.currentTime = 4 * 3600
    if (reason === 'teardown') f.view.playerTeardownInProgress = true
    if (reason === 'background') f.view.isCurrentlyPresented = () => false
    if (reason === 'never presented') f.view.hasBeenPresented = false
    if (reason === 'not ready') f.view.canSaveWatchProgress = false
    f.save()
    assert.equal(f.history.watchProgress, 11 * 3600)
  })
}
test('a seek before the first load creates a complete new history entry', () => {
  const f = fixture(false)
  f.element.currentTime = 14400
  f.element.dispatchEvent(new Event('seeking'))
  f.save()
  assert.equal(f.history.watchProgress, 14400)
  assert.equal(f.history.title, 'Long video')
  assert.equal(f.history.lengthSeconds, 52991)
  assert.equal(f.history.authorId, 'channel')
  assert.ok(f.history.timeWatched > 0)
})

test('late /next metadata replaces the /player metadata once the first history write lands', async () => {
  const { refreshHistoryMetadata } = runInNewContext(`({
    ${source.slice(source.indexOf('    refreshHistoryMetadata:'), source.indexOf('    addToHistory:'))}
  })`)
  const history = new Map()
  let finishFirstWrite
  const view = {
    refreshHistoryMetadata,
    addToHistory,
    isCurrentVideoLoad: () => true,
    get historyEntry() { return history.get(this.videoId) },
    get historyEntryExists() { return history.has(this.videoId) },
    updateHistory: async record => { history.set(record.videoId, record) },
    videoId: 'aaaaaaaaaaa',
    videoTitle: '/next title',
    videoLengthSeconds: 60,
    channelId: 'channel',
    // Started at a timestamp, while the store had no entry yet
    firstHistoryWrite: new Promise(resolve => { finishFirstWrite = resolve }),
  }

  const refresh = view.refreshHistoryMetadata(1, view.videoId)
  history.set(view.videoId, { videoId: view.videoId, title: '/player title', watchProgress: 42 })
  finishFirstWrite()
  await refresh
  assert.equal(history.get(view.videoId).title, '/next title')
  assert.equal(history.get(view.videoId).watchProgress, 42)
})
