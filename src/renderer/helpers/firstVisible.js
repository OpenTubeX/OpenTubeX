// Lazily mounted list rows share one observer. Chrome recomputes every
// observer on each rendered frame, so per-row observers in long playlists,
// hidden tabs and closed sheets made scrolling and animations expensive.
const callbacks = new WeakMap()
let observer = null
let observedCount = 0

function getObserver() {
  observer ??= new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      const callback = isIntersecting && callbacks.get(target)
      if (!callback) continue
      stop(target)
      callback()
    }
  })
  return observer
}

function stop(element) {
  if (!callbacks.delete(element)) return
  observer.unobserve(element)
  // Release the observer while nothing waits to become visible.
  if (--observedCount === 0) {
    observer.disconnect()
    observer = null
  }
}

function update(element, callback) {
  if (!callback) {
    stop(element)
    return
  }
  if (!callbacks.has(element)) {
    getObserver().observe(element)
    observedCount++
  }
  callbacks.set(element, callback)
}

/** Calls the bound function once the element first intersects the viewport. Bind `false` to stop observing. */
export const vFirstVisible = {
  mounted: (element, { value }) => update(element, value),
  updated: (element, { value }) => update(element, value),
  unmounted: stop
}
