import { onBeforeUnmount } from 'vue'

import { suppressReleaseClick } from './useGridReorder'

const HOLD_DELAY = 500
const HOLD_SLOP = 10

/**
 * Runs an action instead of the click when a pointer holds an element still.
 * A touch hold also replaces the long-press link menu, which it fires earlier
 * when the system's long-press delay is shorter. Bind `onPointerDown` on the
 * element, and call `cancel` when the element goes away without unmounting.
 * @param {() => void} onHold
 */
export function usePointerHold(onHold) {
  /** @type {{ pointerId: number, pointerType: string, x: number, y: number, timer: ReturnType<typeof setTimeout> | null } | null} */
  let hold = null

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    stop()
    if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    hold = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(fire, HOLD_DELAY)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    // Ahead of the app's long-press link menu, which listens on the document.
    window.addEventListener('contextmenu', handleContextMenu, true)
    // Android drags a held link, and a mouse drag ends the press.
    window.addEventListener('dragstart', handleDragStart, true)
    // The press can be released in another window.
    window.addEventListener('blur', stop)
  }

  function fire() {
    if (hold?.timer == null) return
    clearTimeout(hold.timer)
    hold.timer = null
    suppressReleaseClick(hold.pointerId)
    onHold()
  }

  /** @param {PointerEvent} event */
  function move(event) {
    if (hold?.timer != null && event.pointerId === hold.pointerId &&
      Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLOP) {
      stop()
    }
  }

  /** @param {PointerEvent} event */
  function release(event) {
    if (event.pointerId === hold?.pointerId) stop()
  }

  /** @param {MouseEvent} event */
  function handleContextMenu(event) {
    // A mouse opens the menu on purpose, such as with Control-click on macOS.
    if (hold?.pointerType === 'mouse') {
      stop()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    fire()
  }

  /** @param {DragEvent} event */
  function handleDragStart(event) {
    if (hold?.pointerType === 'touch') {
      event.preventDefault()
    } else {
      stop()
    }
  }

  /** Ends a hold that has not fired yet. */
  function cancel() {
    if (hold?.timer != null) stop()
  }

  function stop() {
    if (hold?.timer != null) clearTimeout(hold.timer)
    hold = null
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', release, true)
    window.removeEventListener('pointercancel', release, true)
    window.removeEventListener('contextmenu', handleContextMenu, true)
    window.removeEventListener('dragstart', handleDragStart, true)
    window.removeEventListener('blur', stop)
  }

  onBeforeUnmount(stop)
  return { cancel, onPointerDown }
}
