import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldAdvanceDockMediaSequence } from '../../src/main/dockMediaSession.js'

test('advances Dock media ownership only for newly owned playback', () => {
  assert.equal(shouldAdvanceDockMediaSequence('playing', true), true)
  assert.equal(shouldAdvanceDockMediaSequence('playing', false), false)
  assert.equal(shouldAdvanceDockMediaSequence('paused', true), false)
})
