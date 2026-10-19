import { nextTick } from 'vue'
import { applyAnimationSpeed } from './animationSpeed'
import { isReducedMotionEnabled } from './reducedMotion'
import { settleAndroidBackAnimation } from './androidBackGesture'

/** @param {HTMLElement} element */
function getDialogExitKeyframes(element) {
  const { transform, opacity } = getComputedStyle(element)
  return [{ transform, opacity }, { transform: 'translateY(24px) scale(0.94)', opacity: 0 }]
}

/**
 * Preview the existing Back action without changing focus, scroll, or view.
 * @param {HTMLElement} element
 * @param {() => Promise<void>} back
 * @param {() => boolean} isAvailable
 * @param {(element: HTMLElement) => Keyframe[]} [getKeyframes] Runs when the gesture starts.
 */
export function createAndroidBackDialogPreview(element, back, isAvailable, getKeyframes = getDialogExitKeyframes) {
  let animation = null
  let styles = null
  const cancel = () => {
    animation?.cancel()
    animation = null
    if (styles) {
      for (const { name, value, priority } of styles) {
        if (value) element.style.setProperty(name, value, priority)
        else element.style.removeProperty(name)
      }
      styles = null
    }
  }
  return {
    begin() {
      if (!isAvailable() || isReducedMotionEnabled() || element.inert ||
        element.querySelector('.promptCard[inert]')) return false
      const keyframes = getKeyframes(element)
      styles = ['transition', 'animation'].map(name => ({
        name,
        value: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name)
      }))
      // Progress must follow the gesture without a competing CSS transition.
      element.style.setProperty('transition', 'none', 'important')
      animation = applyAnimationSpeed(element.animate(keyframes, { duration: 180, fill: 'both' }))
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
          // The gesture already supplies the exit. Suppress CSS leave animations
          // before Back closes the dialog, without interrupting them on cancel.
          element.style.setProperty('animation', 'none', 'important')
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
