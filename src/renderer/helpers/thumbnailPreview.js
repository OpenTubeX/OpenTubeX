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
