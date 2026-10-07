import thumbnailPlaceholder from '../assets/img/thumbnail_placeholder.svg'
import imageSkeleton from '../assets/img/image_skeleton.svg'

// Sanitized HTML cannot mount Vue components, so keep its images hidden until
// decoded and reserve their original slot with the shared loading skeleton.
export function addHtmlImagePlaceholders(element) {
  for (const image of element.querySelectorAll('img')) {
    const placeholder = image.cloneNode()
    for (const attribute of ['srcset', 'sizes', 'id', 'title']) placeholder.removeAttribute(attribute)
    placeholder.src = imageSkeleton
    placeholder.alt = ''
    placeholder.setAttribute('aria-hidden', 'true')
    placeholder.classList.add('htmlImagePlaceholder', 'ft-shimmer')
    // A <picture>'s sources can override even an img without its own srcset.
    const anchor = image.parentElement.tagName === 'PICTURE' ? image.parentElement : image
    const originalStyle = image.getAttribute('style')
    image.style.position = 'absolute'
    image.style.visibility = 'hidden'
    image.style.pointerEvents = 'none'
    anchor.after(placeholder)

    // A stalled response must not leave a permanent animated loading indication.
    const showFallback = () => {
      placeholder.src = thumbnailPlaceholder
      placeholder.classList.remove('ft-shimmer')
    }
    let skeletonTimeout
    let visibilityObserver
    const clearLoadingDeadline = () => {
      clearTimeout(skeletonTimeout)
      visibilityObserver?.disconnect()
    }

    image.addEventListener('load', () => {
      if (!image.naturalWidth) return
      clearLoadingDeadline()
      if (originalStyle === null) image.removeAttribute('style')
      else image.setAttribute('style', originalStyle)
      placeholder.remove()
    })
    image.addEventListener('error', () => {
      clearLoadingDeadline()
      if (image.alt) {
        placeholder.replaceWith(document.createTextNode(image.alt))
        image.remove()
        return
      }
      showFallback()
      image.style.position = 'absolute'
      image.style.visibility = 'hidden'
      image.style.pointerEvents = 'none'
      if (!placeholder.isConnected) anchor.after(placeholder)
    })
    // Images may have loaded or failed before the helper attached its listeners.
    // Missing sources are also complete and should keep a permanent fallback.
    if (image.complete) {
      image.dispatchEvent(new Event(image.naturalWidth ? 'load' : 'error'))
    } else if (image.loading === 'lazy') {
      // Offscreen lazy images may not have started their request yet.
      visibilityObserver = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        visibilityObserver.disconnect()
        skeletonTimeout = setTimeout(showFallback, 10_000)
      })
      visibilityObserver.observe(image)
    } else {
      skeletonTimeout = setTimeout(showFallback, 10_000)
    }
  }
}
