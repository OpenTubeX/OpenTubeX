import thumbnailPlaceholder from '../assets/img/thumbnail_placeholder.svg'
import imageSkeleton from '../assets/img/image_skeleton.svg'

// Sanitized HTML cannot mount Vue components, so keep its images hidden until
// decoded and reserve their original slot with the shared loading skeleton.
export function addHtmlImagePlaceholders(element) {
  for (const image of element.querySelectorAll('img')) {
    const placeholder = document.createElement('span')
    const sizingImage = image.cloneNode()
    for (const attribute of ['srcset', 'sizes', 'id', 'title']) sizingImage.removeAttribute(attribute)
    sizingImage.src = imageSkeleton
    sizingImage.alt = ''
    const imageStyle = getComputedStyle(image)
    // The wrapper owns the original image's outer box; applying these styles
    // to both elements would duplicate margins, padding and positioning.
    placeholder.style.cssText = image.style.cssText
    for (const [dimension, logicalDimension] of [['width', 'inline-size'], ['height', 'block-size']]) {
      const value = image.getAttribute(dimension)
      if (value !== null && !placeholder.style.getPropertyValue(dimension) && !placeholder.style.getPropertyValue(logicalDimension)) {
        placeholder.style.setProperty(dimension, value.trim().endsWith('%') ? value : `${Number.parseInt(value, 10)}px`)
      }
    }
    placeholder.style.aspectRatio ||= '320 / 180'
    placeholder.style.display = imageStyle.display === 'inline' ? 'inline-block' : imageStyle.display
    placeholder.style.verticalAlign = imageStyle.verticalAlign
    sizingImage.removeAttribute('style')
    sizingImage.style.objectFit = image.style.objectFit
    sizingImage.style.objectPosition = image.style.objectPosition
    placeholder.append(sizingImage)
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
      sizingImage.src = thumbnailPlaceholder
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
