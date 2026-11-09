import assert from 'node:assert/strict'
import test from 'node:test'

import { getVoiceOverPlaybackRate } from '../../src/renderer/components/ft-shaka-video-player/opentubex/useVoiceOverTranslation.js'

test('corrects ordinary voice-over drift with a bounded playback-rate adjustment', () => {
  assert.equal(getVoiceOverPlaybackRate(2, 0.2), 2.05)
  assert.equal(getVoiceOverPlaybackRate(2, 0.8), 2.1)
  assert.equal(getVoiceOverPlaybackRate(2, -0.8), 1.9)
})
