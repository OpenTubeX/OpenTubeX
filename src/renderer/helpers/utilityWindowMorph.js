import { nextTick } from 'vue'

import { applyAnimationSpeed } from './animationSpeed'
import { isReducedMotionEnabled } from './reducedMotion'

const MORPH_ANIMATION_ID = 'utility-window-morph'
// Detached windows no longer report their animations, so keep them to cancel later.
/** @type {WeakMap<HTMLElement, Animation>} */
const morphAnimations = new WeakMap()
// The async window renders after its chunk loads on the first open.
const MORPH_START_TIMEOUT = 1000

/**
 * @typedef {object} UtilityWindowMorph
 * @property {() => Element | null} getButton
 * @property {DOMRect | null} from
 * @property {(animation: Animation | null) => void} start
 * @property {Record<string, Function>} hooks
 */
/** @type {UtilityWindowMorph | null} */
let activeMorph = null

/** @param {Element | null} button */
function getVisibleRect(button) {
  return button?.getClientRects().length ? button.getBoundingClientRect() : null
}

/**
 * @param {HTMLElement} element
 * @param {DOMRect | null} button
 */
function getCollapsedKeyframe(element, button) {
  // Without a visible button, fall back to the regular window transition.
  if (!button) return { transform: 'translateY(8px) scale(0.98)', opacity: 0 }
  const bounds = element.getBoundingClientRect()
  const x = button.left + button.width / 2 - bounds.left - bounds.width / 2
  const y = button.top + button.height / 2 - bounds.top - bounds.height / 2
  return { transform: `translate(${x}px, ${y}px) scale(${button.width / bounds.width})`, opacity: 0 }
}

/** @param {string | null} view */
export function getSettingsWindowIconButton(view) {
  if (view === 'about') return null
  return document.querySelector(`[data-settings-window-icon="${view === 'downloads' ? 'downloads' : 'settings'}"]`)
}

/**
 * Predictive Back follows the path the window takes when it closes to its button.
 * @param {HTMLElement} element
 * @param {Element | null} button
 */
export function getUtilityWindowCloseKeyframes(element, button) {
  const { transform, opacity } = getComputedStyle(element)
  return [{ transform, opacity }, getCollapsedKeyframe(element, getVisibleRect(button))]
}

/**
 * @param {UtilityWindowMorph} morph
 * @param {HTMLElement} element
 * @param {boolean} reverse
 * @param {() => void} done
 */
function playMorph(morph, element, reverse, done) {
  // Hooks from an earlier morph, such as a window that finished loading after
  // its morph timed out, must not settle a later one.
  if (activeMorph !== morph || !element.isConnected) {
    if (activeMorph === morph) morph.start(null)
    done()
    return
  }
  morphAnimations.get(element)?.cancel()
  const collapsed = getCollapsedKeyframe(element, reverse ? getVisibleRect(morph.getButton()) : morph.from)
  const expanded = { transform: 'none', opacity: 1 }
  // Transform and opacity run on the compositor, so the morph stays smooth
  // while the main thread renders or tears down the window.
  const animation = element.animate(reverse ? [expanded, collapsed] : [collapsed, expanded], {
    id: MORPH_ANIMATION_ID,
    duration: 260,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    // A closing window must stay collapsed until Vue removes it.
    fill: reverse ? 'forwards' : 'none'
  })
  applyAnimationSpeed(animation)
  morphAnimations.set(element, animation)
  // Cancelled morphs are settled by Vue's cancel callbacks.
  animation.finished.then(() => done(), () => {})
  morph.start(animation)
}

/** @param {HTMLElement} element */
function cleanUpMorph(element) {
  element.style.removeProperty('pointer-events')
  morphAnimations.get(element)?.cancel()
  morphAnimations.delete(element)
}

/** @param {UtilityWindowMorph} morph */
function createMorphHooks(morph) {
  return {
    onEnter(element, done) {
      playMorph(morph, element, false, done)
    },
    onEnterCancelled: cleanUpMorph,
    onLeave(element, done) {
      // A closing window must not take clicks meant for the controls it uncovers.
      element.style.pointerEvents = 'none'
      // The minimized window button renders later in the same update.
      nextTick(() => playMorph(morph, element, true, done))
    },
    onAfterLeave: cleanUpMorph,
    onLeaveCancelled: cleanUpMorph
  }
}

/** Transition hooks for the utility window while its morph is running. */
export function getUtilityWindowMorphHooks() {
  return activeMorph?.hooks ?? {}
}

/**
 * Applies a window state update and morphs the window from or into the button.
 * @param {() => unknown} update opens or closes the window
 * @param {() => Element | null} getButton
 * @param {(morphing: boolean) => void} setMorphing switches the window transition to the morph hooks
 */
export async function morphUtilityWindow(update, getButton, setMorphing) {
  let morph = null
  let started = null
  if (!isReducedMotionEnabled()) {
    morph = { getButton, from: getVisibleRect(getButton()) }
    started = new Promise(resolve => { morph.start = resolve })
    morph.hooks = createMorphHooks(morph)
    activeMorph = morph
  }
  setMorphing(true)
  let timeout
  try {
    // The window transition must switch to the morph hooks before the update.
    await nextTick()
    await update()
    await nextTick()
    if (!morph) return
    const animation = await Promise.race([
      started,
      new Promise(resolve => { timeout = setTimeout(resolve, MORPH_START_TIMEOUT, null) })
    ])
    await animation?.finished.catch(() => {})
  } finally {
    clearTimeout(timeout)
    if (morph && activeMorph === morph) activeMorph = null
    setMorphing(false)
  }
}
