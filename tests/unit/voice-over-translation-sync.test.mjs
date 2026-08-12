import assert from 'node:assert/strict'
import test from 'node:test'

import { getVoiceOverPlaybackRate } from '../../src/renderer/components/ft-shaka-video-player/opentubex/useVoiceOverTranslation.js'

test('corrects ordinary voice-over drift with a bounded playback-rate adjustment', () => {
  assert.equal(getVoiceOverPlaybackRate(2, 0.2), 2.05)
  assert.equal(getVoiceOverPlaybackRate(2, 0.8), 2.1)
  assert.equal(getVoiceOverPlaybackRate(2, -0.8), 1.9)
})

test('measures voice-over drift in wall-clock time at faster playback rates', () => {
  assert.equal(getVoiceOverPlaybackRate(1, 0.8), null)
  assert.equal(getVoiceOverPlaybackRate(2, 0.8), 2.1)
})

test('keeps the selected playback rate while voice-over drift is negligible', () => {
  assert.equal(getVoiceOverPlaybackRate(2, 0.08), 2)
})
