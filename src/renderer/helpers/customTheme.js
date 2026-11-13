import {
  CUSTOM_THEME_BLURS,
  CUSTOM_THEME_COLORS,
  customThemeBackdropBlur,
  hexColorToRgbComponents,
  isCustomThemeValue,
  normalizeCustomTheme,
  normalizeCustomThemes,
} from '../../customTheme.js'
import { PALETTE_BASE_THEMES } from '../../constants.js'

import { MATERIAL_COLOR_ROLES, MATERIAL_SYSTEM_SEED, MATERIAL_THEME_VALUES, materialColorProperty, materialThemeMode } from '../../materialTheme.js'
import { DEFAULT_SIGNAL_ACCENT_COLOR, SIGNAL_THEME_VALUES } from '../../signalTheme.js'
import { getMaterialPalette, dynamicColorStyles, dynamicThemeColors, getSystemAccentColor } from './dynamicColors.js'

const STORAGE_KEY = 'opentubex-custom-theme'
let appliedBodyThemeClasses = []

/** Read either system appearance without changing the app's active theme. */
export function getThemeBackground(baseTheme, customThemes, dark, seed) {
  const custom = customThemes.find(theme => `custom:${theme.id}` === baseTheme)
  if (custom) return custom.colors.background
  if (MATERIAL_THEME_VALUES.includes(baseTheme)) {
    const mode = materialThemeMode(baseTheme, dark)
    return dynamicThemeColors(getMaterialPalette(seed, baseTheme), mode !== 'light', mode === 'black').background
  }
  const probe = document.createElement('span')
  probe.hidden = true
  probe.className = baseTheme
  document.body.appendChild(probe)
  try {
    return getComputedStyle(probe).getPropertyValue('--bg-color').trim()
  } finally {
    probe.remove()
  }
}

/** Resolve a theme's primary color as rgb() without applying the theme. */
export function getThemePrimaryColor(baseTheme, mainColor, secColor, customTheme, seed, signalAccent, dark) {
  const { classes, customTheme: customThemeMode, style } = getThemeAppearance(
    baseTheme, mainColor, secColor, customTheme, seed, signalAccent, dark
  )
  const probe = document.createElement('span')
  probe.hidden = true
  probe.classList.add('themeScope', ...classes)
  probe.dataset.systemTheme = dark ? 'dark' : 'light'
  if (customThemeMode) probe.dataset.customTheme = customThemeMode
  for (const [property, value] of Object.entries(style)) probe.style.setProperty(property, value)
  // Resolves color-mix() and relative colors for consumers outside the theme.
  probe.style.color = 'var(--primary-color)'
  document.body.appendChild(probe)
  try {
    return getComputedStyle(probe).color
  } finally {
    probe.remove()
  }
}

/** Resolve the Tally accent setting, following the system accent when requested and available. */
export function resolveSignalAccentColor(value) {
  return value === MATERIAL_SYSTEM_SEED ? getSystemAccentColor() ?? DEFAULT_SIGNAL_ACCENT_COLOR : value
}

/**
 * The classes, custom theme mode, and inline properties that render a theme,
 * so the document and theme previews resolve it the same way.
 */
export function getThemeAppearance(baseTheme, mainColor, secColor, customTheme, seed, signalAccent, dark = window.matchMedia('(prefers-color-scheme: dark)').matches) {
  const dynamic = MATERIAL_THEME_VALUES.includes(baseTheme)
  const mode = materialThemeMode(baseTheme, dark)
  const custom = isCustomThemeValue(baseTheme)
  const themeClass = dynamic ? (mode === 'black' ? 'black' : mode) : custom ? 'custom' : (baseTheme || 'system')
  const classes = [themeClass]
  if (dynamic) classes.push('dynamicColors')
  // Fixed palettes must not inherit selectable accent colors.
  else if (!PALETTE_BASE_THEMES.includes(themeClass)) classes.push(`main${mainColor || 'Red'}`, `sec${secColor || 'Blue'}`)

  /** @type {Record<string, string>} */
  let style = {}
  if (custom && customTheme) {
    for (const [key, property] of CUSTOM_THEME_COLORS) style[property] = customTheme.colors[key]
    for (const [key, property] of CUSTOM_THEME_BLURS) {
      style[property] = customThemeBackdropBlur(customTheme.colors[key], customTheme.blurs[key])
    }
    style['--accent-color-rgb'] = hexColorToRgbComponents(customTheme.colors.accent)
  }
  // Tally themes derive every accent shade from this color in themes.css.
  if (SIGNAL_THEME_VALUES.includes(baseTheme)) style['--signal-accent'] = resolveSignalAccentColor(signalAccent)
  if (dynamic) {
    style = dynamicColorStyles(getMaterialPalette(seed, baseTheme), mode !== 'light', mode === 'black')
  }
  return {
    classes,
    customTheme: custom && customTheme ? (customTheme.isDark ? 'dark' : 'light') : null,
    style,
  }
}

const THEME_STYLE_PROPERTIES = [
  ...CUSTOM_THEME_COLORS.map(([, property]) => property),
  ...CUSTOM_THEME_BLURS.map(([, property]) => property),
  ...MATERIAL_COLOR_ROLES.map(materialColorProperty),
  '--accent-color-rgb',
  '--signal-accent',
]

export function applyThemeToDocument(baseTheme, mainColor, secColor, customTheme, seed, signalAccent) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const { classes, customTheme: customThemeMode, style } = getThemeAppearance(
    baseTheme, mainColor, secColor, customTheme, seed, signalAccent, dark
  )
  document.body.classList.remove(...appliedBodyThemeClasses)
  document.body.classList.add(...classes)
  appliedBodyThemeClasses = classes
  document.body.dataset.systemTheme = dark ? 'dark' : 'light'
  if (customThemeMode) {
    document.body.dataset.customTheme = customThemeMode
  } else {
    delete document.body.dataset.customTheme
  }
  // The custom theme editor previews colors on the body directly, so clear every theme property.
  for (const property of THEME_STYLE_PROPERTIES) document.body.style.removeProperty(property)
  for (const [property, value] of Object.entries(style)) document.body.style.setProperty(property, value)
}

export async function loadCustomThemes() {
  if (process.env.IS_ELECTRON) {
    return normalizeCustomThemes(await window.ftElectron.loadCustomTheme())
  }

  const savedTheme = localStorage.getItem(STORAGE_KEY)
  return savedTheme === null ? [] : normalizeCustomThemes(JSON.parse(savedTheme))
}

export async function saveCustomTheme(theme) {
  const normalizedTheme = normalizeCustomTheme(theme)
  if (process.env.IS_ELECTRON) {
    return normalizeCustomThemes(await window.ftElectron.saveCustomTheme(normalizedTheme))
  }

  const themes = await loadCustomThemes()
  const existingIndex = themes.findIndex(({ id }) => id === normalizedTheme.id)
  if (existingIndex === -1) themes.push(normalizedTheme)
  else themes[existingIndex] = normalizedTheme
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes, null, 2))
  return themes
}

export async function deleteCustomTheme(id) {
  if (process.env.IS_ELECTRON) {
    return normalizeCustomThemes(await window.ftElectron.deleteCustomTheme(id))
  }

  const themes = (await loadCustomThemes()).filter(theme => theme.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes, null, 2))
  return themes
}

/**
 * @param {unknown} themes
 * @param {unknown} expected the themes the caller merged against
 * @returns {Promise<object[] | null>} the saved themes, or `null` if another
 *   window changed them since `expected` and nothing was replaced
 */
export async function replaceCustomThemes(themes, expected) {
  const normalizedThemes = normalizeCustomThemes(themes)
  if (process.env.IS_ELECTRON) {
    const saved = await window.ftElectron.replaceCustomThemes(normalizedThemes, normalizeCustomThemes(expected))
    return saved === null ? null : normalizeCustomThemes(saved)
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedThemes, null, 2))
  return normalizedThemes
}

export function handleCustomThemeUpdated(handler) {
  if (!process.env.IS_ELECTRON) return () => {}
  return window.ftElectron.handleCustomThemeUpdated(themes => handler(normalizeCustomThemes(themes)))
}
