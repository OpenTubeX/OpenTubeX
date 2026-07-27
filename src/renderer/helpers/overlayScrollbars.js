import { watch } from 'vue'
import { ClickScrollPlugin, OverlayScrollbars } from 'overlayscrollbars'

import store from '../store/index'

// Kept out of the core bundle by the library, so `clickScroll` below silently
// does nothing unless it is registered.
OverlayScrollbars.plugin(ClickScrollPlugin)

/*
 * Chromium's own overlay scrollbars can't be styled and fade out when idle,
 * so we hide the native ones and draw our own instead. The look is themed in
 * themes.css via the library's --os-* custom properties.
 */

/**
 * Every live instance and how it was set up, so the "Always Show Scrollbars"
 * switch can rebuild them.
 *
 * @type {Map<import('overlayscrollbars').OverlayScrollbars, HTMLElement | object>}
 */
const instances = new Map()

function scrollbarOptions(initialization) {
  const options = {
    scrollbars: {
      // 'move' hides the scrollbars once the pointer has been still for
      // `autoHideDelay` and brings them back as soon as it moves again.
      autoHide: store.getters.getAlwaysShowScrollbars ? 'never' : 'move',
      // Matches how the native scrollbars behaved: clicking the track jumps
      // straight to that position instead of paging towards it.
      clickScroll: true
    }
  }

  if (initialization === document.body) {
    // The page viewport is always a normal block-flow body. Avoid repeatedly
    // reading all flow-related computed styles while long feeds are changing;
    // only direction can change at runtime.
    options.update = {
      flowDirectionStyles: () => ({ direction: document.documentElement.dir })
    }
  }

  return options
}

/**
 * @param {HTMLElement | object} initialization the target element, or a full
 * initialization object when the caller wants to pick the scrolling element
 */
function create(initialization) {
  const instance = OverlayScrollbars(initialization, scrollbarOptions(initialization))
  instances.set(instance, initialization)
  instance.on('destroyed', () => instances.delete(instance))

  if (initialization === document.body) {
    optimizeBodyScrollbarDrag(instance)
  }

  return instance
}

/**
 * OverlayScrollbars applies every pointermove directly while a handle is
 * dragged. Mouse input can arrive faster than Chromium can paint a long video
 * feed, making the handle trail the pointer. Coalesce the page scrollbar's
 * moves to one native scroll per animation frame.
 *
 * @param {import('overlayscrollbars').OverlayScrollbars} instance
 */
function optimizeBodyScrollbarDrag(instance) {
  const { handle, track } = instance.elements().scrollbarVertical

  const onPointerDown = (event) => {
    if (event.button !== 0 || !event.isPrimary) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const pointerId = event.pointerId
    const startClientY = event.clientY
    const startScrollY = window.scrollY
    const scrollRange = instance.state().overflowAmount.y
    const trackRange = track.clientHeight - handle.clientHeight
    let clientY = startClientY
    let frame = null

    if (trackRange <= 0 || scrollRange <= 0) {
      return
    }

    const applyDrag = () => {
      frame = null
      window.scrollTo(0, startScrollY + (clientY - startClientY) / trackRange * scrollRange)
    }

    const onPointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return
      }

      moveEvent.preventDefault()
      moveEvent.stopPropagation()
      clientY = moveEvent.clientY
      frame ??= requestAnimationFrame(applyDrag)
    }

    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return
      }

      finishEvent.stopPropagation()
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)

      if (frame !== null) {
        cancelAnimationFrame(frame)
        applyDrag()
      }
    }

    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    handle.setPointerCapture(pointerId)
  }

  handle.addEventListener('pointerdown', onPointerDown)
  instance.on('destroyed', () => handle.removeEventListener('pointerdown', onPointerDown))
}

/**
 * Replaces the main window's scrollbars. `window.scrollTo`, `window.scrollY`
 * and the document's scroll events keep working when the body is the target.
 */
export function initializeAppScrollbars() {
  create(document.body)

  // Rebuilt rather than reconfigured: switching `autoHide` on a live instance
  // leaves its already scheduled hide behind, so the scrollbars disappear again
  // a second after being switched to "always show".
  watch(() => store.getters.getAlwaysShowScrollbars, () => {
    for (const [instance, initialization] of [...instances]) {
      instance.destroy()
      create(initialization)
    }
  })
}

/**
 * @param {HTMLElement} element
 * @param {boolean} enabled
 */
function toggleOverlayScrollbars(element, enabled) {
  const instance = OverlayScrollbars(element)

  if (enabled && !instance) {
    // Hides the native scrollbars for the moment before the library takes over,
    // the same way index.ejs does it for the page itself.
    element.setAttribute('data-overlayscrollbars-initialize', '')
    // Reusing the element as the viewport keeps it the scrolling element, so
    // existing scrollTop/scrollLeft handling and CSS carry on working.
    create({ target: element, elements: { viewport: element } })
  } else if (!enabled && instance) {
    element.removeAttribute('data-overlayscrollbars-initialize')
    instance.destroy()
  }
}

/**
 * `v-overlay-scrollbars` - does the same for a nested scroll container.
 * Pass `false` to leave the native scrollbars alone, for containers that only
 * scroll in some layouts.
 *
 * Surviving a `<Teleport>` is fine, but note that the library restores the
 * scroll offset the container had before the move, where a native scroll
 * container would have been reset to the top. Containers that recompute their
 * own scroll position after moving (the watch page playlist) can't use this.
 */
export const overlayScrollbarsDirective = {
  mounted(element, binding) {
    toggleOverlayScrollbars(element, binding.value !== false)
  },

  updated(element, binding) {
    toggleOverlayScrollbars(element, binding.value !== false)
  },

  unmounted(element) {
    toggleOverlayScrollbars(element, false)
  }
}
