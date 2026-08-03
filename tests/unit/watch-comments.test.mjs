import assert from 'node:assert/strict'
import test from 'node:test'

import { areCommentsAvailable } from '../../src/renderer/views/Watch/watchComments.js'

test('shows comments for videos and active premieres but not live streams', () => {
  assert.equal(areCommentsAvailable({ isLive: false, isPremiere: false, hideComments: false }), true)
  assert.equal(areCommentsAvailable({ isLive: true, isPremiere: true, hideComments: false }), true)
  assert.equal(areCommentsAvailable({ isLive: true, isPremiere: false, hideComments: false }), false)
})

test('respects the hide comments preference for premieres', () => {
  assert.equal(areCommentsAvailable({ isLive: true, isPremiere: true, hideComments: true }), false)
})
