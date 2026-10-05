import { computed, onBeforeUnmount, ref } from 'vue'

/** Touch-only thumbnail shortcuts; taps and vertical scrolling keep their normal behavior. */
export function useThumbnailSwipe({ getAction, cancelHold, suppressClick, onCommit, getSettleDuration = () => 200 }) {
  const swipe = ref(null)
  let pointer = null
  let settleTimer = null
  const enabled = computed(() => !!(getAction('left') || getAction('right')))

  function cancelSwipe() {
    clearTimeout(settleTimer)
    settleTimer = null
    pointer = null
    swipe.value = null
  }

  function settleSwipe() {
    pointer = null
    const duration = getSettleDuration()
    if (!swipe.value || duration === 0) {
      cancelSwipe()
      return
    }
    swipe.value = { ...swipe.value, offset: 0, progress: 0, settling: true }
    settleTimer = setTimeout(cancelSwipe, duration + 32)
  }

  function abortSwipe(event) {
    if (pointer?.id === event.pointerId) settleSwipe()
  }

  function startSwipe(event) {
    if (pointer) {
      settleSwipe()
      return
    }
    cancelSwipe()
    if (!enabled.value || event.pointerType !== 'touch' || !event.isPrimary ||
        event.target.closest('button, [role="button"], .channelName, .grabBar, [role="dialog"], [role="menu"], .iconDropdown')) return
    const width = event.currentTarget.getBoundingClientRect().width
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      threshold: Math.min(96, Math.max(48, width * 0.25)),
      maxOffset: width * 0.55,
      locked: false,
    }
  }

  function moveSwipe(event) {
    if (!pointer || pointer.id !== event.pointerId) return
    const distance = event.clientX - pointer.x
    const vertical = Math.abs(event.clientY - pointer.y)
    if (!pointer.locked) {
      if (vertical > 10 && vertical >= Math.abs(distance) / 1.5) {
        cancelSwipe()
        return
      }
      if (Math.abs(distance) < 10 || Math.abs(distance) < vertical * 1.5) return
      if (!getAction(distance < 0 ? 'left' : 'right')) {
        cancelSwipe()
        return
      }
      pointer.locked = true
      cancelHold()
      suppressClick()
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.stopPropagation()
    const direction = distance < 0 ? 'left' : 'right'
    const action = getAction(direction)
    swipe.value = action
      ? {
          direction,
          action,
          progress: Math.min(1, Math.abs(distance) / pointer.threshold),
          offset: Math.max(-pointer.maxOffset, Math.min(pointer.maxOffset, distance)),
          settling: false,
        }
      : null
  }

  function finishSwipe(event) {
    if (!pointer || pointer.id !== event.pointerId) return
    // Use the release position as well, including reversals since the last move.
    moveSwipe(event)
    const finished = swipe.value
    const locked = pointer?.locked
    settleSwipe()
    if (locked) {
      event.stopPropagation()
      suppressClick()
    }
    if (finished?.progress === 1) {
      const action = getAction(finished.direction)
      if (action) onCommit(action)
    }
  }

  onBeforeUnmount(cancelSwipe)
  return { enabled, swipe, startSwipe, moveSwipe, finishSwipe, abortSwipe, cancelSwipe }
}
