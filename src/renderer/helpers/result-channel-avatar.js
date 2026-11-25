/**
 * Returns the channel avatar included with a normalized or local result.
 * @param {object | null | undefined} result
 * @returns {string | null}
 */
export function getResultAuthorThumbnailUrl(result) {
  const url = result?.authorThumbnailUrl ??
    result?.authorThumbnails?.at(-1)?.url ??
    result?.author?.best_thumbnail?.url

  if (typeof url !== 'string' || url === '') {
    return null
  }

  return url.startsWith('//') ? `https:${url}` : url
}
