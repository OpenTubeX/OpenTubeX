import { YTNodes } from 'youtubei.js'
import { isLocalGamesSection } from './video-games.js'

/**
 * @typedef {object} VideoDescriptionSectionItem
 * @property {string} title
 * @property {string[]} details e.g. who a person is, or a podcast's channel and episode count
 * @property {string} thumbnail can be empty
 * @property {string|undefined} playlistId undefined when the item isn't a playlist
 */

/**
 * @typedef {object} VideoDescriptionSection
 * @property {string} title YouTube's heading, in the same language as the items' details
 * @property {VideoDescriptionSectionItem[]} items
 */

/**
 * Extracts the description sections that list people and things mentioned in the video, like "People mentioned",
 * and the podcast or course that the video is part of. Games and music have their own sections.
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {VideoDescriptionSection[]}
 */
export function parseLocalVideoDescriptionSections(videoInfo) {
  /** @type {import('youtubei.js').YTNodes.StructuredDescriptionContent | undefined} */
  const structuredDescription = videoInfo.page[1]?.engagement_panels
    ?.find(panel => panel.panel_identifier === 'engagement-panel-structured-description')?.content

  /** @type {VideoDescriptionSection[]} */
  const sections = []

  for (const section of structuredDescription?.items ?? []) {
    if (section.is(YTNodes.VideoAttributesSectionView) && !isLocalGamesSection(videoInfo, section)) {
      sections.push({
        title: section.header_title,
        items: section.video_attributes.map(attribute => ({
          title: attribute.title,
          details: attribute.subtitle ? [attribute.subtitle] : [],
          // `image` is a `ContentPreviewImageView` instead of an array, when YouTube doesn't have an image
          thumbnail: Array.isArray(attribute.image) ? attribute.image[0]?.url.replace(/^\/\//, 'https://') ?? '' : '',
          playlistId: undefined
        }))
      })
    } else if (section.is(YTNodes.VideoDescriptionCourseSection)) {
      sections.push({
        title: section.section_title.text ?? '',
        items: section.media_lockups.filterType(YTNodes.StructuredDescriptionPlaylistLockup).map(lockup => ({
          title: lockup.title.text ?? '',
          details: [lockup.short_byline_text?.text, lockup.video_count_short_text?.text].filter(Boolean),
          // The smallest thumbnail that stays sharp at twice its displayed size
          thumbnail: [...lockup.thumbnail].sort((a, b) => a.width - b.width).find(thumbnail => thumbnail.width >= 160)?.url ??
            lockup.thumbnail[0]?.url ?? '',
          playlistId: lockup.endpoint?.payload?.browseId?.replace(/^VL/, '')
        }))
      })
    }
  }

  return sections.filter(section => section.title && section.items.length > 0)
}
