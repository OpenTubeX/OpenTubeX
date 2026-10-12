import { onBeforeUnmount } from 'vue'
import { applyAnimationSpeed } from '../helpers/animationSpeed'
import { isReducedMotionEnabled } from '../helpers/reducedMotion'

// Shared by navigation and context sheets. Native upward scrolling remains
// available; downward pulls only take over at the top of the touched scrollport.
export function useBottomSheetDismiss(sheet, dismiss) {
  let drag = null
  let suppressClick = false
  let sheetAnimation = null

  function clearDrag() {
    drag = null
    window.removeEventListener('pointermove', movePointer, true)
    window.removeEventListener('pointerup', endPointer, true)
    window.removeEventListener('pointercancel', cancelPointer, true)
    window.removeEventListener('touchend', endTouch, true)
    window.removeEventListener('touchcancel', cancelDrag, true)
  }

  function startDrag(event) {
    if (event.button !== 0 || event.isPrimary === false || drag) return
    suppressClick = false
    const handle = event.target.closest('.bottomSheetHandle')
    // Check the touched content and ancestor scrollports, including an inner
    // OverlayScrollbars host used as its viewport, up to the fixed sheet.
    if (!handle) {
      for (let element = event.target; element && element !== sheet.value; element = element.parentElement) {
        if (element.scrollTop > 1) return
      }
    }
    drag = { id: event.pointerId, touch: event.pointerType === 'touch', x: event.clientX, y: event.clientY, offset: 0, active: false }
    window.addEventListener('pointermove', movePointer, true)
    window.addEventListener('pointerup', endPointer, true)
    window.addEventListener('pointercancel', cancelPointer, true)
    window.addEventListener('touchend', endTouch, true)
    window.addEventListener('touchcancel', cancelDrag, true)
  }

  function move(x, y, event) {
    const distance = y - drag.y
    if (!drag.active) {
      if (Math.max(Math.abs(distance), Math.abs(x - drag.x)) < 8) return
      if (distance <= 0 || Math.abs(x - drag.x) > distance) {
        clearDrag()
        return
      }
      const transform = getComputedStyle(sheet.value).transform
      drag.originOffset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42
      sheetAnimation?.cancel()
      drag.active = true
      drag.start = performance.now()
      drag.startOffset = distance
      suppressClick = true
    }
    if (event.cancelable) event.preventDefault()
    drag.offset = Math.max(0, distance)
    sheet.value.style.transform = `translateY(${drag.originOffset + drag.offset}px)`
  }

  function movePointer(event) {
    if (drag?.id === event.pointerId && !drag.touch) move(event.clientX, event.clientY, event)
  }
  function moveTouch(event) {
    if (!drag?.touch) return
    if (event.touches.length !== 1) return cancelDrag()
    const touch = event.touches[0]
    move(touch.clientX, touch.clientY, event)
  }
  function finish() {
    const { active, offset, start, startOffset } = drag
    clearDrag()
    if (!active) return
    // Match the timed distance to its first movement sample. A release-only
    // sample has no measured movement and cannot establish flick velocity.
    const elapsed = performance.now() - start
    if (offset > 80 || (offset > 20 && elapsed > 0 && (offset - startOffset) / elapsed > 0.6)) {
      dismiss()
    } else {
      const element = sheet.value
      const transform = element.style.transform
      element.style.transform = ''
      sheetAnimation = animate(element, [
        { transform }, { transform: 'translateY(0)' }
      ], 140)
    }
  }
  function endPointer(event) {
    if (drag?.id !== event.pointerId || drag.touch) return
    move(event.clientX, event.clientY, event)
    if (drag) finish()
  }
  function endTouch(event) {
    if (!drag?.touch) return
    // Multiple fingers cancel the single-finger drag; an unrelated release
    // must never advance it using another finger's coordinates.
    if (event.touches.length > 0 || event.changedTouches.length !== 1) return cancelDrag()
    // WebView can coalesce the final move; the release carries its true end.
    const touch = event.changedTouches[0]
    if (touch) move(touch.clientX, touch.clientY, event)
    if (drag) finish()
  }
  function cancelPointer(event) {
    if (drag?.id === event.pointerId) cancelDrag()
  }
  function cancelDrag() {
    clearDrag()
    if (sheet.value) sheet.value.style.transform = ''
  }
  function updateScrollAction(event) {
    const viewport = event.target
    if (!viewport.hasAttribute('data-overlayscrollbars-viewport')) return
    viewport.style.setProperty('--bottom-sheet-scroll-action', viewport.scrollTop > 1 ? 'pan-y' : 'pan-down')
  }
  function filterClick(event) {
    if (!suppressClick || event.detail === 0) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }
  function animate(element, frames, duration) {
    return applyAnimationSpeed(element.animate(frames, {
      duration: isReducedMotionEnabled() ? 0 : duration,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    }))
  }
  function transition(backdrop, done, leaving) {
    const element = backdrop.querySelector('[data-bottom-sheet]')
    const transform = getComputedStyle(element).transform
    clearDrag()
    sheetAnimation?.cancel()
    element.style.transform = ''
    const animation = sheetAnimation = animate(element, leaving
      ? [{ transform }, { transform: 'translateY(100%)' }]
      : [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], leaving ? 140 : 220)
    animate(backdrop, [{ opacity: leaving ? 1 : 0 }, { opacity: leaving ? 0 : 1 }], leaving ? 140 : 220)
    animation.finished.then(done, done)
  }

  onBeforeUnmount(() => {
    clearDrag()
    sheetAnimation?.cancel()
  })
  return {
    startDrag,
    // Bind before the gesture begins; directional touch-action keeps WebView
    // from taking a downward pull away from the sheet at the scrollport top.
    moveTouch,
    updateScrollAction,
    filterClick,
    enter: (element, done) => transition(element, done, false),
    leave: (element, done) => transition(element, done, true)
  }
}
