import { lightHaptic } from '../../helpers/mobileHaptics'

const HOLD_DELAY = 400

/**
 * A button whose tap runs one action and whose hold, context menu, or
 * ContextMenu key runs another, like the tab cards' actions menu.
 *
 * @param {() => void} hold
 * @param {() => boolean} [isHoldOpen] true while the hold action's view is showing
 */
export function useHoldAction(hold, isHoldOpen = () => false) {
  let timer = null
  let held = false

  function cancel() {
    window.clearTimeout(timer)
    timer = null
  }

  function runHold() {
    cancel()
    held = true
    hold()
  }

  return {
    cancel,
    /** @param {PointerEvent} event */
    start(event) {
      held = false
      cancel()
      if (event.button !== 0) return
      timer = window.setTimeout(() => {
        lightHaptic()
        runHold()
      }, HOLD_DELAY)
    },
    // Android also reports a touch hold as a context menu after the timer.
    contextMenu() {
      if (!isHoldOpen()) runHold()
    },
    /** @param {KeyboardEvent} event */
    keydown(event) {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      event.preventDefault()
      runHold()
    },
    /**
     * Skips only the click that ends a pointer hold. Keyboard clicks
     * (detail 0) always tap, even right after the ContextMenu key.
     * @param {MouseEvent} event
     * @param {() => void} tap
     */
    click(event, tap) {
      const endsHold = held && event.detail !== 0
      held = false
      if (!endsHold) tap()
    },
  }
}
