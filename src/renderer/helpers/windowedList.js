// Share observers across cards. Only the cheap shells stay mounted outside the
// overscan region; measured fractional heights keep the scroll range stable.
export function createListWindow({ IntersectionObserver: Intersection, ResizeObserver: Resize, requestAnimationFrame: frame, cancelAnimationFrame: cancel } = globalThis) {
  const items = new Map()
  const releases = new Set()
  const widthRemeasures = new Set()
  let releaseFrame = null
  let remeasureFrame = null
  function scheduleWidthRemeasure(item) {
    widthRemeasures.add(item)
    if (remeasureFrame !== null) return
    remeasureFrame = frame(remeasureWidths)
  }
  function remeasureWidths() {
    remeasureFrame = null
    // Rebuilding every distant card in one frame stalls large desktop feeds.
    let count = 0
    for (const item of widthRemeasures) {
      widthRemeasures.delete(item)
      if (items.has(item.element) && !item.near && !item.isMounted()) item.refresh()
      if (++count === 2) break
    }
    if (widthRemeasures.size) remeasureFrame = frame(remeasureWidths)
  }
  function scheduleRelease(item) {
    releases.add(item)
    if (releaseFrame !== null) return
    releaseFrame = frame(() => {
      releaseFrame = null
      // Measure the whole batch before Vue can patch any card's DOM. Separate
      // animation callbacks would otherwise alternate layout reads and writes.
      const measured = [...releases].filter(candidate => candidate.canEvict()).map(candidate => ({
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
      if (resized && !item.isMounted() && item.height > 0) scheduleWidthRemeasure(item)
      else if (item.isMounted()) {
        item.height = height
        if (!item.near) item.release()
      }
    }
  })

  return {
    observe(element, { mount, unmount, isMounted, isProtected }) {
      let retry = null
      let retryDelay = 1000
      const item = {
        element,
        near: true,
        width: null,
        height: 0,
        isMounted,
        mount() {
          widthRemeasures.delete(item)
          releases.delete(item)
          clearTimeout(retry)
          retry = null
          retryDelay = 1000
          mount()
        },
        release() {
          if (!item.near && isMounted()) scheduleRelease(item)
        },
        canEvict() {
          if (item.near || !items.has(element)) return false
          if (!isProtected()) return true
          clearTimeout(retry)
          retry = setTimeout(() => item.release(), retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000)
          return false
        },
        evict(height) {
          if (height > 0) {
            item.height = height
            unmount(height)
          }
        },
        dispose() {
          widthRemeasures.delete(item)
          releases.delete(item)
          clearTimeout(retry)
          intersection.unobserve(element)
          resize.unobserve(element)
          items.delete(element)
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
        dispose: () => item.dispose(),
      }
    },
    disconnect() {
      cancel(releaseFrame)
      cancel(remeasureFrame)
      releaseFrame = null
      remeasureFrame = null
      for (const item of items.values()) item.dispose()
      releases.clear()
      widthRemeasures.clear()
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
