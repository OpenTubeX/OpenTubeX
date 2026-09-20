/** Defer touch range changes until a tap or an intentional horizontal drag. */
export function attachTouchRange(input) {
  let gesture = null
  let touchPointerId = null
  let acceptedValue = input.value
  const previousTouchAction = input.style.touchAction
  input.style.touchAction = 'pan-y'

  function update(event) {
    const rect = input.getBoundingClientRect()
    const rtl = getComputedStyle(input).direction === 'rtl'
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const min = input.min === '' ? 0 : Number(input.min)
    const max = input.max === '' ? 100 : Number(input.max)
    const previous = input.value
    input.value = String(min + (rtl ? 1 - fraction : fraction) * (max - min))
    acceptedValue = input.value
    // Let the native range sanitize the step and bounds.
    if (input.value !== previous) input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  function down(event) {
    if (event.pointerType !== 'touch' || !event.isPrimary || input.disabled || touchPointerId !== null) return
    touchPointerId = event.pointerId
    acceptedValue = input.value
    event.preventDefault()
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, value: input.value, dragging: false }
    input.setPointerCapture(event.pointerId)
  }
  function move(event) {
    if (gesture?.id !== event.pointerId) return
    const dx = Math.abs(event.clientX - gesture.x)
    const dy = Math.abs(event.clientY - gesture.y)
    if (!gesture.dragging) {
      if (dy > 8 && dy >= dx) { gesture = null; return }
      if (dx < 8 || dx <= dy) return
      gesture.dragging = true
    }
    update(event)
  }
  function up(event) {
    if (touchPointerId !== event.pointerId) return
    touchPointerId = null
    if (gesture?.id !== event.pointerId) return
    const value = gesture.value
    update(event)
    gesture = null
    input.focus({ preventScroll: true })
    if (input.value !== value) input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function cancel(event) {
    if (touchPointerId !== event.pointerId) return
    touchPointerId = null
    const changed = gesture?.dragging && input.value !== gesture.value
    gesture = null
    if (changed) input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function keyboard() { touchPointerId = null; gesture = null }
  function nativeInput(event) {
    // WebView changes ranges on touch-down even when pointerdown is canceled.
    // Suppress those trusted events; update() emits the deliberate changes.
    if (touchPointerId === null || !event.isTrusted) return
    input.value = acceptedValue
    event.stopImmediatePropagation()
  }
  input.addEventListener('input', nativeInput, true)
  input.addEventListener('change', nativeInput, true)
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, keydown: keyboard }
  for (const [name, handler] of Object.entries(handlers)) input.addEventListener(name, handler)
  return () => {
    for (const [name, handler] of Object.entries(handlers)) input.removeEventListener(name, handler)
    input.removeEventListener('input', nativeInput, true)
    input.removeEventListener('change', nativeInput, true)
    input.style.touchAction = previousTouchAction
  }
}

const cleanups = new WeakMap()
export const vTouchRange = {
  mounted(input) { cleanups.set(input, attachTouchRange(input)) },
  unmounted(input) { cleanups.get(input)?.(); cleanups.delete(input) },
}
