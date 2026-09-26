/**
 * WebKit does not emit contextmenu for many touch targets. Dispatch the same
 * event used by Android and mouse input, without taking over scrolling.
 * @param {Document} document
 */
export function installIosContextMenu(document) {
  let hold = null
  let openedTarget = null
  let dispatching = false

  function cancel() {
    clearTimeout(hold?.timer)
    hold = null
  }

  function down(event) {
    cancel()
    openedTarget = null
    if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0) return
    if (event.target.closest?.('button, input, textarea, select, [contenteditable="true"]')) return
    const target = event.target.closest?.('a[href], .ft-list-video, .ft-list-playlist')
    if (!target) return
    hold = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        cancel()
        if (!target.isConnected) return
        openedTarget = target
        dispatching = true
        try {
          target.dispatchEvent(new document.defaultView.PointerEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            pointerType: 'touch',
            clientX: event.clientX,
            clientY: event.clientY
          }))
        } finally { dispatching = false }
      }, 500)
    }
  }

  function move(event) {
    if (hold && (event.pointerId !== hold.pointerId || Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10)) cancel()
  }

  function suppress(event) {
    if (dispatching) return
    cancel()
    const keyboardClick = event.type === 'click' && event.detail === 0 && !event.pointerType
    const suppressClick = !keyboardClick && openedTarget?.contains(event.target)
    if (event.type === 'click') openedTarget = null
    if (suppressClick) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  const handlers = { pointerdown: down, pointermove: move, pointerup: cancel, pointercancel: cancel, scroll: cancel, contextmenu: suppress, click: suppress }
  for (const [type, handler] of Object.entries(handlers)) document.addEventListener(type, handler, true)
  return () => {
    cancel()
    openedTarget = null
    for (const [type, handler] of Object.entries(handlers)) document.removeEventListener(type, handler, true)
  }
}
