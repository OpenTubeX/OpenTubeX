const DEFAULT_ANIMATION_SPEED = 100

let animationPlaybackRate = 1

/**
 * Applies the configured playback rate to animations which are currently
 * attached to the document.
 */
function updateActiveAnimations() {
  document.getAnimations({ subtree: true }).forEach(animation => {
    applyAnimationSpeed(animation)
  })
}

function updateTargetAnimations(event) {
  queueMicrotask(() => {
    if (!(event.target instanceof Element)) { return }
    if (event.target.matches('.feed-enter-active, .feed-move') ||
      event.target.closest('[data-animation-speed-managed]')) { return }

    event.target.getAnimations({ subtree: false }).forEach(animation => {
      applyAnimationSpeed(animation)
    })
  })
}

document.addEventListener('animationstart', updateTargetAnimations, true)
document.addEventListener('transitionrun', updateTargetAnimations, true)

/**
 * @param {number} value percentage of the default animation speed
 */
export function setAnimationSpeed(value) {
  const speed = Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_ANIMATION_SPEED

  animationPlaybackRate = speed / DEFAULT_ANIMATION_SPEED
  updateActiveAnimations()
}

/**
 * Applies the configured speed to an animation created through the Web
 * Animations API and returns it for convenient assignment.
 *
 * @param {Animation} animation
 * @returns {Animation}
 */
export function applyAnimationSpeed(animation) {
  animation.updatePlaybackRate(animationPlaybackRate)
  return animation
}
