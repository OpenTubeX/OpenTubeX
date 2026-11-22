import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAvailableFullscreenActions,
  normalizeFullscreenActions,
} from '../../src/renderer/helpers/fullscreenActions.js'

test('keeps a custom order or an empty selection and discards invalid entries', () => {
  assert.deepEqual(normalizeFullscreenActions(['share', null, 'comments', 'share', 'unknown', 1]), ['share', 'comments'])
  assert.deepEqual(normalizeFullscreenActions([]), [])
  assert.deepEqual(normalizeFullscreenActions(['download', 'recommendations']), ['download', 'recommendations'])
})

test('unavailable actions leave no gaps and return in the selected order', () => {
  const selected = ['liveChat', 'share', 'comments', 'transcript']
  assert.deepEqual(getAvailableFullscreenActions(selected, { share: true, comments: true }), ['share', 'comments'])
  assert.deepEqual(getAvailableFullscreenActions(selected, { liveChat: true, share: true }), ['liveChat', 'share'])
  assert.deepEqual(getAvailableFullscreenActions(selected, {}), [])
  assert.deepEqual(selected, ['liveChat', 'share', 'comments', 'transcript'])
})
