import { DynamicScheme, Hct, SchemeTonalSpot, TonalPalette, argbFromHex, argbFromRgb, hexFromArgb } from '@material/material-color-utilities'

export const DEFAULT_MATERIAL_SEED_COLOR = '#6750a4'
export const MATERIAL_THEME_VALUES = ['dynamic', 'materialLight', 'materialDark', 'materialBlack']
/** Seed value that makes the fixed Material variants follow the system palette. */
export const MATERIAL_SYSTEM_SEED = 'system'

export function normalizeSystemAccentColor(value) {
  if (typeof value !== 'string') return null
  const hex = value.replace(/^#/, '')
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) || hex.slice(6).toLowerCase() === '00') return null
  return `#${hex.slice(0, 6).toLowerCase()}`
}

function normalizeMaterialSeedHex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_MATERIAL_SEED_COLOR
}

export function normalizeMaterialSeedColor(value) {
  return value === MATERIAL_SYSTEM_SEED ? value : normalizeMaterialSeedHex(value)
}

export function materialThemeMode(theme, systemDark) {
  return theme === 'materialBlack'
    ? 'black'
    : theme === 'materialLight'
      ? 'light'
      : theme === 'materialDark' || systemDark ? 'dark' : 'light'
}

/** Android resource shade numbers run in the opposite direction to HCT tones. */
export function materialSeedPalette(seed) {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(normalizeMaterialSeedHex(seed))), false, 0)
  return Object.fromEntries([
    ['accent1', scheme.primaryPalette], ['accent2', scheme.secondaryPalette], ['accent3', scheme.tertiaryPalette],
    ['neutral1', scheme.neutralPalette], ['neutral2', scheme.neutralVariantPalette],
  ].map(([family, palette]) => [family, Object.fromEntries(
    [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
      .map(shade => [shade, hexFromArgb(palette.tone(100 - shade / 10))])
  )]))
}

export const MATERIAL_COLOR_ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
  'surfaceContainerHigh', 'surfaceContainerHighest', 'onSurface', 'onSurfaceVariant',
  'outline', 'outlineVariant', 'error', 'onError', 'errorContainer', 'onErrorContainer',
]

export function materialColorProperty(role) {
  return '--md-sys-color-' + role.replaceAll(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

/** Preserve Android's wallpaper palettes while resolving Material 3 roles. */
export function materialColorScheme(palette, dark) {
  const tonal = family => TonalPalette.fromInt(argbFromHex(palette[family][500]))
  const template = new SchemeTonalSpot(Hct.fromInt(argbFromHex(palette.accent1[500])), dark, 0)
  const scheme = new DynamicScheme({
    ...template,
    primaryPalette: tonal('accent1'),
    secondaryPalette: tonal('accent2'),
    tertiaryPalette: tonal('accent3'),
    neutralPalette: tonal('neutral1'),
    neutralVariantPalette: tonal('neutral2'),
  })
  return Object.fromEntries(MATERIAL_COLOR_ROLES.map(role => [role, hexFromArgb(scheme[role])]))
}

/** Material state layers use the matching on-color at 8% / 12% opacity. */
export function materialStateColor(base, onColor, opacity) {
  const first = argbFromHex(base)
  const second = argbFromHex(onColor)
  const blend = shift => Math.round(((first >> shift) & 255) * (1 - opacity) + ((second >> shift) & 255) * opacity)
  return hexFromArgb(argbFromRgb(blend(16), blend(8), blend(0)))
}

export const MATERIAL_SEED_PRESETS = [
  { name: 'Purple', color: DEFAULT_MATERIAL_SEED_COLOR },
  { name: 'Blue', color: '#4285f4' },
  { name: 'Teal', color: '#006a6a' },
  { name: 'Green', color: '#386a20' },
  { name: 'Amber', color: '#ecaa2e' },
  { name: 'Pink', color: '#ba416d' },
  { name: 'Red', color: '#b3261e' },
  { name: 'Indigo', color: '#3f51b5' },
]
