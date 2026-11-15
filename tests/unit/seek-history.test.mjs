import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed } from 'vue'

import {
  EMPTY_SEEK_HISTORY,
  SEEK_HISTORY_MIN_JUMP_SECONDS,
  clearSeekHistories,
  getSeekHistory,
  recordSeekHistoryJump,
  setSeekHistory,
  stepSeekHistoryBack,
  stepSeekHistoryForward,
} from '../../src/renderer/helpers/player/seekHistory.js'

/** @param {import('../../src/renderer/helpers/player/seekHistory.js').SeekHistory} history */
const positionsOf = history => history.entries.map(({ position }) => position)
/** @param {import('../../src/renderer/helpers/player/seekHistory.js').SeekHistory} history */
const summarize = history => ({ positions: positionsOf(history), index: history.index })

test('returns to the position before an accidental jump and forward again', () => {
  const history = recordSeekHistoryJump(EMPTY_SEEK_HISTORY, 120)

  const back = stepSeekHistoryBack(history, 600)
  assert.equal(back.target, 120)
  assert.deepEqual(summarize(back.history), { positions: [120, 600], index: 0 })
  assert.equal(stepSeekHistoryBack(back.history, 125), null)

  const forward = stepSeekHistoryForward(back.history, 130)
  assert.equal(forward.target, 600)
  assert.deepEqual(summarize(forward.history), { positions: [130, 600], index: 1 })
  assert.equal(stepSeekHistoryForward(forward.history, 610), null)
})

test('keeps newer entries when jumping elsewhere after stepping back', () => {
  let history = recordSeekHistoryJump(EMPTY_SEEK_HISTORY, 60)
  history = recordSeekHistoryJump(history, 300)
  history = stepSeekHistoryBack(history, 900).history
  history = stepSeekHistoryBack(history, 310).history
  assert.deepEqual(summarize(history), { positions: [60, 310, 900], index: 0 })

  // The revisited entry moves to the end with the position it was left at.
  history = recordSeekHistoryJump(history, 90)
  assert.deepEqual(summarize(history), { positions: [310, 900, 90], index: 3 })

  const back = stepSeekHistoryBack(history, 1200)
  assert.equal(back.target, 90)
  assert.deepEqual(positionsOf(back.history), [310, 900, 90, 1200])
})

test('treats nearby positions as the same place', () => {
  let history = recordSeekHistoryJump(EMPTY_SEEK_HISTORY, 100)
  history = recordSeekHistoryJump(history, 400)
  history = recordSeekHistoryJump(history, 103)
  assert.deepEqual(summarize(history), { positions: [400, 103], index: 2 })

  // Stepping back from a recorded place skips over it.
  const back = stepSeekHistoryBack(history, 105)
  assert.equal(back.target, 400)
  assert.deepEqual(summarize(back.history), { positions: [400, 105], index: 0 })
})

test('shares a video\'s history between the players showing it', () => {
  const first = computed(() => getSeekHistory('shared-video'))
  const second = computed(() => getSeekHistory('shared-video'))
  assert.equal(second.value, EMPTY_SEEK_HISTORY)

  setSeekHistory('shared-video', recordSeekHistoryJump(first.value, 30))
  setSeekHistory('shared-video', recordSeekHistoryJump(second.value, 300))
  assert.deepEqual(positionsOf(first.value), [30, 300])
  clearSeekHistories()
  assert.equal(second.value, EMPTY_SEEK_HISTORY)
})

const playerSource = readFileSync(new URL('../../src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', import.meta.url), 'utf8')

function recorder() {
  const state = {
    now: 0,
    dragging: false,
    mobileMiniBarSeeking: { value: false },
    performance: { now: () => state.now },
    ui: { getControls: () => ({ isSeeking: () => state.dragging }) },
    video: { value: { currentTime: 100 } },
    seekHistoryAvailable: { value: true },
    seekHistoryKey: { value: 'video' },
    seekHistory: { value: EMPTY_SEEK_HISTORY },
    seekHistoryJump: null,
    SEEK_HISTORY_JUMP_WINDOW_MS: 1000,
    SEEK_HISTORY_MIN_JUMP_SECONDS,
    recordSeekHistoryJump,
    setSeekHistory(_key, history) { state.seekHistory.value = history },
  }
  const functions = ['updateSeekHistory', 'noteSeekHistoryJump'].map(name => {
    const match = playerSource.match(new RegExp(`^function ${name}\\([^]*?\\n}`, 'm'))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const { noteSeekHistoryJump } = vm.runInNewContext(`${functions}\n({ noteSeekHistoryJump })`, state)
  const seek = (target, after = 0) => {
    state.now += after
    noteSeekHistoryJump(target)
    state.video.value.currentTime = target
  }
  return { state, seek, positions: () => positionsOf(state.seekHistory.value) }
}

test('records where a jump started once it leaves that place', () => {
  const { seek, positions } = recorder()

  seek(110)
  assert.deepEqual(positions(), [])

  // Quick repeated presses add up to one jump from the first position.
  seek(120, 300)
  assert.deepEqual(positions(), [100])
  seek(130, 300)
  assert.deepEqual(positions(), [100])

  seek(200, 1500)
  assert.deepEqual(positions(), [100, 130])
})

test('holding the seek bar still continues the same jump', () => {
  const { state, seek, positions } = recorder()

  state.dragging = true
  seek(105)
  seek(150, 3000)
  state.dragging = false
  assert.deepEqual(positions(), [100])
})

test('holding the mobile mini bar still continues the same jump', () => {
  const { state, seek, positions } = recorder()

  state.mobileMiniBarSeeking.value = true
  seek(105)
  seek(150, 3000)
  state.mobileMiniBarSeeking.value = false
  assert.deepEqual(positions(), [100])
})

test('SponsorBlock draft jumps are the viewer\'s own seeks', async () => {
  const submissionSource = readFileSync(new URL('../../src/renderer/components/FtShakaVideoPlayer/opentubex/useSponsorBlockSubmission.js', import.meta.url), 'utf8')
  const match = submissionSource.match(/ {2}async function previewSponsorBlockDraft\([^]*?\n {2}}/)
  assert.ok(match, 'missing previewSponsorBlockDraft')

  for (const [mode, point] of [['inspect', false], ['end', false], ['preview', false], ['preview', true]]) {
    const seeks = []
    const previewSponsorBlockDraft = vm.runInNewContext(`(${match[0].trim()})`, {
      sponsorBlockDraftSegments: { value: [{ id: 'draft', startTime: 100, endTime: 160, actionType: point ? 'poi' : 'skip' }] },
      sponsorBlockCurrentTime: { value: 0 },
      sponsorBlockPreviewSkipSegment: { value: null },
      sponsorBlockSubmissionError: { value: '' },
      video: { value: { playbackRate: 1, play: async () => {} } },
      SPONSORBLOCK_PREVIEW_SECONDS: 3,
      canSeek: () => true,
      saveSponsorBlockDraft: async () => true,
      isSponsorBlockPointSegment: () => point,
      setCurrentTime: (time, recordSeekHistory) => seeks.push(recordSeekHistory),
      stopSponsorBlockPreviewSkip() {},
      startSponsorBlockPreviewSkipMonitor() {},
      replaceSponsorBlockDraftSegment() {},
      persistSponsorBlockDrafts: async () => {},
      showOverlayControls() {},
      console,
    })
    await previewSponsorBlockDraft('draft', mode)
    assert.deepEqual(seeks, [true], `${mode}${point ? ' point' : ''}`)
  }
})
