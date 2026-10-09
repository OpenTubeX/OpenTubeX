import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { computeTabOffsets } from '../components/TabBar/tabReorder'
import { isReducedMotionEnabled } from '../helpers/reducedMotion'

/**
 * Reorders sibling rows in place, using the same geometry as the tab strip.
 * Only commits on release; nested lists remain independent reorder groups.
 *
 * @param {object} options
 * @param {import('vue').ComputedRef<string[]>} options.items
 * @param {string} options.rowSelector
 * @param {string} options.itemIdAttribute
 * @param {(items: string[]) => unknown} options.updateItems
 * @param {(itemId: string, position: number) => void} options.announceMoved
 */
export function useOrderedItemReorder({ items, rowSelector, itemIdAttribute, updateItems, announceMoved }) {
  const draggedItemId = ref(null)
  const offsets = ref({})
  const settling = ref(false)
  let session = null
  let scrollFrame = null

  function rowStyle(id) {
    if (!session || !session.ids.includes(id)) return undefined
    const dragged = draggedItemId.value === id
    return {
      transform: `translateY(${offsets.value[id] ?? 0}px)`,
      transition: session.reducedMotion || (dragged && !settling.value) ? 'none' : 'transform 160ms ease',
      zIndex: dragged ? 2 : 1,
      position: 'relative',
      backgroundColor: 'var(--card-bg-color)',
      boxShadow: dragged ? '0 4px 12px rgb(0 0 0 / 18%)' : undefined,
    }
  }

  function startPointerDrag(event, itemId) {
    if (!event.isPrimary || event.button !== 0 || session) return
    const handle = event.currentTarget
    const row = handle.closest(rowSelector)
    const list = row?.parentElement
    if (!list) return
    const rows = [...list.children].filter(element => element.matches(rowSelector))
    const rects = rows.map(element => {
      const bounds = element.getBoundingClientRect()
      return { id: element.getAttribute(itemIdAttribute), start: bounds.top, size: bounds.height }
    })
    const ids = rects.map(rect => rect.id)
    const sourceIndex = ids.indexOf(itemId)
    if (sourceIndex < 0) return
    let scroller = list
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    session = {
      handle,
      rows,
      rects,
      ids,
      sourceIndex,
      scroller,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      scrollStart: scroller?.scrollTop ?? 0,
      gap: rects.length > 1 ? rects[1].start - rects[0].start - rects[0].size : 0,
      order: ids,
      reducedMotion: isReducedMotionEnabled(),
    }
    handle.setPointerCapture(event.pointerId)
    scroller?.addEventListener('scroll', updatePosition)
    window.addEventListener('resize', stopDragging)
    window.addEventListener('blur', stopDragging)
    document.addEventListener('keydown', cancelFromKeyboard, true)
    // A responsive reflow invalidates the geometry, but fractional dimensions do not.
    const sizes = rows.map(element => element.getBoundingClientRect())
    session.observer = new ResizeObserver(() => {
      if (rows.some((element, index) => {
        const bounds = element.getBoundingClientRect()
        return Math.abs(bounds.width - sizes[index].width) > 0.01 || Math.abs(bounds.height - sizes[index].height) > 0.01
      })) stopDragging()
    })
    rows.forEach(element => session.observer.observe(element))
  }

  function movePointerDrag(event) {
    if (!session || event.pointerId !== session.pointerId || settling.value) return
    session.currentX = event.clientX
    session.currentY = event.clientY
    if (!draggedItemId.value && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 4) return
    event.preventDefault()
    draggedItemId.value = session.ids[session.sourceIndex]
    updatePosition()
    if (scrollFrame === null && session.scroller) {
      session.lastScrollTime = performance.now()
      scrollFrame = requestAnimationFrame(scrollNearEdge)
    }
  }

  function updatePosition() {
    if (!session || !draggedItemId.value || settling.value) return
    const { rects, ids, sourceIndex, gap, scroller } = session
    const source = rects[sourceIndex]
    const delta = session.currentY - session.startY + (scroller?.scrollTop ?? 0) - session.scrollStart
    const offset = Math.max(rects[0].start - source.start, Math.min(
      rects.at(-1).start + rects.at(-1).size - source.start - source.size, delta
    ))
    const draggedIds = new Set([draggedItemId.value])
    // Use each possible resting position, so a tall category can move past a
    // shorter one without its dragged bounds escaping the list's scroll range.
    let targetIndex = sourceIndex
    let nearest = Math.abs(offset)
    for (let index = 0; index < rects.length; index++) {
      const destination = index > sourceIndex
        ? rects[index].start + rects[index].size - source.size
        : rects[index].start
      const distance = Math.abs(source.start + offset - destination)
      if (distance < nearest) {
        targetIndex = index
        nearest = distance
      }
    }
    const order = ids.filter(id => id !== draggedItemId.value)
    order.splice(targetIndex, 0, draggedItemId.value)
    session.order = order
    offsets.value = computeTabOffsets(rects, order, gap, draggedIds, offset)
  }

  function scrollNearEdge(time) {
    scrollFrame = null
    if (!session || settling.value) return
    const { scroller, currentX, currentY } = session
    const bounds = scroller.getBoundingClientRect()
    const edge = Math.min(40, bounds.height / 3)
    const speed = currentX < bounds.left || currentX > bounds.right
      ? 0
      : currentY < bounds.top + edge
        ? -Math.min(1, (bounds.top + edge - currentY) / edge)
        : Math.max(0, Math.min(1, (currentY - bounds.bottom + edge) / edge))
    scroller.scrollBy({ top: speed * 600 * Math.min(time - session.lastScrollTime, 32) / 1000, behavior: 'instant' })
    session.lastScrollTime = time
    updatePosition()
    scrollFrame = requestAnimationFrame(scrollNearEdge)
  }

  async function endPointerDrag(event) {
    if (!session || event.pointerId !== session.pointerId || settling.value) return
    movePointerDrag(event)
    if (!draggedItemId.value) {
      stopDragging()
      return
    }
    const active = session
    const id = draggedItemId.value
    settling.value = true
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
    offsets.value = computeTabOffsets(active.rects, active.order, active.gap)
    await nextTick()
    // Wait for the actual transitions, including the user's animation speed.
    await Promise.allSettled(active.rows.flatMap(row => row.getAnimations().map(animation => animation.finished)))
    if (session !== active) return
    const position = active.order.indexOf(id)
    if (position !== active.sourceIndex) {
      let index = 0
      const reordered = items.value.map(item => active.ids.includes(item) ? active.order[index++] : item)
      stopDragging()
      await updateItems(reordered)
      announceMoved(id, position)
    } else {
      stopDragging()
    }
  }

  function cancelPointerDrag(event) {
    if (session?.pointerId === event.pointerId && !settling.value) stopDragging()
  }

  function cancelFromKeyboard(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    stopDragging()
  }

  function stopDragging() {
    const active = session
    if (!active) return
    session = null
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
    active.observer.disconnect()
    active.scroller?.removeEventListener('scroll', updatePosition)
    window.removeEventListener('resize', stopDragging)
    window.removeEventListener('blur', stopDragging)
    document.removeEventListener('keydown', cancelFromKeyboard, true)
    // Clear transitions together with transforms to avoid animating back after commit.
    offsets.value = {}
    draggedItemId.value = null
    settling.value = false
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId)
  }

  watch(items, stopDragging)
  onBeforeUnmount(stopDragging)

  return { draggedItemId, rowStyle, startPointerDrag, movePointerDrag, endPointerDrag, cancelPointerDrag, stopDragging }
}
