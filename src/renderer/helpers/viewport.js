// Reading the window's size or scroll position lays out the page if a script
// has changed it since the last layout, such as while a page mounts or in an
// earlier resize observer, and Android WebView lays it out for innerWidth and
// innerHeight regardless. Keep what the last resize and scroll events
// reported instead; both run before frame callbacks and resize observers.
let width = 0
let height = 0
let scrollY = 0
if (typeof window !== 'undefined') {
  const readSize = () => {
    width = window.innerWidth
    height = window.innerHeight
  }
  const readScrollPosition = () => {
    scrollY = window.scrollY
  }
  readSize()
  readScrollPosition()
  window.addEventListener('resize', readSize)
  window.addEventListener('scroll', readScrollPosition, { passive: true })
}

/** The window's innerWidth as of its last resize. */
export function getViewportWidth() {
  return width
}

/** The window's innerHeight as of its last resize. */
export function getViewportHeight() {
  return height
}

/** The page's scrollY as of its last scroll event. */
export function getLastScrollY() {
  return scrollY
}
