import assert from 'node:assert/strict'
import test from 'node:test'

import { resetSabrSessionState } from '../../src/renderer/helpers/player/sabrSession.js'

test('a format switch starts a fresh SABR session', () => {
  const state = {
    sabrUrl: 'https://example.invalid/sabr',
    activeSabrContextTypes: new Set([1]),
    sabrContexts: new Map([[1, { value: 'stale' }]]),
    nextRequestPolicy: { backoffTimeMs: 2_000 },
    playerReloadRequested: true,
    requestNumber: 42
  }

  resetSabrSessionState(state)

  assert.equal(state.sabrUrl, 'https://example.invalid/sabr')
  assert.equal(state.activeSabrContextTypes.size, 0)
  assert.equal(state.sabrContexts.size, 0)
  assert.equal(state.nextRequestPolicy, undefined)
  assert.equal(state.playerReloadRequested, false)
  assert.equal(state.requestNumber, 0)
})
