/**
 * Interpret pointer modifiers for navigation in the current runtime. The
 * caller owns routing and browser events; this adapter only chooses intent.
 *
 * @param {{runtime: 'electron' | 'web', isMac: boolean}} platform
 */
export function createLinkNavigationPlatform({ runtime, isMac }) {
  const isElectron = runtime === 'electron'

  function usesTabModifier(event) {
    return isElectron
      ? (isMac ? event.metaKey : event.ctrlKey)
      : (event.ctrlKey || event.metaKey)
  }

  return {
    /** @param {PointerEvent} event @param {HTMLAnchorElement} link @param {string} appOrigin */
    internalLinkShortcut(event, link, appOrigin) {
      if (!isElectron || event.defaultPrevented || !link || link.origin !== appOrigin) return null
      const isMiddleClick = event.type === 'auxclick' && event.button === 1
      const isModifierClick = event.type === 'click' && event.button === 0 &&
        usesTabModifier(event) && !event.altKey
      if (!isMiddleClick && !isModifierClick) return null
      const hashRoute = new URL(link.href).hash.slice(1)
      if (!hashRoute.startsWith('/')) return null
      return {
        hashRoute,
        doCreateNewWindow: Boolean(event.shiftKey),
        doCreateNewTab: !event.shiftKey,
        makeActive: isModifierClick,
      }
    },
    /** @param {PointerEvent} event */
    linkDisposition(event) {
      const isMiddleClick = event.type === 'auxclick' && event.button === 1
      return {
        doCreateNewTab: Boolean(usesTabModifier(event) || isMiddleClick),
        doCreateNewWindow: Boolean(event.shiftKey),
        isMiddleClick,
      }
    },
    /** @param {PointerEvent} event */
    mouseHistoryOffset(event) {
      if (!isElectron) return null
      if (event.button === 3) return -1
      if (event.button === 4) return 1
      return null
    },
  }
}
