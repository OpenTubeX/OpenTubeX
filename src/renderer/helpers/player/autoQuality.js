/**
 * The automatic quality selection (shaka-player's ABR) was hidden everywhere in
 * FreeTube#8908, because its runtime quality switches are broken with SABR:
 * the initial selection works, but any later switch (changing network conditions,
 * resizing the player or the picture-in-picture window) runs into errors.
 *
 * Streams that don't go through SABR, like yt-dlp's and Invidious' manifests,
 * are unaffected, so auto quality can be offered for those.
 */

/**
 * Whether the currently playing streams support the automatic quality selection.
 * @param {'dash'|'audio'|'legacy'} format the legacy formats have their own quality selection
 * @param {boolean} isSabr whether the streams are served over SABR
 * @returns {boolean}
 */
export function streamsSupportAutoQuality(format, isSabr) {
  return format !== 'legacy' && !isSabr
}

/**
 * Whether the settings should offer auto as a quality, which depends on the
 * stream extraction method, as only the built-in one uses SABR.
 * @param {string} videoPlaybackEngine
 * @returns {boolean}
 */
export function playbackEngineSupportsAutoQuality(videoPlaybackEngine) {
  return !process.env.SUPPORTS_LOCAL_API || videoPlaybackEngine === 'yt-dlp'
}
