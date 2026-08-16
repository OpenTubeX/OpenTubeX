/**
 * @typedef {object} LocalVideoCollaborator
 * @property {string} id
 * @property {string} name
 * @property {string} thumbnail
 * @property {string} subtitle
 */

const COLLABORATIVE_AUTHOR_TEXT_REGEX = /\s+and\s+/i

/**
 * YouTube replaces the regular channel link with a collaboration dialog for
 * videos with multiple authors.
 * @param {string | undefined} author
 * @returns {boolean}
 */
export function isCollaborativeVideoAuthor(author) {
  return typeof author === 'string' && COLLABORATIVE_AUTHOR_TEXT_REGEX.test(author)
}

/**
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {LocalVideoCollaborator[]}
 */
export function parseLocalVideoCollaborators(videoInfo) {
  const owner = videoInfo.secondary_info?.owner
  const author = owner?.author
  const endpoint = author?.endpoint ?? owner?.endpoint
  const collaborators = author?.collaborators?.length > 0
    ? author.collaborators
    : endpoint?.command?.inline_content?.custom_content?.items

  return collaborators?.flatMap((collaborator) => {
    const channelId = collaborator.title?.endpoint?.payload?.browseId ??
      collaborator.renderer_context?.command_context?.on_tap?.payload?.browseId
    const name = collaborator.title?.text

    return channelId && name
      ? [{
          id: channelId,
          name,
          thumbnail: collaborator.leading_accessory?.image?.[0]?.url ?? '',
          subtitle: collaborator.subtitle?.text?.replaceAll(/[\u200e\u2068\u2069]/g, '') ?? ''
        }]
      : []
  }) ?? []
}

/**
 * Resolve every channel represented by local video information. Regular
 * videos expose one owner while collaboration videos expose multiple entries.
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {LocalVideoCollaborator[]}
 */
export function parseLocalVideoChannels(videoInfo) {
  const collaborators = parseLocalVideoCollaborators(videoInfo)
  if (collaborators.length > 0) {
    return collaborators
  }

  const owner = videoInfo.secondary_info?.owner
  const author = owner?.author
  const channelId = (author?.id !== 'N/A' ? author?.id : undefined) ??
    author?.endpoint?.payload?.browseId ??
    owner?.endpoint?.payload?.browseId
  const name = author?.name

  return channelId && name
    ? [{
        id: channelId,
        name,
        thumbnail: author.best_thumbnail?.url ?? '',
        subtitle: owner.subscriber_count?.text ?? ''
      }]
    : []
}

/**
 * Resolve the channel avatar represented by local video information.
 * Collaboration videos store their primary channel in an attachment instead
 * of the regular owner thumbnail.
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {string | undefined}
 */
export function getLocalVideoAvatarUrl(videoInfo) {
  const primaryCollaborator = parseLocalVideoCollaborators(videoInfo)[0]
  return primaryCollaborator?.thumbnail || videoInfo.secondary_info?.owner?.author?.best_thumbnail?.url
}
