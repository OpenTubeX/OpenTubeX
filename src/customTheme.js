export const CUSTOM_THEMES_DIRECTORY = 'themes'
export const CUSTOM_THEMES_SYNC_KEY = 'customThemes'
export const CUSTOM_THEME_VALUE_PREFIX = 'custom:'

export const CUSTOM_THEME_COLORS = Object.freeze([
  ['primaryText', '--primary-text-color', 'Primary text'],
  ['secondaryText', '--secondary-text-color', 'Secondary text'],
  ['tertiaryText', '--tertiary-text-color', 'Tertiary text'],
  ['title', '--title-color', 'Titles'],
  ['logoPrimary', '--logo-primary-color', 'Logo icon'],
  ['logoSecondary', '--logo-secondary-color', 'Logo text'],
  ['logoTertiary', '--logo-tertiary-color', 'Logo hover'],
  ['background', '--bg-color', 'Background'],
  ['cardBackground', '--card-bg-color', 'Cards'],
  ['secondaryCardBackground', '--secondary-card-bg-color', 'Secondary cards'],
  ['favoriteIcon', '--favorite-icon-color', 'Favorite icon'],
  ['error', '--red-500', 'Errors'],
  ['scrollbar', '--scrollbar-color', 'Scrollbar'],
  ['scrollbarHover', '--scrollbar-color-hover', 'Scrollbar hover'],
  ['scrollbarTextHover', '--scrollbar-text-color-hover', 'Dropdown hover text'],
  ['sideNav', '--side-nav-color', 'Side navigation'],
  ['sideNavHover', '--side-nav-hover-color', 'Side navigation hover'],
  ['sideNavHoverText', '--side-nav-hover-text-color', 'Side navigation hover text'],
  ['sideNavActive', '--side-nav-active-color', 'Side navigation active'],
  ['sideNavActiveText', '--side-nav-active-text-color', 'Side navigation active text'],
  ['searchBar', '--search-bar-color', 'Search bar'],
  ['settingsSearchBar', '--settings-search-bar-color', 'Settings search bar'],
  ['instanceMenu', '--instance-menu-color', 'Instance menu'],
  ['primaryInput', '--primary-input-color', 'Input background'],
  ['primaryShadow', '--primary-shadow-color', 'Shadows'],
  ['primary', '--primary-color', 'Primary color'],
  ['primaryHover', '--primary-color-hover', 'Primary hover'],
  ['primaryActive', '--primary-color-active', 'Primary active'],
  ['textWithPrimary', '--text-with-main-color', 'Text on primary'],
  ['accent', '--accent-color', 'Accent color'],
  ['accentHover', '--accent-color-hover', 'Accent hover'],
  ['accentActive', '--accent-color-active', 'Accent active'],
  ['accentLight', '--accent-color-light', 'Light accent'],
  ['accentVisited', '--accent-color-visited', 'Visited accent'],
  ['textWithAccent', '--text-with-accent-color', 'Text on accent'],
  ['link', '--link-color', 'Links'],
  ['linkVisited', '--link-visited-color', 'Visited links'],
  ['destructive', '--destructive-color', 'Destructive action'],
  ['destructiveHover', '--destructive-hover-color', 'Destructive hover'],
  ['destructiveActive', '--destructive-active-color', 'Destructive active'],
  ['destructiveText', '--destructive-text-color', 'Text on destructive action'],
])

export const DEFAULT_CUSTOM_THEME = Object.freeze({
  version: 1,
  id: '',
  name: 'Custom Theme',
  basedOn: 'dark',
  mainColor: 'Red',
  secondaryColor: 'Blue',
  isDark: true,
  colors: Object.freeze({
    primaryText: '#eeeeee',
    secondaryText: '#dddddd',
    tertiaryText: '#999999',
    title: '#eeeeee',
    logoPrimary: '#eeeeee',
    logoSecondary: '#eeeeee',
    logoTertiary: '#eeeeee',
    background: '#121212',
    cardBackground: '#242424',
    secondaryCardBackground: '#181818',
    favoriteIcon: '#6eaa73',
    error: '#f44336',
    scrollbar: '#515151',
    scrollbarHover: '#757575',
    scrollbarTextHover: '#eeeeee',
    sideNav: '#181818',
    sideNavHover: '#242424',
    sideNavHoverText: '#eeeeee',
    sideNavActive: '#303030',
    sideNavActiveText: '#eeeeee',
    searchBar: '#262626',
    settingsSearchBar: '#242424',
    instanceMenu: '#262626',
    primaryInput: '#7f7f7f',
    primaryShadow: '#000000',
    primary: '#f44336',
    primaryHover: '#e53935',
    primaryActive: '#c62828',
    textWithPrimary: '#ffffff',
    accent: '#2196f3',
    accentHover: '#1e88e5',
    accentActive: '#1565c0',
    accentLight: '#90caf9',
    accentVisited: '#7e57c2',
    textWithAccent: '#ffffff',
    link: '#2196f3',
    linkVisited: '#7e57c2',
    destructive: '#f44336',
    destructiveHover: '#e53935',
    destructiveActive: '#c62828',
    destructiveText: '#000000',
  })
})

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i

export function normalizeCustomTheme(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Custom theme must be a JSON object')
  }

  const colors = {}
  for (const [key] of CUSTOM_THEME_COLORS) {
    const color = value.colors?.[key]
    if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
      throw new TypeError(`Invalid or missing custom theme color: ${key}`)
    }
    colors[key] = color.toLowerCase()
  }

  return {
    version: 1,
    id: typeof value.id === 'string' && /^[\w-]{1,80}$/.test(value.id)
      ? value.id
      : 'custom-theme',
    name: typeof value.name === 'string' && value.name.trim() !== ''
      ? value.name.trim().slice(0, 80)
      : DEFAULT_CUSTOM_THEME.name,
    basedOn: typeof value.basedOn === 'string' && value.basedOn !== '' && !isCustomThemeValue(value.basedOn)
      ? value.basedOn
      : DEFAULT_CUSTOM_THEME.basedOn,
    mainColor: typeof value.mainColor === 'string' && value.mainColor !== ''
      ? value.mainColor
      : DEFAULT_CUSTOM_THEME.mainColor,
    secondaryColor: typeof value.secondaryColor === 'string' && value.secondaryColor !== ''
      ? value.secondaryColor
      : DEFAULT_CUSTOM_THEME.secondaryColor,
    isDark: value.isDark !== false,
    colors
  }
}

export function normalizeCustomThemes(value) {
  if (!Array.isArray(value)) throw new TypeError('Custom themes must be a JSON array')
  return value.map(normalizeCustomTheme)
}

export function customThemeValue(id) {
  return `${CUSTOM_THEME_VALUE_PREFIX}${id}`
}

export function isCustomThemeValue(value) {
  return value === 'custom' || (typeof value === 'string' && value.startsWith(CUSTOM_THEME_VALUE_PREFIX))
}

export function customThemeIdFromValue(value) {
  return typeof value === 'string' && value.startsWith(CUSTOM_THEME_VALUE_PREFIX)
    ? value.slice(CUSTOM_THEME_VALUE_PREFIX.length)
    : null
}

export function cloneDefaultCustomTheme() {
  return {
    ...DEFAULT_CUSTOM_THEME,
    colors: { ...DEFAULT_CUSTOM_THEME.colors }
  }
}
