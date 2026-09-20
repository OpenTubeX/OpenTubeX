// Share observers across cards. Only the cheap shells stay mounted outside the
// overscan region; measured fractional heights keep the scroll range stable.
export function createListWindow({ IntersectionObserver: Intersection, ResizeObserver: Resize, requestAnimationFrame: frame, cancelAnimationFrame: cancel } = globalThis) {
  const items = new Map()
  const releases = new Set()
  let releaseFrame = null
  function scheduleRelease(item) {
    releases.add(item)
    if (releaseFrame !== null) return
    releaseFrame = frame(() => {
      releaseFrame = null
      // Measure the whole batch before Vue can patch any card's DOM. Separate
      // animation callbacks would otherwise alternate layout reads and writes.
      const measured = [...releases].map(candidate => ({
        candidate,
        height: candidate.element.getBoundingClientRect().height || candidate.height,
      }))
      releases.clear()
      for (const { candidate, height } of measured) candidate.evict(height)
    })
  }
  const intersection = new Intersection(entries => {
    for (const entry of entries) {
      const item = items.get(entry.target)
      if (!item) continue
      item.near = entry.isIntersecting
      if (item.near) item.mount()
      else item.release()
    }
  }, { rootMargin: '800px 0px' })
  const resize = new Resize(entries => {
    for (const entry of entries) {
      const item = items.get(entry.target)
      if (!item || entry.contentRect.width <= 0) continue
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      const resized = item.width !== null && Math.abs(width - item.width) > 0.01
      item.width = width
      if (resized && !item.isMounted() && item.height > 0) item.refresh()
      else if (item.isMounted()) {
        item.height = height
        if (!item.near) item.release()
      }
    }
  })

  return {
    observe(element, { mount, unmount, isMounted, isProtected }) {
      let retry = null
      const item = {
        element,
        near: true,
        width: null,
        height: 0,
        isMounted,
        mount() {
          releases.delete(item)
          clearTimeout(retry)
          retry = null
          mount()
        },
        release() {
          if (!item.near && isMounted()) scheduleRelease(item)
        },
        evict(height) {
          if (item.near || !items.has(element)) return
          if (isProtected()) {
            clearTimeout(retry)
            retry = setTimeout(() => item.release(), 1000)
          } else if (height > 0) unmount(height)
        },
        refresh() {
          item.mount()
          item.release()
        },
      }
      items.set(element, item)
      intersection.observe(element)
      resize.observe(element)
      return {
        refresh: () => item.refresh(),
        dispose() {
          releases.delete(item)
          clearTimeout(retry)
          intersection.unobserve(element)
          resize.unobserve(element)
          items.delete(element)
        }
      }
    },
    disconnect() {
      cancel(releaseFrame)
      releases.clear()
      intersection.disconnect()
      resize.disconnect()
    },
  }
}

let sharedWindow
export function observeWindowedListItem(element, options) {
  sharedWindow ??= createListWindow()
  return sharedWindow.observe(element, options)
}
