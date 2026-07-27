import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveSponsorBlockEnterTarget,
  resolveSponsorBlockEnterTargets
} from '../../src/renderer/helpers/player/sponsorBlockShortcut.js'

test('does nothing when no SponsorBlock UI is on screen', () => {
  assert.equal(resolveSponsorBlockEnterTarget(false, false, false), null)
  assert.deepEqual(resolveSponsorBlockEnterTargets(false, false, false), [])
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

test('offers the remaining targets as fallbacks in priority order', () => {
  assert.deepEqual(resolveSponsorBlockEnterTargets(true, true, true), ['prompt', 'toast', 'highlight'])
  assert.deepEqual(resolveSponsorBlockEnterTargets(false, true, true), ['toast', 'highlight'])
  assert.deepEqual(resolveSponsorBlockEnterTargets(true, false, true), ['prompt', 'highlight'])
})

test('only offers targets that are actually on screen', () => {
  assert.deepEqual(resolveSponsorBlockEnterTargets(false, false, true), ['highlight'])
  assert.deepEqual(resolveSponsorBlockEnterTargets(false, true, false), ['toast'])
  assert.deepEqual(resolveSponsorBlockEnterTargets(true, false, false), ['prompt'])
})
