import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LANDING_PAGE,
  LEGACY_DEFAULT_LANDING_PAGE,
  resolveLandingPage,
} from '../../src/constants.js'

test('uses Home as the current default landing page', () => {
  assert.equal(DEFAULT_LANDING_PAGE, 'home')
})

test('falls back to Subscriptions when Home is hidden', () => {
  assert.equal(resolveLandingPage(DEFAULT_LANDING_PAGE, true), LEGACY_DEFAULT_LANDING_PAGE)
})

test('keeps another configured landing page when Home is hidden', () => {
  assert.equal(resolveLandingPage('history', true), 'history')
})

test('falls back to the first visible navigation page', () => {
  assert.equal(resolveLandingPage('home', ['history', 'subscriptions']), 'history')
})

test('keeps a landing page that remains in navigation', () => {
  assert.equal(resolveLandingPage('history', ['subscriptions', 'history']), 'history')
})

test('keeps a usable fallback when navigation is empty', () => {
  assert.equal(resolveLandingPage('home', []), LEGACY_DEFAULT_LANDING_PAGE)
})
