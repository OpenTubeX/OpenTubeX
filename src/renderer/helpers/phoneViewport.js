import { ref } from 'vue'

/**
 * Whether the Android software keyboard shrinks the page. Android reports a
 * closed keyboard a few frames after the page blurs its field, and the page is
 * painted at the keyboard-sized viewport until then. Bottom bars stay hidden
 * meanwhile instead of floating where the keyboard was.
 */
export const softwareKeyboardOpen = ref(false)

// Smaller changes come from the keyboard's own toolbars, not from opening it.
const MIN_KEYBOARD_HEIGHT = 100
// A keyboard that closes without resizing the page, like a hardware one, sends no resize.
const KEYBOARD_CLOSE_TIMEOUT = 1000

/** Keep phone dialogs within the viewport while the software keyboard opens. */
export function setupPhoneViewport(window, document, nativeResize = false) {
  let width = window.innerWidth
  let height = window.innerHeight
  let closeTimeout = null

  function updateSoftwareKeyboard() {
    if (window.innerWidth !== width) {
      softwareKeyboardOpen.value = false
    } else if (window.innerHeight <= height - MIN_KEYBOARD_HEIGHT) {
      // Focus moves to the field before Android shrinks the page for its keyboard.
      if (document.activeElement?.matches('input, textarea, [contenteditable]')) softwareKeyboardOpen.value = true
    } else if (window.innerHeight >= height + MIN_KEYBOARD_HEIGHT) {
      softwareKeyboardOpen.value = false
    }
    width = window.innerWidth
    height = window.innerHeight
  }

  function scheduleSoftwareKeyboardClose() {
    clearTimeout(closeTimeout)
    if (!softwareKeyboardOpen.value) return
    closeTimeout = setTimeout(() => {
      if (!document.activeElement?.matches('input, textarea, [contenteditable]')) softwareKeyboardOpen.value = false
    }, KEYBOARD_CLOSE_TIMEOUT)
  }

  function update() {
    // Android resizes the WebView itself. Its visual viewport can briefly
    // subtract the IME again while those two resize events catch up.
    const viewport = nativeResize ? null : window.visualViewport
    if (nativeResize) updateSoftwareKeyboard()
    const { style } = document.documentElement
    const nextHeight = `${viewport?.height ?? window.innerHeight}px`
    const nextTop = `${viewport?.offsetTop ?? 0}px`
    if (style.getPropertyValue?.('--phone-viewport-height') !== nextHeight) {
      style.setProperty('--phone-viewport-height', nextHeight)
    }
    if (style.getPropertyValue?.('--phone-viewport-top') !== nextTop) {
      style.setProperty('--phone-viewport-top', nextTop)
    }
  }
  update()
  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  if (nativeResize) window.addEventListener('focusout', scheduleSoftwareKeyboardClose)
  return () => {
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
    window.removeEventListener('resize', update)
    window.removeEventListener('focusout', scheduleSoftwareKeyboardClose)
    clearTimeout(closeTimeout)
    softwareKeyboardOpen.value = false
  }
}
