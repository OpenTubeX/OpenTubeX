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
 * Smaller versions of the same YouTube thumbnail, including Invidious proxies.
 * Preserve query parameters and leave portraits, chosen frames, and custom
 * thumbnails alone.
 * @param {string} src
 * @returns {string | null}
 */
export function getVideoThumbnailFallbackUrl(src) {
  const qualities = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault']
  const match = src.match(/\/vi(?:_webp)?\/[^/?]+\/(maxresdefault|sddefault|hqdefault)\.(?:jpg|webp)(?=[?#]|$)/)
  if (!match) return null

  return src.replace(match[0], match[0].replace(match[1], qualities[qualities.indexOf(match[1]) + 1]))
}
