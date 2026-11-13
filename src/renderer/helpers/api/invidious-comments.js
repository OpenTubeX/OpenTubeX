/**
 * @param {{authorThumbnail?: string, authorThumbnails?: {url?: string}[]}} comment
 * @returns {string | null}
 */
export function getInvidiousCommentAuthorThumbnail(comment) {
  return comment.authorThumbnail || comment.authorThumbnails?.at(-1)?.url || null
}
