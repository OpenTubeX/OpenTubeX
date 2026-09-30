import { nextTick } from 'vue'
import { applyAnimationSpeed } from './animationSpeed'
import { isReducedMotionEnabled } from './reducedMotion'
import { settleAndroidBackAnimation } from './androidBackGesture'

/** Preview the existing Back action without changing focus, scroll, or view. */
export function createAndroidBackDialogPreview(element, back, isAvailable) {
  let animation = null
  let transition = null
  const cancel = () => {
    animation?.cancel()
    animation = null
    if (transition) {
      if (transition.value) element.style.setProperty('transition', transition.value, transition.priority)
      else element.style.removeProperty('transition')
      transition = null
    }
  }
  return {
    begin() {
      if (!isAvailable() || isReducedMotionEnabled() || element.inert ||
        element.querySelector('.promptCard[inert]')) return false
      const { transform, opacity } = getComputedStyle(element)
      transition = {
        value: element.style.getPropertyValue('transition'),
        priority: element.style.getPropertyPriority('transition')
      }
      // The gesture supplies the exit; suppress a second CSS leave transition.
      element.style.setProperty('transition', 'none', 'important')
      animation = applyAnimationSpeed(element.animate([
        { transform, opacity },
        { transform: 'translateY(24px) scale(0.94)', opacity: 0 }
      ], { duration: 180, fill: 'both' }))
      animation.pause()
      return true
    },
    update(progress) {
      if (animation) animation.currentTime = progress * Number(animation.effect.getTiming().duration)
    },
    async finish(commit) {
      const current = animation
      if (!current) return
      await settleAndroidBackAnimation(current, commit)
      if (animation !== current) return
      try {
        if (commit && isAvailable()) {
          await back()
          await nextTick()
          // Vue applies CSS leave-to classes after two animation frames. Keep
          // the finished gesture visible until that state can take over.
          if (element.isConnected) {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          }
        }
      } finally {
        cancel()
      }
    },
    cancel,
  }
}
