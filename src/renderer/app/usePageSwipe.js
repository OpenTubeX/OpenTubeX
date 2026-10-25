import { computed, nextTick, ref, shallowRef, useTemplateRef } from 'vue'

import store from '../store/index'
import { findSwipeTab, shouldFinishPageSwipe } from '../helpers/capacitorPageSwipe'

const isCapacitor = process.env.IS_CAPACITOR

/**
 * Mobile header gestures: a horizontal swipe on the top navigation drags the
 * neighboring tab's page into view, and a downward swipe opens the tab
 * organizer. Taps on header controls are not captured, and a drag does not
 * turn into a click when it is released.
 *
 * @param {{
 *   isAnyPromptOpen: import('vue').ComputedRef<boolean>,
 *   activeTabId: import('vue').ComputedRef<string | null>,
 *   presentedTabId: import('vue').ComputedRef<string | null>,
 *   capacitorTabService: { activateTab: (tabId: string) => Promise<unknown> } | null
 * }} options
 */
export function usePageSwipe({ isAnyPromptOpen, activeTabId, presentedTabId, capacitorTabService }) {
  const pageSwipeNeighborIds = computed(() => {
    if (!isCapacitor || activeTabId.value !== presentedTabId.value) return []
    return [-1, 1]
      .map(direction => findSwipeTab(store.getters.getTabs, presentedTabId.value, direction)?.id)
      .filter(Boolean)
  })

  const topNav = useTemplateRef('topNav')
  const organizerSwipeActive = ref(false)
  const pageSwipe = shallowRef(null)
  let pageSwipePointer = null
  let pageSwipeClickPointerId = null
  let pageSwipeClickTimeout = null

  function clearPageSwipeClick() {
    window.clearTimeout(pageSwipeClickTimeout)
    pageSwipeClickTimeout = null
    pageSwipeClickPointerId = null
  }

  function startPageSwipe(event) {
    if (event.isPrimary) clearPageSwipeClick()
    if (!isCapacitor || event.pointerType !== 'touch' || !event.isPrimary ||
        pageSwipe.value || organizerSwipeActive.value || isAnyPromptOpen.value ||
        activeTabId.value !== presentedTabId.value ||
        !event.target.closest('.topNavInner') ||
        event.target.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"], .dropdownLayer, .ft-input-component .options')) return

    const width = document.querySelector('.app > .routerView')?.getBoundingClientRect().width
    if (!width) return
    pageSwipePointer = {
      id: event.pointerId,
      fromId: presentedTabId.value,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      width,
      dragging: false,
      cancelled: false
    }
  }

  function movePageSwipe(event) {
    const pointer = pageSwipePointer
    if (!pointer || pointer.id !== event.pointerId || pointer.cancelled) return

    const distance = event.clientX - pointer.x
    const verticalDistance = Math.abs(event.clientY - pointer.y)
    if (!pointer.dragging) {
      if (Math.max(Math.abs(distance), verticalDistance) < 10) return
      if (verticalDistance > Math.abs(distance) * 1.2) {
        const organizer = topNav.value?.organizerSwipe
        if (event.clientY <= pointer.y || !organizer?.begin()) {
          pageSwipePointer = null
          return
        }
        pointer.organizer = organizer
        organizerSwipeActive.value = true
      } else if (Math.abs(distance) < verticalDistance * 1.2) {
        return
      }
    }

    if (isAnyPromptOpen.value || activeTabId.value !== pointer.fromId || presentedTabId.value !== pointer.fromId) {
      // Keep tracking the release so cancellation cannot turn a drag into a click.
      pointer.cancelled = true
      pageSwipe.value = null
      if (pointer.organizer) {
        pointer.organizer.cancel()
        organizerSwipeActive.value = false
      }
      return
    }

    if (!pointer.dragging) {
      pointer.dragging = true
      pageSwipeClickPointerId = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.preventDefault()

    if (pointer.organizer) {
      pointer.organizer.update(event.clientY - pointer.y)
      return
    }

    const direction = distance < 0 ? 1 : -1
    const target = findSwipeTab(store.getters.getTabs, pointer.fromId, direction)
    pageSwipe.value = target
      ? {
          fromId: pointer.fromId,
          toId: target.id,
          direction,
          offset: Math.max(-pointer.width, Math.min(pointer.width, distance)),
          width: pointer.width,
          scrollTop: window.scrollY,
          settling: false
        }
      : null
  }

  function suppressPageSwipeClick(event) {
    if (event.detail === 0 || event.pointerId !== pageSwipeClickPointerId) return
    clearPageSwipeClick()
    event.preventDefault()
    event.stopPropagation()
  }

  async function finishPageSwipe(event, cancelled = false) {
    const pointer = pageSwipePointer
    if (!pointer || pointer.id !== event.pointerId) return
    pageSwipePointer = null
    // Keep suppression for the click dispatched with pointerup, then expire it
    // even when capture release or cancellation produces no click.
    if (pointer.dragging) pageSwipeClickTimeout = window.setTimeout(clearPageSwipeClick, 0)
    if (pointer.organizer) {
      try {
        await pointer.organizer.finish(event.timeStamp - pointer.time, cancelled || pointer.cancelled || isAnyPromptOpen.value || activeTabId.value !== pointer.fromId || presentedTabId.value !== pointer.fromId)
      } finally {
        organizerSwipeActive.value = false
      }
      return
    }
    const swipe = pageSwipe.value
    if (!swipe) return

    const commit = !cancelled && !isAnyPromptOpen.value && shouldFinishPageSwipe(swipe.offset, swipe.width, event.timeStamp - pointer.time) &&
      findSwipeTab(store.getters.getTabs, swipe.fromId, swipe.direction)?.id === swipe.toId
    const reducedMotion = document.documentElement.dataset.reducedMotion === 'reduce' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reducedMotion) {
      // Let a fast drag paint once before starting the release transition.
      await nextTick()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (pageSwipe.value !== swipe) return
    }
    const settledSwipe = {
      ...swipe,
      offset: commit ? Math.sign(swipe.offset) * swipe.width : 0,
      settling: true
    }
    pageSwipe.value = settledSwipe
    await nextTick()
    if (!reducedMotion) {
      const target = document.querySelector('.pageSwipeTo')
      if (target) {
        await new Promise(resolve => {
          const finish = () => {
            target.removeEventListener('transitionend', onTransition)
            target.removeEventListener('transitioncancel', onTransition)
            window.clearTimeout(timeoutId)
            resolve()
          }
          const onTransition = transition => {
            if (transition.target === target && transition.propertyName === 'left') finish()
          }
          target.addEventListener('transitionend', onTransition)
          target.addEventListener('transitioncancel', onTransition)
          // Covers the slowest 25% animation-speed setting if WebView skips the event.
          const timeoutId = window.setTimeout(finish, 1000)
        })
      }
    }
    if (pageSwipe.value !== settledSwipe) return
    try {
      if (commit && !isAnyPromptOpen.value && activeTabId.value === swipe.fromId && presentedTabId.value === swipe.fromId &&
          findSwipeTab(store.getters.getTabs, swipe.fromId, swipe.direction)?.id === swipe.toId) {
        await capacitorTabService.activateTab(swipe.toId)
      }
    } finally {
      pageSwipe.value = null
    }
  }

  function cancelPageSwipe(event) {
    if (event) {
      finishPageSwipe(event, true)
      return
    }
    clearPageSwipeClick()
    topNav.value?.organizerSwipe?.cancel()
    organizerSwipeActive.value = false
    pageSwipePointer = null
    pageSwipe.value = null
  }

  return {
    pageSwipe,
    organizerSwipeActive,
    pageSwipeNeighborIds,
    startPageSwipe,
    movePageSwipe,
    suppressPageSwipeClick,
    finishPageSwipe,
    cancelPageSwipe
  }
}
