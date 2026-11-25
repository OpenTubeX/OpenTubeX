// @ts-check

/** @type {Set<HTMLElement>} */
const leavingBackdrops = new Set()

/**
 * Fading a backdrop's opacity would crossfade a sharp and a blurred copy of the
 * page, which flickers on Android. Backdrops clear their dim and blur instead.
 *
 * Backdrops with CSS animations, such as FtPrompt's, paint their dim on a
 * ::before layer that sets --modal-backdrop-dim-layer, and fade its opacity. Chromium runs a CSS background-color
 * animation on the compositor through a paint worklet, which repaints the
 * backdrop when the animation starts and ends, and Android WebView can draw
 * those frames before the worklet has painted: the dim and the blur vanish
 * and the page flashes through.
 */
export const HIDDEN_MODAL_BACKDROP = Object.freeze({ backgroundColor: 'transparent', backdropFilter: 'blur(0)' })

/**
 * @param {string} color A computed color
 * @returns {number}
 */
export function getColorAlpha(color) {
  const legacy = /^rgba\(.*,\s*([\d.e+-]+)\)$/.exec(color)
  if (legacy) return Number(legacy[1])
  const modern = /\/\s*([\d.e+-]+)(%?)\s*\)$/.exec(color)
  if (modern) return Number(modern[1]) / (modern[2] ? 100 : 1)
  return color === 'transparent' ? 0 : 1
}

/**
 * @param {Element} backdrop
 * @returns {CSSStyleDeclaration | null} The style of the backdrop's dim layer, if it has one.
 */
function getDimLayerStyle(backdrop) {
  const style = getComputedStyle(backdrop, '::before')
  return style.getPropertyValue('--modal-backdrop-dim-layer') ? style : null
}

/**
 * The backdrop's current dim and blur, for the other end of a scripted backdrop
 * animation. Chromium only runs a background-color animation on the compositor
 * when no keyframe falls back to the element's own style, and otherwise keeps
 * the blur on the main thread too.
 * @param {Element} backdrop
 * @returns {{ backgroundColor: string, backdropFilter: string }}
 */
export function getModalBackdropStyle(backdrop) {
  const { backgroundColor, backdropFilter } = getComputedStyle(backdrop)
  const dim = getDimLayerStyle(backdrop)
  if (!dim) return { backgroundColor, backdropFilter }
  const alpha = dim.display === 'none' ? 0 : getColorAlpha(dim.backgroundColor) * Number(dim.opacity)
  return { backgroundColor: `rgb(from ${dim.backgroundColor} r g b / ${alpha})`, backdropFilter }
}

/**
 * Lets a modal that opens while this backdrop animates out take it over.
 * @param {HTMLElement} backdrop
 * @returns {() => void} Call once the backdrop is removed.
 */
export function trackLeavingModalBackdrop(backdrop) {
  leavingBackdrops.add(backdrop)
  return () => leavingBackdrops.delete(backdrop)
}

/**
 * A menu sheet that opens a dialog closes as the dialog opens. Clearing one
 * backdrop while the other builds up shows the page sharp in between, and
 * fully so when a slow frame lets the first finish before the second starts.
 * Instead, the entering backdrop starts from the leaving one's current dim and
 * blur, and the leaving one stops painting them.
 * @param {HTMLElement} backdrop
 * @returns {{ backgroundColor: string, backdropFilter: string } | null} The
 *   entering backdrop's starting keyframe, or null if no backdrop is leaving.
 */
export function takeOverLeavingModalBackdrop(backdrop) {
  /** @type {{ backgroundColor: string, backdropFilter: string } | null} */
  let from = null
  for (const leaving of leavingBackdrops) {
    if (leaving === backdrop || !leaving.isConnected) continue
    from ??= getModalBackdropStyle(leaving)
    // Important declarations override the leave animation.
    leaving.style.setProperty('background-color', 'transparent', 'important')
    leaving.style.setProperty('backdrop-filter', 'none', 'important')
    leaving.style.setProperty('--modal-backdrop-dim-display', 'none')
    // It paints nothing now, so a later modal must not start from it.
    leavingBackdrops.delete(leaving)
  }
  return from
}

/**
 * The opacity that a backdrop's dim layer starts from to match `color`.
 * @param {Element} backdrop
 * @param {string} color
 */
export function getModalBackdropDimOpacity(backdrop, color) {
  const dim = getDimLayerStyle(backdrop)
  const alpha = dim ? getColorAlpha(dim.backgroundColor) : 0
  return alpha > 0 ? Math.min(1, getColorAlpha(color) / alpha) : 0
}
