/**
 * Choose landscape thumbnail quality without changing portraits,
 * selected frames, custom thumbnails, or the chosen image proxy.
 * @param {string} src
 * @param {boolean} dataSaver
 * @returns {string}
 */
export function getVideoThumbnailSource(src, dataSaver = false) {
  return src.replace(/(\/vi(?:_webp)?\/[^/?]+\/)(?:maxres|sd|hq|mq)default(\.(?:jpg|webp)(?=[?#]|$))/, `$1${dataSaver ? 'mq' : 'maxres'}default$2`)
}

/**
 * Lists provide their thumbnails' rendered width as an `<img sizes>` value,
 * such as the measured card width of a grid.
 * @type {import('vue').InjectionKey<import('vue').Ref<string | null>>}
 */
export const thumbnailSizesKey = Symbol('thumbnailSizes')

const MAXRES_THUMBNAIL = /(\/vi(?:_webp)?\/[^/?]+\/)maxresdefault(\.(?:jpg|webp)(?=[?#]|$))/

/**
 * Lets small slots and low-density screens load the 320x180 version of a
 * full-resolution thumbnail. The 4:3 sizes in between are letterboxed, so
 * they stay fallbacks only.
 * @param {string} src
 * @returns {string | null}
 */
export function getVideoThumbnailSrcset(src) {
  if (!MAXRES_THUMBNAIL.test(src)) return null
  return `${src.replace(MAXRES_THUMBNAIL, '$1mqdefault$2')} 320w, ${src} 1280w`
}

/**
 * YouTube answers a missing resolution with a 120x90 placeholder. A srcset
 * scales the natural size by the chosen candidate's density, but every real
 * maxresdefault image is 16:9. Its mqdefault candidate is already the
 * smallest fallback.
 * @param {Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight' | 'currentSrc' | 'srcset'>} image
 * @returns {boolean}
 */
export function isMissingThumbnailPlaceholder({ naturalWidth: width, naturalHeight: height, currentSrc, srcset }) {
  // Natural sizes are whole pixels, so the scaled placeholder is 4:3 within rounding.
  if (MAXRES_THUMBNAIL.test(currentSrc)) return height > 0 && Math.abs(width * 3 - height * 4) <= 3.5
  return !srcset && width === 120 && height === 90
}

/**
 * Smaller versions of the same YouTube thumbnail, including Invidious proxies.
 * Shorts without a selected portrait thumbnail fall back to their middle frame.
 * Preserve query parameters and leave chosen frames and custom thumbnails alone.
 * @param {string} src
 * @returns {string | null}
 */
export function getVideoThumbnailFallbackUrl(src) {
  const fallbacks = { maxresdefault: 'sddefault', sddefault: 'hqdefault', hqdefault: 'mqdefault', oardefault: 'oar2' }
  const match = src.match(/\/vi(?:_webp)?\/[^/?]+\/(maxresdefault|sddefault|hqdefault|oardefault)\.(?:jpg|webp)(?=[?#]|$)/)
  if (!match) return null

  return src.replace(match[0], match[0].replace(match[1], fallbacks[match[1]]))
}

// Windowed lists remount their cards while scrolling. Remember resolutions a
// video does not have, so each remount skips the requests that failed before.
const MISSING_THUMBNAIL_LIMIT = 5000
/** @type {Map<string, string>} */
const missingThumbnails = new Map()

/**
 * @param {string} src a thumbnail that failed to load
 * @param {string} fallback the smaller version used instead
 */
export function rememberMissingThumbnail(src, fallback) {
  missingThumbnails.delete(src)
  missingThumbnails.set(src, fallback)
  if (missingThumbnails.size > MISSING_THUMBNAIL_LIMIT) {
    missingThumbnails.delete(missingThumbnails.keys().next().value)
  }
}

/**
 * @param {string} src
 * @returns {string} the largest version not known to be missing
 */
export function skipMissingThumbnails(src) {
  let source = src
  while (missingThumbnails.has(source)) source = missingThumbnails.get(source)
  return source
}
