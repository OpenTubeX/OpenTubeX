import { watch } from 'vue'
import { supportsAnchorPositioning } from '../helpers/anchoredPosition'

/**
 * CSS anchors follow the trigger, but their post-layout scroll shift can move
 * an already-clamped popup outside the viewport. Correct only that overflow,
 * without measuring the trigger or recalculating its preferred placement.
 * @param {import('vue').Ref<HTMLElement|null>} trigger
 * @param {import('vue').Ref<HTMLElement|null>} popup
 * @param {import('vue').Ref<boolean>} enabled
 */
export function useAnchoredViewportBounds(trigger, popup, enabled) {
  if (!supportsAnchorPositioning) return

  watch([trigger, popup, enabled], ([button, menu, open], _, onCleanup) => {
    if (!open || !button || !menu) return

    let frame = null
    let correcting = false
    const ancestors = []
    for (let element = button; element; element = element.parentElement) ancestors.push(element)
    const mutations = new MutationObserver(schedule)
    const resize = new ResizeObserver(schedule)

    function schedule(event) {
      if (event?.type === 'scroll' && event.target instanceof Node && !event.target.contains(button)) return
      if (frame !== null) return
      menu.style.removeProperty('translate')
      // The compositor's anchor scroll shift is visible after the next frame.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = null
          const minLeft = Number.parseFloat(menu.style.getPropertyValue('--anchor-min-left'))
          const maxLeft = Number.parseFloat(menu.style.getPropertyValue('--anchor-max-left'))
          const minTop = Number.parseFloat(menu.style.getPropertyValue('--anchor-min-top'))
          const maxTop = Number.parseFloat(menu.style.getPropertyValue('--anchor-max-top'))
          if (![minLeft, maxLeft, minTop, maxTop].every(Number.isFinite)) return

          const rect = menu.getBoundingClientRect()
          const x = Math.max(minLeft, Math.min(rect.left, maxLeft)) - rect.left
          const y = Math.max(minTop, Math.min(rect.top, maxTop)) - rect.top
          const needsCorrection = x !== 0 || y !== 0
          if (needsCorrection) menu.style.translate = `${x}px ${y}px`

          // A later layout change can invalidate the scroll correction. Observe
          // only the trigger's ancestors, and only while a correction is active.
          if (needsCorrection !== correcting) {
            correcting = needsCorrection
            mutations.disconnect()
            resize.disconnect()
            if (correcting) {
              for (const element of ancestors) {
                mutations.observe(element, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] })
                resize.observe(element)
              }
            }
          }
        })
      })
    }

    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    onCleanup(() => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      menu.style.removeProperty('translate')
    })
  }, { flush: 'post' })
}
