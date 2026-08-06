import assert from 'node:assert/strict'
import test from 'node:test'

import { getCenteredChapterScrollTop } from '../../src/renderer/components/WatchVideoChapters/chapterScroll.js'

test('centers a chapter within its scroll container', () => {
  assert.equal(getCenteredChapterScrollTop(1480, 74, 480, 5000), 1277)
  assert.equal(getCenteredChapterScrollTop(200, 80, 400, 5000), 40)
})

test('clamps to the scroll range so the first and last chapters stay fully visible', () => {
  assert.equal(getCenteredChapterScrollTop(0, 74, 480, 2000), 0)
  assert.equal(getCenteredChapterScrollTop(3000, 74, 480, 2000), 2000)
})

test('skips scrolling when the container is not laid out yet', () => {
  assert.equal(getCenteredChapterScrollTop(0, 74, 0, 2000), null)
  assert.equal(getCenteredChapterScrollTop(0, 0, 480, 2000), null)
})
