import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isCrossTabMiniPlayerOwner,
  markCrossTabMiniPlayerActive,
  markCrossTabMiniPlayerInactive,
  refreshCrossTabMiniPlayer,
  unregisterCrossTabMiniPlayer,
} from '../../src/renderer/helpers/crossTabMiniPlayer.js'

function createCandidate () {
  const calls = []
  let canShow = true

  return {
    calls,
    candidate: {
      canShow: () => canShow,
      hide: () => calls.push('hide'),
      show: () => calls.push('show'),
    },
    setCanShow (value) {
      canShow = value
    },
  }
}

test('only the most recently left video tab owns the cross-tab mini player', () => {
  const first = createCandidate()
  const second = createCandidate()

  markCrossTabMiniPlayerInactive(first.candidate)
  assert.equal(isCrossTabMiniPlayerOwner(first.candidate), true)
  assert.deepEqual(first.calls, ['show'])

  markCrossTabMiniPlayerInactive(second.candidate)
  assert.equal(isCrossTabMiniPlayerOwner(first.candidate), false)
  assert.equal(isCrossTabMiniPlayerOwner(second.candidate), true)
  assert.deepEqual(first.calls, ['show', 'hide'])
  assert.deepEqual(second.calls, ['show'])

  second.setCanShow(false)
  refreshCrossTabMiniPlayer(second.candidate)
  assert.equal(isCrossTabMiniPlayerOwner(second.candidate), false)
  assert.deepEqual(second.calls, ['show', 'hide'])

  second.setCanShow(true)
  refreshCrossTabMiniPlayer(second.candidate)
  assert.equal(isCrossTabMiniPlayerOwner(second.candidate), true)
  assert.deepEqual(second.calls, ['show', 'hide', 'show'])

  markCrossTabMiniPlayerActive(second.candidate)
  assert.equal(isCrossTabMiniPlayerOwner(second.candidate), false)

  unregisterCrossTabMiniPlayer(first.candidate)
  unregisterCrossTabMiniPlayer(second.candidate)
})
