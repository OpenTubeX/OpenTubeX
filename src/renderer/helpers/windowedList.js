// Share observers across cards. Only the cheap shells stay mounted outside the
// overscan region; measured fractional heights keep the scroll range stable.
export const WINDOWED_LIST_OVERSCAN_PX = 800

// Rows of a background tab keep their layout without rendering it. Measuring
// them would lay out the hidden tab, and against the presented tab's scroll
// position, so they keep their state until the tab shows again.
function isRendered(element) {
  return element.checkVisibility?.() ?? true
}

export function createListWindow({ IntersectionObserver: Intersection, ResizeObserver: Resize, requestAnimationFrame: frame, cancelAnimationFrame: cancel } = globalThis, { nested = false, viewport = globalThis } = {}) {
  const items = new Map()
  const releases = new Set()
  const widthRemeasures = new Set()
  let releaseFrame = null
  let remeasureFrame = null
  function scheduleRemeasure(item) {
    widthRemeasures.add(item)
    if (remeasureFrame !== null) return
    remeasureFrame = frame(remeasureWidths)
  }
  function remeasureWidths() {
    remeasureFrame = null
    // Rebuilding every distant card in one frame stalls large desktop feeds.
    let count = 0
    let rowTop
    for (const item of widthRemeasures) {
      // A hidden row measures nothing and would keep its stale height, so it
      // waits until the resize observer reports its box again, or until its
      // tab shows again. A suspended row waits until its list resumes.
      if (item.hidden || item.suspended || !isRendered(item.element)) continue
      // A grid cell stretches to the stale shells beside it, so every cell of
      // a grid row is remounted in the same frame.
      const top = item.element.offsetTop
      if (count >= 2 && (top === undefined || top !== rowTop)) {
        remeasureFrame = frame(remeasureWidths)
        return
      }
      rowTop = top
      widthRemeasures.delete(item)
      if (items.has(item.element) && !item.near && !item.isMounted()) {
        // The old height is stale. If the list hides before the row is laid
        // out, the row stays mounted until it can be measured.
        item.height = 0
        item.refresh()
      }
      count++
    }
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
  // Height-only breakpoints, such as landscape phones, can restyle every row
  // without the width change that remeasures shells. The keyboard resizing the
  // viewport leaves rows unchanged, so only a mounted row's new height counts.
  let viewportWidth = viewport.innerWidth
  let viewportCheck = null
  function checkViewportResize() {
    if (viewport.innerWidth !== viewportWidth) {
      viewportWidth = viewport.innerWidth
      return
    }
    if (viewportCheck !== null) return
    viewportCheck = frame(() => {
      viewportCheck = null
      const restyled = [...items.values()].some(item => item.isMounted() && item.height > 0 &&
        isRendered(item.element) && Math.abs(item.element.getBoundingClientRect().height - item.height) > 0.5)
      if (!restyled) return
      for (const item of items.values()) {
        if (!item.near && !item.isMounted() && item.height > 0) scheduleRemeasure(item)
      }
    })
  }
  if (nested) viewport.addEventListener('resize', checkViewportResize)
  // scrollMargin extends the overscan into nested scrollers such as the
  // watch-page playlist. Browsers without it mount rows as they appear.
  const margin = `${WINDOWED_LIST_OVERSCAN_PX}px 0px`
  const intersection = new Intersection(entries => {
    for (const entry of entries) {
      const item = items.get(entry.target)
      if (!item) continue
      // Hiding its tab leaves a row where it was. Showing the tab again
      // restores the scroll position that brings the same rows near.
      if (!entry.isIntersecting && !isRendered(entry.target)) continue
      item.near = entry.isIntersecting
      if (item.suspended) continue
      if (item.near) {
        item.mount()
        continue
      }
      // A row that resumed or a list that was refreshed while suspended can
      // still wait for its remeasure.
      if (widthRemeasures.has(item)) scheduleRemeasure(item)
      item.release()
    }
  }, nested ? { rootMargin: margin, scrollMargin: margin } : { rootMargin: margin })
  const resize = new Resize(entries => {
    for (const entry of entries) {
      const item = items.get(entry.target)
      // A suspended row observes its box anew when it resumes.
      if (!item || item.suspended) continue
      const wasHidden = item.hidden
      item.hidden = entry.contentRect.width <= 0
      if (item.hidden) continue
      if (wasHidden && widthRemeasures.has(item)) scheduleRemeasure(item)
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      const resized = item.width !== null && Math.abs(width - item.width) > 0.01
      item.width = width
      if (resized && !item.isMounted() && item.height > 0) scheduleRemeasure(item)
      else if (item.isMounted()) {
        item.height = height
        if (!item.near) item.release()
      }
    }
  })

  return {
    observe(element, { mount, unmount, isMounted, isProtected, suspended = false }) {
      let retry = null
      let retryDelay = 1000
      const item = {
        element,
        near: true,
        hidden: false,
        width: null,
        height: 0,
        // A suspended row keeps its content and size, such as in a page kept
        // hidden behind Watch, which owns the window's scroll position.
        suspended,
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
          if (!item.suspended && !item.near && isMounted()) scheduleRelease(item)
        },
        canEvict() {
          if (item.suspended || item.near || !items.has(element)) return false
          if (isRendered(element) && !isProtected()) return true
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
          if (item.suspended) {
            if (!isMounted()) widthRemeasures.add(item)
            return
          }
          item.mount()
          item.release()
        },
        suspend() {
          item.suspended = true
        },
        resume() {
          if (!item.suspended) return
          item.suspended = false
          // Whether the row is near and how wide it is are stale. Observing it
          // anew reports them for the page's own layout and scroll position,
          // and the width compares with the one before the row was suspended.
          intersection.unobserve(element)
          intersection.observe(element)
          resize.unobserve(element)
          resize.observe(element)
        },
      }
      items.set(element, item)
      intersection.observe(element)
      resize.observe(element)
      return {
        refresh: () => item.refresh(),
        // Mounts a row held back meanwhile, unless it has scrolled away again.
        mountIfNear: () => {
          if (!item.suspended && item.near && !item.isMounted()) item.mount()
        },
        // Restyled content changes the height a shell keeps. Distant shells
        // are remounted through the bounded queue to measure it again.
        remeasure: () => {
          if (!item.near && !item.isMounted() && item.height > 0) scheduleRemeasure(item)
        },
        // Holds the row as it is, without mounting, evicting or remeasuring it,
        // until it resumes and catches up with its position and width.
        suspend: () => item.suspend(),
        resume: () => item.resume(),
        dispose: () => item.dispose(),
        // The last height the resize observer or an eviction measured, or 0.
        measuredHeight: () => item.height,
      }
    },
    // A tab shown again reports no resize for rows that kept their size.
    resumeRemeasures() {
      if (widthRemeasures.size > 0 && remeasureFrame === null) remeasureFrame = frame(remeasureWidths)
    },
    disconnect() {
      cancel(releaseFrame)
      cancel(remeasureFrame)
      cancel(viewportCheck)
      releaseFrame = null
      remeasureFrame = null
      viewportCheck = null
      if (nested) viewport.removeEventListener('resize', checkViewportResize)
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

/** Remeasures the rows that waited while their tab was in the background. */
export function resumeWindowedListRemeasures() {
  sharedWindow?.resumeRemeasures()
  nestedWindow?.resumeRemeasures()
}

// Rows inside their own scroller, such as the watch-page playlist, need the
// overscan there too. Top-level lists and feeds use the shared window above.
let nestedWindow
export function observeNestedWindowedListItem(element, options) {
  nestedWindow ??= createListWindow(globalThis, { nested: true })
  return nestedWindow.observe(element, options)
}

// A page that mounts again, such as on Back, would start rows it has not
// rendered yet at their minimum height and restore its scroll offset into a
// shorter list. Rows keep the height they last had so the offset lands on the
// same content. Least recently measured heights go first.
const MAX_REMEMBERED_HEIGHTS = 5000
const rememberedHeights = new Map()

/**
 * @param {string} key
 * @returns {number}
 */
export function getRememberedListItemHeight(key) {
  return rememberedHeights.get(key) ?? 0
}

/**
 * @param {string} key
 * @param {number} height
 */
export function rememberListItemHeight(key, height) {
  rememberedHeights.delete(key)
  rememberedHeights.set(key, height)
  if (rememberedHeights.size > MAX_REMEMBERED_HEIGHTS) {
    rememberedHeights.delete(rememberedHeights.keys().next().value)
  }
}
