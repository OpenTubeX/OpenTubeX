import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldAdvanceDockMediaSequence } from '../../src/main/dockMediaSession.js'

test('advances Dock media ownership only for newly owned playback', () => {
  assert.equal(shouldAdvanceDockMediaSequence(undefined, 'playing', 'first-tab'), true)
  assert.equal(shouldAdvanceDockMediaSequence({
    playbackState: 'playing',
    ownerId: 'first-tab'
  }, 'playing', 'first-tab'), false)
  assert.equal(shouldAdvanceDockMediaSequence({
    playbackState: 'playing',
    ownerId: 'first-tab'
  }, 'playing', 'second-tab'), true)
  assert.equal(shouldAdvanceDockMediaSequence({
    playbackState: 'paused',
    ownerId: 'second-tab'
  }, 'playing', 'second-tab'), true)
})
