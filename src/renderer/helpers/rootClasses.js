import { onScopeDispose, watch } from 'vue'

// App state that page-wide and teleported styles depend on, as classes on
// <html>. Selecting it with :has() on <html>, <body> or .app made Blink
// recheck the whole document for every DOM change in any tab.
const holders = new Map()

/**
 * Adds a class to <html> until every holder releases it.
 * @param {string} name
 * @returns {() => void} release
 */
export function holdRootClass(name) {
  holders.set(name, (holders.get(name) ?? 0) + 1)
  document.documentElement.classList.add(name)
  let held = true
  return () => {
    if (!held) return
    held = false
    const remaining = holders.get(name) - 1
    if (remaining > 0) {
      holders.set(name, remaining)
    } else {
      holders.delete(name)
      document.documentElement.classList.remove(name)
    }
  }
}

/**
 * Holds a root class while `active` is true, until the current scope ends.
 * @param {string} name
 * @param {import('vue').WatchSource<boolean>} active
 */
export function useRootClass(name, active) {
  let release = null
  watch(active, value => {
    if (value && !release) {
      release = holdRootClass(name)
    } else if (!value && release) {
      release()
      release = null
    }
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => release?.())
}

const APP_CLASSES = {
  capacitorTabs: 'appCapacitorTabs',
  capacitorPhoneLayout: 'appPhoneLayout',
  capacitorTabletLayout: 'appTabletLayout',
  compactNavigation: 'appCompactNavigation',
}

/**
 * Mirrors the rendered .app layout and its open mobile sheets on <html>.
 * Observing the DOM keeps every way of changing them covered, as :has() did.
 * @param {Element} app
 * @returns {() => void} stop
 */
export function mirrorAppState(app) {
  const root = document.documentElement.classList
  const updateApp = () => {
    for (const [name, rootName] of Object.entries(APP_CLASSES)) root.toggle(rootName, app.classList.contains(name))
    root.toggle('appProgressBar', app.querySelector(':scope > .progressBar') !== null)
  }
  // Sheets may be teleported anywhere. Only `open` attribute changes are observed.
  const updateSheets = () => root.toggle('appMobileSheetOpen', document.querySelector('.mobileSheet[open]') !== null)
  const appObserver = new MutationObserver(updateApp)
  appObserver.observe(app, { attributes: true, attributeFilter: ['class'], childList: true })
  const sheetObserver = new MutationObserver(updateSheets)
  sheetObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
  updateApp()
  updateSheets()
  return () => {
    appObserver.disconnect()
    sheetObserver.disconnect()
    for (const name of [...Object.values(APP_CLASSES), 'appProgressBar', 'appMobileSheetOpen']) root.remove(name)
  }
}
