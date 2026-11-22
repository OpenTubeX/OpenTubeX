const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

let preference = 'system'

function applyReducedMotionPreference() {
  const reduceMotion = preference === 'on' ||
    (preference === 'system' && systemReducedMotion.matches)

  document.documentElement.dataset.reducedMotion = reduceMotion ? 'reduce' : 'no-preference'
}

systemReducedMotion.addEventListener('change', applyReducedMotionPreference)
applyReducedMotionPreference()

/**
 * @param {'system' | 'on' | 'off'} value
 */
export function setReducedMotionPreference(value) {
  preference = ['system', 'on', 'off'].includes(value) ? value : 'system'
  applyReducedMotionPreference()
}

export function isReducedMotionEnabled() {
  return document.documentElement.dataset.reducedMotion === 'reduce'
}
