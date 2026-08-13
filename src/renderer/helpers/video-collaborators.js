/**
 * @typedef {object} LocalVideoCollaborator
 * @property {string} id
 * @property {string} name
 * @property {string} thumbnail
 * @property {string} subtitle
 */

/**
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {LocalVideoCollaborator[]}
 */
export function parseLocalVideoCollaborators(videoInfo) {
  const author = videoInfo.secondary_info?.owner?.author
  const collaborators = author?.collaborators?.length > 0
    ? author.collaborators
    : author?.endpoint?.command?.inline_content?.custom_content?.items

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
