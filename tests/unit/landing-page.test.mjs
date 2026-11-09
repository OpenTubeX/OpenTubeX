import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LANDING_PAGE,
  LEGACY_DEFAULT_LANDING_PAGE,
  resolveLandingPage,
} from '../../src/constants.js'

test('falls back to Subscriptions when Home is hidden', () => {
  assert.equal(resolveLandingPage(DEFAULT_LANDING_PAGE, true), LEGACY_DEFAULT_LANDING_PAGE)
})

test('falls back to the first visible navigation page', () => {
  assert.equal(resolveLandingPage('home', ['history', 'subscriptions']), 'history')
})

test('keeps a usable fallback when navigation is empty', () => {
  assert.equal(resolveLandingPage('home', []), LEGACY_DEFAULT_LANDING_PAGE)
})
