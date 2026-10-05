import { onBeforeUnmount, ref } from 'vue'
import { handleDragAndDrop } from '../helpers/dragAndDrop'

const ROW_SELECTOR = '[data-playlist-drag-item]'

/** Share touch reordering between grid cards and numbered playlist rows. */
export function usePlaylistDrag(emit) {
  const nativeDrag = handleDragAndDrop(emit)
  const pointerDragging = ref(false)
  let session = null
  let scrollFrame = null
  let lastMoveTime = 0

  function startPointerDrag(event, video) {
    if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0 || session ||
      !event.target.closest('.grabBar:not(.grabBarDisabled), .videoIndexArea')) return

    // Capture on the stable list, since reordering moves the source row in the DOM.
    const list = event.currentTarget.parentElement
    event.preventDefault()
    event.stopPropagation()
    let scroller = list
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement
    }
    session = {
      pointerId: event.pointerId,
      list,
      scroller: scroller ?? document.scrollingElement,
      video: { ...video, pointerDragging: true },
      x: event.clientX,
      y: event.clientY,
      lastTarget: null
    }
    pointerDragging.value = true
    list.setPointerCapture(event.pointerId)
    list.addEventListener('pointermove', movePointerDrag)
    list.addEventListener('pointerup', endPointerDrag)
    list.addEventListener('pointercancel', endPointerDrag)
    list.addEventListener('lostpointercapture', endPointerDrag)
    emit('drag-video', session.video)
  }

  function updateTarget(flush = false) {
    const row = document.elementFromPoint(session.x, session.y)?.closest(ROW_SELECTOR)
    if (!row || row.parentElement !== session.list) return
    const video = { videoId: row.dataset.videoId, playlistItemId: row.dataset.playlistItemId }
    if (video.videoId === session.video.videoId && video.playlistItemId === session.video.playlistItemId) {
      session.lastTarget = null
      return
    }
    // Wait for row transitions, but retry the latest target even when the
    // finger stops moving. Pointer release always honors the final destination.
    const time = performance.now()
    if (row === session.lastTarget) return false
    if (!flush && time - lastMoveTime < 100) return true
    session.lastTarget = row
    lastMoveTime = time
    nativeDrag.moveDraggedVideo(video, session.video)
  }

  function movePointerDrag(event) {
    if (event.pointerId !== session?.pointerId) return
    event.preventDefault()
    session.x = event.clientX
    session.y = event.clientY
    updateTarget()
    if (scrollFrame === null) scrollFrame = requestAnimationFrame(scrollNearEdge)
  }

  function scrollNearEdge() {
    scrollFrame = null
    if (!session) return
    const viewport = session.scroller === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
      : session.scroller.getBoundingClientRect()
    if (session.x < viewport.left || session.x > viewport.right) return
    const edge = 48
    const direction = session.y < viewport.top + edge ? -1 : session.y > viewport.bottom - edge ? 1 : 0
    if (direction) session.scroller.scrollBy({ top: direction * 8, behavior: 'instant' })
    const pendingTarget = updateTarget()
    if (direction || pendingTarget) scrollFrame = requestAnimationFrame(scrollNearEdge)
  }

  function endPointerDrag(event) {
    if (event.pointerId !== session?.pointerId) return
    if (event.type === 'pointerup') {
      session.x = event.clientX
      session.y = event.clientY
      updateTarget(true)
    }
    stopPointerDrag()
  }

  function stopPointerDrag() {
    if (!session) return
    const { list, pointerId } = session
    session = null
    pointerDragging.value = false
    lastMoveTime = 0
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
    scrollFrame = null
    list.removeEventListener('pointermove', movePointerDrag)
    list.removeEventListener('pointerup', endPointerDrag)
    list.removeEventListener('pointercancel', endPointerDrag)
    list.removeEventListener('lostpointercapture', endPointerDrag)
    if (list.hasPointerCapture(pointerId)) list.releasePointerCapture(pointerId)
    nativeDrag.afterDrag()
  }

  function dragVideo(event, video) {
    if (session) {
      event.preventDefault()
      return
    }
    nativeDrag.dragVideo(event, video)
  }

  onBeforeUnmount(stopPointerDrag)
  return { ...nativeDrag, dragVideo, pointerDragging, startPointerDrag }
}
