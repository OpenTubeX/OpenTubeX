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

    image.addEventListener('load', () => {
      if (!image.naturalWidth) return
      if (originalStyle === null) image.removeAttribute('style')
      else image.setAttribute('style', originalStyle)
      placeholder.remove()
    })
    image.addEventListener('error', () => {
      if (image.alt) {
        placeholder.replaceWith(document.createTextNode(image.alt))
        image.remove()
        return
      }
      placeholder.src = thumbnailPlaceholder
      placeholder.classList.remove('ft-shimmer')
      image.style.position = 'absolute'
      image.style.visibility = 'hidden'
      image.style.pointerEvents = 'none'
      if (!placeholder.isConnected) anchor.after(placeholder)
    })
    // Images may have loaded or failed before the helper attached its listeners.
    // Missing sources are also complete and should keep a permanent fallback.
    if (image.complete) {
      image.dispatchEvent(new Event(image.naturalWidth ? 'load' : 'error'))
    }
  }
}
