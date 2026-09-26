/**
 * Chooses the temporary audio-only format used after Android hides the video
 * surface, or restores the format the user had selected when it becomes
 * visible again.
 */
export function resolveAndroidBackgroundPlaybackFormat({
  hidden,
  continuePlayback,
  activeFormat,
  audioFormatAvailable,
  paused,
  restoreFormat = null,
}) {
  if (!hidden) {
    return restoreFormat === null
      ? null
      : { activeFormat: restoreFormat, restoreFormat: null }
  }

  if (
    !continuePlayback ||
    restoreFormat !== null ||
    activeFormat === 'audio' ||
    !audioFormatAvailable ||
    paused
  ) {
    return null
  }

  return {
    activeFormat: 'audio',
    restoreFormat: activeFormat,
  }
}
