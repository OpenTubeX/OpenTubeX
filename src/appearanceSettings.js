import { DARK_BASE_THEMES, LIGHT_BASE_THEMES } from './constants.js'

const BUILTIN_BASE_THEMES = new Set(['system', ...LIGHT_BASE_THEMES, ...DARK_BASE_THEMES])

function resolveBaseTheme(value, fallback, customThemes = [], allowSystem = true) {
  if (!allowSystem && value === 'system') return fallback
  if (BUILTIN_BASE_THEMES.has(value) || customThemes.some(({ id }) => value === `custom:${id}`)) {
    return value
  }
  return fallback
}

export { resolveBaseTheme }
