export const CAPTION_EDGE_STYLES = Object.freeze([
  'none',
  'outline',
  'dropShadow',
])

export const CAPTION_ANCHORS = Object.freeze([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
])

export const DEFAULT_CAPTION_SETTINGS = Object.freeze({
  textColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.8,
  fontScale: 1,
  verticalPosition: 0,
  anchor: 'bottom-center',
  edgeStyle: 'none',
  edgeColor: '#000000',
})

const HEX_COLOR_PATTERN = /^#([\da-f]{3}|[\da-f]{6})$/i

/**
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeColor(value, fallback) {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    return fallback
  }

  const color = value.toLowerCase()
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }

  return color
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function normalizeNumber(value, fallback, min, max) {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof number === 'number' && Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback
}

/**
 * @param {unknown} value
 * @returns {'none' | 'outline' | 'dropShadow'}
 */
function normalizeEdgeStyle(value) {
  if (CAPTION_EDGE_STYLES.includes(value)) {
    return value
  }

  // Video.js used these names in the legacy caption settings object.
  if (value === 'uniform') {
    return 'outline'
  }
  if (value === 'dropshadow' || value === 'raised' || value === 'depressed') {
    return 'dropShadow'
  }

  return DEFAULT_CAPTION_SETTINGS.edgeStyle
}

/**
 * @param {unknown} value
 * @returns {'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'}
 */
function normalizeAnchor(value) {
  return CAPTION_ANCHORS.includes(value)
    ? value
    : DEFAULT_CAPTION_SETTINGS.anchor
}

/**
 * Parses both the current schema and caption preferences saved by the legacy Video.js player.
 * @param {unknown} value
 * @returns {{textColor: string, backgroundColor: string, backgroundOpacity: number, fontScale: number, verticalPosition: number, anchor: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right', edgeStyle: 'none' | 'outline' | 'dropShadow', edgeColor: string}}
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

  const textColor = normalizeColor(settings.textColor ?? settings.color, DEFAULT_CAPTION_SETTINGS.textColor)

  return {
    textColor,
    backgroundColor: normalizeColor(settings.backgroundColor, DEFAULT_CAPTION_SETTINGS.backgroundColor),
    backgroundOpacity: normalizeNumber(
      settings.backgroundOpacity,
      DEFAULT_CAPTION_SETTINGS.backgroundOpacity,
      0,
      1
    ),
    fontScale: normalizeNumber(
      settings.fontScale ?? settings.fontPercent,
      DEFAULT_CAPTION_SETTINGS.fontScale,
      0.5,
      2
    ),
    verticalPosition: normalizeNumber(
      settings.verticalPosition,
      DEFAULT_CAPTION_SETTINGS.verticalPosition,
      0,
      0.5
    ),
    anchor: normalizeAnchor(settings.anchor),
    edgeStyle: normalizeEdgeStyle(settings.edgeStyle),
    edgeColor: normalizeColor(settings.edgeColor, getContrastingEdgeColor(textColor)),
  }
}

/**
 * @param {string} color
 * @param {number} opacity
 * @returns {string}
 */
function colorWithOpacity(color, opacity) {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  return `rgb(${red} ${green} ${blue} / ${opacity})`
}

/**
 * @param {string} color
 * @returns {'#000000' | '#ffffff'}
 */
function getContrastingEdgeColor(color) {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114
  return luminance > 150 ? '#000000' : '#ffffff'
}

/**
 * @param {ReturnType<typeof parseCaptionSettings>} settings
 * @returns {Record<string, string>}
 */
export function getCaptionCssVariables(settings) {
  const [verticalAnchor, horizontalAnchor] = settings.anchor.split('-')
  const horizontalAlignment = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
  }[horizontalAnchor]
  let textShadow = 'none'
  let textStrokeWidth = '0'

  if (settings.edgeStyle === 'outline') {
    textStrokeWidth = 'clamp(0.75px, 0.055em, 2px)'
  } else if (settings.edgeStyle === 'dropShadow') {
    textShadow = `0.1em 0.1em 0.1em ${settings.edgeColor}`
  }

  return {
    '--caption-text-color': settings.textColor,
    '--caption-background-color': colorWithOpacity(settings.backgroundColor, settings.backgroundOpacity),
    '--caption-edge-color': settings.edgeColor,
    '--caption-text-shadow': textShadow,
    '--caption-text-stroke-width': textStrokeWidth,
    '--caption-font-scale': settings.fontScale.toString(),
    '--caption-align-items': horizontalAlignment,
    '--caption-justify-content': verticalAnchor === 'top' ? 'flex-start' : 'flex-end',
    '--caption-text-align': horizontalAnchor,
    '--caption-edge-gap': 'max(12px, 4%)',
    '--caption-top-padding': verticalAnchor === 'top' ? 'var(--caption-edge-gap)' : '0px',
    '--caption-hidden-bottom-gap': verticalAnchor === 'bottom' ? 'var(--caption-edge-gap)' : '0px',
    '--caption-bottom-offset': `${settings.verticalPosition * 100}%`,
    '--caption-vertical-transform': `${settings.verticalPosition * (verticalAnchor === 'top' ? 100 : -100)}%`,
  }
}
