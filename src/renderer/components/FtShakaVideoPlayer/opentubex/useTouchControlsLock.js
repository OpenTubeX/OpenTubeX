import { onScopeDispose, ref, watch } from 'vue'

// Every input a touch or a stray press can produce. Escape covers Android's
// back button, which the app delivers as an Escape key press.
const BLOCKED_EVENTS = [
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'mousedown', 'mousemove', 'mouseup',
  'click', 'dblclick', 'contextmenu', 'wheel', 'keydown',
]
// Cancelling these would also cancel the click that reveals the unlock button.
const CLICK_PRODUCING_EVENTS = new Set(['touchstart', 'touchend'])
const UNLOCK_BUTTON_TIMEOUT_MS = 3000
export const HOLD_TO_UNLOCK_MS = 600
// The click that follows a completed hold must not reach the unlocked player.
const RELEASE_CLICK_TIMEOUT_MS = 400
// Ends the block even if the browser never reports the release.
const RELEASE_TIMEOUT_MS = 5000

/**
 * Locks the full screen player against touches until the user holds the
 * unlock button, which any touch reveals for a few seconds.
 * @param {object} options
 * @param {() => boolean} options.isAvailable Reactive; the lock ends when it turns false.
 * @param {() => HTMLElement | null | undefined} options.getUnlockButton
 * @param {() => void} options.onLock
 * @param {() => void} options.onUnlock
 */
export function useTouchControlsLock({ isAvailable, getUnlockButton, onLock, onUnlock }) {
  const touchControlsLocked = ref(false)
  const unlockButtonShown = ref(false)
  const unlockHolding = ref(false)
  // Input stays blocked after a hold unlocks, until its pointer is released.
  const blockingInput = ref(false)
  /** @type {number | null} */
  let holdPointerId = null
  let awaitingRelease = false
  /** @type {number | undefined} */
  let hideTimer
  /** @type {number | undefined} */
  let holdTimer
  /** @type {number | undefined} */
  let releaseTimer

  function showUnlockButton() {
    unlockButtonShown.value = true
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => {
      unlockButtonShown.value = false
    }, UNLOCK_BUTTON_TIMEOUT_MS)
  }

  function lockTouchControls() {
    if (touchControlsLocked.value || !isAvailable()) return
    window.clearTimeout(releaseTimer)
    awaitingRelease = false
    holdPointerId = null
    touchControlsLocked.value = true
    blockingInput.value = true
    showUnlockButton()
    onLock()
  }

  function unlockTouchControls() {
    if (!touchControlsLocked.value) return
    touchControlsLocked.value = false
    unlockButtonShown.value = false
    unlockHolding.value = false
    window.clearTimeout(hideTimer)
    window.clearTimeout(holdTimer)
    if (!awaitingRelease) endBlocking()
    onUnlock()
  }

  function endBlocking() {
    window.clearTimeout(releaseTimer)
    awaitingRelease = false
    holdPointerId = null
    blockingInput.value = false
  }

  /** @param {number} pointerId */
  function startHold(pointerId) {
    holdPointerId = pointerId
    unlockHolding.value = true
    // Keep the button up for the whole hold.
    window.clearTimeout(hideTimer)
    holdTimer = window.setTimeout(() => {
      awaitingRelease = true
      releaseTimer = window.setTimeout(endBlocking, RELEASE_TIMEOUT_MS)
      unlockTouchControls()
    }, HOLD_TO_UNLOCK_MS)
  }

  function cancelHold() {
    window.clearTimeout(holdTimer)
    holdPointerId = null
    unlockHolding.value = false
    showUnlockButton()
  }

  /** @param {PointerEvent} event */
  function isOverUnlockButton(event) {
    const rect = getUnlockButton()?.getBoundingClientRect()
    return !!rect && event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom
  }

  /** @param {Event} event */
  function blockInput(event) {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return
    event.stopImmediatePropagation()
    if (event.cancelable && !CLICK_PRODUCING_EVENTS.has(event.type)) event.preventDefault()

    const pointer = /** @type {PointerEvent} */ (event)
    if (!touchControlsLocked.value) {
      if (event.type === 'click') {
        endBlocking()
      } else if ((event.type === 'pointerup' || event.type === 'pointercancel') && pointer.pointerId === holdPointerId) {
        holdPointerId = null
        window.clearTimeout(releaseTimer)
        releaseTimer = window.setTimeout(endBlocking, RELEASE_CLICK_TIMEOUT_MS)
      }
      return
    }

    switch (event.type) {
      case 'pointerdown':
        if (holdPointerId === null && unlockButtonShown.value && isOverUnlockButton(pointer)) {
          startHold(pointer.pointerId)
        }
        break
      case 'pointermove':
        if (pointer.pointerId === holdPointerId && !isOverUnlockButton(pointer)) cancelHold()
        break
      case 'pointerup':
      case 'pointercancel':
        if (pointer.pointerId === holdPointerId) cancelHold()
        break
      case 'click':
      case 'keydown':
        if (holdPointerId === null) showUnlockButton()
        break
    }
  }

  watch(blockingInput, (blocking, _previous, onCleanup) => {
    if (!blocking) return
    // Window capture listeners run before every listener of the player and
    // the page. Touch moves must not be passive so they cannot scroll panels.
    for (const type of BLOCKED_EVENTS) {
      window.addEventListener(type, blockInput, { capture: true, passive: false })
    }
    onCleanup(() => {
      for (const type of BLOCKED_EVENTS) window.removeEventListener(type, blockInput, { capture: true })
    })
  })

  watch(isAvailable, available => {
    if (!available) unlockTouchControls()
  })

  onScopeDispose(() => {
    window.clearTimeout(hideTimer)
    window.clearTimeout(holdTimer)
    window.clearTimeout(releaseTimer)
  })

  return { touchControlsLocked, unlockButtonShown, unlockHolding, lockTouchControls, unlockTouchControls }
}
