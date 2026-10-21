import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import {
  EMPTY_SEEK_HISTORY,
  SEEK_HISTORY_MAX_ENTRIES,
  SEEK_HISTORY_MIN_JUMP_SECONDS,
  clearSeekHistories,
  getSeekHistory,
  recordSeekHistoryJump,
  setSeekHistory,
  stepSeekHistoryBack,
  stepSeekHistoryForward,
} from '../../src/renderer/helpers/player/seekHistory.js'

test('returns to the position before an accidental jump and forward again', () => {
  const history = recordSeekHistoryJump(EMPTY_SEEK_HISTORY, 120)

  const back = stepSeekHistoryBack(history, 600)
  assert.equal(back.target, 120)
  assert.deepEqual(back.history, { positions: [120, 600], index: 0 })
  assert.equal(stepSeekHistoryBack(back.history, 125), null)

  const forward = stepSeekHistoryForward(back.history, 130)
  assert.equal(forward.target, 600)
  assert.deepEqual(forward.history, { positions: [130, 600], index: 1 })
  assert.equal(stepSeekHistoryForward(forward.history, 610), null)
})

test('has nothing to step to without jumps', () => {
  assert.equal(stepSeekHistoryBack(EMPTY_SEEK_HISTORY, 30), null)
  assert.equal(stepSeekHistoryForward(EMPTY_SEEK_HISTORY, 30), null)
})

test('keeps newer entries when jumping elsewhere after stepping back', () => {
  let history = recordSeekHistoryJump(EMPTY_SEEK_HISTORY, 60)
  history = recordSeekHistoryJump(history, 300)
  history = stepSeekHistoryBack(history, 900).history
  history = stepSeekHistoryBack(history, 310).history
  assert.deepEqual(history, { positions: [60, 310, 900], index: 0 })

  // The revisited entry moves to the end with the position it was left at.
  history = recordSeekHistoryJump(history, 90)
  assert.deepEqual(history, { positions: [310, 900, 90], index: 3 })

  const back = stepSeekHistoryBack(history, 1200)
  assert.equal(back.target, 90)
  assert.deepEqual(back.history.positions, [310, 900, 90, 1200])
})

test('treats nearby positions as the same place', () => {
  let history = recordSeekHistoryJump(EMPTY_SEEK_HISTORY, 100)
  history = recordSeekHistoryJump(history, 400)
  history = recordSeekHistoryJump(history, 103)
  assert.deepEqual(history, { positions: [400, 103], index: 2 })

  // Stepping back from a recorded place skips over it.
  const back = stepSeekHistoryBack(history, 105)
  assert.equal(back.target, 400)
  assert.deepEqual(back.history, { positions: [400, 105], index: 0 })
})

test('drops the oldest entries beyond the limit', () => {
  let history = EMPTY_SEEK_HISTORY
  for (let index = 0; index <= SEEK_HISTORY_MAX_ENTRIES; index++) {
    history = recordSeekHistoryJump(history, index * 60)
  }

  assert.equal(history.positions.length, SEEK_HISTORY_MAX_ENTRIES)
  assert.equal(history.positions[0], 60)
  assert.equal(history.index, SEEK_HISTORY_MAX_ENTRIES)
})

test('stores histories per video', () => {
  const history = recordSeekHistoryJump(EMPTY_SEEK_HISTORY, 42)
  setSeekHistory('first-video', history)

  assert.equal(getSeekHistory('first-video'), history)
  assert.equal(getSeekHistory('second-video'), EMPTY_SEEK_HISTORY)

  setSeekHistory('first-video', EMPTY_SEEK_HISTORY)
  assert.equal(getSeekHistory('first-video'), EMPTY_SEEK_HISTORY)

  setSeekHistory('first-video', history)
  setSeekHistory('second-video', history)
  clearSeekHistories()
  assert.equal(getSeekHistory('first-video'), EMPTY_SEEK_HISTORY)
  assert.equal(getSeekHistory('second-video'), EMPTY_SEEK_HISTORY)
})

const playerSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

function recorder() {
  const state = {
    now: 0,
    dragging: false,
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
    setSeekHistory() {},
  }
  const functions = ['updateSeekHistory', 'noteSeekHistoryJump'].map(name => {
    const match = playerSource.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const { noteSeekHistoryJump } = vm.runInNewContext(`${functions}\n({ noteSeekHistoryJump })`, state)
  const seek = (target, after = 0) => {
    state.now += after
    noteSeekHistoryJump(target)
    state.video.value.currentTime = target
  }
  return { state, seek, positions: () => state.seekHistory.value.positions }
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

test('does not record while seeking is unavailable', () => {
  const { state, seek, positions } = recorder()

  state.seekHistoryAvailable.value = false
  seek(300)
  assert.deepEqual(positions(), [])
})
