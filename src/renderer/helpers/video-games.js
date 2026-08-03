import { YTNodes } from 'youtubei.js'

/**
 * @typedef {object} LocalVideoGame
 * @property {string} title
 * @property {string} subtitle the release year, can be empty
 * @property {string} thumbnail the box art, can be empty
 * @property {string|undefined} channelId the game's YouTube channel, undefined when it doesn't have one
 */

/**
 * Extracts the games that YouTube lists in the description of gaming videos.
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {LocalVideoGame[]}
 */
export function parseLocalVideoGames(videoInfo) {
  // `VideoAttributesSectionView` is a generic section, so only trust it to contain games on gaming videos.
  // The category is always in English, no matter which language the rest of the response is in.
  if (videoInfo.basic_info?.category !== 'Gaming') {
    return []
  }

  /** @type {import('youtubei.js').YTNodes.StructuredDescriptionContent | undefined} */
  const structuredDescription = videoInfo.page[1]?.engagement_panels
    ?.find(panel => panel.panel_identifier === 'engagement-panel-structured-description')?.content

  const games = []

  for (const section of structuredDescription?.items ?? []) {
    if (!section.is(YTNodes.VideoAttributesSectionView)) {
      continue
    }

    for (const attribute of section.video_attributes) {
      // `image` is a `ContentPreviewImageView` instead of an array, when YouTube doesn't have any box art
      const boxArt = Array.isArray(attribute.image) ? attribute.image[0]?.url : undefined

      games.push({
        title: attribute.title,
        subtitle: attribute.subtitle ?? '',
        thumbnail: boxArt?.replace(/^\/\//, 'https://') ?? '',
        channelId: attribute.on_tap?.payload?.browseId
      })
    }
  }

  return games
}
