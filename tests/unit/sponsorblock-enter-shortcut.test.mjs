import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSponsorBlockEnterTarget } from '../../src/renderer/helpers/player/sponsorBlockShortcut.js'

test('does nothing when no SponsorBlock UI is on screen', () => {
  assert.equal(resolveSponsorBlockEnterTarget(false, false, false), null)
})

test('skips to the highlight when it is the only thing on screen', () => {
  assert.equal(resolveSponsorBlockEnterTarget(false, false, true), 'highlight')
})

test('prefers a skipped-segment toast over the highlight button', () => {
  assert.equal(resolveSponsorBlockEnterTarget(false, true, true), 'toast')
})

test('prefers a skip prompt over the highlight button', () => {
  assert.equal(resolveSponsorBlockEnterTarget(true, false, true), 'prompt')
})

test('prefers a skip prompt over both other targets', () => {
  assert.equal(resolveSponsorBlockEnterTarget(true, true, true), 'prompt')
})
