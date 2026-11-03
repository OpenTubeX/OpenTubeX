import { MATERIAL_SYSTEM_SEED } from './materialTheme.js'

/** Persisted IDs of the Signal themes, which match the website's palette. */
export const SIGNAL_THEME_VALUES = ['openTubeXLight', 'openTubeXDark']
export const DEFAULT_SIGNAL_ACCENT_COLOR = '#f34132'

export function normalizeSignalAccentColor(value) {
  if (value === MATERIAL_SYSTEM_SEED) return value
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_SIGNAL_ACCENT_COLOR
}

export const SIGNAL_ACCENT_PRESETS = [
  { name: 'Red', color: DEFAULT_SIGNAL_ACCENT_COLOR },
  { name: 'Orange', color: '#f97316' },
  { name: 'Amber', color: '#f59e0b' },
  { name: 'Green', color: '#22c55e' },
  { name: 'Teal', color: '#2ec4b6' },
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Pink', color: '#ec4899' },
]
