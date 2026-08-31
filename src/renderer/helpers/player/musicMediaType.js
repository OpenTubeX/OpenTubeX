export const MUSIC_MEDIA_TYPE = Object.freeze({
  AUDIO_TRACK: 'audioTrack',
  OFFICIAL_VIDEO: 'officialVideo',
  PODCAST: 'podcast',
  UNKNOWN: 'unknown',
  USER_VIDEO: 'userVideo',
})

/** @typedef {(typeof MUSIC_MEDIA_TYPE)[keyof typeof MUSIC_MEDIA_TYPE]} MusicMediaType */

const YOUTUBE_MUSIC_VIDEO_TYPES = Object.freeze({
  MUSIC_VIDEO_TYPE_ATV: MUSIC_MEDIA_TYPE.AUDIO_TRACK,
  MUSIC_VIDEO_TYPE_OMV: MUSIC_MEDIA_TYPE.OFFICIAL_VIDEO,
  MUSIC_VIDEO_TYPE_PODCAST_EPISODE: MUSIC_MEDIA_TYPE.PODCAST,
  MUSIC_VIDEO_TYPE_UGC: MUSIC_MEDIA_TYPE.USER_VIDEO,
})

const ARTIST_TOPIC_SUFFIX = ' - Topic'

/**
 * Converts YouTube's player-response value into a stable app classification.
 * Unknown values deliberately stay unknown so normal videos never receive the
 * audio-track player based on a category or channel-name guess.
 *
 * @param {unknown} musicVideoType
 * @returns {(typeof MUSIC_MEDIA_TYPE)[keyof typeof MUSIC_MEDIA_TYPE]}
 */
export function classifyMusicMediaType(musicVideoType) {
  return typeof musicVideoType === 'string'
    ? YOUTUBE_MUSIC_VIDEO_TYPES[musicVideoType] ?? MUSIC_MEDIA_TYPE.UNKNOWN
    : MUSIC_MEDIA_TYPE.UNKNOWN
}

/**
 * Invidious does not expose YouTube's musicVideoType field. Artist topic
 * channels are the conservative fallback that distinguishes auto-generated
 * audio tracks from official and user-uploaded music videos.
 *
 * @param {object} video
 * @param {unknown} video.author
 * @param {unknown} video.genre
 * @returns {(typeof MUSIC_MEDIA_TYPE)[keyof typeof MUSIC_MEDIA_TYPE]}
 */
export function classifyInvidiousMusicMediaType(video) {
  return video.genre === 'Music' &&
    typeof video.author === 'string' &&
    video.author.endsWith(ARTIST_TOPIC_SUFFIX)
    ? MUSIC_MEDIA_TYPE.AUDIO_TRACK
    : MUSIC_MEDIA_TYPE.UNKNOWN
}

/**
 * Removes Invidious' artist topic-channel suffix from the player label.
 * @param {string} author
 * @returns {string}
 */
export function getMusicTrackArtist(author) {
  return author.endsWith(ARTIST_TOPIC_SUFFIX)
    ? author.slice(0, -ARTIST_TOPIC_SUFFIX.length)
    : author
}
