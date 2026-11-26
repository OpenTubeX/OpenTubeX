import { apply, isSupported } from '@oddbird/popover-polyfill/fn'

// Popover needs Chrome 114, as in Huawei's WebView, Firefox 125 or Safari 17.
// The polyfill marks open popovers with a class, which styles must match too,
// as CSS cannot be polyfilled.
const OPEN_CLASS = ':popover-open'

if (!isSupported()) {
  apply()
  keepOpenClass()
}

/**
 * Vue replaces the class attribute when a class binding changes, such as the
 * watch layout's while rotation fullscreen keeps it open for the next video.
 * Restore the polyfill's class until the popover closes.
 */
function keepOpenClass() {
  const open = new Set()
  const observer = new MutationObserver(() => {
    for (const element of open) {
      if (!element.isConnected || !element.hasAttribute('popover')) {
        open.delete(element)
      } else if (!element.classList.contains(OPEN_CLASS)) {
        element.classList.add(OPEN_CLASS)
      }
    }
  })
  const track = element => {
    if (element.classList.contains(OPEN_CLASS)) open.add(element)
    else open.delete(element)
    observer.disconnect()
    for (const element of open) observer.observe(element, { attributeFilter: ['class'] })
  }
  for (const name of ['showPopover', 'hidePopover', 'togglePopover']) {
    const method = HTMLElement.prototype[name]
    HTMLElement.prototype[name] = function (...args) {
      try {
        return method.apply(this, args)
      } finally {
        track(this)
      }
    }
  }
}
