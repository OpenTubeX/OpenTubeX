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
 * @param {HTMLElement} element
 * @returns {[HTMLElement, Keyframe[]][]}
 */
function getDialogExitAnimations(element) {
  const card = element.matches('.prompt') ? element.querySelector(':scope > .promptCard') : null
  if (!card) return [[element, getDialogExitKeyframes(element)]]
  // Fading the backdrop's opacity would crossfade a sharp and a blurred copy of
  // the page, which flickers. Clear its dim and blur and fade the card instead.
  return [
    [element, [{ backgroundColor: 'transparent', backdropFilter: 'blur(0)' }]],
    [card, getDialogExitKeyframes(card)]
  ]
}

/**
 * Preview the existing Back action without changing focus, scroll, or view.
 * @param {HTMLElement} element
 * @param {() => Promise<void>} back
 * @param {() => boolean} isAvailable
 * @param {(element: HTMLElement) => Keyframe[]} [getKeyframes] Runs when the gesture starts.
 */
export function createAndroidBackDialogPreview(element, back, isAvailable, getKeyframes) {
  /** @type {Animation[] | null} */
  let animations = null
  /** @type {{ target: HTMLElement, name: string, value: string, priority: string }[] | null} */
  let styles = null
  const saveStyle = (target, name) => ({
    target,
    name,
    value: target.style.getPropertyValue(name),
    priority: target.style.getPropertyPriority(name)
  })
  const cancel = () => {
    animations?.forEach(animation => animation.cancel())
    animations = null
    if (styles) {
      for (const { target, name, value, priority } of styles) {
        if (value) target.style.setProperty(name, value, priority)
        else target.style.removeProperty(name)
      }
      styles = null
    }
  }
  return {
    begin() {
      if (!isAvailable() || isReducedMotionEnabled() || element.inert ||
        element.querySelector('.promptCard[inert]')) return false
      const targets = getKeyframes ? [[element, getKeyframes(element)]] : getDialogExitAnimations(element)
      // Progress changes the transform from script. Without this hint,
      // Chromium rasterizes the content again at every new scale.
      const transformed = targets.filter(([, keyframes]) => keyframes.some(frame => 'transform' in frame)).map(([target]) => target)
      styles = [
        saveStyle(element, 'transition'),
        saveStyle(element, 'animation'),
        ...transformed.map(target => saveStyle(target, 'will-change'))
      ]
      // Progress must follow the gesture without a competing CSS transition.
      element.style.setProperty('transition', 'none', 'important')
      for (const target of transformed) target.style.setProperty('will-change', 'transform', 'important')
      animations = targets.map(([target, keyframes]) => {
        const animation = applyAnimationSpeed(target.animate(keyframes, { duration: 180, fill: 'both' }))
        animation.pause()
        return animation
      })
      return true
    },
    update(progress) {
      animations?.forEach(animation => { animation.currentTime = progress * Number(animation.effect.getTiming().duration) })
    },
    async finish(commit) {
      const current = animations
      if (!current) return
      await Promise.all(current.map(animation => settleAndroidBackAnimation(animation, commit)))
      if (animations !== current) return
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
