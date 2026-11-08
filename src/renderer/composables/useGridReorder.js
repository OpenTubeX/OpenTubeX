import { nextTick, onBeforeUnmount, ref } from 'vue'

import { computeReorderOffsets } from '../helpers/reorderOffsets'

const DRAG_THRESHOLD = 4
const SCROLL_EDGE = 64
// CSS pixels per second with the pointer at the scroller's edge.
const SCROLL_SPEED = 900

/**
 * Reorders the cards of a grid, or of a single-column list, by dragging their
 * handles with any pointer type. Cards keep their DOM order during the drag
 * and slide into the proposed order with `translate`. Targets are measured
 * against the layout from before the drag, so a card sliding away under the
 * pointer cannot change the target. The order is committed once the dropped
 * card has settled into its slot; Escape cancels the drag.
 *
 * Bind `onPointerDown` as a capturing pointerdown listener on the list.
 *
 * @param {object} options
 * @param {string} options.itemSelector Matches the list's reorderable children
 * @param {string} options.handleSelector
 * @param {(item: HTMLElement) => string} options.getId
 * @param {(id: string, index: number) => void} options.commit Must render the new order on the next tick
 */
export function useGridReorder({ itemSelector, handleSelector, getId, commit }) {
  /** @type {import('vue').Ref<string | null>} Set while a card is dragged or settles */
  const draggedId = ref(null)
  let session = null
  let scrollFrame = null
  let lastScrollTime = null

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (session || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return
    const list = /** @type {HTMLElement} */ (event.currentTarget)
    const item = event.target.closest(handleSelector)?.closest(itemSelector)
    if (!item || item.parentElement !== list) return
    // Keep the pointer from selecting text, focusing the handle or opening the card's long-press menu.
    event.preventDefault()
    event.stopPropagation()
    session = {
      list,
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      started: false,
      dropping: false
    }
    list.setPointerCapture(event.pointerId)
    list.addEventListener('pointermove', onPointerMove)
    list.addEventListener('pointerup', onPointerUp)
    list.addEventListener('pointercancel', cancel)
    list.addEventListener('lostpointercapture', cancel)
    list.addEventListener('contextmenu', preventContextMenu, true)
  }

  function begin() {
    const { list, item } = session
    const items = [...list.children].filter(element => element.matches(itemSelector))
    const sourceIndex = items.indexOf(item)
    if (items.length < 2 || sourceIndex === -1) {
      cancel()
      return
    }
    const ids = items.map(getId)
    Object.assign(session, { started: true, items, ids, indexById: new Map(ids.map((id, index) => [id, index])), sourceIndex })
    measure()
    const origin = list.getBoundingClientRect()
    const source = session.slots[sourceIndex]
    // Keep the card's grab point under the pointer.
    session.grabX = session.startX - origin.left - source.left
    session.grabY = session.startY - origin.top - source.top
    let scroller = list.parentElement
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    session.scroller = scroller ?? document.scrollingElement
    // Cards that render or reflow during the drag move the slots.
    session.observer = new ResizeObserver(() => {
      measure()
      update()
    })
    items.forEach(element => session.observer.observe(element))
    // The measured cards no longer match a list that another window changed.
    session.mutationObserver = new MutationObserver(cancel)
    session.mutationObserver.observe(list, { childList: true })
    document.addEventListener('scroll', update, { capture: true, passive: true })
    document.addEventListener('keydown', cancelFromKeyboard, true)
    window.addEventListener('blur', cancel)
    list.classList.add('reorderActive')
    item.classList.add('reorderDragged')
    draggedId.value = session.ids[sourceIndex]
  }

  /** Layout positions relative to the list, without any translation applied to the cards. */
  function measure() {
    const { list, items } = session
    const origin = list.getBoundingClientRect()
    const slots = items.map(element => {
      const bounds = element.getBoundingClientRect()
      const [x, y] = currentTranslation(element)
      return { left: bounds.left - x - origin.left, top: bounds.top - y - origin.top, width: bounds.width, height: bounds.height }
    })
    session.slots = slots
    session.linear = slots.every(slot => Math.abs(slot.left - slots[0].left) < 1)
    session.gap = slots[1].top - slots[0].top - slots[0].height
    session.bounds = {
      left: Math.min(...slots.map(slot => slot.left)),
      top: slots[0].top,
      right: Math.max(...slots.map(slot => slot.left + slot.width)),
      bottom: Math.max(...slots.map(slot => slot.top + slot.height))
    }
  }

  /** @param {PointerEvent} event */
  function onPointerMove(event) {
    if (event.pointerId !== session?.pointerId) return
    session.x = event.clientX
    session.y = event.clientY
    if (!session.started) {
      if (Math.hypot(session.x - session.startX, session.y - session.startY) < DRAG_THRESHOLD) return
      begin()
      if (!session) return
    }
    update()
    if (scrollFrame === null) scrollFrame = requestAnimationFrame(autoScroll)
  }

  function update() {
    if (!session?.started || session.dropping) return
    const { list, slots, sourceIndex, bounds } = session
    const source = slots[sourceIndex]
    const origin = list.getBoundingClientRect()
    const left = clamp(session.x - origin.left - session.grabX, bounds.left, bounds.right - source.width)
    const top = clamp(session.y - origin.top - session.grabY, bounds.top, bounds.bottom - source.height)

    let targetIndex = sourceIndex
    let nearest = Infinity
    slots.forEach((slot, index) => {
      // Lists compare where the card would rest at each index, so a tall card
      // can pass a shorter one. Grids compare card and cell centers.
      const distance = session.linear
        ? Math.abs(top - (index > sourceIndex ? slot.top + slot.height - source.height : slot.top))
        : Math.hypot(left + source.width / 2 - slot.left - slot.width / 2, top + source.height / 2 - slot.top - slot.height / 2)
      if (distance < nearest) {
        targetIndex = index
        nearest = distance
      }
    })
    session.targetIndex = targetIndex
    applyOffsets([left - source.left, top - source.top])
  }

  /** @param {[number, number] | null} draggedOffset Null places the dragged card in its target slot */
  function applyOffsets(draggedOffset) {
    const { items, ids, indexById, slots, sourceIndex, targetIndex } = session
    const draggedItemId = ids[sourceIndex]
    const order = ids.filter(id => id !== draggedItemId)
    order.splice(targetIndex, 0, draggedItemId)
    const offsets = new Map()
    if (session.linear) {
      const rects = slots.map((slot, index) => ({ id: ids[index], start: slot.top, size: slot.height }))
      for (const [id, y] of Object.entries(computeReorderOffsets(rects, order, session.gap))) offsets.set(id, [0, y])
    } else {
      order.forEach((id, index) => {
        const from = slots[indexById.get(id)]
        offsets.set(id, [slots[index].left - from.left, slots[index].top - from.top])
      })
    }
    if (draggedOffset) offsets.set(draggedItemId, draggedOffset)
    items.forEach((element, index) => {
      const [x, y] = offsets.get(ids[index]) ?? [0, 0]
      const translate = x === 0 && y === 0 ? '' : `${x}px ${y}px`
      // Long lists only restyle the cards that move.
      if (element.style.translate !== translate) element.style.translate = translate
    })
  }

  function autoScroll(time) {
    scrollFrame = null
    if (!session?.started || session.dropping) return
    const { scroller, y } = session
    const view = scroller === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight }
      : scroller.getBoundingClientRect()
    const edge = Math.min(SCROLL_EDGE, (view.bottom - view.top) / 4)
    const speed = y < view.top + edge
      ? -Math.min(1, (view.top + edge - y) / edge)
      : Math.min(1, Math.max(0, (y - view.bottom + edge) / edge))
    if (speed === 0) {
      lastScrollTime = null
      return
    }
    const elapsed = lastScrollTime === null ? 16 : Math.min(time - lastScrollTime, 32)
    lastScrollTime = time
    scroller.scrollBy({ top: speed * SCROLL_SPEED * elapsed / 1000, behavior: 'instant' })
    scrollFrame = requestAnimationFrame(autoScroll)
  }

  /** @param {PointerEvent} event */
  function onPointerUp(event) {
    if (event.pointerId !== session?.pointerId) return
    if (!session.started) {
      cancel()
      return
    }
    session.x = event.clientX
    session.y = event.clientY
    update()
    settle(true)
  }

  /**
   * Glides the dragged card into its target slot, or back into its own one,
   * before the DOM order changes underneath it.
   * @param {boolean} drop
   */
  async function settle(drop) {
    const active = session
    releasePointer()
    active.dropping = true
    if (!drop) active.targetIndex = active.sourceIndex
    active.item.classList.add('reorderDropping')
    applyOffsets(null)
    await Promise.allSettled(active.items.flatMap(element => element.getAnimations().map(animation => animation.finished)))
    if (session !== active) return
    if (active.targetIndex !== active.sourceIndex) {
      commit(active.ids[active.sourceIndex], active.targetIndex)
      await nextTick()
    }
    // The cards already show the new order, so clearing their offsets after
    // the DOM update changes nothing on screen.
    finish()
  }

  /** @param {KeyboardEvent} event */
  function cancelFromKeyboard(event) {
    if (event.key !== 'Escape' || session?.dropping) return
    event.preventDefault()
    event.stopPropagation()
    settle(false)
  }

  function preventContextMenu(event) {
    event.preventDefault()
    event.stopPropagation()
  }

  function cancel() {
    if (session?.dropping) return
    finish()
  }

  function releasePointer() {
    const { list, pointerId } = session
    list.removeEventListener('pointermove', onPointerMove)
    list.removeEventListener('pointerup', onPointerUp)
    list.removeEventListener('pointercancel', cancel)
    list.removeEventListener('lostpointercapture', cancel)
    if (list.hasPointerCapture(pointerId)) list.releasePointerCapture(pointerId)
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
    lastScrollTime = null
  }

  function finish() {
    if (!session) return
    const active = session
    releasePointer()
    session = null
    draggedId.value = null
    active.list.removeEventListener('contextmenu', preventContextMenu, true)
    if (!active.started) return
    active.observer.disconnect()
    active.mutationObserver.disconnect()
    document.removeEventListener('scroll', update, { capture: true })
    document.removeEventListener('keydown', cancelFromKeyboard, true)
    window.removeEventListener('blur', cancel)
    active.list.classList.remove('reorderActive')
    active.item.classList.remove('reorderDragged', 'reorderDropping')
    active.items.forEach(element => { element.style.translate = '' })
  }

  onBeforeUnmount(finish)

  return { draggedId, onPointerDown }
}

/** @param {Element} element */
function currentTranslation(element) {
  const style = getComputedStyle(element)
  const [x = 0, y = 0] = style.translate === 'none' ? [] : style.translate.split(' ').map(Number.parseFloat)
  // Covers a move transition that is still running from an earlier reorder.
  const matrix = style.transform === 'none' ? null : new DOMMatrixReadOnly(style.transform)
  return [x + (matrix?.m41 ?? 0), y + (matrix?.m42 ?? 0)]
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
