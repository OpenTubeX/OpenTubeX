import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CHAPTER_RESTART_THRESHOLD_SECONDS, getChapterNavigationTarget } from '../../src/renderer/helpers/player/chapterNavigation.js'
import { getTwoFingerTapPoint, isTwoFingerDoubleTap, TWO_FINGER_TAP_SLOP } from '../../src/renderer/helpers/player/twoFingerTap.js'

const chapters = [{ startSeconds: 0 }, { startSeconds: 60 }, { startSeconds: 120 }]

test('next and previous follow the playback time and stop at the first and last chapters', () => {
  assert.equal(getChapterNavigationTarget(chapters, 70, 'next'), 2)
  assert.equal(getChapterNavigationTarget(chapters, 130, 'next'), null)
  assert.equal(getChapterNavigationTarget(chapters, 70, 'previous'), 0)
  assert.equal(getChapterNavigationTarget(chapters, 10, 'previous'), null)
  assert.equal(getChapterNavigationTarget([], 0, 'next'), null)
  // A seek to a chapter start can report a time just before it.
  assert.equal(getChapterNavigationTarget(chapters, 59.999999, 'next'), 2)
  assert.equal(getChapterNavigationTarget(chapters, 59.96, 'next'), 1)
  // Before the first chapter starts, next goes to it.
  assert.equal(getChapterNavigationTarget([{ startSeconds: 5 }], 1, 'next'), 0)
  assert.equal(getChapterNavigationTarget([{ startSeconds: 5 }], 1, 'restart'), null)
})

test('restart returns to the current chapter, or the previous one near its start', () => {
  assert.equal(getChapterNavigationTarget(chapters, 60 + CHAPTER_RESTART_THRESHOLD_SECONDS, 'restart'), 1)
  assert.equal(getChapterNavigationTarget(chapters, 60 + CHAPTER_RESTART_THRESHOLD_SECONDS - 0.01, 'restart'), 0)
  // A restart lands exactly on the start, so repeating it steps back.
  assert.equal(getChapterNavigationTarget(chapters, 60, 'restart'), 0)
  assert.equal(getChapterNavigationTarget(chapters, 1, 'restart'), 0)
})

test('two touches that stay within the slop and lift quickly are a tap at their centroid', () => {
  const touch = (startX, maxDistance = 0) => ({ startX, startY: 100, maxDistance })
  assert.deepEqual(getTwoFingerTapPoint([touch(300), touch(360, TWO_FINGER_TAP_SLOP)], 200), { x: 330, y: 100 })
  assert.equal(getTwoFingerTapPoint([touch(300), touch(360, TWO_FINGER_TAP_SLOP + 0.5)], 200), null)
  assert.equal(getTwoFingerTapPoint([touch(300), touch(360)], 451), null)
  assert.equal(getTwoFingerTapPoint([touch(300)], 100), null)
  assert.equal(getTwoFingerTapPoint([touch(300), touch(330), touch(360)], 100), null)
})

test('a double tap needs a second tap on the same side soon after the first', () => {
  assert.equal(isTwoFingerDoubleTap({ direction: 1, endTime: 100 }, { direction: 1, startTime: 450 }), true)
  assert.equal(isTwoFingerDoubleTap({ direction: 1, endTime: 100 }, { direction: 1, startTime: 451 }), false)
  assert.equal(isTwoFingerDoubleTap({ direction: 1, endTime: 100 }, { direction: -1, startTime: 200 }), false)
  assert.equal(isTwoFingerDoubleTap({ direction: 0, endTime: 100 }, { direction: 0, startTime: 200 }), false)
  assert.equal(isTwoFingerDoubleTap(null, { direction: 1, startTime: 200 }), false)
})
