const SEARCH_INPUT_FONT = "16px Roboto, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"

let context = null
let referenceAscent = null

function getContext() {
  if (context == null && typeof document !== 'undefined') {
    context = document.createElement('canvas').getContext('2d')
    if (context != null) {
      context.font = SEARCH_INPUT_FONT
    }
  }

  return context
}

/**
 * Measure how far the rendered text ascends beyond the primary font metrics.
 * @param {string} text
 * @returns {number}
 */
export function getInputTextAscentOffset(text) {
  const metricsContext = getContext()
  if (metricsContext == null) return 0

  // Use the primary font's declared ascent as the reference so ordinary text
  // (including tall Latin ascenders like l/h/k, which exceed cap height) never
  // reports an offset. Only glyphs rendered by a taller fallback font do.
  referenceAscent ??= metricsContext.measureText('Ag').fontBoundingBoxAscent
  const textAscent = metricsContext.measureText(text).actualBoundingBoxAscent

  return Math.max(0, Math.min(4, Math.round(textAscent - referenceAscent)))
}
