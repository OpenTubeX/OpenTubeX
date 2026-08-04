/**
 * Pure state machine behind the automatic Picture-in-Picture triggers.
 *
 * Toggling PiP is asynchronous (in Electron it round-trips through the main
 * process) and several triggers can fire within the same window transition, so
 * the decisions live here instead of being derived ad-hoc from the DOM.
 */

// How long a restore may still produce a stale blur before the blur trigger is
// re-evaluated, in case the window never emits a focus event afterwards.
export const BLUR_TRIGGER_RECHECK_DELAY_MS = 750

/**
 * @typedef {{
 *   windowMinimized: boolean,
 *   windowFocused: boolean,
 *   autoPipActive: boolean,
 *   pendingPipTarget: boolean | null,
 *   blurTriggerArmed: boolean,
 *   pictureInPictureDismissed: boolean
 * }} AutoPictureInPictureState
 */

/**
 * @param {{ minimized?: boolean, focused?: boolean }} [initial]
 * @returns {AutoPictureInPictureState}
 */
export function createAutoPictureInPictureState({ minimized = false, focused = true } = {}) {
  return {
    windowMinimized: minimized,
    windowFocused: focused,
    // Whether the current PiP window was opened automatically. Only then may it
    // be closed again automatically, so a manually opened one is left alone.
    autoPipActive: false,
    // Desired PiP state of a toggle that was requested but not observed yet.
    pendingPipTarget: null,
    // A blur only counts as a trigger once the document has been focused since
    // the last restore, see `applyMinimizedState`.
    blurTriggerArmed: true,
    // Whether the user closed an automatically opened PiP window while its
    // trigger still applies, see `applyPictureInPictureState`.
    pictureInPictureDismissed: false
  }
}

/**
 * @param {AutoPictureInPictureState} state
 * @param {{
 *   canAutoPip: boolean,
 *   isActiveTab: boolean,
 *   triggerOnTabChange: boolean,
 *   triggerOnMinimize: boolean,
 *   triggerOnBlur: boolean
 * }} options
 */
export function shouldAutoPictureInPicture(state, {
  canAutoPip,
  isActiveTab,
  triggerOnTabChange,
  triggerOnMinimize,
  triggerOnBlur
}) {
  if (!canAutoPip) {
    return false
  }

  // An in-app tab change is handled by the 'tab' trigger. Window minimize / blur only
  // apply while this is the presented tab, so background tabs don't spuriously enter PiP.
  const tabHidden = triggerOnTabChange && !isActiveTab
  const minimized = isActiveTab && triggerOnMinimize && state.windowMinimized
  const blurred = isActiveTab && triggerOnBlur && !state.windowFocused && state.blurTriggerArmed

  return tabHidden || minimized || blurred
}

/**
 * @param {AutoPictureInPictureState} state
 * @param {{ wantPip: boolean, inPip: boolean }} status
 * @returns {'enter' | 'exit' | 'wait' | 'none'}
 */
export function resolveAutoPictureInPictureAction(state, { wantPip, inPip }) {
  if (state.pendingPipTarget !== null) {
    // Requesting another toggle before the previous one landed would cancel it
    // out, e.g. when blur and minimize both fire while minimizing the window.
    if (state.pendingPipTarget !== inPip) {
      return 'wait'
    }
    state.pendingPipTarget = null
  }

  // Once the trigger stops applying, a dismissal from that trigger is spent.
  if (!wantPip) {
    state.pictureInPictureDismissed = false
  }

  if (wantPip && !inPip) {
    return state.pictureInPictureDismissed ? 'none' : 'enter'
  }

  if (!wantPip && inPip && state.autoPipActive) {
    return 'exit'
  }

  return 'none'
}

/**
 * @param {AutoPictureInPictureState} state
 * @param {boolean} target
 */
export function markPictureInPictureRequested(state, target) {
  state.pendingPipTarget = target
  state.autoPipActive = target
}

/**
 * @param {AutoPictureInPictureState} state
 */
export function markPictureInPictureRequestFailed(state) {
  state.pendingPipTarget = null
  state.autoPipActive = false
}

/**
 * @param {AutoPictureInPictureState} state
 * @param {boolean} focused
 */
export function applyFocusState(state, focused) {
  state.windowFocused = focused
  if (focused) {
    state.blurTriggerArmed = true
  }
}

/**
 * @param {AutoPictureInPictureState} state
 * @param {boolean} minimized
 */
export function applyMinimizedState(state, minimized) {
  state.windowMinimized = minimized
  if (!minimized) {
    // Restoring/showing the app makes its document the active application surface.
    // Keep the stale blur emitted while minimizing (or while the PiP window that is
    // being closed hands focus back) from holding an automatically opened PiP window
    // open forever, or from reopening it right after the restore closed it.
    state.windowFocused = true
    state.blurTriggerArmed = false
  }
}

/**
 * Records an observed PiP transition.
 *
 * @param {AutoPictureInPictureState} state
 * @param {boolean} inPip
 * @returns {boolean} whether the triggers should be re-evaluated
 */
export function applyPictureInPictureState(state, inPip) {
  const wasRequested = state.pendingPipTarget === inPip
  state.pendingPipTarget = null

  if (!inPip) {
    state.autoPipActive = false
    // A PiP window closed by the user must not be reopened by a trigger that is
    // still active, so remember the dismissal until that trigger stops applying
    // and let only a requested close settle the state right away.
    state.pictureInPictureDismissed = !wasRequested

    return wasRequested
  }

  state.pictureInPictureDismissed = false

  return true
}
