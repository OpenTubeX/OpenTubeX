// Chromium draws title attribute tooltips natively, ignoring the app's theme.
// While the pointer rests on a titled element, its title is moved here so the
// native tooltip stays hidden, and a themed tooltip shows the text instead.

const SHOW_DELAY_MS = 500
// Moving straight to another titled element shows its tooltip without delay
const WARM_PERIOD_MS = 300
const COMPACT_ANCHOR_PX = 64
const ANCHOR_GAP_PX = 6
const CURSOR_GAP_PX = 18
const VIEWPORT_MARGIN_PX = 8

/** @type {HTMLDivElement} */
let tooltip
/** @type {MutationObserver} */
let observer
/** @type {Element | null} */
let anchor = null
let title = ''
// Whether the anchor's title attribute is currently held here
let stripped = false
// After a press, scroll or key press the tooltip stays hidden until the pointer leaves
let suppressed = false
let showTimer = 0
let warmUntil = 0
const pointer = { x: 0, y: 0 }

export function installTitleTooltips() {
  tooltip = document.createElement('div')
  tooltip.className = 'ftTitleTooltip'
  tooltip.popover = 'manual'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.dataset.tabPreviewOverlay = ''
  document.body.append(tooltip)

  observer = new MutationObserver(handleTitleMutation)

  document.addEventListener('pointerover', handlePointerOver, true)
  document.addEventListener('pointerout', handlePointerOut, true)
  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true })
  document.addEventListener('pointerdown', suppress, true)
  document.addEventListener('keydown', suppress, true)
  document.addEventListener('wheel', suppress, { capture: true, passive: true })
  document.addEventListener('scroll', handleScroll, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => setAnchor(null))
  window.addEventListener('blur', () => setAnchor(null))
}

/**
 * @param {PointerEvent} event
 */
function handlePointerOver(event) {
  if (event.pointerType === 'touch') return
  pointer.x = event.clientX
  pointer.y = event.clientY
  setAnchor(findAnchor(event.target))
}

/**
 * @param {PointerEvent} event
 */
function handlePointerOut(event) {
  // The pointer left the window
  if (event.relatedTarget === null) setAnchor(null)
}

/**
 * @param {PointerEvent} event
 */
function handlePointerMove(event) {
  pointer.x = event.clientX
  pointer.y = event.clientY
  // Keep the native tooltip hidden while the pointer moves on after a press
  if (suppressed && !stripped && anchor?.hasAttribute('title')) {
    stripTitle()
  }
}

/**
 * @param {Event} event
 */
function handleScroll(event) {
  if (anchor && event.target instanceof Node && event.target.contains(anchor)) suppress()
}

/**
 * @param {EventTarget | null} target
 * @returns {Element | null}
 */
function findAnchor(target) {
  if (!(target instanceof Element)) return null
  const titled = target.closest('[title]')
  // The active anchor has no title attribute, so closest() skips it
  if (anchor?.contains(target) && (titled === null || titled.contains(anchor))) return anchor
  // An empty title hides the tooltips of its ancestors
  return titled?.getAttribute('title').trim() ? titled : null
}

/**
 * @param {Element | null} next
 */
function setAnchor(next) {
  if (next === anchor) return

  if (anchor) {
    if (tooltip.matches(':popover-open')) warmUntil = performance.now() + WARM_PERIOD_MS
    hide()
    restoreTitle()
    anchor = null
    suppressed = false
  }
  if (next === null) return

  anchor = next
  stripTitle()
  if (performance.now() < warmUntil) {
    show()
  } else {
    showTimer = window.setTimeout(show, SHOW_DELAY_MS)
  }
}

function stripTitle() {
  title = anchor.getAttribute('title')
  anchor.removeAttribute('title')
  stripped = true
  observer.observe(anchor, { attributes: true, attributeFilter: ['title'] })
}

function restoreTitle() {
  if (!stripped) return
  stripped = false
  // Keep a title that the anchor's owner changed or removed in the meantime
  const changed = observer.takeRecords().length > 0
  observer.disconnect()
  if (!changed) anchor.setAttribute('title', title)
}

function handleTitleMutation() {
  const value = anchor.getAttribute('title')
  if (value === null) {
    // Removed by the anchor's owner, so there is nothing to restore
    stripped = false
    observer.disconnect()
    setAnchor(null)
    return
  }

  title = value
  anchor.removeAttribute('title')
  observer.takeRecords()
  if (!title.trim()) {
    hide()
  } else if (tooltip.matches(':popover-open')) {
    tooltip.textContent = title
    position()
  }
}

function suppress() {
  if (!anchor || suppressed) return
  suppressed = true
  hide()
  // Tests and other code may look up the element by its title after a click
  restoreTitle()
}

function show() {
  showTimer = 0
  if (!anchor?.isConnected || !stripped || !title.trim()) return

  tooltip.textContent = title
  // Reopen to move above dialogs and fullscreen elements shown since the last time
  if (tooltip.matches(':popover-open')) tooltip.hidePopover()
  tooltip.showPopover()
  position()
}

function hide() {
  window.clearTimeout(showTimer)
  showTimer = 0
  if (tooltip.matches(':popover-open')) tooltip.hidePopover()
}

/**
 * Place the tooltip below small anchors and below the pointer on large ones,
 * flipping it above when there is no room.
 */
function position() {
  const rect = anchor.getBoundingClientRect()
  const width = tooltip.offsetWidth
  const height = tooltip.offsetHeight
  const compact = rect.height <= COMPACT_ANCHOR_PX
  const centerX = rect.width <= COMPACT_ANCHOR_PX ? rect.left + rect.width / 2 : pointer.x
  const maxTop = window.innerHeight - height - VIEWPORT_MARGIN_PX

  let top = compact ? rect.bottom + ANCHOR_GAP_PX : pointer.y + CURSOR_GAP_PX
  if (top > maxTop) {
    top = (compact ? rect.top - ANCHOR_GAP_PX : pointer.y - ANCHOR_GAP_PX) - height
  }
  const left = Math.min(Math.max(centerX - width / 2, VIEWPORT_MARGIN_PX), window.innerWidth - width - VIEWPORT_MARGIN_PX)

  tooltip.style.left = `${Math.round(left)}px`
  tooltip.style.top = `${Math.round(Math.min(Math.max(top, VIEWPORT_MARGIN_PX), maxTop))}px`
}
