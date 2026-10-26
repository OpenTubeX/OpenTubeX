import { YTNodes } from 'youtubei.js'

/**
 * @typedef {object} VideoMusicTrack
 * @property {string} title
 * @property {string} artist can be empty
 * @property {string} album can be empty
 * @property {string} license can be empty
 * @property {string} thumbnail the album art, can be empty
 * @property {string|undefined} videoId the song's video, undefined when YouTube doesn't link one
 * @property {string|undefined} channelId the artist's channel, undefined when YouTube doesn't link one
 */

/**
 * Extracts the songs that YouTube credits in the "Music" section of the description.
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 * @returns {VideoMusicTrack[]}
 */
export function parseLocalVideoMusicTracks(videoInfo) {
  /** @type {import('youtubei.js').YTNodes.StructuredDescriptionContent | undefined} */
  const structuredDescription = videoInfo.page[1]?.engagement_panels
    ?.find(panel => panel.panel_identifier === 'engagement-panel-structured-description')?.content

  const tracks = []

  // The section header is localised, but only the music section lists square album art.
  // The chapters are also a `HorizontalCardList`, with `MacroMarkersListItem` cards.
  for (const section of structuredDescription?.items ?? []) {
    if (!section.is(YTNodes.HorizontalCardList)) {
      continue
    }

    for (const card of section.cards) {
      if (!card.is(YTNodes.VideoAttributeView) || card.image_style !== 'VIDEO_ATTRIBUTE_IMAGE_STYLE_SQUARE') {
        continue
      }

      tracks.push({
        title: card.title,
        artist: card.subtitle ?? '',
        album: card.secondary_subtitle?.content ?? '',
        license: '',
        thumbnail: Array.isArray(card.image) ? (card.image[0]?.url ?? '') : '',
        videoId: card.on_tap?.payload?.videoId,
        channelId: undefined
      })
    }
  }

  if (tracks.length > 0) {
    return tracks
  }

  // The older `VideoDescriptionMusicSection` layout, parsed by YouTube.js
  return parseVideoMusicTracks(videoInfo.music_tracks)
}

/**
 * Normalises the music tracks from YouTube.js' `music_tracks` and Invidious' `musicTracks`, which share a shape.
 * Invidious doesn't return the video and channel IDs.
 * @param {{ song?: string, artist?: string, album?: string, license?: string, videoId?: string, channelId?: string }[] | undefined} musicTracks
 * @returns {VideoMusicTrack[]}
 */
export function parseVideoMusicTracks(musicTracks) {
  return (musicTracks ?? [])
    .filter(track => track.song)
    .map(track => ({
      title: track.song,
      artist: track.artist ?? '',
      album: track.album ?? '',
      license: track.license ?? '',
      thumbnail: '',
      videoId: track.videoId,
      channelId: track.channelId
    }))
}
