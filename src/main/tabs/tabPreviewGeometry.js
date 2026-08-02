/**
 * @typedef {object} TabPreviewContentBounds
 * @property {number} contentTop
 * @property {number} contentLeft
 * @property {number} contentRight
 * @property {number} viewportWidth
 * @property {number} viewportHeight
 * @property {number} devicePixelRatio
 */

/**
 * Measures the page region a tab preview should show: everything except the
 * window chrome (the tab bar and the header), so previews only ever contain
 * page content.
 *
 * This runs inside the renderer via `executeJavaScript(fn.toString())`, so it
 * must stay self-contained: no imports, no closure variables, only the passed
 * in `window`/`document` and their own APIs.
 * @param {Window} window
 * @param {Document} document
 * @returns {TabPreviewContentBounds}
 */
export function measureTabPreviewContentBounds(window, document) {
  const viewportWidth = Math.max(
    window.visualViewport?.width || 0,
    window.innerWidth || 0,
    document.documentElement?.clientWidth || 0
  )
  const viewportHeight = Math.max(
    window.visualViewport?.height || 0,
    window.innerHeight || 0,
    document.documentElement?.clientHeight || 0
  )
  const clampX = value => Math.min(viewportWidth, Math.max(0, value))
  const clampY = value => Math.min(viewportHeight, Math.max(0, value))

  const tabBar = document.querySelector('.tabBar')
  const topNav = document.querySelector('.topNav')
  let contentTop = 0
  let contentLeft = 0
  let contentRight = viewportWidth

  if (tabBar != null) {
    const rect = tabBar.getBoundingClientRect()
    if (tabBar.classList.contains('vertical')) {
      // Full-height side column: crop it off horizontally. It sits at
      // whichever inline edge matches the text direction.
      if (rect.left <= viewportWidth - rect.right) {
        contentLeft = clampX(rect.right)
      } else {
        contentRight = clampX(rect.left)
      }
    } else {
      contentTop = clampY(rect.bottom)
    }
  }

  if (topNav != null) {
    // The sticky header sits below a horizontal tab bar, so its bottom edge is
    // where the page content actually starts. It collapses to a zero rect when
    // it is hidden (e.g. fullscreen), which leaves the bounds untouched.
    const rect = topNav.getBoundingClientRect()
    contentTop = Math.max(contentTop, clampY(rect.bottom))
  }

  return {
    contentTop,
    contentLeft,
    contentRight,
    viewportWidth,
    viewportHeight,
    // Display scaling times page zoom. NativeImage reports and exports sizes in
    // logical pixels, so this is the only place the real pixel count is known.
    devicePixelRatio: window.devicePixelRatio || 1
  }
}

// The tooltip lays its preview out in CSS pixels (~324px wide at the widest),
// so these are a CSS pixel budget, not a device pixel one.
export const TAB_PREVIEW_MAX_CSS_WIDTH = 360
export const TAB_PREVIEW_MAX_CSS_HEIGHT = 220
// A preview is a whole page shrunk to thumbnail size (a 5x reduction at 1080p),
// which destroys detail no matter how good the resampler is. Storing twice the
// displayed size lets the browser do the last step of the downscale with its
// own filtering, which is what makes small text read as text instead of mush.
export const TAB_PREVIEW_SUPERSAMPLE = 2
// Bounds the stored file when supersampling stacks with HiDPI or page zoom.
export const TAB_PREVIEW_MAX_PIXEL_RATIO = 3

/**
 * Picks the size a cropped capture should be stored at.
 *
 * `NativeImage` measures and exports in logical pixels: `getSize()` reports the
 * 1x representation and `toDataURL()` writes it out, so on a scaled display the
 * capture silently loses resolution. The stored size therefore follows both the
 * window's device pixel ratio and a supersampling factor on top of it.
 * @param {{width: number, height: number}} imageSize logical size of the crop
 * @param {TabPreviewContentBounds | null} contentBounds
 * @returns {{width: number, height: number} | null} null when it already fits
 */
export function getTabPreviewTargetSize({ width, height }, contentBounds) {
  if (width <= 0 || height <= 0) {
    return null
  }

  const pixelRatio = Math.min(
    TAB_PREVIEW_MAX_PIXEL_RATIO,
    Math.max(1, contentBounds?.devicePixelRatio || 1) * TAB_PREVIEW_SUPERSAMPLE
  )

  const ratio = Math.min(
    TAB_PREVIEW_MAX_CSS_WIDTH * pixelRatio / width,
    TAB_PREVIEW_MAX_CSS_HEIGHT * pixelRatio / height,
    1
  )
  return ratio < 1
    ? { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
    : null
}

/**
 * Crops a full window screenshot down to the measured content region. The
 * bounds are in CSS pixels while the image is in device pixels, so they are
 * rescaled by the ratio between them.
 * @param {import('electron').NativeImage} image
 * @param {TabPreviewContentBounds} contentBounds
 * @returns {import('electron').NativeImage | null}
 */
export function cropTabPreviewToContent(image, contentBounds) {
  const { contentTop = 0, contentLeft = 0, viewportWidth, viewportHeight } = contentBounds
  const contentRight = contentBounds.contentRight ?? viewportWidth

  if (contentTop <= 0 && contentLeft <= 0 && contentRight >= viewportWidth) {
    return image
  }

  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return null
  }

  const scaleX = width / viewportWidth
  const scaleY = height / viewportHeight
  const cropX = Math.min(width, Math.max(0, Math.ceil(contentLeft * scaleX)))
  const cropRight = Math.min(width, Math.max(0, Math.floor(contentRight * scaleX)))
  const cropY = Math.min(height, Math.max(0, Math.ceil(contentTop * scaleY)))
  const cropWidth = cropRight - cropX
  const cropHeight = height - cropY
  return cropWidth <= 0 || cropHeight <= 0
    ? null
    : image.crop({ x: cropX, y: cropY, width: cropWidth, height: cropHeight })
}
