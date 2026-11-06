/**
 * Calls `handler` with a press's `pointerdown` once that press ends. Android
 * delivers the start of an edge Back swipe to the page before cancelling it.
 * Closing a popup on `pointerdown` would let that Back also close the layer
 * behind the popup.
 * @param {(event: PointerEvent) => void} handler
 * @param {boolean} [capture]
 * @returns {() => void} Removes the listeners.
 */
export function listenForOutsidePress(handler, capture = false) {
  /** @type {Map<number, PointerEvent>} */
  const presses = new Map()
  const start = event => presses.set(event.pointerId, event)
  const end = event => {
    const press = presses.get(event.pointerId)
    presses.delete(event.pointerId)
    if (press) handler(press)
  }
  const cancel = event => presses.delete(event.pointerId)
  document.addEventListener('pointerdown', start, capture)
  document.addEventListener('pointerup', end, capture)
  document.addEventListener('pointercancel', cancel, capture)
  return () => {
    document.removeEventListener('pointerdown', start, capture)
    document.removeEventListener('pointerup', end, capture)
    document.removeEventListener('pointercancel', cancel, capture)
  }
}
