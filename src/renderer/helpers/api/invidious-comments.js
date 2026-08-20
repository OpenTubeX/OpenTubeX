import { getBestQualityImageUrl } from '../images.js'

/**
 * @param {{authorThumbnail?: string, authorThumbnails?: {url?: string}[]}} comment
 * @returns {string | null}
 */
export function getInvidiousCommentAuthorThumbnail(comment) {
  return comment.authorThumbnail || getBestQualityImageUrl(comment.authorThumbnails) || null
}
