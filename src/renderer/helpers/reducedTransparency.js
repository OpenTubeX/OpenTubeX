import { observeIosReduceTransparency } from './androidUi'

/** @param {boolean} reduce */
function applyReducedTransparency(reduce) {
  document.documentElement.toggleAttribute('data-reduced-transparency', reduce)
}

if (process.env.IS_IOS) {
  // WebKit does not implement prefers-reduced-transparency, so iOS reports it natively.
  observeIosReduceTransparency(applyReducedTransparency).catch(error => {
    console.error('Failed to observe Reduce Transparency:', error)
  })
} else {
  const systemReducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)')
  systemReducedTransparency.addEventListener('change', () => applyReducedTransparency(systemReducedTransparency.matches))
  applyReducedTransparency(systemReducedTransparency.matches)
}
