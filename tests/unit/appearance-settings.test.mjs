import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getThemeClassification,
  resolveBaseTheme,
  resolveSystemTheme,
} from '../../src/appearanceSettings.js'

test('invalid appearance choices fall back to their defaults', () => {
  assert.equal(resolveBaseTheme('missing', 'system'), 'system')
  assert.equal(resolveBaseTheme('system', 'light', [], false), 'light')
  assert.equal(resolveBaseTheme('missing', 'dark', [], false), 'dark')
})

test('built-in and available custom appearance choices are retained', () => {
  assert.equal(resolveBaseTheme('solarizedDark', 'system'), 'solarizedDark')
  assert.equal(resolveBaseTheme('custom:paper', 'system', [{ id: 'paper' }]), 'custom:paper')
})

test('themes are classified by their built-in or custom color scheme', () => {
  const customThemes = [
    { id: 'midnight', isDark: true },
    { id: 'paper', isDark: false },
  ]

  assert.equal(getThemeClassification('solarizedLight'), 'light')
  assert.equal(getThemeClassification('solarizedDark'), 'dark')
  assert.equal(getThemeClassification('custom:paper', customThemes), 'light')
  assert.equal(getThemeClassification('custom:midnight', customThemes), 'dark')
  assert.equal(getThemeClassification('missing', customThemes), null)
})

test('system theme choices must match their color scheme', () => {
  const customThemes = [
    { id: 'midnight', isDark: true },
    { id: 'paper', isDark: false },
  ]

  assert.equal(resolveSystemTheme('solarizedLight', 'light'), 'solarizedLight')
  assert.equal(resolveSystemTheme('solarizedDark', 'light'), 'light')
  assert.equal(resolveSystemTheme('custom:paper', 'light', customThemes), 'custom:paper')
  assert.equal(resolveSystemTheme('custom:midnight', 'light', customThemes), 'light')
  assert.equal(resolveSystemTheme('custom:midnight', 'dark', customThemes), 'custom:midnight')
  assert.equal(resolveSystemTheme('custom:paper', 'dark', customThemes), 'dark')
})
