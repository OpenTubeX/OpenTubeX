import { YTNodes } from 'youtubei.js'

/**
 * @typedef {object} LocalVideoGame
 * @property {string} title
 * @property {string} subtitle the release year, can be empty
 * @property {string} thumbnail the box art, can be empty
 * @property {string|undefined} channelId the game's YouTube channel, undefined when it doesn't have one
 */

/**
 * `VideoAttributesSectionView` is a generic section, which also lists e.g. the people mentioned in a video.
 * Only trust it to contain games on gaming videos, and when it shows their portrait box art.
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @param {import('youtubei.js').YTNodes.VideoAttributesSectionView} section
 * @returns {boolean}
 */
export function isLocalGamesSection(videoInfo, section) {
  // The category is always in English, no matter which language the rest of the response is in.
  return videoInfo.basic_info?.category === 'Gaming' &&
    section.video_attributes.some(attribute => attribute.image_style === 'VIDEO_ATTRIBUTE_IMAGE_STYLE_PORTRAIT')
}

/**
 * Extracts the games that YouTube lists in the description of gaming videos.
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {LocalVideoGame[]}
 */
export function parseLocalVideoGames(videoInfo) {
  /** @type {import('youtubei.js').YTNodes.StructuredDescriptionContent | undefined} */
  const structuredDescription = videoInfo.page[1]?.engagement_panels
    ?.find(panel => panel.panel_identifier === 'engagement-panel-structured-description')?.content

  const games = []

  for (const section of structuredDescription?.items ?? []) {
    if (!section.is(YTNodes.VideoAttributesSectionView) || !isLocalGamesSection(videoInfo, section)) {
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
