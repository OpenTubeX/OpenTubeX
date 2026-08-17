/**
 * Decide whether a renderer update represents newly owned playback rather than
 * another publication of the current Media Session state.
 * @param {{playbackState: string, ownerId: string | null} | undefined} previous
 * @param {string} playbackState
 * @param {string | null} ownerId
 * @returns {boolean}
 */
export function shouldAdvanceDockMediaSequence(previous, playbackState, ownerId) {
  return playbackState === 'playing' && (
    previous?.playbackState !== 'playing' || previous.ownerId !== ownerId
  )
}
