import { isAppHidden } from './appVisibility.js'

/** Pause loading animations outside their clipped viewport or a visible window. */
export function initializeShimmerVisibility() {
  const root = document.body
  const observed = new Set()
  let windowHidden = false

  const intersections = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (observed.has(target)) {
        // Edge contact counts as intersecting. With the default threshold, moving
        // from that edge into view does not trigger another notification.
        target.toggleAttribute('data-shimmer-visible', isIntersecting)
      }
    }
  })

  function forget(element) {
    intersections.unobserve(element)
    observed.delete(element)
    element.removeAttribute('data-shimmer-visible')
  }

  function update(element) {
    if (element.classList.contains('ft-shimmer')) {
      if (!observed.has(element)) {
        observed.add(element)
        element.removeAttribute('data-shimmer-visible')
        intersections.observe(element)
      }
    } else if (observed.has(element)) {
      forget(element)
    }
  }

  function scan(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    update(node)
    for (const element of node.querySelectorAll('.ft-shimmer')) update(element)
  }

  // Scan new subtrees only. Text updates and our visibility attributes do not
  // require searching the page or reading layout on the main thread.
  const mutations = new MutationObserver(records => {
    let removed = false
    for (const record of records) {
      if (record.type === 'attributes') update(record.target)
      else {
        for (const node of record.addedNodes) scan(node)
        removed ||= record.removedNodes.length > 0
      }
    }
    if (removed) {
      for (const element of observed) {
        if (!root.contains(element)) forget(element)
      }
    }
  })
  scan(root)
  mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

  function updateWindowVisibility() {
    document.documentElement.toggleAttribute('data-shimmer-hidden', windowHidden || isAppHidden())
  }
  document.addEventListener('visibilitychange', updateWindowVisibility)
  // Electron keeps background throttling disabled for playback and can skip
  // document visibility events when minimized or hidden to the tray.
  const removeWindowListener = window.ftElectron?.handleWindowMinimizedState?.(hidden => {
    windowHidden = hidden
    updateWindowVisibility()
  })
  updateWindowVisibility()

  return () => {
    mutations.disconnect()
    intersections.disconnect()
    document.removeEventListener('visibilitychange', updateWindowVisibility)
    removeWindowListener?.()
    for (const element of observed) element.removeAttribute('data-shimmer-visible')
    observed.clear()
    document.documentElement.removeAttribute('data-shimmer-hidden')
  }
}
