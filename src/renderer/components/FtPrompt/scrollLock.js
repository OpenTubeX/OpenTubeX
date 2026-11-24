let scrollLockCount = 0
let originalDocumentOverflow = ''

export function lockBodyScroll() {
  if (scrollLockCount === 0) {
    originalDocumentOverflow = document.documentElement.style.overflow

    // Lock the root viewport rather than turning the body into an overflow
    // container, which would make its sticky app chrome scroll out of view.
    // Its scrollbar takes up no space, so hiding it shifts nothing.
    document.documentElement.style.overflow = 'hidden'
    document.documentElement.classList.add('appScrollLocked')
  }

  scrollLockCount += 1
}

export function unlockBodyScroll() {
  if (scrollLockCount === 0) {
    return
  }

  scrollLockCount -= 1

  if (scrollLockCount === 0) {
    document.documentElement.style.overflow = originalDocumentOverflow
    document.documentElement.classList.remove('appScrollLocked')
  }
}
