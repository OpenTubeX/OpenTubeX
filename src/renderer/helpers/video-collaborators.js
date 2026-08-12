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
  const listItems = videoInfo.secondary_info?.owner?.author?.endpoint?.payload
    ?.panelLoadingStrategy?.inlineContent?.dialogViewModel?.customContent
    ?.listViewModel?.listItems

  if (!Array.isArray(listItems)) {
    return []
  }

  const collaborators = []
  const seenChannelIds = new Set()

  for (const item of listItems) {
    const viewModel = item.listItemViewModel
    const avatar = viewModel?.leadingAccessory?.avatarViewModel
    const channelId = viewModel?.title?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId ??
      avatar?.endpoint?.innertubeCommand?.browseEndpoint?.browseId
    const name = viewModel?.title?.content

    if (!channelId || !name || seenChannelIds.has(channelId)) {
      continue
    }

    seenChannelIds.add(channelId)
    collaborators.push({
      id: channelId,
      name,
      thumbnail: avatar?.image?.sources?.at(-1)?.url ?? '',
      subtitle: viewModel?.subtitle?.content?.replaceAll(/[\u200e\u2068\u2069]/g, '') ?? ''
    })
  }

  return collaborators
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
  return primaryCollaborator?.thumbnail ?? videoInfo.secondary_info?.owner?.author?.best_thumbnail?.url
}
