import { ref } from 'vue'
import { registerPlugin } from '@capacitor/core'
import { CUSTOM_THEME_COLORS, hexColorToRgbComponents } from '../../customTheme.js'

const AndroidDynamicColors = process.env.IS_CAPACITOR ? registerPlugin('AndroidDynamicColors') : null

export function getAndroidDynamicColors() {
  return AndroidDynamicColors?.getColors() ?? Promise.resolve({ supported: false })
}

export function onAndroidDynamicColorsChanged(listener) {
  return AndroidDynamicColors?.addListener('dynamicColorsChanged', listener)
}

export const androidDynamicColors = ref({ supported: false })

/** Map Android's tonal palette to the existing theme roles. */
export function dynamicThemeColors(palette, dark) {
  const tone = (family, light, night) => palette[family]?.[dark ? night : light]
  const primary = tone('accent1', 600, 200)
  const onPrimary = tone('accent1', 0, 800)
  const accent = tone('accent3', 600, 200)
  const text = tone('neutral1', 900, 100)
  const secondaryText = tone('neutral2', 700, 200)
  const surface = tone('neutral1', 50, 900)
  const raised = tone('neutral1', 100, 800)
  const hover = tone('neutral2', 100, 800)
  const colors = {
    primaryText: text,
    secondaryText,
    tertiaryText: secondaryText,
    title: text,
    background: surface,
    cardBackground: raised,
    secondaryCardBackground: surface,
    sideNav: surface,
    searchBar: surface,
    settingsSearchBar: surface,
    instanceMenu: raised,
    primaryInput: palette.neutral1[900],
    border: tone('neutral2', 600, 300),
    subtleSurface: hover,
    primary,
    primaryHover: tone('accent1', 700, 100),
    primaryActive: tone('accent1', 800, 50),
    textWithPrimary: onPrimary,
    accent,
    accentHover: tone('accent3', 700, 100),
    accentActive: tone('accent3', 800, 50),
    accentLight: tone('accent3', 700, 100),
    accentVisited: tone('accent2', 600, 200),
    textWithAccent: tone('accent3', 0, 800),
    favoriteIcon: accent,
    // Material's error roles remain red, independently of the wallpaper hue.
    error: dark ? '#ffb4ab' : '#ba1a1a',
    destructive: dark ? '#ffb4ab' : '#ba1a1a',
    destructiveHover: dark ? '#ffdad6' : '#93000a',
    destructiveActive: dark ? '#ffedea' : '#690005',
    destructiveText: dark ? '#690005' : '#ffffff',
    link: accent,
    linkVisited: tone('accent2', 600, 200),
    selectionBackground: primary,
    selectionText: onPrimary,
    logoPrimary: text,
    logoSecondary: text,
    logoTertiary: primary,
    logoPressed: primary,
    scrollbar: secondaryText,
    scrollbarHover: primary,
    scrollbarActive: primary,
    scrollbarTextHover: onPrimary,
    dropdownHover: hover,
    dropdownHoverText: text,
    sideNavHover: hover,
    sideNavHoverText: text,
    sideNavActive: hover,
    sideNavActiveText: text,
    headerHover: hover,
    headerHoverText: text,
    headerPressed: hover,
    headerPressedText: text,
    coloredHeaderHover: tone('accent1', 700, 100),
    coloredHeaderHoverText: onPrimary,
    coloredHeaderPressed: tone('accent1', 800, 50),
    coloredHeaderPressedText: onPrimary,
  }
  return colors
}

export function applyDynamicColors(palette, dark) {
  const colors = dynamicThemeColors(palette, dark)
  for (const [key, property] of CUSTOM_THEME_COLORS) {
    if (colors[key]) document.body.style.setProperty(property, colors[key])
  }
  if (colors.accent) {
    document.body.style.setProperty('--accent-color-rgb', hexColorToRgbComponents(colors.accent))
  }
}
