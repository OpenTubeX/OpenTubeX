/**
 * Measure the visible headers without moving the document's scroll viewport.
 * Resize covers wrapped labels; scroll covers sticky headers and cached routes
 * being detached or restored. Keep fractional CSS pixels at non-default zoom.
 *
 * @param {(inset: number) => void} onChange
 * @param {Window} [pageWindow]
 */
export function observePageScrollbarHeaders(onChange, pageWindow = window) {
  const headers = new Set()
  let frame = null
  let previousInset = -1

  const update = () => {
    frame = null
    let inset = 0
    for (const header of headers) {
      if (!header.isConnected) continue
      const bounds = header.getBoundingClientRect()
      if (bounds.height > 0 && pageWindow.getComputedStyle(header).visibility !== 'hidden') {
        inset = Math.max(inset, bounds.bottom)
      }
    }
    inset = Math.min(pageWindow.innerHeight, inset)
    if (inset !== previousInset) {
      previousInset = inset
      onChange(inset)
    }
  }
  const schedule = () => {
    frame ??= pageWindow.requestAnimationFrame(update)
  }
  const observer = new pageWindow.ResizeObserver(schedule)
  pageWindow.addEventListener('scroll', schedule, { passive: true })
  pageWindow.addEventListener('resize', schedule)

  return {
    refresh: schedule,
    observe(header) {
      headers.add(header)
      observer.observe(header)
      schedule()
    },
    unobserve(header) {
      headers.delete(header)
      observer.unobserve(header)
      schedule()
    },
    destroy() {
      observer.disconnect()
      pageWindow.removeEventListener('scroll', schedule)
      pageWindow.removeEventListener('resize', schedule)
      if (frame !== null) pageWindow.cancelAnimationFrame(frame)
    }
  }
}
