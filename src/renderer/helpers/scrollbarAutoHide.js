const HIDDEN_CLASS = 'app-scrollbar-idle'
const AUTO_HIDE_DELAY = 1300

/**
 * Preserve move-to-show scrollbars without the library rewriting both bars'
 * classes on every scroll frame. Only visibility transitions touch the DOM.
 *
 * @param {import('overlayscrollbars').Elements} elements
 * @returns {() => void} removes listeners and the pending hide timer
 */
export function addScrollbarAutoHide(elements) {
  const { host, scrollEventElement, scrollbarHorizontal, scrollbarVertical } = elements
  const scrollbars = [scrollbarHorizontal.scrollbar, scrollbarVertical.scrollbar]
  const document = host.ownerDocument
  let hidden = false
  let hideTimer
  let activePointer = null

  const setHidden = (value) => {
    if (hidden === value) return
    hidden = value
    for (const scrollbar of scrollbars) scrollbar.classList.toggle(HIDDEN_CLASS, value)
  }
  const show = () => {
    setHidden(false)
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (activePointer === null) setHidden(true)
    }, AUTO_HIDE_DELAY)
  }
  const onPointerMove = (event) => {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') show()
  }
  const onPointerDown = (event) => {
    if (event.button !== 0 || !event.isPrimary) return
    activePointer = event.pointerId
    show()
  }
  const onPointerEnd = (event) => {
    if (event.pointerId !== activePointer) return
    activePointer = null
    show()
  }

  setHidden(true)
  host.addEventListener('pointermove', onPointerMove, { passive: true })
  scrollEventElement.addEventListener('scroll', show, { passive: true })
  for (const scrollbar of scrollbars) {
    scrollbar.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
    scrollbar.addEventListener('pointerleave', onPointerMove, { passive: true })
    scrollbar.addEventListener('lostpointercapture', onPointerEnd, { passive: true })
  }
  // Capture also sees the page drag handler's stopped pointerup/pointercancel.
  document.addEventListener('pointerup', onPointerEnd, { passive: true, capture: true })
  document.addEventListener('pointercancel', onPointerEnd, { passive: true, capture: true })

  return () => {
    clearTimeout(hideTimer)
    host.removeEventListener('pointermove', onPointerMove)
    scrollEventElement.removeEventListener('scroll', show)
    for (const scrollbar of scrollbars) {
      scrollbar.removeEventListener('pointerdown', onPointerDown, { capture: true })
      scrollbar.removeEventListener('pointerleave', onPointerMove)
      scrollbar.removeEventListener('lostpointercapture', onPointerEnd)
    }
    document.removeEventListener('pointerup', onPointerEnd, { capture: true })
    document.removeEventListener('pointercancel', onPointerEnd, { capture: true })
  }
}
