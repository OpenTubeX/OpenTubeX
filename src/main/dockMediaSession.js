/**
 * Decide whether a renderer update represents newly started or resumed
 * playback rather than another publication of the current Media Session state.
 * @param {string} playbackState
 * @param {boolean} playbackStarted
 * @returns {boolean}
 */
export function shouldAdvanceDockMediaSequence(playbackState, playbackStarted) {
  return playbackState === 'playing' && playbackStarted === true
}
