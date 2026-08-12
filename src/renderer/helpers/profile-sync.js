import { THEME_BG_COLOR, THEME_TEXT_COLOR } from '../../constants.js'

const DEFAULT_PROFILE_BACKGROUND = '#000000'
const DEFAULT_PROFILE_TEXT = '#FFFFFF'

/** Backgrounds that only make sense locally, so they can't be sent to the sync server */
function isLocalOnlyBackground(color) {
  return color === 'transparent' || color === THEME_BG_COLOR
}

export function getSyncProfileBackground(color, fallback = DEFAULT_PROFILE_BACKGROUND) {
  const opaqueFallback = fallback == null || isLocalOnlyBackground(fallback)
    ? DEFAULT_PROFILE_BACKGROUND
    : fallback
  return color == null || isLocalOnlyBackground(color) ? opaqueFallback : color
}

export function getSyncProfileTextColor(color, fallback = DEFAULT_PROFILE_TEXT) {
  if (color !== THEME_TEXT_COLOR) return color

  return fallback === THEME_TEXT_COLOR || fallback == null ? DEFAULT_PROFILE_TEXT : fallback
}

export function getMergedProfileTextColor(local, syncedTextColor) {
  return local?.bgColor === THEME_BG_COLOR ? THEME_TEXT_COLOR : syncedTextColor
}

export function getMergedProfileBackground(local, syncedBackground) {
  const preserveLocalTransparency = local?.icon?.type === 'image' &&
    local.bgColor === 'transparent'

  if (preserveLocalTransparency) return 'transparent'

  // the sync server can't represent the theme color, so a synced value must not overwrite it
  return local?.bgColor === THEME_BG_COLOR ? THEME_BG_COLOR : syncedBackground
}
