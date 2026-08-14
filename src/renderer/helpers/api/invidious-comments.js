/**
 * @param {{authorThumbnails?: {url?: string}[]}} comment
 * @returns {string | null}
 */
export function getInvidiousCommentAuthorThumbnail(comment) {
  return comment.authorThumbnails?.at(-1)?.url ?? null
}
