import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getThemeClassification,
  hasFixedThemeColors,
  resolveBaseTheme,
  resolveSystemTheme,
} from '../../src/appearanceSettings.js'

test('palette themes survive setting repair and work as system theme choices', () => {
  const light = ['tokyoNightDay']
  for (const theme of ['tokyoNightDay', 'catppuccinMacchiato']) {
    const classification = light.includes(theme) ? 'light' : 'dark'
    assert.equal(resolveBaseTheme(theme, 'system'), theme)
    assert.equal(getThemeClassification(theme), classification)
    assert.equal(resolveSystemTheme(theme, classification), theme)
    assert.equal(hasFixedThemeColors(theme), theme !== 'catppuccinMacchiato')
  }
})

test('invalid appearance choices fall back to their defaults', () => {
  assert.equal(resolveBaseTheme('missing', 'system'), 'system')
  assert.equal(resolveBaseTheme('system', 'light', [], false), 'light')
  assert.equal(resolveBaseTheme('missing', 'dark', [], false), 'dark')
})

test('built-in and available custom appearance choices are retained', () => {
  assert.equal(resolveBaseTheme('solarizedDark', 'system'), 'solarizedDark')
  assert.equal(resolveBaseTheme('custom:paper', 'system', [{ id: 'paper' }]), 'custom:paper')
})
