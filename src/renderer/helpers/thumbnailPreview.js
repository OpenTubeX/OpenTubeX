/**
 * Read the animated thumbnail URL from youtubei.js' old and new video card
 * shapes.
 *
 * @param {object | null | undefined} video
 * @returns {string | null}
 */
export function getThumbnailPreviewUrl(video) {
  const richThumbnailUrl = video?.rich_thumbnail?.find?.(
    thumbnail => typeof thumbnail?.url === 'string'
  )?.url

  if (richThumbnailUrl) {
    return richThumbnailUrl
  }

  const animatedOverlay = video?.content_image?.overlays?.find?.(
    overlay => overlay?.type === 'AnimatedThumbnailOverlayView'
  )

  return animatedOverlay?.thumbnail?.find?.(
    thumbnail => typeof thumbnail?.url === 'string'
  )?.url ?? null
}

/**
 * YouTube's failed moving-thumbnail requests return a decodable 120x90 error
 * image. Image loaders report it as loaded even though the response is a 404.
 *
 * @param {{ naturalWidth: number, naturalHeight: number }} image
 * @returns {boolean}
 */
export function isThumbnailPreviewImageUsable(image) {
  return image.naturalWidth > 0 &&
    image.naturalHeight > 0 &&
    !(image.naturalWidth === 120 && image.naturalHeight === 90)
}
