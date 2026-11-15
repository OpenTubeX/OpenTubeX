let scrollLockCount = 0
let originalDocumentOverflow = ''
let originalBodyPaddingInlineEnd = ''

export function lockBodyScroll() {
  if (scrollLockCount === 0) {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    originalDocumentOverflow = document.documentElement.style.overflow
    originalBodyPaddingInlineEnd = document.body.style.paddingInlineEnd

    // Lock the root viewport rather than turning the body into an overflow
    // container, which would make its sticky app chrome scroll out of view.
    document.documentElement.style.overflow = 'hidden'

    if (scrollbarWidth > 0) {
      document.body.style.paddingInlineEnd = `calc(${originalBodyPaddingInlineEnd || '0px'} + ${scrollbarWidth}px)`
    }
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
    document.body.style.paddingInlineEnd = originalBodyPaddingInlineEnd
  }
}
