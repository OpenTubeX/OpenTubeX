/**
 * The automatic quality selection (shaka-player's ABR) was hidden everywhere in
 * FreeTube#8908, because its runtime quality switches are broken with SABR:
 * the initial selection works, but any later switch (changing network conditions,
 * resizing the player or the picture-in-picture window) runs into errors.
 *
 * Streams that don't go through SABR, like the visionOS client's, yt-dlp's and
 * Invidious' manifests, are unaffected, so auto quality can be offered for those.
 */

/** The qualities that the fallback for auto picks from, highest first. */
const AUTO_QUALITY_FALLBACKS = [1080, 720, 480, 360, 240, 144]

/**
 * The quality that a stored `auto` falls back to while auto quality is
 * unavailable: the highest one that fits the screen's short side in physical
 * pixels, which a fullscreen landscape video fills. The quality stays fixed for
 * the whole video, so it can't step down on a slow connection, which is why it
 * stops at 1080p. Anything that displays the fallback has to use this as well,
 * to agree with playback.
 * @param {{ width: number, height: number }} [screenSize]
 * @param {number} [pixelRatio]
 * @returns {string}
 */
export function getAutoQualityFallback(screenSize = window.screen, pixelRatio = window.devicePixelRatio) {
  const shortSide = Math.min(screenSize.width, screenSize.height) * pixelRatio
  const quality = AUTO_QUALITY_FALLBACKS.find(quality => quality <= shortSide) ?? AUTO_QUALITY_FALLBACKS.at(-1)

  return String(quality)
}

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
 * Whether the settings should offer auto as a quality. Only the built-in stream
 * extraction method uses SABR, and only for all videos when the user chose it.
 * Otherwise most videos play its visionOS DASH streams, and the player falls
 * back to a fixed quality for those that still use SABR.
 * @param {string} videoPlaybackEngine
 * @param {string} builtInStreams
 * @returns {boolean}
 */
export function playbackEngineSupportsAutoQuality(videoPlaybackEngine, builtInStreams) {
  return !process.env.SUPPORTS_LOCAL_API || videoPlaybackEngine === 'yt-dlp' || builtInStreams !== 'sabr'
}
