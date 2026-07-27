/**
 * Decides what the Enter shortcut acts on while SponsorBlock UI is on screen.
 *
 * Toasts take priority over the highlight button, because the highlight button sticks around
 * for the whole video while a toast is a short-lived notification the user is reacting to.
 *
 * @param {boolean} hasPromptToast
 * @param {boolean} hasSkippedToast
 * @param {boolean} hasHighlight
 * @returns {'prompt'|'toast'|'highlight'|null}
 */
export function resolveSponsorBlockEnterTarget(hasPromptToast, hasSkippedToast, hasHighlight) {
  if (hasPromptToast) {
    return 'prompt'
  }

  if (hasSkippedToast) {
    return 'toast'
  }

  return hasHighlight ? 'highlight' : null
}
