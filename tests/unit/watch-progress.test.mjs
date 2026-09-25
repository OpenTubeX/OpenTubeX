import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { isHistoryEntryWatched } from '../../src/history.js'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'

const source = await readFile(new URL('../../src/renderer/views/Watch/watchHistory.js', import.meta.url), 'utf8')
const methodsSource = source.slice(source.indexOf('export const watchHistoryMethods = ') + 'export const watchHistoryMethods = '.length)
const { _saveWatchProgress, addToHistory } = runInNewContext(`(${methodsSource})`, { isHistoryEntryWatched })

const playerSource = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const seekingHandler = playerSource.slice(playerSource.indexOf('    function handleSeeking()'), playerSource.indexOf('    function handleSeeked()'))

function fixture(existing = true) {
  const element = Object.assign(new EventTarget(), {
    style: {}, volume: 1, muted: false, playbackRate: 1, defaultPlaybackRate: 1, loop: false, pause() {},
  })
  const media = attachAndroidMediaElement(element, {
    command: async () => {}, load: async () => {}, onError: assert.fail, now: () => 0,
  })
  const hasPlaybackPosition = { value: false }
  const handleSeeking = runInNewContext(`${seekingHandler}; handleSeeking`, {
    hasPlaybackPosition, playbackEnded: { value: false }, video: { value: element }, cancelSponsorBlockSkipSchedule() {},
    clearAbRepeatBoundarySchedule() {}, syncPlayPauseControlIcons() {}, emit() {},
  })
  const player = {
    hasLoaded: false, get hasPlaybackPosition() { return hasPlaybackPosition.value },
    getCurrentTime: () => element.currentTime,
  }
  element.addEventListener('seeking', handleSeeking)
  const history = existing ? { watchProgress: 11 * 3600 } : {}
  const view = {
    canSaveWatchProgress: true, isCurrentlyPresented: () => true, hasBeenPresented: true,
    $refs: { player }, isLoading: false, videoId: 'D8P-16SMdlg',
    historyEntryExists: existing, historyEntry: existing ? history : undefined,
    videoTitle: 'Long video', channelName: 'Channel', channelId: 'channel', videoLengthSeconds: 52991,
    addToHistory, updateHistory: payload => Object.assign(history, payload),
    updateWatchProgress: payload => Object.assign(history, payload),
  }
  return { element, media, player, history, view, save: () => _saveWatchProgress.call(view) }
}

for (const target of [0, 4 * 3600, 12 * 3600]) {
  test(`saves a seek to ${target} before the first native segment finishes loading`, () => {
    const f = fixture()
    f.media.update({ duration: 52991, position: 11 * 3600, ready: false, buffering: true })
    f.element.currentTime = target
    f.media.update({ position: 11 * 3600, ready: false, buffering: true })
    assert.equal(f.element.currentTime, target)
    assert.equal(f.player.hasLoaded, false)
    f.save()
    assert.equal(f.history.watchProgress, target)
  })
}

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
  f.save()
  assert.equal(f.history.watchProgress, 14400)
  assert.equal(f.history.title, 'Long video')
  assert.equal(f.history.lengthSeconds, 52991)
  assert.equal(f.history.authorId, 'channel')
  assert.ok(f.history.timeWatched > 0)
})
