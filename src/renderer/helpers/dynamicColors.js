import { ref } from 'vue'
import { registerPlugin } from '@capacitor/core'
import { MATERIAL_COLOR_ROLES, MATERIAL_SYSTEM_SEED, materialColorProperty, materialColorScheme, materialSeedPalette, materialStateColor, normalizeSystemAccentColor } from '../../materialTheme.js'
import { CUSTOM_THEME_COLORS, hexColorToRgbComponents } from '../../customTheme.js'

const AndroidDynamicColors = process.env.IS_CAPACITOR && !process.env.IS_IOS ? registerPlugin('AndroidDynamicColors') : null

export function getAndroidDynamicColors() {
  return AndroidDynamicColors?.getColors() ?? Promise.resolve({ supported: false })
}

export function onAndroidDynamicColorsChanged(listener) {
  return AndroidDynamicColors?.addListener('dynamicColorsChanged', listener)
}

export const androidDynamicColors = ref({ supported: false })
export const desktopSystemAccentColor = ref(normalizeSystemAccentColor(
  typeof window === 'undefined' ? null : window.ftElectron?.startupAppearance.systemAccentColor
))

export async function initializeAndroidDynamicColors(request = getAndroidDynamicColors()) {
  let timeout
  try {
    // Theme availability must not prevent the application from mounting.
    androidDynamicColors.value = await Promise.race([
      request,
      new Promise(resolve => { timeout = setTimeout(() => resolve({ supported: false }), 1500) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

/** Dynamic colors, or a fixed Material variant seeded with the system palette, follows the system. */
export function getMaterialPalette(seed, theme) {
  if (theme !== 'dynamic' && seed !== MATERIAL_SYSTEM_SEED) return materialSeedPalette(seed)
  return androidDynamicColors.value.supported
    ? androidDynamicColors.value.palette
    : materialSeedPalette(desktopSystemAccentColor.value ?? seed)
}

/** Map Android's tonal palette to the existing theme roles. */
export function dynamicThemeColors(palette, dark, black = false) {
  const roles = materialColorScheme(palette, dark)
  const hover = (base, onColor) => materialStateColor(base, onColor, 0.08)
  const pressed = (base, onColor) => materialStateColor(base, onColor, 0.12)
  // Preserve Android distributions that offer pure-black system surfaces.
  const surface = black || (dark && palette.neutral1[900] === '#000000') ? '#000000' : roles.surface
  const colors = {
    primaryText: roles.onSurface,
    secondaryText: roles.onSurfaceVariant,
    tertiaryText: roles.onSurfaceVariant,
    title: roles.onSurface,
    background: surface,
    cardBackground: roles.surfaceContainerLow,
    secondaryCardBackground: roles.surfaceContainer,
    sideNav: surface,
    searchBar: roles.surfaceContainerHighest,
    settingsSearchBar: roles.surfaceContainerHighest,
    instanceMenu: roles.surfaceContainerHigh,
    primaryInput: materialColorScheme(palette, true).surfaceContainerLow,
    border: roles.outline,
    subtleSurface: roles.surfaceContainerHighest,
    primary: roles.primary,
    primaryHover: hover(roles.primary, roles.onPrimary),
    primaryActive: pressed(roles.primary, roles.onPrimary),
    textWithPrimary: roles.onPrimary,
    accent: roles.secondary,
    accentHover: hover(roles.secondary, roles.onSecondary),
    accentActive: pressed(roles.secondary, roles.onSecondary),
    accentLight: hover(roles.secondary, roles.onSecondary),
    accentVisited: roles.tertiary,
    textWithAccent: roles.onSecondary,
    favoriteIcon: roles.tertiary,
    error: roles.error,
    destructive: roles.error,
    destructiveHover: hover(roles.error, roles.onError),
    destructiveActive: pressed(roles.error, roles.onError),
    destructiveText: roles.onError,
    link: roles.primary,
    linkVisited: roles.tertiary,
    selectionBackground: roles.primary,
    selectionText: roles.onPrimary,
    logoPrimary: roles.primary,
    logoSecondary: roles.onSurface,
    logoTertiary: roles.primary,
    logoPressed: roles.primary,
    scrollbar: roles.outline,
    scrollbarHover: roles.primary,
    scrollbarActive: roles.primary,
    scrollbarTextHover: roles.onPrimary,
    dropdownHover: roles.secondaryContainer,
    dropdownHoverText: roles.onSurface,
    sideNavHover: roles.secondaryContainer,
    sideNavHoverText: roles.onSecondaryContainer,
    sideNavActive: roles.secondaryContainer,
    sideNavActiveText: roles.onSecondaryContainer,
    headerHover: roles.secondaryContainer,
    headerHoverText: roles.onSecondaryContainer,
    headerPressed: pressed(roles.secondaryContainer, roles.onSecondaryContainer),
    headerPressedText: roles.onSecondaryContainer,
    coloredHeaderHover: hover(roles.primary, roles.onPrimary),
    coloredHeaderHoverText: roles.onPrimary,
    coloredHeaderPressed: pressed(roles.primary, roles.onPrimary),
    coloredHeaderPressedText: roles.onPrimary,
  }
  return colors
}

export function applyDynamicColors(palette, dark, black = false) {
  const colors = dynamicThemeColors(palette, dark, black)
  const roles = materialColorScheme(palette, dark)
  for (const role of MATERIAL_COLOR_ROLES) {
    document.body.style.setProperty(materialColorProperty(role), roles[role])
  }
  for (const [key, property] of CUSTOM_THEME_COLORS) {
    if (colors[key]) document.body.style.setProperty(property, colors[key])
  }
  if (colors.accent) {
    document.body.style.setProperty('--accent-color-rgb', hexColorToRgbComponents(colors.accent))
  }
}
