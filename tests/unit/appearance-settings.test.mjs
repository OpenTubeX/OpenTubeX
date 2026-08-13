import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveBaseTheme } from '../../src/appearanceSettings.js'

test('invalid appearance choices fall back to their defaults', () => {
  assert.equal(resolveBaseTheme('missing', 'system'), 'system')
  assert.equal(resolveBaseTheme('system', 'light', [], false), 'light')
  assert.equal(resolveBaseTheme('missing', 'dark', [], false), 'dark')
})

test('built-in and available custom appearance choices are retained', () => {
  assert.equal(resolveBaseTheme('solarizedDark', 'system'), 'solarizedDark')
  assert.equal(resolveBaseTheme('custom:paper', 'system', [{ id: 'paper' }]), 'custom:paper')
})
