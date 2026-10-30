/*
  Shaka renders the captions and offers their style in the player's captions menu, so the saved
  settings use the options of its text displayer configuration. Positions, font families and edge
  styles are saved by the names of Shaka's enums, colors and opacities as Shaka takes them.
*/

/** Keys of `shaka.config.PositionArea`. */
export const CAPTION_POSITION_AREAS = Object.freeze([
  'DEFAULT',
  'TOP_LEFT',
  'TOP_CENTER',
  'TOP_RIGHT',
  'CENTER_LEFT',
  'CENTER',
  'CENTER_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_CENTER',
  'BOTTOM_RIGHT',
])

/** `shaka.config.FontFamily`, the default font family is the one of the app. */
export const CAPTION_FONT_FAMILIES = Object.freeze({
  DEFAULT: '',
  MONOSPACED_SERIF: '"Courier New", Courier, "Nimbus Mono L", "Cutive Mono", monospace',
  PROPORTIONAL_SERIF: '"Times New Roman", Times, Georgia, Cambria, "PT Serif Caption", serif',
  MONOSPACED_SANS_SERIF: '"Deja Vu Sans Mono", "Lucida Console", Monaco, Consolas, "PT Mono", monospace',
  PROPORTIONAL_SANS_SERIF: 'Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
})

/** Keys of `shaka.config.CharacterEdgeStyle`. */
export const CAPTION_EDGE_STYLES = Object.freeze([
  'DEFAULT',
  'NONE',
  'DROP_SHADOW',
  'RAISED',
  'DEPRESSED',
  'OUTLINE',
])

/** The colors of Shaka's color menus, an empty string keeps the color of the captions. */
export const CAPTION_COLORS = Object.freeze({
  '': 'Default',
  '#fff': 'White',
  '#ff0': 'Yellow',
  '#0f0': 'Green',
  '#0ff': 'Cyan',
  '#00f': 'Blue',
  '#f0f': 'Magenta',
  '#f00': 'Red',
  '#080808': 'Black',
})

/** The opacities of Shaka's opacity menus, `null` keeps the opacity of the captions. */
export const CAPTION_FONT_OPACITIES = Object.freeze([null, 0.25, 0.5, 0.75, 1])
export const CAPTION_BACKGROUND_OPACITIES = Object.freeze([null, 0, 0.25, 0.5, 0.75, 1])

/** Shaka's font sizes, extended to the 400% that the settings offered before. */
export const CAPTION_FONT_SCALE_FACTORS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4])

/**
 * Player height from which on captions get their full configured size (a 16:9 player at 711px wide).
 * Deliberately smaller than a regular watch page player, so only players that are actually small
 * scale their captions down.
 */
const REFERENCE_PLAYER_HEIGHT = 400

/** Keeps captions legible in tiny players, where a purely proportional size would be unreadable. */
const MIN_CAPTION_PLAYER_SCALE = 0.45

/** Share of the player height a single line of captions may take up at most. */
const MAX_CAPTION_FONT_SIZE_RATIO = 0.1

/** Shaka's font size for captions, which its font sizes scale. */
const CAPTION_FONT_SIZE = 20

/**
 * Shaka's defaults, except for the position: YouTube positions some cues, for example with
 * position:63%, so the captions are kept at the bottom center unless the user picks the default.
 */
export const DEFAULT_CAPTION_SETTINGS = Object.freeze({
  fontFamily: 'DEFAULT',
  fontColor: '',
  fontOpacity: null,
  fontScaleFactor: 1,
  backgroundColor: '',
  backgroundOpacity: null,
  characterEdgeStyle: 'DEFAULT',
  positionArea: 'BOTTOM_CENTER',
})

/**
 * @typedef {{
 *   fontFamily: string,
 *   fontColor: string,
 *   fontOpacity: number | null,
 *   fontScaleFactor: number,
 *   backgroundColor: string,
 *   backgroundOpacity: number | null,
 *   characterEdgeStyle: string,
 *   positionArea: string,
 * }} CaptionSettings
 */

const HEX_COLOR_PATTERN = /^#([\da-f]{3}|[\da-f]{6})$/i

/** Anchors of the settings before Shaka's style options, which had no centered row. */
export const LEGACY_ANCHORS = Object.freeze({
  'top-left': 'TOP_LEFT',
  'top-center': 'TOP_CENTER',
  'top-right': 'TOP_RIGHT',
  'bottom-left': 'BOTTOM_LEFT',
  'bottom-center': 'BOTTOM_CENTER',
  'bottom-right': 'BOTTOM_RIGHT',
})

/** Edge styles of the settings before Shaka's style options, and of the Video.js player before them. */
export const LEGACY_EDGE_STYLES = Object.freeze({
  none: 'DEFAULT',
  outline: 'OUTLINE',
  uniform: 'OUTLINE',
  dropShadow: 'DROP_SHADOW',
  dropshadow: 'DROP_SHADOW',
  raised: 'RAISED',
  depressed: 'DEPRESSED',
})

/**
 * Lowercases a color and shortens it to the form of Shaka's palette when it is one of its colors.
 * The colors the earlier settings had by default become the default again.
 * @param {unknown} value
 * @param {string} legacyDefault
 * @returns {string}
 */
function normalizeColor(value, legacyDefault) {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    return ''
  }

  let color = value.toLowerCase()
  if (color.length === 4) {
    color = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  if (color === legacyDefault) {
    return ''
  }

  const shortColor = /^#(.)\1(.)\2(.)\3$/.test(color) ? `#${color[1]}${color[3]}${color[5]}` : color
  return shortColor in CAPTION_COLORS ? shortColor : color
}

/**
 * @param {unknown} value
 * @param {number | null} [legacyDefault]
 * @returns {number | null}
 */
function normalizeOpacity(value, legacyDefault) {
  const opacity = typeof value === 'string' ? Number.parseFloat(value) : value
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity === legacyDefault) {
    return null
  }
  return Math.min(1, Math.max(0, opacity))
}

/**
 * Picks the closest of the font sizes, so that the captions menu can show which one is used.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeFontScaleFactor(value) {
  const scale = typeof value === 'string' ? Number.parseFloat(value) : value
  if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    return DEFAULT_CAPTION_SETTINGS.fontScaleFactor
  }
  return CAPTION_FONT_SCALE_FACTORS.reduce((closest, factor) => {
    return Math.abs(factor - scale) < Math.abs(closest - scale) ? factor : closest
  })
}

/**
 * @param {unknown} value
 * @param {readonly string[]} names
 * @param {string} fallback
 * @returns {string}
 */
function normalizeName(value, names, fallback) {
  return typeof value === 'string' && names.includes(value) ? value : fallback
}

/**
 * Parses the saved caption settings, including the ones saved before Shaka's style options and
 * by the legacy Video.js player. Their vertical position and edge color have no counterpart.
 * @param {unknown} value
 * @returns {CaptionSettings}
 */
export function parseCaptionSettings(value) {
  let settings = value

  if (typeof value === 'string') {
    try {
      settings = JSON.parse(value)
    } catch {
      settings = {}
    }
  }

  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    settings = {}
  }

  // Every setting is saved together, so only earlier settings lack the font color.
  const legacy = !('fontColor' in settings)

  return {
    fontFamily: normalizeName(settings.fontFamily, Object.keys(CAPTION_FONT_FAMILIES), DEFAULT_CAPTION_SETTINGS.fontFamily),
    fontColor: normalizeColor(legacy ? settings.textColor ?? settings.color : settings.fontColor, legacy ? '#ffffff' : ''),
    fontOpacity: normalizeOpacity(settings.fontOpacity),
    fontScaleFactor: normalizeFontScaleFactor(settings.fontScaleFactor ?? settings.fontScale ?? settings.fontPercent),
    backgroundColor: normalizeColor(settings.backgroundColor, legacy ? '#000000' : ''),
    backgroundOpacity: normalizeOpacity(settings.backgroundOpacity, legacy ? 0.8 : null),
    characterEdgeStyle: normalizeName(
      settings.characterEdgeStyle ?? LEGACY_EDGE_STYLES[settings.edgeStyle],
      CAPTION_EDGE_STYLES,
      DEFAULT_CAPTION_SETTINGS.characterEdgeStyle
    ),
    positionArea: normalizeName(
      settings.positionArea ?? LEGACY_ANCHORS[settings.anchor],
      CAPTION_POSITION_AREAS,
      DEFAULT_CAPTION_SETTINGS.positionArea
    ),
  }
}

/**
 * @param {CaptionSettings} settings
 * @returns {boolean}
 */
export function areCaptionSettingsDefault(settings) {
  return Object.entries(DEFAULT_CAPTION_SETTINGS).every(([setting, value]) => Object.is(settings[setting], value))
}

/**
 * The position of the secondary captions, at the opposite edge of the main captions.
 * @param {string} positionArea
 * @returns {{ atTop: boolean, align: 'left' | 'center' | 'right' }}
 */
export function getSecondaryCaptionPosition(positionArea) {
  const [row, column] = positionArea.split('_')
  return {
    atTop: row !== 'TOP',
    align: column === 'LEFT' ? 'left' : column === 'RIGHT' ? 'right' : 'center',
  }
}

/**
 * Captions are sized in pixels, so without this they stay just as big when the player shrinks
 * (e.g. the scroll mini player), where they would cover the entire video.
 * Only ever scales down, so that regular and fullscreen players keep their configured size.
 * @param {number} playerHeight height of the player in CSS pixels
 * @returns {number}
 */
export function getCaptionPlayerScale(playerHeight) {
  if (!Number.isFinite(playerHeight) || playerHeight <= 0) {
    return 1
  }

  return Math.min(1, Math.max(MIN_CAPTION_PLAYER_SCALE, playerHeight / REFERENCE_PLAYER_HEIGHT))
}

/**
 * The font size Shaka's font sizes scale. A large font size can outgrow a small player even after
 * it was scaled down, so the scaled size is capped at a share of the player height that always
 * leaves room for a couple of lines of captions.
 * @param {number} playerHeight height of the player in CSS pixels
 * @param {number} fontScaleFactor
 * @returns {Record<string, string>}
 */
export function getCaptionPlayerVariables(playerHeight, fontScaleFactor) {
  let fontSize = CAPTION_FONT_SIZE * getCaptionPlayerScale(playerHeight)
  if (Number.isFinite(playerHeight) && playerHeight > 0) {
    fontSize = Math.min(fontSize, Math.round(playerHeight * MAX_CAPTION_FONT_SIZE_RATIO) / fontScaleFactor)
  }

  return {
    '--caption-font-size': `${Math.round(fontSize * 100) / 100}px`,
  }
}

/**
 * @param {string} color a hex color
 * @param {number} opacity
 * @returns {string}
 */
function colorWithOpacity(color, opacity) {
  const hex = color.length === 4 ? color.replaceAll(/[\da-f]/gi, '$&$&') : color
  const [red, green, blue] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16))
  return `rgb(${red} ${green} ${blue} / ${opacity})`
}

/**
 * Styles captions that Shaka doesn't render, the secondary captions and the sample in the
 * settings, like Shaka's text displayer styles the cues that have no style of their own.
 * @param {CaptionSettings} settings
 * @returns {{ text: Record<string, string>, background: string }}
 */
export function getCaptionStyle(settings) {
  const fontOpacity = settings.fontOpacity ?? 1
  // Shaka's edge styles, in 1/32 of the font size
  const dark = `rgb(34 34 34 / ${fontOpacity})`
  const light = `rgb(204 204 204 / ${fontOpacity})`
  const textShadow = {
    DROP_SHADOW: [3, 4, 5].map(blur => `0.0625em 0.0625em ${blur / 32}em ${dark}`).join(', '),
    RAISED: [1, 2, 3].map(offset => `${offset / 32}em ${offset / 32}em ${dark}`).join(', '),
    DEPRESSED: `0.03125em 0.03125em ${light}, -0.03125em -0.03125em ${dark}`,
    OUTLINE: Array(5).fill(`0 0 0.0625em ${dark}`).join(', '),
  }[settings.characterEdgeStyle] ?? 'none'

  return {
    text: {
      color: colorWithOpacity(settings.fontColor || '#fff', fontOpacity),
      fontFamily: CAPTION_FONT_FAMILIES[settings.fontFamily] || 'inherit',
      fontSize: `calc(var(--caption-font-size, 20px) * ${settings.fontScaleFactor})`,
      textShadow,
    },
    background: colorWithOpacity(
      settings.backgroundColor || '#000',
      settings.backgroundOpacity ?? (settings.backgroundColor ? 1 : 0.8)
    ),
  }
}
