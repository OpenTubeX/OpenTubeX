import { ref } from 'vue'

// The owning Watch tab holds navigation visibility until its minimize handoff ends.
/** @type {import('vue').Ref<string | null>} */
export const mobileNavigationMinimizePreview = ref(null)

// Accumulate small scroll steps without reacting to subpixel jitter or overscroll.
export function createMobileNavigationScroll({ revealThreshold = 8 } = {}) {
  let anchor = 0
  let hidden = false

  return {
    reset(position, preserveHidden = false) {
      anchor = Math.max(0, position)
      hidden = preserveHidden
    },
    update(position, maximum) {
      const top = Math.max(0, Math.min(position, Math.max(0, maximum)))
      if (top <= 8) {
        hidden = false
        anchor = 0
      } else if (hidden) {
        anchor = Math.max(anchor, top)
        if (anchor - top >= revealThreshold) {
          hidden = false
          anchor = top
        }
      } else {
        anchor = Math.min(anchor, top)
        if (top - anchor >= 8) {
          hidden = true
          anchor = top
        }
      }
      return hidden
    }
  }
}
