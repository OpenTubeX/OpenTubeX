/**
 * @typedef {'prompt'|'toast'|'highlight'} SponsorBlockEnterTarget
 */

/**
 * Lists what the Enter shortcut can act on while SponsorBlock UI is on screen, most preferred first.
 *
 * Toasts take priority over the highlight button, because the highlight button sticks around
 * for the whole video while a toast is a short-lived notification the user is reacting to.
 *
 * More than one target is returned so the caller can fall through when the preferred one turns
 * out to be a no-op, rather than swallowing the key press.
 *
 * @param {boolean} hasPromptToast
 * @param {boolean} hasSkippedToast
 * @param {boolean} hasHighlight
 * @returns {SponsorBlockEnterTarget[]}
 */
export function resolveSponsorBlockEnterTargets(hasPromptToast, hasSkippedToast, hasHighlight) {
  const targets = []

  if (hasPromptToast) {
    targets.push('prompt')
  }

  if (hasSkippedToast) {
    targets.push('toast')
  }

  if (hasHighlight) {
    targets.push('highlight')
  }

  return targets
}

/**
 * The target the Enter shortcut advertises itself on, i.e. the one whose label gets the hint.
 *
 * @param {boolean} hasPromptToast
 * @param {boolean} hasSkippedToast
 * @param {boolean} hasHighlight
 * @returns {SponsorBlockEnterTarget|null}
 */
export function resolveSponsorBlockEnterTarget(hasPromptToast, hasSkippedToast, hasHighlight) {
  return resolveSponsorBlockEnterTargets(hasPromptToast, hasSkippedToast, hasHighlight)[0] ?? null
}
