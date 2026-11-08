/**
 * Names of the caption style options, for the settings and the sync activity.
 * @typedef {(key: string) => string} Translate
 */

/**
 * @param {string} color
 * @param {Translate} t
 * @returns {string}
 */
export function getCaptionColorName(color, t) {
  switch (color) {
    case '': return t('Settings.Player Settings.Caption Appearance.Default')
    case '#fff': return t('Settings.Player Settings.Caption Appearance.Colors.White')
    case '#ff0': return t('Settings.Player Settings.Caption Appearance.Colors.Yellow')
    case '#0f0': return t('Settings.Player Settings.Caption Appearance.Colors.Green')
    case '#0ff': return t('Settings.Player Settings.Caption Appearance.Colors.Cyan')
    case '#00f': return t('Settings.Player Settings.Caption Appearance.Colors.Blue')
    case '#f0f': return t('Settings.Player Settings.Caption Appearance.Colors.Magenta')
    case '#f00': return t('Settings.Player Settings.Caption Appearance.Colors.Red')
    case '#080808': return t('Settings.Player Settings.Caption Appearance.Colors.Black')
    // Like Shaka's color menus, other colors are shown as they are.
    default: return color
  }
}

/**
 * @param {string} fontFamily
 * @param {Translate} t
 * @returns {string}
 */
export function getCaptionFontFamilyName(fontFamily, t) {
  switch (fontFamily) {
    case 'MONOSPACED_SERIF': return t('Settings.Player Settings.Caption Appearance.Font Family.Monospaced Serif')
    case 'PROPORTIONAL_SERIF': return t('Settings.Player Settings.Caption Appearance.Font Family.Proportional Serif')
    case 'MONOSPACED_SANS_SERIF': return t('Settings.Player Settings.Caption Appearance.Font Family.Monospaced Sans-Serif')
    case 'PROPORTIONAL_SANS_SERIF': return t('Settings.Player Settings.Caption Appearance.Font Family.Proportional Sans-Serif')
    default: return t('Settings.Player Settings.Caption Appearance.Default')
  }
}

/**
 * @param {string} edgeStyle
 * @param {Translate} t
 * @returns {string}
 */
export function getCaptionEdgeStyleName(edgeStyle, t) {
  switch (edgeStyle) {
    case 'NONE': return t('Settings.Player Settings.Caption Appearance.Edge Style.None')
    case 'DROP_SHADOW': return t('Settings.Player Settings.Caption Appearance.Edge Style.Drop Shadow')
    case 'RAISED': return t('Settings.Player Settings.Caption Appearance.Edge Style.Raised')
    case 'DEPRESSED': return t('Settings.Player Settings.Caption Appearance.Edge Style.Depressed')
    case 'OUTLINE': return t('Settings.Player Settings.Caption Appearance.Edge Style.Outline')
    default: return t('Settings.Player Settings.Caption Appearance.Default')
  }
}

/**
 * @param {string} positionArea
 * @param {Translate} t
 * @returns {string}
 */
export function getCaptionPositionName(positionArea, t) {
  switch (positionArea) {
    case 'TOP_LEFT': return t('Settings.Player Settings.Caption Appearance.Anchor.Top Left')
    case 'TOP_CENTER': return t('Settings.Player Settings.Caption Appearance.Anchor.Top Center')
    case 'TOP_RIGHT': return t('Settings.Player Settings.Caption Appearance.Anchor.Top Right')
    case 'CENTER_LEFT': return t('Settings.Player Settings.Caption Appearance.Anchor.Center Left')
    case 'CENTER': return t('Settings.Player Settings.Caption Appearance.Anchor.Center')
    case 'CENTER_RIGHT': return t('Settings.Player Settings.Caption Appearance.Anchor.Center Right')
    case 'BOTTOM_LEFT': return t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Left')
    case 'BOTTOM_CENTER': return t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Center')
    case 'BOTTOM_RIGHT': return t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Right')
    default: return t('Settings.Player Settings.Caption Appearance.Default')
  }
}
