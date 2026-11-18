import assert from 'node:assert/strict'
import test from 'node:test'

import { getDirectPlayerFallbackReason } from '../../src/renderer/helpers/api/direct-player.js'

const playable = { playabilityStatus: { status: 'OK' }, streamingData: { serverAbrStreamingUrl: 'https://sabr.test' } }

test('a playable direct /player response is used', () => {
  assert.equal(getDirectPlayerFallbackReason(playable), null)
})

test('age-restricted videos keep the direct response for the embedded player fallback', () => {
  assert.equal(getDirectPlayerFallbackReason({
    playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' }
  }), null)
})

for (const [name, response] of [
  ['a bot check', { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }],
  ['missing streaming data', { playabilityStatus: { status: 'OK' } }],
  ['a missing SABR URL', { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [] } }],
]) {
  test(`${name} falls back to the watch page`, () => {
    assert.equal(typeof getDirectPlayerFallbackReason(response), 'string')
  })
}
