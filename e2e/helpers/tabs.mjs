import { expect } from './app.mjs'

/** Measures the highlight's CSS box without rounding fractional UI scales. */
export function tabHighlightAlignment(tab) {
  const style = getComputedStyle(tab)
  const highlight = getComputedStyle(tab, '::before')
  return Math.max(
    ...['left', 'right', 'top', 'bottom'].map(side => Math.abs(parseFloat(highlight[side]))),
    Math.abs(parseFloat(highlight.width) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) - parseFloat(style.width)),
    Math.abs(parseFloat(highlight.height) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) - parseFloat(style.height))
  )
}

export async function expectTabHighlightStyle(tab, property, value) {
  await expect.poll(() => tab.evaluate((element, property) => getComputedStyle(element, '::before')[property], property)).toBe(value)
}

export async function expectTabHighlightAligned(tab) {
  await expect(tab).toBeVisible()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expectTabHighlightStyle(tab, 'content', '""')
  await expectTabHighlightStyle(tab, 'opacity', '1')
  await expect.poll(() => tab.evaluate(tabHighlightAlignment)).toBeLessThan(0.2)
}

/** Excludes text/hover transitions from highlight animation assertions. */
export function tabHighlightAnimations(tab) {
  return tab.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition && animation.transitionProperty === 'opacity' && animation.effect.target === tab && animation.effect.pseudoElement === '::before')
    .map(animation => ({ property: animation.transitionProperty, playbackRate: animation.playbackRate, duration: animation.effect.getTiming().duration }))
}

/**
 * Capture the fade as soon as the selection renders. A busy renderer can
 * finish it before the next frame dispatches transitionrun.
 */
export async function selectTabWithHighlightAnimation(tab, key = null) {
  return tab.evaluate((element, key) => new Promise(resolve => {
    const observer = new MutationObserver(onSelection)
    const timeout = setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, 5000)
    // Mutation callbacks run right after Vue's update, before the fade can advance.
    async function onSelection() {
      if (element.getAttribute('aria-selected') !== 'true') return
      observer.disconnect()
      clearTimeout(timeout)
      const animation = element.getAnimations({ subtree: true }).find(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === 'opacity' && animation.effect.target === element && animation.effect.pseudoElement === '::before')
      if (!animation) { resolve(null); return }
      try {
        await animation.ready
        resolve({ property: animation.transitionProperty, playbackRate: animation.playbackRate, duration: animation.effect.getTiming().duration })
      } catch {
        resolve(null)
      }
    }
    observer.observe(element, { attributeFilter: ['aria-selected'] })
    if (key === null) element.click()
    else element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }), key)
}
